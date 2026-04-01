// Mock for VS Code API - used for testing
export const ConfigurationTarget = {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3,
};

export const Uri = {
    file: (path: string) => ({ fsPath: path, path, scheme: 'file' }),
    parse: (value: string) => ({ fsPath: value, path: value, scheme: 'file' }),
};

let mockConfig: Record<string, any> = {};

export const workspace = {
    getConfiguration: (section?: string) => ({
        get: (key: string, defaultValue?: any) => {
            const configKey = section ? `${section}.${key}` : key;
            return mockConfig[configKey] ?? defaultValue;
        },
        update: jest.fn(async (key: string, value: any, target: number) => {
            const sectionPrefix = '';
            const configKey = `${sectionPrefix}${key}`;
            mockConfig[configKey] = value;
        }),
        has: (key: string) => {
            const configKey = key;
            return configKey in mockConfig;
        },
    }),
    onDidChangeConfiguration: jest.fn(() => ({
        dispose: jest.fn(),
    })),
};

export const window = {
    showInformationMessage: jest.fn(async (message: string, ...items: any[]) => {
        return items[0] || undefined;
    }),
    showErrorMessage: jest.fn(async (message: string, ...items: any[]) => {
        return items[0] || undefined;
    }),
    showWarningMessage: jest.fn(async (message: string, ...items: any[]) => {
        return items[0] || undefined;
    }),
    showSaveDialog: jest.fn(async (options?: any) => {
        return undefined;
    }),
    showOpenDialog: jest.fn(async (options?: any) => {
        return undefined;
    }),
    showQuickPick: jest.fn(async (items: any[], options?: any) => {
        return undefined;
    }),
    showInputBox: jest.fn(async (options?: any) => {
        return undefined;
    }),
};

export const commands = {
    registerCommand: jest.fn((command: string, callback: any) => ({
        dispose: jest.fn(),
    })),
    executeCommand: jest.fn(async (command: string, ...args: any[]) => {
        return undefined;
    }),
};

export const extensions = {
    getExtension: jest.fn((extensionId: string) => undefined),
};

// Helper to reset mock config between tests
export const __resetWorkspaceConfig = () => {
    mockConfig = {};
};
