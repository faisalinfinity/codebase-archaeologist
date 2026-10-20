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
  references?: SourceReference[];
  aliases?: Array<{ pattern: string; targets: string[]; scope?: string }>;
}

export interface SourceReference {
  sourceName: string;
  sourceStartLine: number;
  targetName: string;
  targetModule: string | null;
  line: number;
  relationshipType: 'calls' | 'constructs' | 'extends';
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
    let aliases: SourceAnalysis['aliases'];
    if (/(^|\/)(tsconfig[^/]*\.json|jsconfig\.json)$/.test(path)) {
      const config = ts.parseConfigFileTextToJson(path, content).config;
      const options = config?.compilerOptions;
      const base =
        path.slice(0, path.lastIndexOf('/') + 1) +
        (typeof options?.baseUrl === 'string' ? options.baseUrl + '/' : '');
      if (options?.paths && typeof options.paths === 'object')
        aliases = Object.entries(options.paths).flatMap(([pattern, targets]) =>
          Array.isArray(targets)
            ? [
                {
                  pattern,
                  scope: path.slice(0, path.lastIndexOf('/') + 1),
                  targets: targets
                    .filter((target): target is string => typeof target === 'string')
                    .map((target) => base + target),
                },
              ]
            : [],
        );
    }
    if (/(^|\/)package\.json$/.test(path)) {
      try {
        const config = JSON.parse(content);
        const directory = path.slice(0, path.lastIndexOf('/') + 1);
        if (typeof config.name === 'string')
          aliases = [
            {
              pattern: config.name,
              targets: [
                typeof config.types === 'string' ? directory + config.types : '',
                typeof config.module === 'string' ? directory + config.module : '',
                typeof config.main === 'string' ? directory + config.main : '',
                directory + 'src/index',
                directory + 'index',
              ].filter(Boolean),
            },
          ];
      } catch {
        /* Invalid configuration stays searchable as text. */
      }
    }
    return { symbols: [], imports: [], chunks, ...(aliases ? { aliases } : {}) };
  }

  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, scriptKind(path));
  const symbols: SourceSymbol[] = [];
  const symbolNodes = new Map<SourceSymbol, ts.Node>();
  const imports = new Set<string>();

  function addSymbol(node: ts.Node, name: string, symbolType: string): void {
    const startLine = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const endLine = source.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
    const signature = node.getText(source).split('\n')[0]?.slice(0, 300) ?? null;
    const symbol = { name, symbolType, startLine, endLine, signature };
    symbols.push(symbol);
    symbolNodes.set(symbol, node);
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
  const bindings = new Map<string, { module: string; name: string }>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const module = statement.moduleSpecifier.text;
    if (statement.importClause?.name)
      bindings.set(statement.importClause.name.text, { module, name: 'default' });
    const named = statement.importClause?.namedBindings;
    if (named && ts.isNamedImports(named))
      for (const element of named.elements)
        bindings.set(element.name.text, {
          module,
          name: element.propertyName?.text ?? element.name.text,
        });
    if (named && ts.isNamespaceImport(named)) bindings.set(named.name.text, { module, name: '*' });
  }
  const references: SourceReference[] = [];
  function isShadowed(name: string, node: ts.Node): boolean {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (
        ts.isFunctionLike(parent) &&
        parent.parameters.some((parameter) =>
          parameter.name.getText(source).split(/\W+/).includes(name),
        )
      )
        return true;
      if (ts.isBlock(parent))
        for (const statement of parent.statements) {
          if (
            ts.isVariableStatement(statement) &&
            statement.declarationList.declarations.some((declaration) =>
              declaration.name.getText(source).split(/\W+/).includes(name),
            )
          )
            return true;
          if (
            (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
            statement.name?.text === name
          )
            return true;
        }
    }
    return false;
  }
  function visitReferences(node: ts.Node) {
    if (
      ts.isCallExpression(node) ||
      ts.isNewExpression(node) ||
      ts.isExpressionWithTypeArguments(node)
    ) {
      const expression = node.expression;
      let name: string | undefined;
      let module: string | null = null;
      if (ts.isIdentifier(expression)) {
        const binding = bindings.get(expression.text);
        name = isShadowed(expression.text, node) ? undefined : (binding?.name ?? expression.text);
        module = binding?.module ?? null;
      } else if (
        ts.isPropertyAccessExpression(expression) &&
        ts.isIdentifier(expression.expression)
      ) {
        const binding = bindings.get(expression.expression.text);
        if (binding?.name === '*' && !isShadowed(expression.expression.text, node)) {
          name = expression.name.text;
          module = binding.module;
        }
      }
      if (name) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        const owner = symbols
          .filter(
            (symbol) =>
              symbolNodes.get(symbol)!.getStart(source) <= node.getStart(source) &&
              symbolNodes.get(symbol)!.getEnd() >= node.getEnd(),
          )
          .sort(
            (a, b) => symbolNodes.get(a)!.getWidth(source) - symbolNodes.get(b)!.getWidth(source),
          )[0];
        if (owner)
          references.push({
            sourceName: owner.name,
            sourceStartLine: owner.startLine,
            targetName: name,
            targetModule: module,
            line,
            relationshipType: ts.isNewExpression(node)
              ? 'constructs'
              : ts.isExpressionWithTypeArguments(node)
                ? 'extends'
                : 'calls',
          });
      }
    }
    ts.forEachChild(node, visitReferences);
  }
  visitReferences(source);
  return { symbols, imports: [...imports], chunks, references };
}
