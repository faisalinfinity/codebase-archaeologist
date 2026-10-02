import ts from 'typescript';

export interface SourceSymbol {
  name: string;
  symbolType: string;
  startLine: number;
  endLine: number;
  signature: string | null;
}

export interface SourceChunk {
  content: string;
  startLine: number;
  endLine: number;
}

export interface SourceAnalysis {
  symbols: SourceSymbol[];
  imports: string[];
  chunks: SourceChunk[];
}

const MAX_CHUNK_CHARS = 12_000;

function scriptKind(path: string): ts.ScriptKind {
  if (/\.tsx$/i.test(path)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(path)) return ts.ScriptKind.JSX;
  if (/\.(js|mjs|cjs)$/i.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function chunksFor(content: string): SourceChunk[] {
  if (!content) return [];
  const chunks: SourceChunk[] = [];
  let start = 0;
  let startLine = 1;
  while (start < content.length) {
    let end = Math.min(start + MAX_CHUNK_CHARS, content.length);
    if (end < content.length) {
      const breakAt = content.lastIndexOf('\n', end - 1);
      if (breakAt > start + MAX_CHUNK_CHARS / 2) end = breakAt + 1;
    }
    const value = content.slice(start, end);
    const lineBreaks = (value.match(/\n/g) ?? []).length;
    chunks.push({
      content: value,
      startLine,
      endLine: startLine + lineBreaks - (value.endsWith('\n') ? 1 : 0),
    });
    start = end;
    startLine += lineBreaks;
  }
  return chunks;
}

/** Extract syntax facts without evaluating or type-checking untrusted source. */
export function analyzeSource(path: string, content: string): SourceAnalysis {
  const chunks = chunksFor(content);
  if (!/\.(tsx?|jsx?|mjs|cjs|mts|cts)$/i.test(path)) {
    return { symbols: [], imports: [], chunks };
  }

  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, scriptKind(path));
  const symbols: SourceSymbol[] = [];
  const imports = new Set<string>();

  function addSymbol(node: ts.Node, name: string, symbolType: string): void {
    const startLine = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const endLine = source.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
    const signature = node.getText(source).split('\n')[0]?.slice(0, 300) ?? null;
    symbols.push({ name, symbolType, startLine, endLine, signature });
  }

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.add(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.add(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) imports.add(arg.text);
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require'
    ) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) imports.add(arg.text);
    }

    if (ts.isFunctionDeclaration(node) && node.name) addSymbol(node, node.name.text, 'function');
    else if (ts.isClassDeclaration(node) && node.name) addSymbol(node, node.name.text, 'class');
    else if (ts.isInterfaceDeclaration(node)) addSymbol(node, node.name.text, 'interface');
    else if (ts.isTypeAliasDeclaration(node)) addSymbol(node, node.name.text, 'type');
    else if (ts.isEnumDeclaration(node)) addSymbol(node, node.name.text, 'enum');
    else if (ts.isMethodDeclaration(node) && node.name)
      addSymbol(node, node.name.getText(source), 'method');
    else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name))
      addSymbol(node, node.name.text, 'variable');
    ts.forEachChild(node, visit);
  }

  visit(source);
  return { symbols, imports: [...imports], chunks };
}
