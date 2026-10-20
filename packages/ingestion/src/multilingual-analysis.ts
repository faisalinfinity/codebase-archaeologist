import { createRequire } from 'node:module';
import { Parser, Language, type Node } from 'web-tree-sitter';
import { analyzeSource, type SourceAnalysis, type SourceSymbol } from './source-analysis';

const require = createRequire(import.meta.url);
const grammars: Record<string, string> = {
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  rb: 'ruby',
  cs: 'c_sharp',
  php: 'php',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
};
let initialized: Promise<void> | undefined;
const languages = new Map<string, Promise<Language>>();
const symbolTypes: Record<string, string> = {
  function_definition: 'function',
  function_declaration: 'function',
  function_item: 'function',
  method_definition: 'method',
  method_declaration: 'method',
  method: 'method',
  singleton_method: 'method',
  class_definition: 'class',
  class_declaration: 'class',
  class: 'class',
  interface_declaration: 'interface',
  struct_item: 'struct',
  struct_specifier: 'struct',
  enum_item: 'enum',
  enum_declaration: 'enum',
  trait_item: 'trait',
  type_spec: 'type',
};

/** Parse only packaged grammars. No repository-supplied grammar, plugin, or code runs. */
export async function analyzeSourceFile(
  filePath: string,
  content: string,
): Promise<SourceAnalysis> {
  const base = analyzeSource(filePath, content);
  const grammar = grammars[filePath.split('.').pop()?.toLowerCase() ?? ''];
  if (!grammar) return base;
  initialized ??= Parser.init({
    locateFile: () => require.resolve('web-tree-sitter/tree-sitter.wasm'),
  });
  await initialized;
  let language = languages.get(grammar);
  if (!language) {
    language = Language.load(require.resolve(`tree-sitter-wasms/out/tree-sitter-${grammar}.wasm`));
    languages.set(grammar, language);
  }
  const parser = new Parser();
  try {
    parser.setLanguage(await language);
    const started = Date.now();
    const tree = parser.parse(content, undefined, {
      progressCallback: () => {
        if (Date.now() - started > 5000) throw new Error('Source parsing timed out.');
      },
    });
    if (!tree) throw new Error('Source parsing failed.');
    try {
      const symbols: SourceSymbol[] = [];
      const imports = new Set<string>();
      const stack: Node[] = [tree.rootNode];
      while (stack.length) {
        const node = stack.pop()!;
        const symbolType = symbolTypes[node.type];
        if (symbolType) {
          const name =
            node.childForFieldName('name') ??
            node
              .childForFieldName('declarator')
              ?.descendantsOfType(['identifier', 'field_identifier'])[0] ??
            node.namedChildren.find(
              (child) => child && ['simple_identifier', 'type_identifier'].includes(child.type),
            );
          if (name)
            symbols.push({
              name: name.text,
              symbolType,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
              signature: node.text.split('\n')[0]!.slice(0, 300),
            });
        }
        if (
          [
            'import_statement',
            'import_from_statement',
            'import_declaration',
            'use_declaration',
            'preproc_include',
          ].includes(node.type)
        ) {
          if (grammar === 'python') {
            const module = node.childForFieldName('module_name');
            if (module) imports.add(module.text);
            else
              for (const child of node.namedChildren)
                if (child && (child.type === 'dotted_name' || child.type === 'aliased_import'))
                  imports.add((child.childForFieldName('name') ?? child).text);
          } else
            for (const child of node.descendantsOfType([
              'interpreted_string_literal',
              'string_literal',
              'system_lib_string',
            ]))
              if (child) imports.add(child.text.replace(/^["'<]|["'>]$/g, ''));
        }
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const child = node.namedChild(i);
          if (child) stack.push(child);
        }
      }
      return { ...base, symbols, imports: [...imports] };
    } finally {
      tree.delete();
    }
  } finally {
    parser.delete();
  }
}
