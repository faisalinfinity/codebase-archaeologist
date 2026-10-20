import type { InsertFileInput, SymbolEdge } from './repository-store';
import { resolveImport } from './resolve-import';

/** Resolve explicit syntactic references only; ambiguous targets remain unresolved. */
export type GraphFile = Pick<InsertFileInput, 'path' | 'symbols' | 'references' | 'aliases'>;
export function buildSymbolEdges(files: GraphFile[]): SymbolEdge[] {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const paths = new Set(byPath.keys());
  const aliases = files.flatMap((file) => file.aliases ?? []);
  const edges: SymbolEdge[] = [];
  for (const file of files)
    for (const reference of file.references ?? []) {
      const targetPath = reference.targetModule
        ? resolveImport(file.path, reference.targetModule, paths, aliases)
        : file.path;
      if (!targetPath) continue;
      const target = byPath.get(targetPath);
      const named = target?.symbols.filter((symbol) => symbol.name === reference.targetName) ?? [];
      // Default imports can refer to named declarations; require explicit export-default syntax.
      const candidates =
        reference.targetName === 'default'
          ? (target?.symbols.filter((symbol) => {
              const line = symbol.signature ?? '';
              return /export\s+default\s/.test(line);
            }) ?? [])
          : named;
      if (candidates.length !== 1) continue;
      const symbol = candidates[0]!;
      edges.push({
        sourcePath: file.path,
        sourceName: reference.sourceName,
        sourceLine: reference.sourceStartLine,
        targetPath,
        targetName: symbol.name,
        targetLine: symbol.startLine,
        relationshipType: reference.relationshipType,
      });
    }
  return edges;
}
