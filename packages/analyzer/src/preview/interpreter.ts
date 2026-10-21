import type { PreviewNode } from '@appflow/model';
import { namedChildren, type Node } from '../parsing/ast';
import { stringValue, type ModuleGraph, type ModuleInfo } from './modules';

/**
 * A small static interpreter for the part of JavaScript that UI code uses to
 * describe a screen: literals, objects, styles, props, conditionals, `map`,
 * component calls and JSX. Nothing from the project is executed; anything
 * the interpreter cannot know (state, data, native results) is `Unknown` and
 * carries its source text so it can be shown as a placeholder.
 */

/** Text pieces of a string built from known text and runtime data (`${name}さん`). */
export type TextPart = string | { expr: string };

export class Unknown {
  constructor(
    readonly text?: string,
    /** For strings built from templates or `+`: the literal text and the expressions in between. */
    readonly parts?: TextPart[],
  ) {}
}
/** A function written in the project, closed over its scope. */
export class Closure {
  constructor(
    readonly node: Node,
    readonly scope: Scope,
    readonly mod: ModuleInfo,
    readonly name?: string,
  ) {}
}
/** A value imported from a library (`View` from react-native), possibly a member of it (`Animated.View`). */
export class Host {
  constructor(
    readonly module: string,
    readonly path: string[],
  ) {}
  get name(): string {
    return this.path.at(-1) ?? this.module;
  }
}
/** Elements already rendered to preview nodes. */
export class Rendered {
  constructor(readonly nodes: PreviewNode[]) {}
}
/** An image file of the project (`require('./logo.png')`). */
export class Asset {
  constructor(readonly path: string) {}
}
/** A project module used as a value (`import * as X`, `require('./x')`). */
export class ModRef {
  constructor(readonly mod: ModuleInfo) {}
}
export class Builtin {
  constructor(readonly fn: (args: Val[], thisArg?: Val) => Val) {}
}
/** A class component. */
export class ClassComponent {
  constructor(
    readonly node: Node,
    readonly scope: Scope,
    readonly mod: ModuleInfo,
  ) {}
}

export type Val = undefined | null | boolean | number | string | Val[] | { [key: string]: Val } | Unknown | Closure | Host | Rendered | Asset | ModRef | Builtin | ClassComponent;
export type Obj = { [key: string]: Val };

export const isObj = (v: Val): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
export const isUnknown = (v: Val): v is Unknown => v instanceof Unknown;
const isPrimitive = (v: Val): v is undefined | null | boolean | number | string => v === undefined || v === null || typeof v !== 'object';

export class Scope {
  private readonly vars = new Map<string, Val>();
  constructor(readonly parent?: Scope) {}
  has(name: string): boolean {
    return this.vars.has(name) || !!this.parent?.has(name);
  }
  get(name: string): Val {
    if (this.vars.has(name)) return this.vars.get(name);
    return this.parent?.get(name);
  }
  set(name: string, v: Val): void {
    this.vars.set(name, v);
  }
  assign(name: string, v: Val): boolean {
    if (this.vars.has(name)) {
      this.vars.set(name, v);
      return true;
    }
    return !!this.parent?.assign(name, v);
  }
}

class BudgetExceeded extends Error {}
class ReturnSignal {
  constructor(readonly value: Val) {}
}

/** How JSX elements become preview nodes; supplied by the React Native layer. */
export interface ElementRenderer {
  /** Renders a library or built-in component. */
  host(interp: Interpreter, host: Host, props: Obj, children: Val[], at?: Node, mod?: ModuleInfo, tagText?: string): PreviewNode[];
  /** Calls a library function (`StyleSheet.create`, `useState`, `s(10)`…). */
  hostCall(interp: Interpreter, host: Host, args: Val[]): Val;
  /** A constant member of a library (`StyleSheet.hairlineWidth`, `Platform.OS`); `undefined` to keep it a `Host`. */
  hostMember(host: Host, key: string): Val | undefined;
  /** Location of an element, for click-to-code. */
  location(mod: ModuleInfo, at: Node): PreviewNode['location'];
}

export interface InterpreterLimits {
  steps: number;
  nodes: number;
  depth: number;
}

export class Interpreter {
  private steps = 0;
  private depth = 0;
  nodeCount = 0;
  readonly notes = new Set<string>();
  private readonly moduleValues = new Map<string, Map<string, Val>>();
  private readonly evaluating = new Set<string>();
  private readonly componentStack: Node[] = [];

  constructor(
    readonly graph: ModuleGraph,
    readonly renderer: ElementRenderer,
    readonly limits: InterpreterLimits = { steps: 400_000, nodes: 4000, depth: 60 },
  ) {}

  /** Wraps a top-level evaluation so running out of budget yields a partial result. */
  guard<T>(fn: () => T, fallback: T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof BudgetExceeded) {
        this.notes.add('The screen is too large to draw completely.');
        return fallback;
      }
      throw e;
    }
  }

  private tick(): void {
    if (++this.steps > this.limits.steps || this.nodeCount > this.limits.nodes) throw new BudgetExceeded();
  }

  // ---- Modules -----------------------------------------------------------------------------------------

  /** The value a module exports under `name` (`default`, a name, or `*` for the module itself). */
  exportOf(mod: ModuleInfo, name: string, seen = new Set<string>()): Val {
    if (mod.json !== undefined) return name === 'default' || name === '*' ? toVal(mod.json) : isObj(toVal(mod.json)) ? (toVal(mod.json) as Obj)[name] : undefined;
    if (name === '*') return new ModRef(mod);
    const key = `${mod.file}#${name}`;
    if (seen.has(key)) return new Unknown(name);
    seen.add(key);
    const e = mod.exports.get(name);
    if (e?.kind === 'local') return this.moduleLocal(mod, e.name);
    if (e?.kind === 'expr') return this.cached(mod, `export:${name}`, () => this.eval(e.node, new Scope(), mod));
    if (e?.kind === 're') return this.imported(mod, e.source, e.imported, seen);
    if (name !== 'default') {
      for (const star of mod.stars) {
        const r = this.graph.resolve(mod.file, star);
        const target = r?.kind === 'file' ? this.graph.module(r.path) : undefined;
        if (target && (target.exports.has(name) || target.stars.length)) {
          const v = this.exportOf(target, name, seen);
          if (v !== undefined && !(isUnknown(v) && v.text === name)) return v;
        }
      }
    }
    return undefined;
  }

  private imported(mod: ModuleInfo, source: string, imported: string, seen?: Set<string>): Val {
    const r = this.graph.resolve(mod.file, source);
    if (!r) return new Unknown(imported === 'default' || imported === '*' ? source : imported);
    if (r.kind === 'library') return new Host(source, imported === 'default' || imported === '*' ? [] : [imported]);
    if (r.kind === 'asset') return new Asset(r.path);
    const target = this.graph.module(r.path);
    return target ? this.exportOf(target, imported, seen) : new Unknown(imported);
  }

  /** A module-level binding, evaluated once. */
  moduleLocal(mod: ModuleInfo, name: string): Val {
    const decl = mod.locals.get(name);
    if (!decl) return undefined;
    return this.cached(mod, name, () => {
      const scope = new Scope();
      switch (decl.kind) {
        case 'import':
          return this.imported(mod, decl.source, decl.imported);
        case 'value':
          return this.eval(decl.node, scope, mod, name);
        case 'function':
          return /class/.test(decl.node.type) ? new ClassComponent(decl.node, scope, mod) : new Closure(decl.node, scope, mod, name);
        case 'pattern': {
          this.bindPattern(decl.pattern, this.eval(decl.value, scope, mod), scope, mod);
          return scope.get(name);
        }
      }
    });
  }

  private cached(mod: ModuleInfo, key: string, compute: () => Val): Val {
    let values = this.moduleValues.get(mod.file);
    if (!values) this.moduleValues.set(mod.file, (values = new Map()));
    if (values.has(key)) return values.get(key);
    const id = `${mod.file}#${key}`;
    if (this.evaluating.has(id)) return new Unknown(key);
    this.evaluating.add(id);
    try {
      const v = compute();
      values.set(key, v);
      return v;
    } finally {
      this.evaluating.delete(id);
    }
  }

  private lookup(name: string, scope: Scope, mod: ModuleInfo): Val {
    if (scope.has(name)) return scope.get(name);
    if (mod.locals.has(name)) return this.moduleLocal(mod, name);
    switch (name) {
      case 'undefined':
        return undefined;
      case 'NaN':
        return NaN;
      case 'Infinity':
        return Infinity;
      case 'require':
        return new Builtin((args) => (typeof args[0] === 'string' ? this.require(mod, args[0]) : new Unknown('require()')));
      case 'Array':
        return { isArray: new Builtin((args) => Array.isArray(args[0])), from: new Builtin((args) => (Array.isArray(args[0]) ? [...args[0]] : isObj(args[0]) && typeof args[0].length === 'number' ? Array.from({ length: Math.min(args[0].length, 50) }, (_, i) => (args[1] instanceof Closure ? this.call(args[1], [undefined, i]) : undefined)) : new Unknown('Array.from()'))) };
      case 'Math':
        return mathObject();
      case 'Object':
        return {
          keys: new Builtin((args) => (isObj(args[0]) ? Object.keys(args[0]) : new Unknown('Object.keys()'))),
          values: new Builtin((args) => (isObj(args[0]) ? Object.values(args[0]) : new Unknown('Object.values()'))),
          entries: new Builtin((args) => (isObj(args[0]) ? Object.entries(args[0]) : new Unknown('Object.entries()'))),
          assign: new Builtin((args) => Object.assign({}, ...args.filter(isObj))),
        };
      case 'String':
        return new Builtin((args) => (isPrimitive(args[0]) ? String(args[0]) : isUnknown(args[0]) ? args[0] : new Unknown('String()')));
      case 'Number':
        return new Builtin((args) => (isPrimitive(args[0]) ? Number(args[0]) : isUnknown(args[0]) ? args[0] : new Unknown('Number()')));
      case 'Boolean':
        return new Builtin((args) => (isUnknown(args[0]) ? args[0] : truthy(args[0])));
      case 'parseInt':
        return new Builtin((args) => (isPrimitive(args[0]) ? parseInt(String(args[0]), 10) : new Unknown('parseInt()')));
      case 'parseFloat':
        return new Builtin((args) => (isPrimitive(args[0]) ? parseFloat(String(args[0])) : new Unknown('parseFloat()')));
      case 'console':
        return { log: new Builtin(() => undefined), warn: new Builtin(() => undefined), error: new Builtin(() => undefined) };
    }
    return new Unknown(name);
  }

  private require(mod: ModuleInfo, spec: string): Val {
    const r = this.graph.resolve(mod.file, spec);
    if (!r) return new Unknown(`require('${spec}')`);
    if (r.kind === 'asset') return new Asset(r.path);
    if (r.kind === 'library') return new Host(spec, []);
    const target = this.graph.module(r.path);
    if (!target) return new Unknown(spec);
    // CommonJS modules export through module.exports; ES modules through their exports.
    return target.json !== undefined ? toVal(target.json) : target.exports.has('default') && !target.exports.size ? this.exportOf(target, 'default') : new ModRef(target);
  }

  // ---- Expressions ------------------------------------------------------------------------------------

  eval(n: Node, scope: Scope, mod: ModuleInfo, name?: string): Val {
    this.tick();
    switch (n.type) {
      case 'number':
        return Number(n.text.replace(/_/g, ''));
      case 'string':
        return stringValue(n);
      case 'true':
        return true;
      case 'false':
        return false;
      case 'null':
        return null;
      case 'undefined':
        return undefined;
      case 'template_string':
        return this.template(n, scope, mod);
      case 'identifier':
      case 'shorthand_property_identifier':
        return this.lookup(n.text, scope, mod);
      case 'this':
        return scope.get('this');
      case 'parenthesized_expression':
      case 'as_expression':
      case 'satisfies_expression':
      case 'non_null_expression':
      case 'type_assertion':
      case 'await_expression': {
        const inner = namedChildren(n).find((c) => !/type|comment/.test(c.type) || c.type === 'type_assertion');
        return inner ? this.eval(inner, scope, mod) : undefined;
      }
      case 'sequence_expression': {
        let v: Val;
        for (const c of namedChildren(n)) v = this.eval(c, scope, mod);
        return v;
      }
      case 'object':
        return this.object(n, scope, mod);
      case 'array': {
        const out: Val[] = [];
        for (const c of namedChildren(n)) {
          if (c.type === 'spread_element') {
            const v = this.eval(c.namedChild(0)!, scope, mod);
            if (Array.isArray(v)) out.push(...v);
          } else if (c.type !== 'comment') out.push(this.eval(c, scope, mod));
        }
        return out;
      }
      case 'arrow_function':
      case 'function_expression':
      case 'function':
      case 'generator_function':
        return new Closure(n, scope, mod, name ?? n.childForFieldName('name')?.text);
      case 'class':
        return new ClassComponent(n, scope, mod);
      case 'member_expression':
      case 'subscript_expression': {
        const obj = this.eval(n.childForFieldName('object')!, scope, mod);
        const key = n.type === 'member_expression' ? n.childForFieldName('property')!.text : this.eval(n.childForFieldName('index')!, scope, mod);
        if (isUnknown(key)) return new Unknown(n.text);
        return this.member(obj, String(key), n.text);
      }
      case 'call_expression':
        return this.callExpression(n, scope, mod);
      case 'new_expression':
        return new Unknown(n.text);
      case 'ternary_expression': {
        const test = this.eval(n.childForFieldName('condition')!, scope, mod);
        const yes = n.childForFieldName('consequence')!;
        const no = n.childForFieldName('alternative')!;
        if (!isUnknown(test)) return truthy(test) ? this.eval(yes, scope, mod) : this.eval(no, scope, mod);
        // Unknown condition: show the branch that draws more (data over spinner, content over null).
        const a = this.eval(yes, scope, mod);
        const b = this.eval(no, scope, mod);
        return weight(b) > weight(a) ? b : a;
      }
      case 'binary_expression':
        return this.binary(n, scope, mod);
      case 'unary_expression': {
        const op = n.childForFieldName('operator')?.text ?? n.child(0)?.text;
        const v = this.eval(n.childForFieldName('argument')!, scope, mod);
        if (op === 'typeof') return isUnknown(v) ? v : typeOf(v);
        if (op === 'void') return undefined;
        if (isUnknown(v)) return new Unknown(n.text);
        if (op === '!') return !truthy(v);
        if (op === '-') return typeof v === 'number' ? -v : new Unknown(n.text);
        if (op === '+') return isPrimitive(v) ? Number(v) : new Unknown(n.text);
        return new Unknown(n.text);
      }
      case 'assignment_expression': {
        const left = n.childForFieldName('left')!;
        const v = this.eval(n.childForFieldName('right')!, scope, mod);
        if (left.type === 'identifier') scope.assign(left.text, v);
        return v;
      }
      case 'jsx_element':
      case 'jsx_self_closing_element':
        return new Rendered(this.jsx(n, scope, mod));
      case 'spread_element':
        return this.eval(n.namedChild(0)!, scope, mod);
      default:
        return new Unknown(n.text);
    }
  }

  private template(n: Node, scope: Scope, mod: ModuleInfo): Val {
    const raw = n.text;
    let out = '';
    let last = 1;
    let unknown = false;
    const parts: TextPart[] = [];
    for (const sub of namedChildren(n).filter((c) => c.type === 'template_substitution')) {
      const literal = unescapeTemplate(raw.slice(last, sub.startIndex - n.startIndex));
      out += literal;
      parts.push(literal);
      const v = this.eval(sub.namedChild(0)!, scope, mod);
      if (isUnknown(v) || !isPrimitive(v)) {
        unknown = true;
        out += `{${sub.namedChild(0)!.text}}`;
        parts.push(...partsOf(v, sub.namedChild(0)!.text));
      } else {
        out += String(v);
        parts.push(String(v));
      }
      last = sub.endIndex - n.startIndex;
    }
    const tail = unescapeTemplate(raw.slice(last, raw.length - 1));
    out += tail;
    parts.push(tail);
    return unknown ? new Unknown(out, parts.filter((p) => p !== '')) : out;
  }

  private object(n: Node, scope: Scope, mod: ModuleInfo): Obj {
    const out: Obj = {};
    for (const c of namedChildren(n)) {
      if (c.type === 'pair') {
        const k = c.childForFieldName('key')!;
        const key = k.type === 'computed_property_name' ? this.eval(k.namedChild(0)!, scope, mod) : k.type === 'string' ? stringValue(k) : k.text;
        if (isUnknown(key) || !isPrimitive(key)) continue;
        out[String(key)] = this.eval(c.childForFieldName('value')!, scope, mod, String(key));
      } else if (c.type === 'shorthand_property_identifier') {
        out[c.text] = this.lookup(c.text, scope, mod);
      } else if (c.type === 'spread_element') {
        const v = this.eval(c.namedChild(0)!, scope, mod);
        if (isObj(v)) Object.assign(out, v);
      } else if (c.type === 'method_definition') {
        const name = c.childForFieldName('name')?.text;
        if (name) out[name] = new Closure(c, scope, mod, name);
      }
    }
    return out;
  }

  private binary(n: Node, scope: Scope, mod: ModuleInfo): Val {
    const op = n.childForFieldName('operator')!.text;
    const l = this.eval(n.childForFieldName('left')!, scope, mod);
    if (op === '&&') {
      if (isUnknown(l)) return this.eval(n.childForFieldName('right')!, scope, mod);
      return truthy(l) ? this.eval(n.childForFieldName('right')!, scope, mod) : l;
    }
    if (op === '||' || op === '??') {
      const known = op === '||' ? !isUnknown(l) && truthy(l) : !isUnknown(l) && l !== undefined && l !== null;
      if (known) return l;
      const r = this.eval(n.childForFieldName('right')!, scope, mod);
      // With an unknown left side, prefer a known fallback (`user?.avatar || defaultAvatar`).
      return isUnknown(l) && (isUnknown(r) || r === undefined) ? l : r;
    }
    const r = this.eval(n.childForFieldName('right')!, scope, mod);
    if (isUnknown(l) || isUnknown(r) || !isPrimitive(l) || !isPrimitive(r)) {
      if (op === '+' && (typeof l === 'string' || typeof r === 'string')) return new Unknown(`${textOf(l)}${textOf(r)}`, [...partsOf(l), ...partsOf(r)]);
      return new Unknown(n.text);
    }
    const a = l as any;
    const b = r as any;
    switch (op) {
      case '+':
        return a + b;
      case '-':
        return a - b;
      case '*':
        return a * b;
      case '/':
        return a / b;
      case '%':
        return a % b;
      case '**':
        return a ** b;
      case '===':
        return a === b;
      case '!==':
        return a !== b;
      case '==':
        return a == b;
      case '!=':
        return a != b;
      case '<':
        return a < b;
      case '<=':
        return a <= b;
      case '>':
        return a > b;
      case '>=':
        return a >= b;
      default:
        return new Unknown(n.text);
    }
  }

  member(obj: Val, key: string, text?: string): Val {
    if (obj === undefined || obj === null) return undefined;
    if (isUnknown(obj)) {
      // Lists known only at runtime: draw a few sample rows.
      if (key === 'map' || key === 'flatMap') return new Builtin(([f]) => Array.from({ length: 3 }, (_, i) => this.call(f, [new Unknown(`${obj.text ?? 'item'}[${i}]`), i])));
      if (key === 'filter' || key === 'slice' || key === 'sort' || key === 'reverse' || key === 'concat') return new Builtin(() => obj);
      return new Unknown(text ?? `${obj.text ?? '?'}.${key}`);
    }
    if (obj instanceof Host) {
      const constant = this.renderer.hostMember(obj, key);
      return constant !== undefined ? constant : new Host(obj.module, [...obj.path, key]);
    }
    if (obj instanceof ModRef) return this.exportOf(obj.mod, key);
    if (Array.isArray(obj)) return arrayMember(this, obj, key);
    if (typeof obj === 'string') return stringMember(obj, key);
    if (typeof obj === 'number') return key === 'toFixed' ? new Builtin((args) => obj.toFixed(typeof args[0] === 'number' ? args[0] : 0)) : key === 'toString' ? new Builtin(() => String(obj)) : undefined;
    if (isObj(obj)) return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
    if (obj instanceof Closure && (key === 'bind' || key === 'call')) return new Builtin(() => obj);
    return new Unknown(text ?? key);
  }

  private callExpression(n: Node, scope: Scope, mod: ModuleInfo): Val {
    const fnNode = n.childForFieldName('function')!;
    const argsNode = n.childForFieldName('arguments');
    const args: Val[] = [];
    for (const a of argsNode ? namedChildren(argsNode) : []) {
      if (a.type === 'comment') continue;
      if (a.type === 'spread_element') {
        const v = this.eval(a.namedChild(0)!, scope, mod);
        if (Array.isArray(v)) args.push(...v);
      } else args.push(this.eval(a, scope, mod));
    }
    let thisArg: Val;
    let fn: Val;
    if (fnNode.type === 'member_expression') {
      thisArg = this.eval(fnNode.childForFieldName('object')!, scope, mod);
      fn = this.member(thisArg, fnNode.childForFieldName('property')!.text, fnNode.text);
    } else {
      fn = this.eval(fnNode, scope, mod);
    }
    return this.call(fn, args, thisArg, n.text);
  }

  call(fn: Val, args: Val[], thisArg?: Val, text?: string): Val {
    if (fn instanceof Builtin) return fn.fn(args, thisArg);
    if (fn instanceof Host) return this.renderer.hostCall(this, fn, args);
    if (fn instanceof Closure) return this.callClosure(fn, args, thisArg);
    return new Unknown(text ?? 'call');
  }

  callClosure(fn: Closure, args: Val[], thisArg?: Val): Val {
    if (++this.depth > this.limits.depth) {
      this.depth--;
      return new Unknown(fn.name ?? 'call');
    }
    try {
      const scope = new Scope(fn.scope);
      if (thisArg !== undefined && fn.node.type !== 'arrow_function') scope.set('this', thisArg);
      const params = fn.node.childForFieldName('parameters') ?? fn.node.childForFieldName('parameter');
      if (params) {
        const list = params.type === 'formal_parameters' ? namedChildren(params).filter((p) => p.type !== 'comment') : [params];
        list.forEach((p, i) => this.bindParam(p, i, args, scope, fn.mod));
      }
      const body = fn.node.childForFieldName('body');
      if (!body) return undefined;
      if (body.type !== 'statement_block') return this.eval(body, scope, fn.mod);
      return this.block(body, scope, fn.mod);
    } finally {
      this.depth--;
    }
  }

  private bindParam(p: Node, i: number, args: Val[], scope: Scope, mod: ModuleInfo): void {
    if (p.type === 'required_parameter' || p.type === 'optional_parameter') {
      const pattern = p.childForFieldName('pattern')!;
      if (pattern.type === 'rest_pattern') return this.bindPattern(namedChildren(pattern)[0]!, args.slice(i), scope, mod);
      let v = args[i];
      const def = p.childForFieldName('value');
      if (v === undefined && def) v = this.eval(def, scope, mod);
      return this.bindPattern(pattern, v, scope, mod);
    }
    if (p.type === 'rest_pattern') return this.bindPattern(namedChildren(p)[0]!, args.slice(i), scope, mod);
    this.bindPattern(p, args[i], scope, mod);
  }

  bindPattern(p: Node, v: Val, scope: Scope, mod: ModuleInfo): void {
    switch (p.type) {
      case 'identifier':
      case 'shorthand_property_identifier_pattern':
        scope.set(p.text, v);
        return;
      case 'assignment_pattern': {
        const left = p.childForFieldName('left')!;
        this.bindPattern(left, v === undefined ? this.eval(p.childForFieldName('right')!, scope, mod) : v, scope, mod);
        return;
      }
      case 'object_pattern': {
        const used: string[] = [];
        for (const c of namedChildren(p)) {
          if (c.type === 'shorthand_property_identifier_pattern') {
            used.push(c.text);
            scope.set(c.text, this.member(v, c.text));
          } else if (c.type === 'object_assignment_pattern') {
            const left = c.childForFieldName('left')!;
            used.push(left.text);
            const got = this.member(v, left.text);
            this.bindPattern(left, got === undefined ? this.eval(c.childForFieldName('right')!, scope, mod) : got, scope, mod);
          } else if (c.type === 'pair_pattern') {
            const k = c.childForFieldName('key')!;
            const key = k.type === 'string' ? stringValue(k) : k.text;
            used.push(key);
            this.bindPattern(c.childForFieldName('value')!, this.member(v, key), scope, mod);
          } else if (c.type === 'rest_pattern') {
            const rest: Obj = {};
            if (isObj(v)) for (const [k, x] of Object.entries(v)) if (!used.includes(k)) rest[k] = x;
            this.bindPattern(namedChildren(c)[0]!, isUnknown(v) ? v : rest, scope, mod);
          }
        }
        return;
      }
      case 'array_pattern': {
        namedChildren(p).forEach((c, i) => {
          if (c.type === 'rest_pattern') this.bindPattern(namedChildren(c)[0]!, Array.isArray(v) ? v.slice(i) : v, scope, mod);
          else this.bindPattern(c, Array.isArray(v) ? v[i] : isUnknown(v) ? new Unknown(c.text) : undefined, scope, mod);
        });
        return;
      }
    }
  }

  // ---- Statements --------------------------------------------------------------------------------------

  private block(body: Node, scope: Scope, mod: ModuleInfo): Val {
    try {
      this.statements(namedChildren(body), scope, mod);
      return undefined;
    } catch (e) {
      if (e instanceof ReturnSignal) return e.value;
      throw e;
    }
  }

  private statements(list: Node[], scope: Scope, mod: ModuleInfo): void {
    // Function declarations are hoisted.
    for (const s of list) {
      if (s.type === 'function_declaration') {
        const name = s.childForFieldName('name')?.text;
        if (name) scope.set(name, new Closure(s, scope, mod, name));
      }
    }
    for (const s of list) this.statement(s, scope, mod);
  }

  private statement(s: Node, scope: Scope, mod: ModuleInfo): void {
    this.tick();
    switch (s.type) {
      case 'lexical_declaration':
      case 'variable_declaration':
        for (const d of namedChildren(s).filter((c) => c.type === 'variable_declarator')) {
          const name = d.childForFieldName('name')!;
          const value = d.childForFieldName('value');
          this.bindPattern(name, value ? this.eval(value, scope, mod, name.type === 'identifier' ? name.text : undefined) : undefined, scope, mod);
        }
        return;
      case 'return_statement': {
        const e = namedChildren(s).find((c) => c.type !== 'comment');
        throw new ReturnSignal(e ? this.eval(e, scope, mod) : undefined);
      }
      case 'if_statement': {
        const test = this.eval(s.childForFieldName('condition')!, scope, mod);
        const yes = s.childForFieldName('consequence')!;
        const no = s.childForFieldName('alternative');
        // An unknown condition usually guards an early return (loading, empty, error): keep going to the main content.
        if (isUnknown(test)) {
          if (no) this.statement(no, scope, mod);
          return;
        }
        if (truthy(test)) this.statement(yes, scope, mod);
        else if (no) this.statement(no, scope, mod);
        return;
      }
      case 'else_clause':
        for (const c of namedChildren(s)) this.statement(c, scope, mod);
        return;
      case 'statement_block':
        this.statements(namedChildren(s), new Scope(scope), mod);
        return;
      case 'expression_statement': {
        const e = s.namedChild(0);
        if (e?.type === 'assignment_expression') this.eval(e, scope, mod);
        return;
      }
      case 'try_statement': {
        const body = s.childForFieldName('body');
        if (body) this.statement(body, scope, mod);
        return;
      }
      case 'switch_statement': {
        const value = this.eval(s.childForFieldName('value')!, scope, mod);
        const cases = namedChildren(s.childForFieldName('body')!);
        const start = isUnknown(value) ? -1 : cases.findIndex((c) => c.type === 'switch_case' && this.eval(c.childForFieldName('value')!, scope, mod) === value);
        const from = start >= 0 ? start : cases.findIndex((c) => c.type === 'switch_default');
        if (from < 0) return;
        for (const c of cases.slice(from)) {
          for (const st of namedChildren(c).filter((x) => x !== c.childForFieldName('value'))) {
            if (st.type === 'break_statement') return;
            this.statement(st, scope, mod);
          }
        }
        return;
      }
    }
  }

  // ---- JSX ---------------------------------------------------------------------------------------------

  jsx(n: Node, scope: Scope, mod: ModuleInfo): PreviewNode[] {
    this.tick();
    const open = n.type === 'jsx_element' ? n.childForFieldName('open_tag') ?? namedChildren(n)[0]! : n;
    const nameNode = open.childForFieldName('name');
    const props: Obj = {};
    for (const a of namedChildren(open)) {
      if (a.type === 'jsx_attribute') {
        const [key, value] = namedChildren(a);
        if (!key) continue;
        props[key.text] = value === undefined ? true : value.type === 'string' ? stringValue(value) : value.type === 'jsx_expression' ? (value.namedChild(0) ? this.eval(value.namedChild(0)!, scope, mod) : undefined) : this.eval(value, scope, mod);
      } else if (a.type === 'jsx_expression') {
        const spread = a.namedChild(0);
        if (spread?.type === 'spread_element') {
          const v = this.eval(spread.namedChild(0)!, scope, mod);
          if (isObj(v)) Object.assign(props, v);
        }
      }
    }
    const children: Val[] = [];
    if (n.type === 'jsx_element') {
      for (const c of namedChildren(n)) {
        if (c === open || c.type === 'jsx_closing_element') continue;
        if (c.type === 'jsx_text') {
          const t = jsxText(c.text);
          if (t) children.push(t);
        } else if (c.type === 'html_character_reference') children.push(decodeEntity(c.text));
        else if (c.type === 'jsx_expression') {
          const e = c.namedChild(0);
          if (e && e.type !== 'comment') children.push(this.eval(e, scope, mod));
        } else if (c.type === 'jsx_element' || c.type === 'jsx_self_closing_element') children.push(new Rendered(this.jsx(c, scope, mod)));
      }
    }
    // A fragment (<>…</>) has no name.
    if (!nameNode) return this.flatten(children);
    const tag = this.eval(nameNode, scope, mod);
    return this.element(tag, props, children, nameNode.text, n, mod);
  }

  /** Renders `tag` with props; `children` are the JSX children (they override a `children` prop). */
  element(tag: Val, props: Obj, children: Val[], tagText: string, at?: Node, mod?: ModuleInfo): PreviewNode[] {
    const kids = children.length ? children : props.children !== undefined ? [props.children] : [];
    if (tag instanceof Host) {
      if (tag.name === 'Fragment') return this.flatten(kids);
      return this.renderer.host(this, tag, props, kids, at, mod, tagText);
    }
    if (tag instanceof Closure || tag instanceof ClassComponent) {
      if (this.componentStack.filter((x) => x === tag.node).length >= 2) return [];
      this.componentStack.push(tag.node);
      try {
        const childProp = kids.length === 0 ? undefined : kids.length === 1 ? kids[0] : kids;
        const p: Obj = { ...props, children: childProp };
        const result = tag instanceof Closure ? this.callClosure(tag, [p]) : this.renderClass(tag, p);
        return this.toNodes(result);
      } finally {
        this.componentStack.pop();
      }
    }
    // An image file used as a component (react-native-svg-transformer: `<Logo width={24} />`).
    if (tag instanceof Asset) {
      const size: Obj = {};
      for (const k of ['width', 'height']) if (typeof props[k] === 'number' || typeof props[k] === 'string') size[k] = props[k];
      return this.renderer.host(this, new Host('react-native', ['Image']), { source: tag, resizeMode: 'contain', style: [size, props.style] }, [], at, mod, tagText);
    }
    if (typeof tag === 'string') return this.renderer.host(this, new Host('react-native', [tag]), props, kids, at, mod);
    // Unresolved component: keep its children, say what it was.
    return this.renderer.host(this, new Host('?', [tagText]), props, kids, at, mod);
  }

  private renderClass(c: ClassComponent, props: Obj): Val {
    const body = c.node.childForFieldName('body');
    if (!body) return undefined;
    const self: Obj = { props, state: {} };
    const scope = new Scope(c.scope);
    for (const m of namedChildren(body)) {
      if (m.type === 'public_field_definition' || m.type === 'field_definition') {
        const name = m.childForFieldName('name')?.text;
        const value = m.childForFieldName('value');
        if (name && value) self[name] = this.eval(value, scope, c.mod, name);
      }
    }
    const ctor = namedChildren(body).find((m) => m.type === 'method_definition' && m.childForFieldName('name')?.text === 'constructor');
    if (ctor) this.callClosure(new Closure(ctor, scope, c.mod), [props], self);
    for (const m of namedChildren(body)) {
      const name = m.type === 'method_definition' ? m.childForFieldName('name')?.text : undefined;
      if (name && name !== 'render' && name !== 'constructor') self[name] = new Closure(m, scope, c.mod, name);
    }
    const render = namedChildren(body).find((m) => m.type === 'method_definition' && m.childForFieldName('name')?.text === 'render');
    return render ? this.callClosure(new Closure(render, scope, c.mod, 'render'), [], self) : undefined;
  }

  /** Preview nodes for a rendered value: elements, strings, arrays; nothing for booleans and unknown data. */
  toNodes(v: Val): PreviewNode[] {
    if (v instanceof Rendered) return v.nodes;
    if (Array.isArray(v)) return v.flatMap((x) => this.toNodes(x));
    if (typeof v === 'string' || typeof v === 'number') return [{ type: 'raw', text: String(v) }];
    if (isUnknown(v) && v.text) return [{ type: 'raw', text: v.text, dynamic: true }];
    return [];
  }

  flatten(children: Val[]): PreviewNode[] {
    return children.flatMap((c) => this.toNodes(c));
  }
}

// ---- Helpers ---------------------------------------------------------------------------------------------

export function truthy(v: Val): boolean {
  return !!v || (typeof v === 'object' && v !== null);
}

function typeOf(v: Val): string {
  if (v instanceof Closure || v instanceof Builtin || v instanceof ClassComponent) return 'function';
  if (v instanceof Host) return 'function';
  if (v === null || typeof v === 'object') return 'object';
  return typeof v;
}

/** Escapes in template literal text (`\n`, `　`). */
function unescapeTemplate(s: string): string {
  const map: Record<string, string> = { n: '\n', t: '\t', r: '', b: '\b', f: '\f', v: '\v', 0: '\0' };
  return s.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_m, c: string) => (c[0] === 'u' && c.length > 1 ? String.fromCodePoint(parseInt(c.replace(/[u{}]/g, ''), 16)) : c[0] === 'x' && c.length === 3 ? String.fromCharCode(parseInt(c.slice(1), 16)) : (map[c] ?? c)));
}

/** A value as text pieces: known text, or the expression it comes from. */
function partsOf(v: Val, fallback?: string): TextPart[] {
  if (isUnknown(v)) return v.parts ?? [{ expr: v.text ?? fallback ?? '…' }];
  if (isPrimitive(v)) return v === undefined || v === null ? [] : [String(v)];
  return fallback ? [{ expr: fallback }] : [];
}

function textOf(v: Val): string {
  if (isUnknown(v)) return `{${v.text ?? '…'}}`;
  return isPrimitive(v) ? String(v) : '';
}

/** How much a value draws, to pick between the branches of an unknown condition. */
function weight(v: Val): number {
  if (v instanceof Rendered) return 1 + v.nodes.reduce((s, n) => s + countNodes(n), 0);
  if (Array.isArray(v)) return v.reduce<number>((s, x) => s + weight(x), 0);
  if (typeof v === 'string' && v) return 0.5;
  return 0;
}

function countNodes(n: PreviewNode): number {
  return 1 + (n.children ?? []).reduce((s, c) => s + countNodes(c), 0);
}

export function toVal(x: unknown): Val {
  if (x === null || typeof x !== 'object') return x as Val;
  if (Array.isArray(x)) return x.map(toVal);
  const out: Obj = {};
  for (const [k, v] of Object.entries(x)) out[k] = toVal(v);
  return out;
}

/** JSX text: lines trimmed, blank lines dropped, joined with spaces. */
function jsxText(raw: string): string {
  if (/^\s*$/.test(raw) && /[\r\n]/.test(raw)) return '';
  const lines = raw.replace(/\r/g, '').split('\n');
  const kept = lines
    .map((l, i) => {
      let t = l.replace(/\t/g, ' ');
      if (i > 0) t = t.replace(/^\s+/, '');
      if (i < lines.length - 1) t = t.replace(/\s+$/, '');
      return t;
    })
    .filter((l) => l.length);
  return decodeEntities(kept.join(' '));
}

function decodeEntities(s: string): string {
  return s.replace(/&(\w+|#\d+|#x[0-9a-f]+);/gi, (m) => decodeEntity(m));
}

function decodeEntity(e: string): string {
  const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' };
  if (named[e]) return named[e]!;
  const m = /^&#(x?)([0-9a-f]+);$/i.exec(e);
  return m ? String.fromCodePoint(parseInt(m[2]!, m[1] ? 16 : 10)) : e;
}

function mathObject(): Obj {
  const num = (f: (...xs: number[]) => number) => new Builtin((args) => (args.every((a) => typeof a === 'number') ? f(...(args as number[])) : new Unknown('Math')));
  return { round: num(Math.round), floor: num(Math.floor), ceil: num(Math.ceil), min: num(Math.min), max: num(Math.max), abs: num(Math.abs), sqrt: num(Math.sqrt), pow: num(Math.pow), random: new Builtin(() => 0.5), PI: Math.PI };
}

function stringMember(s: string, key: string): Val {
  if (key === 'length') return s.length;
  const str = (f: (args: Val[]) => Val) => new Builtin(f);
  switch (key) {
    case 'toUpperCase':
      return str(() => s.toUpperCase());
    case 'toLowerCase':
      return str(() => s.toLowerCase());
    case 'trim':
      return str(() => s.trim());
    case 'toString':
      return str(() => s);
    case 'slice':
    case 'substring':
      return str((a) => s[key](typeof a[0] === 'number' ? a[0] : 0, typeof a[1] === 'number' ? a[1] : undefined));
    case 'split':
      return str((a) => (typeof a[0] === 'string' ? s.split(a[0]) : [s]));
    case 'includes':
    case 'startsWith':
    case 'endsWith':
      return str((a) => (typeof a[0] === 'string' ? s[key](a[0]) : new Unknown(key)));
    case 'replace':
    case 'replaceAll':
      return str((a) => (typeof a[0] === 'string' && typeof a[1] === 'string' ? s[key](a[0], a[1]) : s));
    case 'padStart':
    case 'padEnd':
      return str((a) => (typeof a[0] === 'number' ? s[key](a[0], typeof a[1] === 'string' ? a[1] : ' ') : s));
    case 'charAt':
      return str((a) => s.charAt(typeof a[0] === 'number' ? a[0] : 0));
  }
  return undefined;
}

function arrayMember(interp: Interpreter, arr: Val[], key: string): Val {
  const cb = (f: Val, args: Val[]) => interp.call(f, args);
  switch (key) {
    case 'length':
      return arr.length;
    case 'map':
      return new Builtin(([f]) => arr.slice(0, 50).map((x, i) => cb(f, [x, i, arr])));
    case 'filter':
      return new Builtin(([f]) => (f instanceof Host && f.name === 'Boolean' ? arr.filter(truthy) : arr.filter((x, i) => { const r = cb(f, [x, i, arr]); return isUnknown(r) || truthy(r); })));
    case 'find':
      return new Builtin(([f]) => arr.find((x, i) => truthy(cb(f, [x, i, arr]))));
    case 'some':
      return new Builtin(([f]) => arr.some((x, i) => truthy(cb(f, [x, i, arr]))));
    case 'every':
      return new Builtin(([f]) => arr.every((x, i) => truthy(cb(f, [x, i, arr]))));
    case 'forEach':
      return new Builtin(() => undefined);
    case 'includes':
      return new Builtin(([x]) => arr.includes(x));
    case 'indexOf':
      return new Builtin(([x]) => arr.indexOf(x));
    case 'join':
      return new Builtin(([sep]) => (arr.every(isPrimitive) ? arr.join(typeof sep === 'string' ? sep : ',') : new Unknown('join')));
    case 'slice':
      return new Builtin(([a, b]) => arr.slice(typeof a === 'number' ? a : 0, typeof b === 'number' ? b : undefined));
    case 'concat':
      return new Builtin((args) => arr.concat(...args.map((x) => (Array.isArray(x) ? x : [x]))));
    case 'flat':
      return new Builtin(() => arr.flat() as Val[]);
    case 'reverse':
      return new Builtin(() => [...arr].reverse());
    case 'reduce':
      return new Builtin(([f, init]) => arr.reduce<Val>((acc, x, i) => cb(f, [acc, x, i, arr]), init));
    case 'at':
      return new Builtin(([i]) => (typeof i === 'number' ? arr.at(i) : undefined));
  }
  return /^\d+$/.test(key) ? arr[Number(key)] : undefined;
}
