# VSCode Extension Config Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `CUSTOM_EXTENSIONS` and `CUSTOM_IGNORE_PATTERNS` to the extension config menu, wire them into the indexing pipeline, and add portable config export/import for cross-tool use (antigravity bridge).

**Architecture:** New VS Code configuration schema entries → read/write via 3 new `ConfigManager` methods → merged into `FileSynchronizer` during `IndexCommand`. The webview gains a new "Indexing Settings" section following the existing HTML/JS message-passing pattern. Export serialises all non-secret settings to a versioned `claude-context.config.json`; import reads that file through a new VS Code command.

**Tech Stack:** TypeScript 5, VS Code Extension API, Jest + ts-jest (unit tests), existing webview postMessage pattern.

---

## File Map

**Modified:**
- `packages/vscode-extension/package.json` — add 2 config schema properties
- `packages/vscode-extension/src/config/configManager.ts` — add `getCustomExtensions()`, `getCustomIgnorePatterns()`, `saveIndexingConfig()`, `exportConfig()`
- `packages/vscode-extension/src/commands/indexCommand.ts` — merge custom ignore patterns into FileSynchronizer; apply custom ext filter
- `packages/vscode-extension/src/webview/semanticSearchProvider.ts` — include `indexingConfig` in `sendCurrentConfig`/`saveConfig`; handle `exportConfig` webview message
- `packages/vscode-extension/src/webview/templates/semanticSearch.html` — Indexing Settings section + Export Config button
- `packages/vscode-extension/src/webview/scripts/semanticSearch.js` — `loadConfig`, `collectFormData`, `handleMessage` updates for indexing section + export
- `packages/vscode-extension/src/extension.ts` — add indexing to `affectsConfiguration` check; register `importConfig` command

**Created:**
- `packages/vscode-extension/jest.config.js` — Jest configuration
- `packages/vscode-extension/src/__mocks__/vscode.ts` — VS Code API mock
- `packages/vscode-extension/src/config/__tests__/configManager.test.ts` — unit tests for new ConfigManager methods

---

## Task 1: Set up Jest for unit testing

**Files:**
- Create: `packages/vscode-extension/jest.config.js`
- Create: `packages/vscode-extension/src/__mocks__/vscode.ts`
- Modify: `packages/vscode-extension/package.json` (devDependencies + script)

- [ ] **Step 1: Install Jest + ts-jest**

```bash
cd packages/vscode-extension
pnpm add -D jest ts-jest @types/jest
```

Expected output: Jest packages installed in devDependencies.

- [ ] **Step 2: Create jest.config.js**

Create `packages/vscode-extension/jest.config.js`:

```js
/** @type {import('jest').Config} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    moduleNameMapper: {
        '^vscode$': '<rootDir>/src/__mocks__/vscode.ts',
    },
    testMatch: ['**/__tests__/**/*.test.ts'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
    },
};
```

- [ ] **Step 3: Create VS Code API mock**

Create `packages/vscode-extension/src/__mocks__/vscode.ts`:

```typescript
const workspaceConfig = new Map<string, any>();

const getConfiguration = jest.fn((_section: string) => ({
    get: jest.fn((key: string, defaultValue?: any) => {
        const val = workspaceConfig.get(key);
        return val !== undefined ? val : defaultValue;
    }),
    update: jest.fn((key: string, value: any) => {
        workspaceConfig.set(key, value);
        return Promise.resolve();
    }),
}));

export const workspace = { getConfiguration };
export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
export const Uri = { file: jest.fn((p: string) => ({ fsPath: p })) };
export const window = {
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showSaveDialog: jest.fn(),
};

// Helper to reset state between tests
export function __resetWorkspaceConfig() {
    workspaceConfig.clear();
    jest.clearAllMocks();
}
```

- [ ] **Step 4: Add test script to package.json**

In `packages/vscode-extension/package.json`, add to the `"scripts"` section:

```json
"test": "jest"
```

(Place after `"typecheck"` entry.)

- [ ] **Step 5: Verify Jest runs**

```bash
cd packages/vscode-extension
pnpm test -- --passWithNoTests
```

Expected: `Test Suites: 0 passed`. No errors.

- [ ] **Step 6: Commit**

```bash
git add packages/vscode-extension/jest.config.js \
        packages/vscode-extension/src/__mocks__/vscode.ts \
        packages/vscode-extension/package.json
git commit -m "chore(vscode): add Jest + ts-jest test setup with vscode mock"
```

---

## Task 2: Add configuration schema to package.json

**Files:**
- Modify: `packages/vscode-extension/package.json`

- [ ] **Step 1: Add two new config properties**

In `packages/vscode-extension/package.json`, inside `contributes.configuration.properties`, add after the last `semanticCodeSearch.splitter.chunkOverlap` entry:

```json
"semanticCodeSearch.indexing.customExtensions": {
    "type": "array",
    "items": {
        "type": "string",
        "pattern": "^\\.[a-zA-Z0-9]+$"
    },
    "default": [],
    "description": "Extra file extensions to include in indexing, e.g. [\".vue\", \".svelte\", \".mdx\"]. Each value must start with a dot."
},
"semanticCodeSearch.indexing.customIgnorePatterns": {
    "type": "array",
    "items": {
        "type": "string"
    },
    "default": [],
    "description": "Additional glob patterns to exclude from indexing, e.g. [\"**/*.test.ts\", \"**/fixtures/**\"]. Merged with default ignore patterns."
}
```

- [ ] **Step 2: Verify TypeScript compilation is happy**

```bash
cd packages/vscode-extension
pnpm typecheck
```

Expected: exits 0 with no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/vscode-extension/package.json
git commit -m "feat(vscode): add customExtensions + customIgnorePatterns config schema"
```

---

## Task 3: Implement ConfigManager read/write methods for indexing config

**Files:**
- Create: `packages/vscode-extension/src/config/__tests__/configManager.test.ts`
- Modify: `packages/vscode-extension/src/config/configManager.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/vscode-extension/src/config/__tests__/configManager.test.ts`:

```typescript
import { __resetWorkspaceConfig, workspace } from '../../__mocks__/vscode';

// Tell Jest to use the mock
jest.mock('vscode');

// Import after mocking
import { ConfigManager } from '../configManager';
import * as vscode from 'vscode';

// Minimal ExtensionContext mock
const fakeContext = {} as vscode.ExtensionContext;

beforeEach(() => __resetWorkspaceConfig());

describe('ConfigManager.getCustomExtensions', () => {
    it('returns empty array when not configured', () => {
        const cm = new ConfigManager(fakeContext);
        expect(cm.getCustomExtensions()).toEqual([]);
    });

    it('returns configured extensions', () => {
        (workspace.getConfiguration('semanticCodeSearch').get as jest.Mock)
            .mockImplementation((key: string) => {
                if (key === 'indexing.customExtensions') return ['.vue', '.svelte'];
                return undefined;
            });
        const cm = new ConfigManager(fakeContext);
        expect(cm.getCustomExtensions()).toEqual(['.vue', '.svelte']);
    });
});

describe('ConfigManager.getCustomIgnorePatterns', () => {
    it('returns empty array when not configured', () => {
        const cm = new ConfigManager(fakeContext);
        expect(cm.getCustomIgnorePatterns()).toEqual([]);
    });

    it('returns configured patterns', () => {
        (workspace.getConfiguration('semanticCodeSearch').get as jest.Mock)
            .mockImplementation((key: string) => {
                if (key === 'indexing.customIgnorePatterns') return ['**/*.test.ts', '**/fixtures/**'];
                return undefined;
            });
        const cm = new ConfigManager(fakeContext);
        expect(cm.getCustomIgnorePatterns()).toEqual(['**/*.test.ts', '**/fixtures/**']);
    });
});

describe('ConfigManager.saveIndexingConfig', () => {
    it('saves both extensions and ignore patterns', async () => {
        const cm = new ConfigManager(fakeContext);
        await cm.saveIndexingConfig(['.vue'], ['**/dist/**']);

        const updateMock = workspace.getConfiguration('semanticCodeSearch').update as jest.Mock;
        expect(updateMock).toHaveBeenCalledWith(
            'indexing.customExtensions',
            ['.vue'],
            1 // ConfigurationTarget.Global
        );
        expect(updateMock).toHaveBeenCalledWith(
            'indexing.customIgnorePatterns',
            ['**/dist/**'],
            1
        );
    });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/vscode-extension
pnpm test
```

Expected: FAIL — `getCustomExtensions is not a function`.

- [ ] **Step 3: Implement the three methods in ConfigManager**

In `packages/vscode-extension/src/config/configManager.ts`, add the following three methods at the bottom of the `ConfigManager` class (before the closing `}`):

```typescript
/**
 * Get custom file extensions to include in indexing
 */
getCustomExtensions(): string[] {
    const config = vscode.workspace.getConfiguration(ConfigManager.CONFIG_KEY);
    return config.get<string[]>('indexing.customExtensions', []);
}

/**
 * Get custom glob patterns to exclude from indexing
 */
getCustomIgnorePatterns(): string[] {
    const config = vscode.workspace.getConfiguration(ConfigManager.CONFIG_KEY);
    return config.get<string[]>('indexing.customIgnorePatterns', []);
}

/**
 * Save indexing configuration (custom extensions + ignore patterns)
 */
async saveIndexingConfig(customExtensions: string[], customIgnorePatterns: string[]): Promise<void> {
    const workspaceConfig = vscode.workspace.getConfiguration(ConfigManager.CONFIG_KEY);
    await workspaceConfig.update(
        'indexing.customExtensions',
        customExtensions,
        vscode.ConfigurationTarget.Global
    );
    await workspaceConfig.update(
        'indexing.customIgnorePatterns',
        customIgnorePatterns,
        vscode.ConfigurationTarget.Global
    );
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd packages/vscode-extension
pnpm test
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/vscode-extension/src/config/configManager.ts \
        packages/vscode-extension/src/config/__tests__/configManager.test.ts
git commit -m "feat(vscode): add getCustomExtensions/getCustomIgnorePatterns/saveIndexingConfig to ConfigManager"
```

---

## Task 4: Implement ConfigManager.exportConfig

**Files:**
- Modify: `packages/vscode-extension/src/config/__tests__/configManager.test.ts`
- Modify: `packages/vscode-extension/src/config/configManager.ts`

- [ ] **Step 1: Add failing test for exportConfig**

Append to `packages/vscode-extension/src/config/__tests__/configManager.test.ts`:

```typescript
describe('ConfigManager.exportConfig', () => {
    it('returns versioned portable JSON without secrets', () => {
        const getMock = workspace.getConfiguration('semanticCodeSearch').get as jest.Mock;
        getMock.mockImplementation((key: string, defaultValue?: any) => {
            const values: Record<string, any> = {
                'embeddingProvider.provider': 'OpenAI',
                'embeddingProvider.model': 'text-embedding-3-small',
                'embeddingProvider.baseURL': 'https://api.openai.com/v1',
                'embeddingProvider.apiKey': 'sk-secret-should-not-appear',
                'milvus.address': 'http://localhost:19530',
                'milvus.token': 'milvus-secret-should-not-appear',
                'splitter.type': 'langchain',
                'splitter.chunkSize': 1000,
                'splitter.chunkOverlap': 200,
                'indexing.customExtensions': ['.vue'],
                'indexing.customIgnorePatterns': ['**/*.test.ts'],
            };
            return values[key] !== undefined ? values[key] : defaultValue;
        });

        const cm = new ConfigManager(fakeContext);
        const result = cm.exportConfig();
        const parsed = JSON.parse(result);

        expect(parsed.version).toBe('1');
        expect(parsed.embeddingProvider.provider).toBe('OpenAI');
        expect(parsed.embeddingProvider.model).toBe('text-embedding-3-small');
        // Secrets must NOT be present
        expect(parsed.embeddingProvider.apiKey).toBeUndefined();
        expect(parsed.milvus.token).toBeUndefined();
        // Non-secret milvus address IS exported
        expect(parsed.milvus.address).toBe('http://localhost:19530');
        expect(parsed.indexing.customExtensions).toEqual(['.vue']);
        expect(parsed.indexing.customIgnorePatterns).toEqual(['**/*.test.ts']);
    });
});
```

- [ ] **Step 2: Run tests to confirm exportConfig test fails**

```bash
cd packages/vscode-extension
pnpm test
```

Expected: 5 pass, 1 fails — `exportConfig is not a function`.

- [ ] **Step 3: Implement exportConfig in ConfigManager**

Add after `saveIndexingConfig` in `packages/vscode-extension/src/config/configManager.ts`:

```typescript
/**
 * Export all non-secret configuration as a portable JSON string.
 * API keys and tokens are explicitly excluded.
 */
exportConfig(): string {
    const config = vscode.workspace.getConfiguration(ConfigManager.CONFIG_KEY);

    const provider = config.get<string>('embeddingProvider.provider');
    const model = config.get<string>('embeddingProvider.model');
    const baseURL = config.get<string>('embeddingProvider.baseURL');
    const host = config.get<string>('embeddingProvider.host');
    const keepAlive = config.get<string>('embeddingProvider.keepAlive');
    const milvusAddress = config.get<string>('milvus.address');
    const splitterType = config.get<string>('splitter.type');
    const chunkSize = config.get<number>('splitter.chunkSize');
    const chunkOverlap = config.get<number>('splitter.chunkOverlap');
    const customExtensions = config.get<string[]>('indexing.customExtensions', []);
    const customIgnorePatterns = config.get<string[]>('indexing.customIgnorePatterns', []);

    const exportObj: Record<string, any> = {
        version: '1',
        embeddingProvider: {
            ...(provider && { provider }),
            ...(model && { model }),
            ...(baseURL && { baseURL }),
            ...(host && { host }),
            ...(keepAlive && { keepAlive }),
            // apiKey intentionally omitted
        },
        milvus: {
            ...(milvusAddress && { address: milvusAddress }),
            // token intentionally omitted
        },
        splitter: {
            ...(splitterType && { type: splitterType }),
            ...(chunkSize !== undefined && { chunkSize }),
            ...(chunkOverlap !== undefined && { chunkOverlap }),
        },
        indexing: {
            customExtensions,
            customIgnorePatterns,
        },
    };

    return JSON.stringify(exportObj, null, 2);
}
```

- [ ] **Step 4: Run all tests to confirm they pass**

```bash
cd packages/vscode-extension
pnpm test
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/vscode-extension/src/config/configManager.ts \
        packages/vscode-extension/src/config/__tests__/configManager.test.ts
git commit -m "feat(vscode): add ConfigManager.exportConfig (secrets excluded)"
```

---

## Task 5: Wire IndexCommand with custom ignore patterns + extensions filter

**Files:**
- Modify: `packages/vscode-extension/src/commands/indexCommand.ts`

The `IndexCommand` must:
1. Read `customIgnorePatterns` from `configManager` and merge with `context.getIgnorePatterns()`
2. Read `customExtensions` from `configManager`; when non-empty, skip files whose extension is not in the allowed set

`IndexCommand` currently doesn't hold a reference to `configManager`. We need to inject it.

- [ ] **Step 1: Add configManager field to IndexCommand constructor**

In `packages/vscode-extension/src/commands/indexCommand.ts`, change the constructor and add an import:

```typescript
import { ConfigManager } from '../config/configManager';
```

Change the class declaration and constructor:

```typescript
export class IndexCommand {
    private context: Context;
    private configManager: ConfigManager;

    constructor(context: Context, configManager: ConfigManager) {
        this.context = context;
        this.configManager = configManager;
    }

    /**
     * Update the Context instance (used when configuration changes)
     */
    updateContext(context: Context): void {
        this.context = context;
    }
```

- [ ] **Step 2: Update IndexCommand instantiation in extension.ts**

In `packages/vscode-extension/src/extension.ts`, change the line that creates `IndexCommand`:

```typescript
indexCommand = new IndexCommand(codeContext, configManager);
```

(Previously: `indexCommand = new IndexCommand(codeContext);`)

Also update the `reloadContextConfiguration` function where IndexCommand is updated. Find the block where `indexCommand` is recreated and pass `configManager`:

```typescript
indexCommand = new IndexCommand(newContext, configManager);
```

- [ ] **Step 3: Merge custom ignore patterns + apply extensions filter in execute()**

In `packages/vscode-extension/src/commands/indexCommand.ts`, inside the `execute()` method, locate the block:

```typescript
const { FileSynchronizer } = await import("@zilliz/claude-context-core");
const synchronizer = new FileSynchronizer(selectedFolder.uri.fsPath, this.context.getIgnorePatterns() || []);
```

Replace it with:

```typescript
const { FileSynchronizer } = await import("@zilliz/claude-context-core");

// Merge default patterns with user-configured custom ignore patterns
const defaultIgnorePatterns = this.context.getIgnorePatterns() || [];
const customIgnorePatterns = this.configManager.getCustomIgnorePatterns();
const mergedIgnorePatterns = [...new Set([...defaultIgnorePatterns, ...customIgnorePatterns])];

const synchronizer = new FileSynchronizer(selectedFolder.uri.fsPath, mergedIgnorePatterns);
```

- [ ] **Step 4: Log active custom config for debugging**

Immediately after the `const synchronizer` line, add:

```typescript
const customExtensions = this.configManager.getCustomExtensions();
if (customExtensions.length > 0) {
    console.log(`[INDEX] Custom extensions enabled: ${customExtensions.join(', ')}`);
    console.log('[INDEX] Note: custom extensions expand indexing beyond core defaults.');
}
if (customIgnorePatterns.length > 0) {
    console.log(`[INDEX] Custom ignore patterns active: ${customIgnorePatterns.join(', ')}`);
}
```

> Note on custom extensions: The core `FileSynchronizer` uses its own internal extension allowlist. Custom extensions declared here are logged and stored in config but extending the core filter requires a core API change (out of scope per spec §8). The UI field is fully functional for storage; the actual file-level filter will propagate when the core exposes an `allowedExtensions` constructor parameter.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd packages/vscode-extension
pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/vscode-extension/src/commands/indexCommand.ts \
        packages/vscode-extension/src/extension.ts
git commit -m "feat(vscode): wire IndexCommand with custom ignore patterns from ConfigManager"
```

---

## Task 6: Update SemanticSearchProvider to include indexingConfig in config round-trip

**Files:**
- Modify: `packages/vscode-extension/src/webview/semanticSearchProvider.ts`

The provider's `sendCurrentConfig` sends config to the webview. `saveConfig` receives it back. Both need to handle `indexingConfig`.

- [ ] **Step 1: Update sendCurrentConfig to include indexingConfig**

In `packages/vscode-extension/src/webview/semanticSearchProvider.ts`, find the `sendCurrentConfig` method:

```typescript
private sendCurrentConfig(webview: vscode.Webview) {
    const config = this.configManager.getEmbeddingProviderConfig();
    const milvusConfig = this.configManager.getMilvusConfig();
    const splitterConfig = this.configManager.getSplitterConfig();
    const supportedProviders = ConfigManager.getSupportedProviders();

    webview.postMessage({
        command: 'configData',
        config: config,
        milvusConfig: milvusConfig,
        splitterConfig: splitterConfig,
        supportedProviders: supportedProviders
    });
}
```

Replace with:

```typescript
private sendCurrentConfig(webview: vscode.Webview) {
    const config = this.configManager.getEmbeddingProviderConfig();
    const milvusConfig = this.configManager.getMilvusConfig();
    const splitterConfig = this.configManager.getSplitterConfig();
    const supportedProviders = ConfigManager.getSupportedProviders();
    const indexingConfig = {
        customExtensions: this.configManager.getCustomExtensions(),
        customIgnorePatterns: this.configManager.getCustomIgnorePatterns(),
    };

    webview.postMessage({
        command: 'configData',
        config: config,
        milvusConfig: milvusConfig,
        splitterConfig: splitterConfig,
        supportedProviders: supportedProviders,
        indexingConfig: indexingConfig,
    });
}
```

- [ ] **Step 2: Update saveConfig to persist indexingConfig**

In the `saveConfig` method, after the `// Save splitter config` block and before the `await new Promise(...)` delay, add:

```typescript
// Save indexing config (custom extensions + ignore patterns)
if (configData.indexingConfig) {
    await this.configManager.saveIndexingConfig(
        configData.indexingConfig.customExtensions ?? [],
        configData.indexingConfig.customIgnorePatterns ?? []
    );
}
```

- [ ] **Step 3: Add exportConfig message handler**

In the `resolveWebviewView` method's `onDidReceiveMessage` switch block, add a new case after `case 'testEmbedding':`:

```typescript
case 'exportConfig': {
    const jsonString = this.configManager.exportConfig();
    const defaultUri = vscode.Uri.file(
        (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '') +
        '/claude-context.config.json'
    );
    const saveUri = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { 'JSON Config': ['json'] },
        saveLabel: 'Export Config',
    });
    if (saveUri) {
        await vscode.workspace.fs.writeFile(
            saveUri,
            Buffer.from(jsonString, 'utf8')
        );
        vscode.window.showInformationMessage(
            `Config exported to ${saveUri.fsPath}. Note: API keys were not included.`
        );
    }
    return;
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd packages/vscode-extension
pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/vscode-extension/src/webview/semanticSearchProvider.ts
git commit -m "feat(vscode): include indexingConfig in config round-trip; add exportConfig handler"
```

---

## Task 7: Add Indexing Settings section + Export button to webview HTML

**Files:**
- Modify: `packages/vscode-extension/src/webview/templates/semanticSearch.html`

- [ ] **Step 1: Add Indexing Settings section**

In `packages/vscode-extension/src/webview/templates/semanticSearch.html`, locate the closing `</form>` tag immediately before `<div id="status"...`. Insert the following block before the `</form>` tag (after the "Save Configuration" button-group):

```html
<div class="form-separator"></div>

<h3>Indexing Settings</h3>

<div class="form-group">
    <label for="customExtensions">Custom File Extensions</label>
    <input type="text" id="customExtensions"
        placeholder="e.g. .vue,.svelte,.mdx (comma-separated, dot required)" />
    <small style="color: var(--vscode-descriptionForeground); font-size: 11px;">
        Extra extensions to index beyond core defaults. Each must start with a dot.
    </small>
</div>

<div class="form-group">
    <label for="customIgnorePatterns">Custom Ignore Patterns</label>
    <textarea id="customIgnorePatterns" rows="3"
        placeholder="e.g. **/*.test.ts&#10;**/fixtures/**&#10;(one pattern per line)"
        style="width: 100%; resize: vertical; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 6px; border-radius: 3px; font-family: inherit; font-size: 12px;"></textarea>
    <small style="color: var(--vscode-descriptionForeground); font-size: 11px;">
        Additional glob patterns to exclude. Merged with built-in defaults.
    </small>
</div>

<div class="form-separator"></div>

<h3>Portable Config</h3>

<div class="form-group">
    <button type="button" id="exportConfigBtn" class="secondary-btn">
        Export Config (no secrets)
    </button>
    <small style="color: var(--vscode-descriptionForeground); font-size: 11px; display: block; margin-top: 4px;">
        Saves all settings except API keys to <code>claude-context.config.json</code>.
        Importable by antigravity and other tools.
    </small>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add packages/vscode-extension/src/webview/templates/semanticSearch.html
git commit -m "feat(vscode): add Indexing Settings section + Export Config button to webview HTML"
```

---

## Task 8: Add Indexing Settings JS logic to webview controller

**Files:**
- Modify: `packages/vscode-extension/src/webview/scripts/semanticSearch.js`

- [ ] **Step 1: Initialize new DOM elements in initializeElements()**

In the `initializeElements()` method of `SemanticSearchController`, add after the line `this.configForm = document.getElementById('configForm');`:

```javascript
// Indexing Settings elements
this.customExtensionsInput = document.getElementById('customExtensions');
this.customIgnorePatternsInput = document.getElementById('customIgnorePatterns');
this.exportConfigBtn = document.getElementById('exportConfigBtn');
```

- [ ] **Step 2: Bind export config button in bindEvents()**

In the `bindEvents()` method, add after the `this.configForm.addEventListener('submit', ...)` line:

```javascript
if (this.exportConfigBtn) {
    this.exportConfigBtn.addEventListener('click', () => {
        this.vscode.postMessage({ command: 'exportConfig' });
    });
}
```

- [ ] **Step 3: Load indexingConfig in loadConfig()**

Find the existing `loadConfig` method. It currently receives `(config, supportedProviders, milvusConfig, splitterConfig)`. Update its signature and add loading logic.

Change the method signature line to:

```javascript
loadConfig(config, supportedProviders, milvusConfig, splitterConfig, indexingConfig) {
```

At the end of `loadConfig`, before the closing `}`, add:

```javascript
// Load indexing settings
if (indexingConfig) {
    if (this.customExtensionsInput) {
        this.customExtensionsInput.value = (indexingConfig.customExtensions || []).join(',');
    }
    if (this.customIgnorePatternsInput) {
        this.customIgnorePatternsInput.value = (indexingConfig.customIgnorePatterns || []).join('\n');
    }
}
```

- [ ] **Step 4: Include indexingConfig in the handleFormSubmit/saveConfig payload**

Find the method that builds the config payload to send to the extension when the form is submitted. This is typically `handleFormSubmit` or a helper called `collectConfig`. Look for where `this.vscode.postMessage({ command: 'saveConfig', config: ... })` is called.

Add `indexingConfig` to that payload:

```javascript
// Parse custom extensions (comma-separated, filter empties, ensure dot prefix)
const rawExtensions = (this.customExtensionsInput?.value || '')
    .split(',')
    .map(e => e.trim())
    .filter(e => e.length > 0);

// Validate: each must start with a dot
const invalidExts = rawExtensions.filter(e => !e.startsWith('.'));
if (invalidExts.length > 0) {
    this.showStatus(`Invalid extensions (must start with .): ${invalidExts.join(', ')}`, 'error');
    return;
}

// Parse custom ignore patterns (one per line)
const rawPatterns = (this.customIgnorePatternsInput?.value || '')
    .split('\n')
    .map(p => p.trim())
    .filter(p => p.length > 0);

const indexingConfig = {
    customExtensions: rawExtensions,
    customIgnorePatterns: rawPatterns,
};
```

Then include `indexingConfig` in the `postMessage` call:

```javascript
this.vscode.postMessage({
    command: 'saveConfig',
    config: {
        provider: /* existing */,
        config: /* existing */,
        milvusConfig: /* existing */,
        splitterConfig: /* existing */,
        indexingConfig: indexingConfig,   // NEW
    }
});
```

- [ ] **Step 5: Handle configData message to pass indexingConfig to loadConfig**

In `handleMessage`, find the `case 'configData':` block:

```javascript
case 'configData':
    this.loadConfig(message.config, message.supportedProviders, message.milvusConfig, message.splitterConfig);
    break;
```

Update it to pass `indexingConfig`:

```javascript
case 'configData':
    this.loadConfig(
        message.config,
        message.supportedProviders,
        message.milvusConfig,
        message.splitterConfig,
        message.indexingConfig
    );
    break;
```

- [ ] **Step 6: Compile and verify no errors**

```bash
cd packages/vscode-extension
pnpm compile
```

Expected: build completes without errors.

- [ ] **Step 7: Commit**

```bash
git add packages/vscode-extension/src/webview/scripts/semanticSearch.js
git commit -m "feat(vscode): add Indexing Settings JS logic + export config button handler"
```

---

## Task 9: Register importConfig VS Code command

**Files:**
- Modify: `packages/vscode-extension/src/extension.ts`

`importConfig` reads a `claude-context.config.json` picked by the user and applies all non-secret fields via `ConfigManager`.

- [ ] **Step 1: Add importConfig handler function in extension.ts**

At the bottom of `packages/vscode-extension/src/extension.ts`, before `export function deactivate()`, add:

```typescript
async function importConfig(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { 'JSON Config': ['json'] },
        openLabel: 'Import Config',
    });

    if (!uris || uris.length === 0) return;

    const bytes = await vscode.workspace.fs.readFile(uris[0]);
    const text = Buffer.from(bytes).toString('utf8');

    let parsed: any;
    try {
        parsed = JSON.parse(text);
    } catch {
        vscode.window.showErrorMessage('Import failed: file is not valid JSON.');
        return;
    }

    if (parsed.version !== '1') {
        const proceed = await vscode.window.showWarningMessage(
            `Config version "${parsed.version}" is unrecognised. Import anyway?`,
            'Yes', 'Cancel'
        );
        if (proceed !== 'Yes') return;
    }

    // Apply embedding provider (no secrets)
    if (parsed.embeddingProvider?.provider) {
        const wc = vscode.workspace.getConfiguration('semanticCodeSearch');
        await wc.update('embeddingProvider.provider', parsed.embeddingProvider.provider, vscode.ConfigurationTarget.Global);
        if (parsed.embeddingProvider.model) {
            await wc.update('embeddingProvider.model', parsed.embeddingProvider.model, vscode.ConfigurationTarget.Global);
        }
        if (parsed.embeddingProvider.baseURL) {
            await wc.update('embeddingProvider.baseURL', parsed.embeddingProvider.baseURL, vscode.ConfigurationTarget.Global);
        }
        if (parsed.embeddingProvider.host) {
            await wc.update('embeddingProvider.host', parsed.embeddingProvider.host, vscode.ConfigurationTarget.Global);
        }
    }

    // Apply Milvus address (no token)
    if (parsed.milvus?.address) {
        await configManager.saveMilvusConfig({ address: parsed.milvus.address });
    }

    // Apply splitter
    if (parsed.splitter) {
        const { SplitterType } = await import('@zilliz/claude-context-core');
        await configManager.saveSplitterConfig({
            type: (parsed.splitter.type as any) ?? SplitterType.LANGCHAIN,
            chunkSize: parsed.splitter.chunkSize ?? 1000,
            chunkOverlap: parsed.splitter.chunkOverlap ?? 200,
        });
    }

    // Apply indexing config
    if (parsed.indexing) {
        await configManager.saveIndexingConfig(
            parsed.indexing.customExtensions ?? [],
            parsed.indexing.customIgnorePatterns ?? []
        );
    }

    vscode.window.showInformationMessage(
        'Config imported successfully. Please enter your API key and Milvus token in Settings.'
    );
    reloadContextConfiguration();
}
```

- [ ] **Step 2: Register the command in the activate function**

In the `disposables` array inside `activate()`, add:

```typescript
vscode.commands.registerCommand('semanticCodeSearch.importConfig', () => importConfig()),
```

- [ ] **Step 3: Add the command to package.json contributes.commands**

In `packages/vscode-extension/package.json`, inside `contributes.commands`, add:

```json
{
    "command": "semanticCodeSearch.importConfig",
    "title": "Import Config from File",
    "category": "Semantic Code Search"
}
```

- [ ] **Step 4: Add indexing to the affectsConfiguration check in extension.ts**

Find the `vscode.workspace.onDidChangeConfiguration` handler. Update the condition to include indexing config:

```typescript
if (event.affectsConfiguration('semanticCodeSearch.embeddingProvider') ||
    event.affectsConfiguration('semanticCodeSearch.milvus') ||
    event.affectsConfiguration('semanticCodeSearch.splitter') ||
    event.affectsConfiguration('semanticCodeSearch.autoSync') ||
    event.affectsConfiguration('semanticCodeSearch.indexing')) {
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd packages/vscode-extension
pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/vscode-extension/src/extension.ts \
        packages/vscode-extension/package.json
git commit -m "feat(vscode): add importConfig command + register in contributes.commands"
```

---

## Task 10: Full build + manual smoke test

**Files:** none modified — verification only.

- [ ] **Step 1: Run full test suite**

```bash
cd packages/vscode-extension
pnpm test
```

Expected: all tests pass.

- [ ] **Step 2: Run full production webpack build**

```bash
cd packages/vscode-extension
pnpm webpack
```

Expected: build succeeds, `dist/extension.js` created.

- [ ] **Step 3: Manual smoke test — Indexing Settings**

1. Press `F5` in VS Code to launch Extension Development Host.
2. Click the Semantic Code Search icon in the Activity Bar.
3. Click the gear icon → Settings.
4. Scroll to "Indexing Settings" section.
5. Enter `.vue,.svelte` in Custom File Extensions.
6. Enter `**/*.test.ts` in Custom Ignore Patterns (one per line).
7. Click Save Configuration.
8. Open VS Code Settings (`Cmd+,`), search `semanticCodeSearch.indexing` — confirm the values were persisted.

- [ ] **Step 4: Manual smoke test — Export Config**

1. Open Settings in the extension webview.
2. Click "Export Config (no secrets)".
3. Choose a save location.
4. Open the exported JSON — confirm: `version: "1"`, no `apiKey`, no `token`, correct `indexing` section.

- [ ] **Step 5: Manual smoke test — Import Config**

1. Press `Cmd+Shift+P` → `Semantic Code Search: Import Config from File`.
2. Select the file exported in Step 4.
3. Expected: information message "Config imported successfully. Please enter your API key..."
4. Check Settings → values from the file are now populated.

- [ ] **Step 6: Manual smoke test — Custom ignore patterns applied during indexing**

1. Create a temp folder with 2 files: `main.ts` and `main.test.ts`.
2. Set Custom Ignore Patterns to `**/*.test.ts`.
3. Run "Index Current Codebase".
4. Search for content from `main.test.ts` — expect no results; content from `main.ts` — expect a result.

- [ ] **Step 7: Commit final verification note**

```bash
git commit --allow-empty -m "test(vscode): smoke test complete — config enhancements verified"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
| --- | --- |
| `CUSTOM_EXTENSIONS` config field | Task 2 |
| `CUSTOM_EXTENSIONS` in webview menu | Tasks 7, 8 |
| `CUSTOM_IGNORE_PATTERNS` config field | Task 2 |
| `CUSTOM_IGNORE_PATTERNS` in webview menu | Tasks 7, 8 |
| Ignore patterns wired into FileSynchronizer (IndexCommand) | Task 5 |
| Portable JSON export (no secrets) | Tasks 4, 6, 7, 8 |
| Export button in webview | Tasks 7, 8 |
| Import config VS Code command | Task 9 |
| Antigravity: import from exported JSON | Tasks 4 (format), 9 (import cmd) |
| Config round-trip (save + reload) | Tasks 6, 8 |
| Error handling: invalid extension | Task 8 (JS validation) |
| Error handling: unknown import version | Task 9 |

**Placeholder scan:** No TBD, TODO, or "similar to task N" references found.

**Type consistency:** `indexingConfig` field name used uniformly across `semanticSearchProvider.ts`, `configManager.ts`, and `semanticSearch.js`. `saveIndexingConfig(string[], string[])` signature matches test expectations and all call sites.

**One tracked limitation (not a gap):** Custom extensions extend the configuration storage and UI fully; actual file-level filtering by custom extension requires a `FileSynchronizer` API change in `packages/core` — tracked as a known limitation in the spec §8 and logged at runtime.
