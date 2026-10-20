import { createRequire } from 'node:module';
import path from 'node:path';
import { Language, Parser, type Tree } from 'web-tree-sitter';

export type GrammarId = 'dart' | 'kotlin' | 'java' | 'swift' | 'objc' | 'typescript' | 'tsx' | 'javascript';

const requireFromHere = createRequire(typeof __filename === 'string' ? __filename : import.meta.url);

let initPromise: Promise<void> | null = null;
const languages = new Map<GrammarId, Promise<Language>>();

function grammarPath(id: GrammarId): string {
  const pkg = requireFromHere.resolve('tree-sitter-wasms/package.json');
  return path.join(path.dirname(pkg), 'out', `tree-sitter-${id}.wasm`);
}

async function language(id: GrammarId): Promise<Language> {
  initPromise ??= Parser.init();
  await initPromise;
  let lang = languages.get(id);
  if (!lang) {
    lang = Language.load(grammarPath(id));
    languages.set(id, lang);
  }
  return lang;
}

/**
 * Parses source text with the given grammar. The caller owns the returned tree
 * and must call `tree.delete()` (WASM memory is not garbage collected).
 */
export async function parseSource(id: GrammarId, source: string): Promise<Tree> {
  const lang = await language(id);
  const parser = new Parser();
  try {
    parser.setLanguage(lang);
    const tree = parser.parse(source);
    if (!tree) throw new Error(`Parser returned no tree (${id})`);
    return tree;
  } finally {
    parser.delete();
  }
}
