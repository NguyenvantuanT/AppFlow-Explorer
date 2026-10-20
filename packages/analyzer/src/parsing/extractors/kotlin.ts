import { buildArg, countErrors, handler, HANDLER_FUNCTION, HANDLER_LABEL, isCapitalized, LISTENER_CALL, namedChildren, ownerLabel, pos, walk, type ArgSpec, type Node } from '../ast';
import { emptyFacts, type ArgFact, type FileFacts, type HandlerContext } from '../facts';

interface Scope {
  cls?: string;
  fn?: string;
  handler?: HandlerContext;
  parentCall?: number;
  variable?: string;
}

function stringOf(n: Node): { value?: string; pattern?: string } | null {
  if (n.type !== 'string_literal' && n.type !== 'multiline_string_literal') return null;
  let value = '';
  let pattern = '';
  let dynamic = false;
  for (const c of namedChildren(n)) {
    if (c.type === 'string_content') {
      value += c.text;
      pattern += c.text;
    } else if (c.type.startsWith('interpolat')) {
      dynamic = true;
      pattern += '*';
    }
  }
  return dynamic ? { pattern } : { value, pattern: value };
}

function calleeName(n: Node | null): string {
  if (!n) return '';
  switch (n.type) {
    case 'simple_identifier':
    case 'type_identifier':
      return n.text;
    case 'this_expression':
      return 'this';
    case 'navigation_expression': {
      const [target, suffix] = namedChildren(n);
      const name = suffix ? namedChildren(suffix).find((c) => c.type === 'simple_identifier')?.text : undefined;
      return [calleeName(target ?? null), name].filter(Boolean).join('.');
    }
    case 'call_expression':
      return calleeName(n.namedChild(0));
    case 'parenthesized_expression':
      return calleeName(n.namedChild(0));
    default:
      return '…';
  }
}

function typeRefOf(n: Node): string | null {
  if (n.type === 'callable_reference') return namedChildren(n).find((c) => c.type === 'type_identifier')?.text ?? null;
  if (n.type === 'call_expression') {
    const callee = n.namedChild(0);
    if (callee?.type === 'simple_identifier' && isCapitalized(callee.text)) return callee.text;
  }
  return null;
}

const spec: ArgSpec = { stringOf, typeRefOf, isLambda: (n) => n.type === 'lambda_literal' || n.type === 'annotated_lambda' };

function annotationsOf(n: Node): string[] {
  const modifiers = namedChildren(n).find((c) => c.type === 'modifiers');
  if (!modifiers) return [];
  return namedChildren(modifiers)
    .filter((c) => c.type === 'annotation')
    .map((a) => a.text.replace(/^@/, '').split('(')[0]!.trim());
}

/** Extracts facts from a Kotlin syntax tree. */
export function extractKotlin(root: Node): FileFacts {
  const facts = emptyFacts();
  facts.syntaxErrors = countErrors(root);

  const valueArgs = (suffix: Node): Array<{ node: Node; fact: ArgFact }> => {
    const out: Array<{ node: Node; fact: ArgFact }> = [];
    for (const c of namedChildren(suffix)) {
      if (c.type === 'value_arguments') {
        for (const a of namedChildren(c).filter((x) => x.type === 'value_argument')) {
          const parts = namedChildren(a);
          const hasLabel = parts.length > 1 && parts[0]!.type === 'simple_identifier' && a.text.slice(parts[0]!.endIndex - a.startIndex).trimStart().startsWith('=');
          out.push({ node: a, fact: buildArg(hasLabel ? parts.slice(1) : parts, spec, hasLabel ? parts[0]!.text : undefined) });
        }
      } else if (c.type === 'annotated_lambda' || c.type === 'lambda_literal') {
        out.push({ node: c, fact: { ...buildArg([c], spec), isLambda: true } });
      }
    }
    return out;
  };

  const visit = (n: Node, scope: Scope): void => {
    switch (n.type) {
      case 'class_declaration':
      case 'object_declaration':
      case 'companion_object': {
        const name = namedChildren(n).find((c) => c.type === 'type_identifier')?.text ?? (n.type === 'companion_object' ? scope.cls : undefined);
        if (!name) break;
        if (n.type !== 'companion_object') {
          const supertypes: string[] = [];
          const supertypeArgs: string[] = [];
          for (const d of namedChildren(n).filter((c) => c.type === 'delegation_specifier')) {
            const userType = d.descendantsOfType('user_type')[0];
            const t = userType ? namedChildren(userType).find((c) => c.type === 'type_identifier') : undefined;
            if (t) supertypes.push(t.text);
            const targs = userType ? namedChildren(userType).find((c) => c.type === 'type_arguments') : undefined;
            if (targs) walk(targs, (x) => void (x.type === 'type_identifier' && supertypeArgs.push(x.text)));
          }
          const isInterface = n.children.some((c) => c?.type === 'interface');
          facts.classes.push({
            name,
            kind: n.type === 'object_declaration' ? 'object' : isInterface ? 'interface' : 'class',
            supertypes,
            supertypeArgs,
            annotations: annotationsOf(n),
            endLine: n.endPosition.row + 1,
            ...pos(n),
          });
        }
        for (const c of namedChildren(n)) visit(c, { ...scope, cls: name, fn: undefined });
        return;
      }
      case 'function_declaration': {
        const name = namedChildren(n).find((c) => c.type === 'simple_identifier')?.text;
        const annotations = annotationsOf(n);
        if (name) {
          facts.functions.push({
            name,
            annotations,
            enclosingClass: scope.cls,
            endLine: n.endPosition.row + 1,
            exported: !n.text.startsWith('private'),
            ...pos(n),
          });
        }
        const childScope: Scope = { ...scope, fn: name };
        if (name && HANDLER_FUNCTION.test(name) && !scope.handler) childScope.handler = handler(name);
        for (const c of namedChildren(n)) visit(c, childScope);
        return;
      }
      case 'property_declaration': {
        const decl = namedChildren(n).find((c) => c.type === 'variable_declaration');
        const nameNode = decl ? namedChildren(decl).find((c) => c.type === 'simple_identifier') : undefined;
        const valueNodes = namedChildren(n).filter((c) => decl && c.startIndex > decl.endIndex && c.type !== 'property_delegate');
        if (nameNode && valueNodes.length) {
          const value = buildArg(valueNodes, spec);
          if (value.stringValue !== undefined) {
            facts.constants.push({ name: scope.cls ? `${scope.cls}.${nameNode.text}` : nameNode.text, value: value.stringValue, line: pos(n).line });
            if (scope.cls) facts.constants.push({ name: nameNode.text, value: value.stringValue, line: pos(n).line });
          }
          const init = valueNodes[0]!;
          facts.variables.push({
            name: nameNode.text,
            value,
            enclosingClass: scope.cls,
            enclosingFunction: scope.fn,
            initCallee: init.type === 'call_expression' ? calleeName(init) : undefined,
            ...pos(nameNode),
          });
          for (const v of valueNodes) visit(v, { ...scope, variable: nameNode.text });
          return;
        }
        break;
      }
      case 'call_expression': {
        const callee = n.namedChild(0);
        const suffix = namedChildren(n).find((c) => c.type === 'call_suffix');
        // `foo(args) { lambda }` nests as call(call(foo, args), lambda): merge into one call.
        const innerCall = callee?.type === 'call_expression' ? callee : null;
        const lambdaOnly = !!suffix && !namedChildren(suffix).some((c) => c.type === 'value_arguments');
        if (innerCall && lambdaOnly) {
          visitCall(innerCall, scope, suffix);
          return;
        }
        if (suffix) {
          visitCall(n, scope);
          return;
        }
        break;
      }
      case 'import_header': {
        const id = namedChildren(n).find((c) => c.type === 'identifier');
        if (id) facts.imports.push({ source: id.text, names: [{ local: id.text.split('.').pop()!, imported: id.text }], line: pos(n).line });
        return;
      }
      case 'string_literal': {
        const s = stringOf(n);
        if (s?.value !== undefined) facts.strings.push({ value: s.value, ...pos(n) });
        break;
      }
    }
    for (const c of namedChildren(n)) visit(c, scope);
  };

  /** Records a call; `extraSuffix` carries a trailing lambda that the grammar nested outside. */
  const visitCall = (call: Node, scope: Scope, extraSuffix?: Node): void => {
    const calleeNode = call.namedChild(0);
    const suffix = namedChildren(call).find((c) => c.type === 'call_suffix');
    const args = [...(suffix ? valueArgs(suffix) : []), ...(extraSuffix ? valueArgs(extraSuffix) : [])];
    const callee = calleeName(calleeNode);
    const name = callee.split('.').pop() ?? callee;
    const index = facts.calls.length;
    const nameNode = calleeNode?.type === 'navigation_expression' ? calleeNode.lastNamedChild ?? calleeNode : calleeNode ?? call;
    facts.calls.push({
      index,
      callee,
      name,
      args: args.map((a) => a.fact),
      hasTrailingLambda: args.some((a) => a.node.type === 'annotated_lambda' || a.node.type === 'lambda_literal'),
      enclosingClass: scope.cls,
      enclosingFunction: scope.fn,
      handler: scope.handler,
      parentCall: scope.parentCall,
      isInstantiation: isCapitalized(name) && calleeNode?.type === 'simple_identifier',
      ...pos(nameNode),
    });
    // The receiver chain may contain calls of its own (e.g. `findNavController().navigate`).
    if (calleeNode && calleeNode.type !== 'simple_identifier') visit(calleeNode, scope);
    const receiver = callee.includes('.') ? callee.slice(0, callee.lastIndexOf('.')) : undefined;
    for (const a of args) {
      const childScope: Scope = { ...scope, parentCall: index };
      const label = a.fact.label;
      if (label && HANDLER_LABEL.test(label)) {
        childScope.handler = handler(label, name, ownerLabel(args.map((x) => x.fact), a.fact));
      } else if (a.fact.isLambda && LISTENER_CALL.test(name)) {
        childScope.handler = handler(name, receiver ?? name);
      }
      visit(a.node, childScope);
    }
  };

  visit(root, {});
  return facts;
}
