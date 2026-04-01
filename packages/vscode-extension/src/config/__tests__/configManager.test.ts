import { __resetWorkspaceConfig, workspace } from '../../__mocks__/vscode';
jest.mock('vscode');
import { ConfigManager } from '../configManager';
import * as vscode from 'vscode';

const fakeContext = {} as vscode.ExtensionContext;

beforeEach(() => __resetWorkspaceConfig());

describe('ConfigManager', () => {
    describe('getCustomExtensions', () => {
        it('should return empty array when custom extensions are not configured', () => {
            const mockGet = jest.fn((key: string, defaultValue?: any) => {
                if (key === 'indexing.customExtensions') {
                    return defaultValue;
                }
                return defaultValue;
            });

            (workspace.getConfiguration as jest.Mock).mockReturnValue({
                get: mockGet,
                update: jest.fn(),
                has: jest.fn(),
            });

            const manager = new ConfigManager(fakeContext);
            const result = manager.getCustomExtensions();

            expect(result).toEqual([]);
        });

        it('should return configured custom extensions array', () => {
            const customExtensions = ['.custom', '.ext'];
            const mockGet = jest.fn((key: string, defaultValue?: any) => {
                if (key === 'indexing.customExtensions') {
                    return customExtensions;
                }
                return defaultValue;
            });

            (workspace.getConfiguration as jest.Mock).mockReturnValue({
                get: mockGet,
                update: jest.fn(),
                has: jest.fn(),
            });

            const manager = new ConfigManager(fakeContext);
            const result = manager.getCustomExtensions();

            expect(result).toEqual(customExtensions);
        });
    });

    describe('getCustomIgnorePatterns', () => {
        it('should return empty array when custom ignore patterns are not configured', () => {
            const mockGet = jest.fn((key: string, defaultValue?: any) => {
                if (key === 'indexing.customIgnorePatterns') {
                    return defaultValue;
                }
                return defaultValue;
            });

            (workspace.getConfiguration as jest.Mock).mockReturnValue({
                get: mockGet,
                update: jest.fn(),
                has: jest.fn(),
            });

            const manager = new ConfigManager(fakeContext);
            const result = manager.getCustomIgnorePatterns();

            expect(result).toEqual([]);
        });

        it('should return configured custom ignore patterns array', () => {
            const customIgnorePatterns = ['**/*.test.ts', 'node_modules/**'];
            const mockGet = jest.fn((key: string, defaultValue?: any) => {
                if (key === 'indexing.customIgnorePatterns') {
                    return customIgnorePatterns;
                }
                return defaultValue;
            });

            (workspace.getConfiguration as jest.Mock).mockReturnValue({
                get: mockGet,
                update: jest.fn(),
                has: jest.fn(),
            });

            const manager = new ConfigManager(fakeContext);
            const result = manager.getCustomIgnorePatterns();

            expect(result).toEqual(customIgnorePatterns);
        });
    });

    describe('saveIndexingConfig', () => {
        it('should save both custom extensions and custom ignore patterns', async () => {
            const mockUpdate = jest.fn();
            (workspace.getConfiguration as jest.Mock).mockReturnValue({
                get: jest.fn(),
                update: mockUpdate,
                has: jest.fn(),
            });

            const customExtensions = ['.custom', '.ext'];
            const customIgnorePatterns = ['**/*.test.ts', 'node_modules/**'];

            const manager = new ConfigManager(fakeContext);
            await manager.saveIndexingConfig(customExtensions, customIgnorePatterns);

            expect(mockUpdate).toHaveBeenCalledWith(
                'indexing.customExtensions',
                customExtensions,
                vscode.ConfigurationTarget.Global
            );
            expect(mockUpdate).toHaveBeenCalledWith(
                'indexing.customIgnorePatterns',
                customIgnorePatterns,
                vscode.ConfigurationTarget.Global
            );
        });
    });

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
            // Non-secret values ARE exported
            expect(parsed.milvus.address).toBe('http://localhost:19530');
            expect(parsed.indexing.customExtensions).toEqual(['.vue']);
            expect(parsed.indexing.customIgnorePatterns).toEqual(['**/*.test.ts']);
        });
    });
});
