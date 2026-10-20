import { countErrors, handler, HANDLER_FUNCTION, isCapitalized, namedChildren, pos, unquote, walk, type Node } from '../ast';
import { emptyFacts, type ArgFact, type FileFacts, type HandlerContext } from '../facts';

/**
 * Objective-C support is intentionally narrow: class declarations, message
 * sends (`[receiver selector:arg]`) and `[[X alloc] init]` / `[X new]`
 * instantiations. Macros, blocks and categories are not interpreted.
 */

interface Scope {
  cls?: string;
  fn?: string;
  handler?: HandlerContext;
  parentCall?: number;
}

function stringValue(n: Node): string | undefined {
  if (n.type === 'string_literal') return unquote(n.text.replace(/^@/, ''));
  return undefined;
}

/** `[[X alloc] init]`, `[X new]`, `[X alloc]` → `X`. */
function instantiatedType(n: Node): string | null {
  if (n.type !== 'message_expression') return null;
  const receiver = n.childForFieldName('receiver');
  const method = n.childForFieldName('method')?.text;
  if (receiver?.type === 'identifier' && isCapitalized(receiver.text) && (method === 'alloc' || method === 'new')) return receiver.text;
  if (receiver?.type === 'message_expression' && method?.startsWith('init')) return instantiatedType(receiver);
  return null;
}

function argFact(valueNodes: Node[], label?: string): ArgFact {
  const typeRefs: string[] = [];
  const strings: string[] = [];
  for (const v of valueNodes) {
    walk(v, (n) => {
      const t = instantiatedType(n);
      if (t && !typeRefs.includes(t)) typeRefs.push(t);
      const s = stringValue(n);
      if (s !== undefined) strings.push(s);
    });
  }
  const single = valueNodes.length === 1 ? stringValue(valueNodes[0]!) : undefined;
  return {
    label,
    text: valueNodes.map((n) => n.text).join(' '),
    stringValue: single,
    stringPattern: single,
    typeRefs,
    strings,
    isLambda: valueNodes.length === 1 && valueNodes[0]!.type === 'block_literal',
  };
}

/** Extracts facts from an Objective-C syntax tree. */
export function extractObjc(root: Node): FileFacts {
  const facts = emptyFacts();
  facts.syntaxErrors = countErrors(root);

  const visit = (n: Node, scope: Scope): void => {
    switch (n.type) {
      case 'class_interface': {
        const name = namedChildren(n).find((c) => c.type === 'identifier')?.text;
        const superclass = n.childForFieldName('superclass')?.text;
        if (name) {
          facts.classes.push({ name, kind: 'class', supertypes: superclass ? [superclass] : [], supertypeArgs: [], annotations: [], endLine: n.endPosition.row + 1, ...pos(n) });
        }
        return;
      }
      case 'class_implementation': {
        const name = namedChildren(n).find((c) => c.type === 'identifier')?.text;
        for (const c of namedChildren(n)) visit(c, { ...scope, cls: name });
        return;
      }
      case 'method_definition': {
        const name = namedChildren(n).find((c) => c.type === 'identifier')?.text;
        const childScope: Scope = { ...scope, fn: name };
        if (name) {
          facts.functions.push({ name, annotations: [], enclosingClass: scope.cls, endLine: n.endPosition.row + 1, exported: true, ...pos(n) });
          const returnsAction = /\(\s*IBAction\s*\)/.test(n.text.slice(0, 40));
          if ((returnsAction || HANDLER_FUNCTION.test(name)) && !scope.handler) childScope.handler = handler(returnsAction ? `@IBAction ${name}` : name);
        }
        for (const c of namedChildren(n)) visit(c, childScope);
        return;
      }
      case 'message_expression': {
        const receiver = n.childForFieldName('receiver');
        const parts = namedChildren(n);
        const methods: Node[] = [];
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i);
          if (c && n.fieldNameForChild(i) === 'method') methods.push(c);
        }
        const name = methods[0]?.text ?? '…';
        // Arguments follow each `selectorPart:` token.
        const args: ArgFact[] = [];
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i);
          if (c?.type === ':') {
            const value = n.child(i + 1);
            const label = n.child(i - 1)?.text;
            if (value && value.isNamed) args.push(argFact([value], label));
          }
        }
        const index = facts.calls.length;
        facts.calls.push({
          index,
          callee: `${receiver?.text ?? ''}.${name}`,
          name,
          args,
          hasTrailingLambda: false,
          enclosingClass: scope.cls,
          enclosingFunction: scope.fn,
          handler: scope.handler,
          parentCall: scope.parentCall,
          isInstantiation: instantiatedType(n) !== null,
          ...pos(n),
        });
        for (const c of parts) visit(c, { ...scope, parentCall: index });
        return;
      }
      case 'init_declarator': {
        let nameNode = n.childForFieldName('declarator');
        while (nameNode && nameNode.type !== 'identifier') nameNode = nameNode.childForFieldName('declarator') ?? nameNode.namedChild(0);
        const value = n.childForFieldName('value');
        if (nameNode && value) {
          facts.variables.push({ name: nameNode.text, value: argFact([value]), enclosingClass: scope.cls, enclosingFunction: scope.fn, ...pos(nameNode) });
        }
        break;
      }
      case 'string_literal': {
        const s = stringValue(n);
        if (s !== undefined) facts.strings.push({ value: s, ...pos(n) });
        return;
      }
      case 'preproc_include': {
        const path = namedChildren(n).find((c) => c.type === 'string_literal' || c.type === 'system_lib_string');
        if (path) facts.imports.push({ source: path.text.replace(/^["<]|[">]$/g, ''), names: [], line: pos(n).line });
        return;
      }
    }
    for (const c of namedChildren(n)) visit(c, scope);
  };

  visit(root, {});
  return facts;
}
