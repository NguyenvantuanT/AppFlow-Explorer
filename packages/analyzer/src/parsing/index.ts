import type { SourceLanguage } from '@appflow/model';
import { extractDart } from './extractors/dart';
import { extractJava } from './extractors/java';
import { extractKotlin } from './extractors/kotlin';
import { extractObjc } from './extractors/objc';
import { extractSwift } from './extractors/swift';
import { extractTypeScript } from './extractors/typescript';
import type { FileFacts } from './facts';
import { parseSource, type GrammarId } from './treeSitter';

export type { FileFacts } from './facts';
export * from './facts';

/** Languages with a syntax-tree extractor. */
export type CodeLanguage = Extract<SourceLanguage, 'dart' | 'kotlin' | 'java' | 'swift' | 'objc' | 'typescript' | 'javascript'>;

const EXTENSIONS: Record<string, { language: CodeLanguage; grammar: GrammarId }> = {
  '.dart': { language: 'dart', grammar: 'dart' },
  '.kt': { language: 'kotlin', grammar: 'kotlin' },
  '.kts': { language: 'kotlin', grammar: 'kotlin' },
  '.java': { language: 'java', grammar: 'java' },
  '.swift': { language: 'swift', grammar: 'swift' },
  '.m': { language: 'objc', grammar: 'objc' },
  '.mm': { language: 'objc', grammar: 'objc' },
  '.h': { language: 'objc', grammar: 'objc' },
  '.ts': { language: 'typescript', grammar: 'typescript' },
  '.tsx': { language: 'typescript', grammar: 'tsx' },
  '.js': { language: 'javascript', grammar: 'tsx' },
  '.jsx': { language: 'javascript', grammar: 'tsx' },
  '.mjs': { language: 'javascript', grammar: 'javascript' },
};

export function codeLanguageOf(path: string): CodeLanguage | null {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  return EXTENSIONS[ext]?.language ?? null;
}

/**
 * tree-sitter-dart sometimes parses a generic call `f<T>(…)` (after `await`,
 * `=>`, …) as the comparison `f < T > (…)`. Dart relational operators cannot
 * be chained, so `name<…>(` is always a generic invocation: blanking the type
 * arguments (same length, so every line and column stays put) lets the call be
 * recognized. Type arguments are not needed for analysis.
 */
export function preprocessDart(source: string): string {
  return source.replace(/(\b[A-Za-z_][\w]*)(<[^<>()=;{}]*(?:<[^<>()=;{}]*>[^<>()=;{}]*)*>)(\()/g, (_m, head: string, generic: string, tail: string) => head + ' '.repeat(generic.length) + tail);
}

/** Parses a source file and extracts language-neutral facts. */
export async function extractFacts(path: string, source: string): Promise<FileFacts | null> {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  const entry = EXTENSIONS[ext];
  if (!entry) return null;
  const tree = await parseSource(entry.grammar, entry.language === 'dart' ? preprocessDart(source) : source);
  try {
    const root = tree.rootNode;
    switch (entry.language) {
      case 'dart':
        return extractDart(root);
      case 'kotlin':
        return extractKotlin(root);
      case 'java':
        return extractJava(root);
      case 'swift':
        return extractSwift(root);
      case 'objc':
        return extractObjc(root);
      case 'typescript':
      case 'javascript':
        return extractTypeScript(root);
    }
  } finally {
    tree.delete();
  }
}
