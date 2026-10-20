import type { Node } from 'web-tree-sitter';
import type { ArgFact, FactPos, HandlerContext } from './facts';

export type { Node };

export const pos = (n: Node): FactPos => ({ line: n.startPosition.row + 1, column: n.startPosition.column + 1 });

export function namedChildren(n: Node): Node[] {
  const out: Node[] = [];
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i);
    if (c) out.push(c);
  }
  return out;
}

export function children(n: Node): Node[] {
  const out: Node[] = [];
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i);
    if (c) out.push(c);
  }
  return out;
}

export function firstOfType(n: Node, ...types: string[]): Node | undefined {
  return namedChildren(n).find((c) => types.includes(c.type));
}

/** Depth-first pre-order traversal; return `false` from `visit` to skip a subtree. */
export function walk(root: Node, visit: (n: Node) => boolean | void): void {
  const stack: Node[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (visit(n) === false) continue;
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i);
      if (c) stack.push(c);
    }
  }
}

export function countErrors(root: Node): number {
  let errors = 0;
  walk(root, (n) => {
    if (n.type === 'ERROR' || n.isMissing) errors++;
  });
  return errors;
}

/** Type-like name; Dart private types (`_LoginPageState`) count too. */
export const isCapitalized = (s: string): boolean => /^_*[A-Z]/.test(s);

/** Handler-like argument labels: `onPressed`, `onClick`, `action`, … */
export const HANDLER_LABEL = /^(on[A-Z]\w*|action)$/;
/** Calls whose closure argument is an event handler. */
export const LISTENER_CALL = /^(setOn\w+Listener|addOn\w+Listener|on[A-Z]\w*|clickable|addTarget)$/;
/** Function names that are event handlers by convention. */
export const HANDLER_FUNCTION = /^(on[A-Z]\w*|handle[A-Z]\w*|did[A-Z]\w*|tap\w*|.*(Tapped|Clicked|Pressed))$/;

/** Language-specific hooks used to build `ArgFact`s generically. */
export interface ArgSpec {
  /** Returns the literal value / interpolation pattern of a string node, or null if `n` is not a string. */
  stringOf(n: Node): { value?: string; pattern?: string } | null;
  /** Returns a referenced type name when `n` is an instantiation or class literal. */
  typeRefOf(n: Node): string | null;
  isLambda(n: Node): boolean;
}

/** Builds an ArgFact from the node(s) making up an argument's value. */
export function buildArg(valueNodes: Node[], spec: ArgSpec, label?: string): ArgFact {
  const text = valueNodes.map((n) => n.text).join('').trim();
  const typeRefs: string[] = [];
  const strings: string[] = [];
  for (const v of valueNodes) {
    walk(v, (n) => {
      const ref = spec.typeRefOf(n);
      if (ref && !typeRefs.includes(ref)) typeRefs.push(ref);
      const s = spec.stringOf(n);
      if (s) {
        if (s.value !== undefined) strings.push(s.value);
        return false;
      }
      return true;
    });
  }
  const single = valueNodes.length === 1 ? spec.stringOf(valueNodes[0]!) : null;
  return {
    label,
    text,
    stringValue: single?.value,
    stringPattern: single?.pattern ?? single?.value,
    typeRefs,
    strings,
    isLambda: valueNodes.length === 1 && spec.isLambda(valueNodes[0]!),
  };
}

/** The visible label of a component: its first string argument outside the handler argument. */
export function ownerLabel(args: ArgFact[], exclude?: ArgFact): string | undefined {
  for (const a of args) {
    // Named closures (`onEdit = { … }`) are other handlers, not the visible label.
    if (a === exclude || (a.label && a.isLambda)) continue;
    const s = a.stringValue ?? a.strings[0];
    if (s) return s;
  }
  return undefined;
}

export function handler(name: string, owner?: string, label?: string): HandlerContext {
  return { name, owner, ownerLabel: label };
}

/** Strips quote delimiters from a string literal's source text. */
export function unquote(text: string): string {
  let t = text;
  if (/^[rR]/.test(t)) t = t.slice(1);
  for (const q of ['"""', "'''", '"', "'", '`']) {
    if (t.startsWith(q) && t.endsWith(q) && t.length >= 2 * q.length) return t.slice(q.length, t.length - q.length);
  }
  return t;
}
