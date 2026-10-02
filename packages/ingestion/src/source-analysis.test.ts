import { describe, expect, it } from 'vitest';

import { analyzeSource } from './source-analysis';

describe('analyzeSource', () => {
  it('extracts TypeScript symbols and imports with source line numbers', () => {
    const result = analyzeSource(
      'src/app.ts',
      [
        "import { helper } from './helper';",
        'export interface Config { enabled: boolean }',
        'export class App {',
        '  run() { return helper(); }',
        '}',
        'export const version = 1;',
      ].join('\n'),
    );

    expect(result.imports).toEqual(['./helper']);
    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Config', symbolType: 'interface', startLine: 2 }),
        expect.objectContaining({ name: 'App', symbolType: 'class', startLine: 3, endLine: 5 }),
        expect.objectContaining({ name: 'run', symbolType: 'method', startLine: 4 }),
        expect.objectContaining({ name: 'version', symbolType: 'variable', startLine: 6 }),
      ]),
    );
  });

  it('bounds chunks and preserves source text', () => {
    const content = `# title\n${'x'.repeat(30_000)}\nend`;
    const result = analyzeSource('README.md', content);
    expect(result.symbols).toEqual([]);
    expect(result.chunks.map((chunk) => chunk.content).join('')).toBe(content);
    expect(result.chunks.every((chunk) => chunk.content.length <= 12_000)).toBe(true);
  });

  it('records CommonJS require calls', () => {
    const result = analyzeSource('lib/app.js', "const helper = require('./helper');");
    expect(result.imports).toEqual(['./helper']);
  });
});
