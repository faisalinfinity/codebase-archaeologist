import { expect, it } from 'vitest';
import { buildSymbolEdges } from './symbol-graph';
import { resolveImport } from './resolve-import';

it('resolves named aliases and refuses ambiguous symbol targets', () => {
  const target = {
    path: 'src/auth.ts',
    symbols: [
      {
        name: 'check',
        symbolType: 'function',
        startLine: 1,
        endLine: 3,
        signature: 'export function check() {}',
      },
    ],
  };
  const source = {
    path: 'src/app.ts',
    symbols: [],
    references: [
      {
        sourceName: 'handle',
        sourceStartLine: 2,
        targetName: 'check',
        targetModule: '@/auth',
        line: 3,
        relationshipType: 'calls' as const,
      },
    ],
  };
  const config = {
    path: 'tsconfig.json',
    symbols: [],
    aliases: [{ pattern: '@/*', targets: ['src/*'] }],
  };
  expect(buildSymbolEdges([target, source, config])).toMatchObject([
    {
      sourcePath: 'src/app.ts',
      sourceName: 'handle',
      targetPath: 'src/auth.ts',
      targetName: 'check',
    },
  ]);
  expect(
    buildSymbolEdges([
      { ...target, symbols: [...target.symbols, { ...target.symbols[0]!, startLine: 5 }] },
      source,
      config,
    ]),
  ).toEqual([]);
  expect(
    resolveImport('src/app.ts', '@pkg/core', new Set(['packages/core/src/index.ts']), [
      { pattern: '@pkg/core', targets: ['packages/core/src/index'] },
    ]),
  ).toBe('packages/core/src/index.ts');
});
