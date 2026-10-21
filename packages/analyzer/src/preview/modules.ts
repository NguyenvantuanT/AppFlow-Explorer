import type { Tree } from 'web-tree-sitter';
import { importAliases } from '../adapters/reactNative';
import type { ImportAlias } from '../core/codeIndex';
import { dirname } from '../core/types';
import { namedChildren, type Node } from '../parsing/ast';
import { parseSource, type GrammarId } from '../parsing/treeSitter';

/** Read access to project files; paths are project-relative. */
export interface PreviewSource {
  readText(path: string): Promise<string | null>;
  exists(path: string): Promise<boolean>;
}

/** How a module-level name gets its value. */
export type LocalDecl =
  | { kind: 'import'; source: string; imported: string }
  | { kind: 'value'; node: Node }
  | { kind: 'pattern'; pattern: Node; value: Node }
  | { kind: 'function'; node: Node };

export type ExportDecl = { kind: 'local'; name: string } | { kind: 'expr'; node: Node } | { kind: 're'; source: string; imported: string };

export interface ModuleInfo {
  file: string;
  locals: Map<string, LocalDecl>;
  exports: Map<string, ExportDecl>;
  /** Sources of `export * from`. */
  stars: string[];
  /** Parsed JSON files. */
  json?: unknown;
}

export type Resolved = { kind: 'file'; path: string } | { kind: 'asset'; path: string } | { kind: 'library'; name: string };

const CODE_SUFFIXES = ['.ios.tsx', '.ios.ts', '.ios.js', '.native.tsx', '.native.ts', '.native.js', '.tsx', '.ts', '.jsx', '.js', '.json'];
const ASSET_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const GRAMMAR: Record<string, GrammarId> = { '.ts': 'typescript', '.tsx': 'tsx', '.js': 'tsx', '.jsx': 'tsx', '.mjs': 'javascript' };
/** Files reachable from one screen are capped, so a huge app cannot stall a preview. */
const MAX_MODULES = 600;

/**
 * The project modules a React Native screen depends on, parsed once and kept
 * for every screen of the project. Loading is asynchronous; the interpreter
 * that walks them afterwards is synchronous.
 */
export class ModuleGraph {
  private readonly modules = new Map<string, ModuleInfo | null>();
  private readonly trees: Tree[] = [];
  private readonly resolutions = new Map<string, Resolved | null>();
  private aliases: ImportAlias[] = [];

  private constructor(
    private readonly source: PreviewSource,
    readonly appRoot: string,
  ) {}

  static async open(source: PreviewSource, appRoot: string): Promise<ModuleGraph> {
    const graph = new ModuleGraph(source, appRoot);
    graph.aliases = await importAliases({ readText: (p) => source.readText(p) }, appRoot);
    return graph;
  }

  /** Frees the syntax trees (WASM memory is not garbage collected). */
  dispose(): void {
    for (const t of this.trees) t.delete();
    this.trees.length = 0;
    this.modules.clear();
  }

  module(file: string): ModuleInfo | undefined {
    return this.modules.get(file) ?? undefined;
  }

  /** A specifier resolved during `load`; `undefined` when it was not seen. */
  resolve(from: string, spec: string): Resolved | null | undefined {
    return this.resolutions.get(`${from}|${spec}`);
  }

  /** Loads `file` and every project module it reaches through imports, re-exports and `require()`. */
  async load(file: string): Promise<void> {
    const queue = [file];
    while (queue.length) {
      const f = queue.shift()!;
      if (this.modules.has(f)) continue;
      if (this.modules.size >= MAX_MODULES) break;
      const info = await this.parse(f);
      this.modules.set(f, info);
      if (!info) continue;
      for (const spec of info.specs) {
        const r = await this.resolveSpec(f, spec);
        this.resolutions.set(`${f}|${spec}`, r);
        if (r?.kind === 'file' && !this.modules.has(r.path)) queue.push(r.path);
      }
    }
  }

  private async resolveSpec(from: string, spec: string): Promise<Resolved | null> {
    let base: string | undefined;
    const alias = this.aliases.find((a) => spec === a.prefix || spec.startsWith(a.prefix.endsWith('/') ? a.prefix : `${a.prefix}/`));
    if (alias) base = normalize([alias.target, spec.slice(alias.prefix.length).replace(/^\//, '')].filter(Boolean).join('/'));
    else if (spec.startsWith('.')) base = normalize(`${dirname(from)}/${spec}`);
    else return { kind: 'library', name: spec };
    if (ASSET_EXT.test(base)) {
      const dot = base.lastIndexOf('.');
      for (const c of [base, `${base.slice(0, dot)}@2x${base.slice(dot)}`, `${base.slice(0, dot)}@3x${base.slice(dot)}`]) if (await this.source.exists(c)) return { kind: 'asset', path: c };
      return null;
    }
    const candidates = /\.(tsx?|jsx?|json)$/.test(base) ? [base] : [...CODE_SUFFIXES.map((s) => base + s), ...CODE_SUFFIXES.map((s) => `${base}/index${s}`)];
    for (const c of candidates) if (await this.source.exists(c)) return { kind: 'file', path: c };
    return null;
  }

  private async parse(file: string): Promise<(ModuleInfo & { specs: string[] }) | null> {
    const text = await this.source.readText(file);
    if (text === null) return null;
    const info: ModuleInfo & { specs: string[] } = { file, locals: new Map(), exports: new Map(), stars: [], specs: [] };
    if (file.endsWith('.json')) {
      try {
        info.json = JSON.parse(text);
      } catch {
        info.json = undefined;
      }
      return info;
    }
    const grammar = GRAMMAR[file.slice(file.lastIndexOf('.'))];
    if (!grammar) return null;
    const tree = await parseSource(grammar, text);
    this.trees.push(tree);
    collect(tree.rootNode, info);
    return info;
  }
}

function normalize(p: string): string {
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

export function stringValue(n: Node): string {
  if (n.type !== 'string') return n.text;
  let out = '';
  for (const c of namedChildren(n)) {
    if (c.type === 'escape_sequence') out += unescape(c.text);
    else out += c.text;
  }
  return out;
}

function unescape(seq: string): string {
  const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };
  const c = seq.slice(1);
  if (map[c] !== undefined) return map[c]!;
  if (/^u\{?[0-9a-fA-F]+\}?$/.test(c)) return String.fromCodePoint(parseInt(c.replace(/[u{}]/g, ''), 16));
  if (/^x[0-9a-fA-F]{2}$/.test(c)) return String.fromCharCode(parseInt(c.slice(1), 16));
  return c;
}

/** Module-level declarations, imports and exports, plus every specifier to resolve. */
function collect(root: Node, info: ModuleInfo & { specs: string[] }): void {
  const addDecl = (n: Node, exported: boolean, isDefault = false) => {
    switch (n.type) {
      case 'lexical_declaration':
      case 'variable_declaration':
        for (const d of namedChildren(n).filter((c) => c.type === 'variable_declarator')) {
          const name = d.childForFieldName('name');
          const value = d.childForFieldName('value');
          if (!name || !value) continue;
          if (name.type === 'identifier') {
            info.locals.set(name.text, { kind: 'value', node: value });
            if (exported) info.exports.set(name.text, { kind: 'local', name: name.text });
          } else {
            for (const id of patternNames(name)) {
              info.locals.set(id, { kind: 'pattern', pattern: name, value });
              if (exported) info.exports.set(id, { kind: 'local', name: id });
            }
          }
        }
        return true;
      case 'function_declaration':
      case 'generator_function_declaration':
      case 'class_declaration':
      case 'abstract_class_declaration': {
        const name = n.childForFieldName('name')?.text;
        if (!name) return false;
        info.locals.set(name, { kind: 'function', node: n });
        if (exported) info.exports.set(isDefault ? 'default' : name, { kind: 'local', name });
        return true;
      }
    }
    return false;
  };

  for (const n of namedChildren(root)) {
    if (n.type === 'import_statement') {
      const source = n.childForFieldName('source');
      if (!source) continue;
      const spec = stringValue(source);
      info.specs.push(spec);
      const clause = namedChildren(n).find((c) => c.type === 'import_clause');
      for (const c of clause ? namedChildren(clause) : []) {
        if (c.type === 'identifier') info.locals.set(c.text, { kind: 'import', source: spec, imported: 'default' });
        else if (c.type === 'namespace_import') {
          const id = namedChildren(c).find((x) => x.type === 'identifier');
          if (id) info.locals.set(id.text, { kind: 'import', source: spec, imported: '*' });
        } else if (c.type === 'named_imports') {
          for (const s of namedChildren(c).filter((x) => x.type === 'import_specifier')) {
            const imported = s.childForFieldName('name')?.text ?? s.text;
            info.locals.set(s.childForFieldName('alias')?.text ?? imported, { kind: 'import', source: spec, imported });
          }
        }
      }
    } else if (n.type === 'export_statement') {
      const source = n.childForFieldName('source');
      const clause = namedChildren(n).find((c) => c.type === 'export_clause');
      if (source) {
        const spec = stringValue(source);
        info.specs.push(spec);
        if (clause) {
          for (const s of namedChildren(clause).filter((x) => x.type === 'export_specifier')) {
            const imported = s.childForFieldName('name')?.text ?? s.text;
            info.exports.set(s.childForFieldName('alias')?.text ?? imported, { kind: 're', source: spec, imported });
          }
        } else {
          const ns = namedChildren(n).find((c) => c.type === 'namespace_export');
          const id = ns && namedChildren(ns).find((x) => x.type === 'identifier');
          if (id) info.exports.set(id.text, { kind: 're', source: spec, imported: '*' });
          else info.stars.push(spec);
        }
        continue;
      }
      if (clause) {
        for (const s of namedChildren(clause).filter((x) => x.type === 'export_specifier')) {
          const local = s.childForFieldName('name')?.text ?? s.text;
          info.exports.set(s.childForFieldName('alias')?.text ?? local, { kind: 'local', name: local });
        }
        continue;
      }
      const isDefault = n.children.some((c) => c?.type === 'default');
      const decl = n.childForFieldName('declaration');
      if (decl && addDecl(decl, true, isDefault)) continue;
      const value = n.childForFieldName('value') ?? namedChildren(n).find((c) => c.type !== 'comment' && c.type !== 'decorator');
      if (!value) continue;
      if (isDefault && value.type === 'identifier') info.exports.set('default', { kind: 'local', name: value.text });
      else if (isDefault && !addDecl(value, true, true)) {
        // export default function () {} / export default memo(X)
        const name = value.childForFieldName('name')?.text;
        if (name && /function|class/.test(value.type)) {
          info.locals.set(name, { kind: 'function', node: value });
          info.exports.set('default', { kind: 'local', name });
        } else {
          info.exports.set('default', { kind: 'expr', node: value });
        }
      }
    } else if (!addDecl(n, false) && n.type === 'expression_statement') {
      // module.exports = X / exports.name = X
      const e = n.namedChild(0);
      if (e?.type !== 'assignment_expression') continue;
      const left = e.childForFieldName('left')?.text ?? '';
      const right = e.childForFieldName('right');
      if (!right) continue;
      if (left === 'module.exports') info.exports.set('default', { kind: 'expr', node: right });
      else if (/^(module\.)?exports\.\w+$/.test(left)) info.exports.set(left.split('.').pop()!, { kind: 'expr', node: right });
    }
  }
  // require('x') anywhere in the module.
  const stack: Node[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.type === 'call_expression' && n.childForFieldName('function')?.text === 'require') {
      const arg = n.childForFieldName('arguments')?.namedChild(0);
      if (arg?.type === 'string') info.specs.push(stringValue(arg));
    }
    for (const c of namedChildren(n)) stack.push(c);
  }
  info.specs = [...new Set(info.specs)];
}

/** Names bound by a destructuring pattern. */
export function patternNames(p: Node): string[] {
  switch (p.type) {
    case 'identifier':
    case 'shorthand_property_identifier_pattern':
      return [p.text];
    case 'object_pattern':
    case 'array_pattern':
      return namedChildren(p).flatMap((c) => {
        if (c.type === 'pair_pattern') return patternNames(c.childForFieldName('value')!);
        if (c.type === 'object_assignment_pattern' || c.type === 'assignment_pattern') return patternNames(c.childForFieldName('left')!);
        if (c.type === 'rest_pattern') return namedChildren(c).flatMap(patternNames);
        return patternNames(c);
      });
    default:
      return [];
  }
}

