import type { SourceLocation } from '@appflow/model';
import type { ArgFact, CallFact, ClassFact, FileFacts, FunctionFact, JsxFact } from '../parsing/facts';

export interface Located<T> {
  fact: T;
  file: string;
}

export const loc = (file: string, line: number, column?: number): SourceLocation => ({ fileId: file, line, ...(column ? { column } : {}) });

const CODE_EXTENSIONS = ['.dart', '.tsx', '.ts', '.jsx', '.js', '.kt', '.java', '.swift'];

/**
 * Cross-file lookup tables over extracted facts: classes and functions by
 * name, string constants, and which types each class or function uses.
 *
 * Projects often reuse class names per feature (every page has its own
 * `BodyContent`), so usage is tracked per declaration (`file#Name`), with
 * references resolved through imports and re-exports.
 */
export class CodeIndex {
  readonly files = new Map<string, FileFacts>();
  readonly classes = new Map<string, Located<ClassFact>[]>();
  readonly functions = new Map<string, Located<FunctionFact>[]>();
  readonly constants = new Map<string, string>();
  private qualifiedUses: Map<string, Set<string>> | null = null;
  private readonly visibleCache = new Map<string, Set<string>>();

  add(file: string, facts: FileFacts): void {
    this.files.set(file, facts);
    for (const c of facts.classes) push(this.classes, c.name, { fact: c, file });
    for (const f of facts.functions) push(this.functions, f.name, { fact: f, file });
    for (const k of facts.constants) if (!this.constants.has(k.name)) this.constants.set(k.name, k.value);
    this.qualifiedUses = null;
    this.visibleCache.clear();
  }

  classNamed(name: string): Located<ClassFact> | undefined {
    return this.classes.get(name)?.[0];
  }

  *allCalls(): Generator<{ call: CallFact; file: string; facts: FileFacts }> {
    for (const [file, facts] of this.files) for (const call of facts.calls) yield { call, file, facts };
  }

  *allJsx(): Generator<{ jsx: JsxFact; file: string; facts: FileFacts }> {
    for (const [file, facts] of this.files) for (const jsx of facts.jsx) yield { jsx, file, facts };
  }

  /** True when `name` (transitively) extends one of `bases` within the indexed code, or directly. */
  extendsAny(name: string, bases: Set<string>, seen = new Set<string>()): boolean {
    if (seen.has(name)) return false;
    seen.add(name);
    const cls = this.classNamed(name)?.fact;
    if (!cls) return false;
    return cls.supertypes.some((s) => bases.has(s) || this.extendsAny(s, bases, seen));
  }

  /**
   * Resolves an argument to a string: a literal, or a reference to a known
   * string constant (`Routes.home`, `HOME`). Returns the interpolation pattern
   * (`/product/*`) when only part of the value is static.
   */
  resolveString(arg: ArgFact | undefined): { value?: string; pattern?: string } {
    if (!arg) return {};
    if (arg.stringValue !== undefined) return { value: arg.stringValue, pattern: arg.stringValue };
    if (arg.stringPattern !== undefined) return { pattern: arg.stringPattern };
    const ref = arg.text.replace(/^const\s+/, '').trim();
    const direct = this.constants.get(ref) ?? this.constants.get(ref.split('.').pop() ?? ref);
    return direct !== undefined && /^[\w.$]+$/.test(ref) ? { value: direct, pattern: direct } : {};
  }

  /** Resolves an import specifier (relative path or Dart `package:`) to a project file. */
  resolveImport(from: string, source: string): string | undefined {
    let base: string | undefined;
    if (source.startsWith('.')) {
      const parts = [...from.split('/').slice(0, -1), ...source.split('/')];
      const out: string[] = [];
      for (const p of parts) {
        if (!p || p === '.') continue;
        if (p === '..') out.pop();
        else out.push(p);
      }
      base = out.join('/');
    } else if (source.startsWith('package:')) {
      const rest = source.slice('package:'.length).split('/').slice(1).join('/');
      for (const f of this.files.keys()) if (f.endsWith(`lib/${rest}`)) return f;
      return undefined;
    } else {
      return undefined;
    }
    for (const candidate of [base, ...CODE_EXTENSIONS.map((e) => base + e), ...CODE_EXTENSIONS.map((e) => `${base}/index${e}`)]) {
      if (this.files.has(candidate)) return candidate;
    }
    return undefined;
  }

  /** Files whose declarations `file` can see: itself, its imports and what they re-export. */
  private visibleFiles(file: string): Set<string> {
    const cached = this.visibleCache.get(file);
    if (cached) return cached;
    const visible = new Set([file]);
    const viaExports = (f: string, depth: number) => {
      if (depth > 4) return;
      for (const imp of this.files.get(f)?.imports ?? []) {
        if (!imp.isExport) continue;
        const target = this.resolveImport(f, imp.source);
        if (target && !visible.has(target)) {
          visible.add(target);
          viaExports(target, depth + 1);
        }
      }
    };
    for (const imp of this.files.get(file)?.imports ?? []) {
      const target = this.resolveImport(file, imp.source);
      if (target && !visible.has(target)) {
        visible.add(target);
        viaExports(target, 1);
      }
    }
    this.visibleCache.set(file, visible);
    return visible;
  }

  /**
   * The file declaring the `name` that `file` refers to: unique declaration,
   * else the one visible through imports, else the nearest by directory.
   */
  resolveDeclaration(file: string, name: string): string | undefined {
    const decls = [...new Set([...(this.classes.get(name) ?? []), ...(this.functions.get(name) ?? []).filter((f) => !f.fact.enclosingClass)].map((d) => d.file))];
    if (decls.length <= 1) return decls[0];
    if (decls.includes(file)) return file;
    const visible = this.visibleFiles(file);
    const reachable = decls.filter((d) => visible.has(d));
    if (reachable.length === 1) return reachable[0];
    const pool = reachable.length ? reachable : decls;
    const dir = file.split('/').slice(0, -1);
    const shared = (d: string) => {
      const other = d.split('/').slice(0, -1);
      let n = 0;
      while (n < dir.length && n < other.length && dir[n] === other[n]) n++;
      return n;
    };
    return [...pool].sort((a, b) => shared(b) - shared(a))[0];
  }

  /** `file#Owner` → declarations it instantiates or renders (`file#Type`, or `?#Type` outside the project). */
  private uses(): Map<string, Set<string>> {
    if (this.qualifiedUses) return this.qualifiedUses;
    const map = new Map<string, Set<string>>();
    for (const [file, facts] of this.files) {
      const use = (owner: string | undefined, type: string) => {
        if (!owner || owner === type) return;
        const key = `${file}#${owner}`;
        let set = map.get(key);
        if (!set) map.set(key, (set = new Set()));
        set.add(`${this.resolveDeclaration(file, type) ?? '?'}#${type}`);
      };
      for (const call of facts.calls) {
        const owner = call.enclosingClass ?? call.enclosingFunction;
        if (call.isInstantiation) use(owner, call.name);
        for (const a of call.args) for (const t of a.typeRefs) use(owner, t);
      }
      for (const j of facts.jsx) {
        const owner = j.enclosingClass ?? j.enclosingFunction;
        if (/^[A-Z]/.test(j.name)) use(owner, j.name.split('.')[0]!);
        for (const a of j.attrs) for (const t of a.typeRefs) use(owner, t);
      }
    }
    this.qualifiedUses = map;
    return map;
  }

  /**
   * Owners (from `candidates`, by name) that use `name`, following component
   * usage up to `depth` levels: a navigation inside `PromoBanner` belongs to the
   * screens that render a `PromoBanner`. Pass `fromFile` (where `name` is
   * declared or used) to follow that exact declaration rather than every class
   * with the same name.
   */
  ownersUsing(name: string, candidates: Set<string>, depth = 3, fromFile?: string): string[] {
    const uses = this.uses();
    let frontier: Set<string>;
    if (fromFile) {
      frontier = new Set([`${this.resolveDeclaration(fromFile, name) ?? fromFile}#${name}`]);
    } else {
      const decls = [...(this.classes.get(name) ?? []), ...(this.functions.get(name) ?? [])].map((d) => `${d.file}#${name}`);
      frontier = new Set([...decls, `?#${name}`]);
    }
    const found = new Set<string>();
    const seen = new Set(frontier);
    for (let d = 0; d < depth && frontier.size; d++) {
      const next = new Set<string>();
      for (const [owner, types] of uses) {
        if (seen.has(owner)) continue;
        if ([...frontier].some((t) => types.has(t))) {
          const ownerName = owner.slice(owner.indexOf('#') + 1);
          if (candidates.has(ownerName)) found.add(ownerName);
          else next.add(owner);
          seen.add(owner);
        }
      }
      frontier = next;
    }
    return [...found];
  }
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Converts a route pattern (`/product/:id`, `detail/{id}`) to a matcher; `*` in the probe matches any segment. */
export function routeMatcher(pattern: string): (probe: string) => boolean {
  const norm = (s: string) => s.replace(/\/+$/, '') || '/';
  const parts = norm(pattern).split('/');
  return (probe) => {
    const p = norm(probe).split('?')[0]!.split('/');
    if (p.length !== parts.length) return false;
    return parts.every((seg, i) => {
      const actual = p[i]!;
      if (/^[:{]/.test(seg) || seg === '*') return actual.length > 0;
      if (actual === '*') return false;
      if (actual.includes('*')) return new RegExp(`^${actual.split('*').map(escapeRegExp).join('.*')}$`).test(seg);
      return seg === actual;
    });
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
