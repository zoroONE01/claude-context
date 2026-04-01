# Design Spec: VSCode Extension Config Enhancements + Antigravity Support

**Date:** 2026-04-01  
**Status:** Draft — awaiting user review

---

## 1. Summary

Three enhancements to the `vscode-extension` package:

1. **`CUSTOM_EXTENSIONS`** — config field + webview UI so users can add file extensions beyond what the core recognizes (e.g. `.vue`, `.svelte`, `.mdx`)
2. **`CUSTOM_IGNORE_PATTERNS`** — config field + webview UI for extra glob patterns to exclude during indexing (e.g. `**/*.test.ts`, `**/fixtures/**`)
3. **Portable output + antigravity support** — export/import of non-secret config as a portable JSON file, enabling the same Milvus index to be reused by other tools (assumed: "antigravity" is an AI coding platform with its own plugin/MCP mechanism)

> **Assumption about "antigravity":** Not found in the codebase. Assumed to be a separate AI coding tool or IDE that can connect to the same Milvus vector database and read a shared config JSON. If antigravity has its own extension system, it uses the existing `packages/mcp` server as the bridge. This assumption must be confirmed by the user — implementation details for the antigravity adapter may need adjustment.

---

## 2. Context: Current State

- Extension: `packages/vscode-extension` — VS Code extension "Semantic Code Search"
- Config managed via `ConfigManager` (reads/writes VS Code workspace configuration)
- Index flow: `IndexCommand` → `FileSynchronizer(path, ignorePatterns)` → `context.indexCodebase()`
- Sync flow: `SyncCommand` → `context.reindexByChange()`
- Webview config panel supports: Embedding Provider, Milvus, Splitter, Auto-Sync
- The project also contains `packages/mcp` — an MCP server that exposes the same Milvus index

---

## 3. Approaches Considered

### Option A — VS Code Settings Only (minimal)
Add both fields purely as VS Code configuration properties (editable via `settings.json`). No webview changes.

- **Pro:** Minimal code changes
- **Con:** Poor discoverability; users unlikely to find these settings; no portable export

### Option B — VS Code Settings + Webview "Indexing" Section + Portable Export (recommended)
Add fields to `package.json` configuration, add a new "Indexing" section in the webview config panel following existing patterns, wire into `FileSynchronizer`, and add an Export/Import Config action to produce a portable JSON.

- **Pro:** Consistent UX with existing config sections; discoverable; addresses all three requirements
- **Con:** More files to touch; export format needs versioning

### Option C — Full Antigravity Adapter Package
Create a new `packages/antigravity-extension` similar to `packages/vscode-extension`, with full installation support for the antigravity platform.

- **Pro:** Clean separation; full native support
- **Con:** Requires knowing antigravity's extension API; out of scope until antigravity is confirmed

**Recommendation: Option B.** Implement the config UI and portable export now. Antigravity-specific adapter is deferred until the platform API is confirmed.

---

## 4. Design

### 4.1 New VS Code Configuration Fields

Add to `package.json` → `contributes.configuration.properties`:

```json
"semanticCodeSearch.indexing.customExtensions": {
  "type": "array",
  "items": { "type": "string" },
  "default": [],
  "description": "Extra file extensions to include in indexing (e.g. [\".vue\", \".svelte\", \".mdx\"]). Dot prefix required."
},
"semanticCodeSearch.indexing.customIgnorePatterns": {
  "type": "array",
  "items": { "type": "string" },
  "default": [],
  "description": "Additional glob patterns to exclude from indexing (e.g. [\"**/*.test.ts\", \"**/fixtures/**\"])."
}
```

### 4.2 ConfigManager Changes

Add two new methods to `ConfigManager`:

```typescript
getCustomExtensions(): string[]
getCustomIgnorePatterns(): string[]
saveIndexingConfig(extensions: string[], ignorePatterns: string[]): Promise<void>
```

The `PluginConfig` interface gains an `indexingConfig` field:

```typescript
export interface PluginConfig {
  embeddingProvider?: EmbeddingProviderConfig;
  splitterProvider?: SplitterProviderConfig;
  milvusConfig?: MilvusWebConfig;
  splitterConfig?: SplitterConfig;
  indexingConfig?: {          // NEW
    customExtensions: string[];
    customIgnorePatterns: string[];
  };
}
```

### 4.3 IndexCommand + SyncCommand Wiring

**IndexCommand** (`src/commands/indexCommand.ts`):
- After reading `configManager.getCustomIgnorePatterns()`, merge with `this.context.getIgnorePatterns()` before passing to `FileSynchronizer`
- Pass `customExtensions` to `context.indexCodebase()` — if the core `Context.indexCodebase` does not yet accept an extensions filter, add a pre-indexing file-list filter that excludes files whose extension is not in the allowed set (union of core defaults + custom)

**SyncCommand** (`src/commands/syncCommand.ts`):
- Same: merge custom ignore patterns when creating / updating `FileSynchronizer`

> **Edge case:** If both arrays are empty (default), behavior is identical to current — no regression.

### 4.4 Webview Config Panel — New "Indexing" Section

Add a collapsible "Indexing Settings" section in the webview HTML template (`src/webview/templates/semanticSearch.html`) and its JS (`src/webview/scripts/semanticSearch.js`), following the same pattern as the existing Embedding Provider and Milvus sections:

- **Custom File Extensions:** tag-style input (comma-separated), validated to start with `.`
- **Custom Ignore Patterns:** textarea or tag-style input (one pattern per line or comma-separated)
- A "Save Indexing Settings" button that sends `saveConfig` message (reuses existing save flow)

The `semanticSearchProvider.ts` `saveConfig()` handler already passes the full config through — it needs to be extended to read and persist `indexingConfig`.

### 4.5 Portable Config Export / Import (Antigravity + Cross-tool)

**Export:**
- Add an "Export Config" button in the webview
- Action: generates a `claude-context.config.json` file and offers a "Save As" dialog
- Format (version-stamped, secrets excluded):

```json
{
  "version": "1",
  "embeddingProvider": {
    "provider": "OpenAI",
    "model": "text-embedding-3-small",
    "baseURL": "https://api.openai.com/v1"
  },
  "milvus": {
    "address": "http://localhost:19530"
  },
  "splitter": {
    "type": "langchain",
    "chunkSize": 1000,
    "chunkOverlap": 200
  },
  "indexing": {
    "customExtensions": [".vue", ".svelte"],
    "customIgnorePatterns": ["**/*.test.ts", "**/fixtures/**"]
  }
}
```

API keys/tokens are **never** included in exports.

**Import (VS Code):**
- Register a new command `semanticCodeSearch.importConfig`
- Opens a file picker → reads JSON → validates → applies to VS Code workspace config via `ConfigManager`
- Prompts user to enter secrets (API key, Milvus token) after import

**Antigravity import:**
- The same `claude-context.config.json` serves as the input for antigravity's configuration
- Antigravity connects to the same Milvus instance → reads the already-indexed vectors → no re-indexing needed
- Antigravity-specific installation (e.g. MCP server config, plugin manifest) is **TBD** pending confirmation of what antigravity's plugin API looks like
- Likely path: `packages/mcp` already provides an MCP server; antigravity likely supports MCP tools — the config JSON tells antigravity which Milvus endpoint to query

---

## 5. Data Flow

```
User → Webview "Indexing" section
  → saves customExtensions + customIgnorePatterns
  → ConfigManager.saveIndexingConfig()
  → VS Code WorkspaceConfiguration

IndexCommand.execute()
  → ConfigManager.getCustomIgnorePatterns() → merged with context.getIgnorePatterns()
  → FileSynchronizer(path, mergedIgnorePatterns)
  → ConfigManager.getCustomExtensions() → file extension filter applied
  → context.indexCodebase(path, ...)

Export flow:
  → "Export Config" button
  → ConfigManager.exportConfig() → claude-context.config.json (no secrets)
  → user saves file → shares with team / imports in antigravity
```

---

## 6. Error Handling

| Scenario | Behavior |
|---|---|
| Invalid extension (no leading dot) | Webview shows inline validation error; prevents save |
| Invalid glob pattern | Warn but allow save; malformed patterns are logged and skipped at sync time |
| Import JSON missing required fields | Show error message listing missing fields; partial import not applied |
| Import JSON version mismatch | Show warning; attempt best-effort mapping |

---

## 7. Testing

- Unit tests for `ConfigManager` new methods (getCustomExtensions, getCustomIgnorePatterns, saveIndexingConfig, exportConfig, importConfig)
- Integration test: index a folder with `.vue` files where `.vue` is in `customExtensions` → assert files are indexed
- Integration test: ignore pattern `**/fixtures/**` → assert fixture files are excluded
- Export → import round-trip test (secrets excluded, all other fields preserved)

---

## 8. Out of Scope

- Core (`packages/core`) changes beyond accepting custom extensions in the filter layer — if core needs changes, that is a separate spec
- Full antigravity plugin/adapter code — deferred pending antigravity API confirmation
- UI redesign of the webview — the new section follows existing visual patterns exactly

---

## 9. Open Questions

1. **What is "antigravity"?** Is it a specific AI IDE (e.g. Cursor-like tool), an internal Zilliz product, or something else? This determines whether the MCP bridge is sufficient or if a dedicated adapter is needed.
2. **Does `Context.indexCodebase()` accept a file extension allowlist?** If not, the extension filter is applied at the `FileSynchronizer` / pre-indexing layer instead.
3. **Where should `Export Config` save by default?** Workspace root is the obvious choice; confirm with user.
