import { buildArg, children, countErrors, handler, HANDLER_FUNCTION, HANDLER_LABEL, isCapitalized, namedChildren, ownerLabel, pos, unquote, walk, type ArgSpec, type Node } from '../ast';
import { emptyFacts, type ArgFact, type FileFacts, type HandlerContext } from '../facts';

interface Scope {
  cls?: string;
  fn?: string;
  handler?: HandlerContext;
  parentCall?: number;
  variable?: string;
  pairKeys: string[];
}

function stringOf(n: Node): { value?: string; pattern?: string } | null {
  if (n.type !== 'string_literal') return null;
  const subs = namedChildren(n).filter((c) => c.type === 'template_substitution');
  if (subs.length === 0) return { value: unquote(n.text) };
  let pattern = '';
  let cursor = n.startIndex;
  for (const s of subs) {
    pattern += n.text.slice(cursor - n.startIndex, s.startIndex - n.startIndex) + '*';
    cursor = s.endIndex;
  }
  pattern += n.text.slice(cursor - n.startIndex);
  return { pattern: unquote(pattern) };
}

function hasCallSelector(n: Node | null): boolean {
  return !!n && n.type === 'selector' && namedChildren(n).some((c) => c.type === 'argument_part');
}

function typeRefOf(n: Node): string | null {
  if (n.type === 'const_object_expression' || n.type === 'new_expression') {
    return namedChildren(n).find((c) => c.type === 'type_identifier')?.text ?? null;
  }
  if (n.type === 'identifier' && isCapitalized(n.text) && hasCallSelector(n.nextNamedSibling)) return n.text;
  return null;
}

const spec: ArgSpec = { stringOf, typeRefOf, isLambda: (n) => n.type === 'function_expression' };

function selectorName(sel: Node): string | null {
  const assignable = namedChildren(sel).find((c) => c.type.endsWith('assignable_selector'));
  if (!assignable) return null;
  return namedChildren(assignable).find((c) => c.type === 'identifier')?.text ?? null;
}

function signatureName(sig: Node | null): string | undefined {
  if (!sig) return undefined;
  const direct = sig.childForFieldName('name');
  if (direct) return direct.text;
  let found: string | undefined;
  walk(sig, (n) => {
    if (found) return false;
    const name = n.childForFieldName('name');
    if (name) {
      found = name.text;
      return false;
    }
    return true;
  });
  return found;
}

/** Extracts facts from a Dart syntax tree. */
export function extractDart(root: Node): FileFacts {
  const facts = emptyFacts();
  facts.syntaxErrors = countErrors(root);

  const argsOf = (argumentsNode: Node): Array<{ node: Node; fact: ArgFact }> =>
    namedChildren(argumentsNode)
      .filter((a) => a.type === 'argument' || a.type === 'named_argument')
      .map((a) => {
        if (a.type === 'named_argument') {
          const label = namedChildren(a).find((c) => c.type === 'label');
          const labelText = label ? namedChildren(label).find((c) => c.type === 'identifier')?.text : undefined;
          const values = namedChildren(a).filter((c) => c.type !== 'label');
          return { node: a, fact: buildArg(values, spec, labelText) };
        }
        return { node: a, fact: buildArg(namedChildren(a), spec) };
      });

  const emitCall = (
    callee: string,
    at: Node,
    argumentsNode: Node | undefined,
    scope: Scope,
    isInstantiation: boolean,
  ): void => {
    const args = argumentsNode ? argsOf(argumentsNode) : [];
    const name = callee.split('.').pop() ?? callee;
    const index = facts.calls.length;
    facts.calls.push({
      index,
      callee,
      name,
      args: args.map((a) => a.fact),
      hasTrailingLambda: false,
      enclosingClass: scope.cls,
      enclosingFunction: scope.fn,
      handler: scope.handler,
      parentCall: scope.parentCall,
      isInstantiation,
      ...pos(at),
    });
    for (const a of args) {
      const label = a.fact.label;
      const childScope: Scope = { ...scope, parentCall: index };
      if (label && HANDLER_LABEL.test(label)) {
        childScope.handler = handler(label, name, ownerLabel(args.map((x) => x.fact), a.fact));
      }
      if (label) childScope.pairKeys = [...scope.pairKeys];
      visitChildren(a.node, childScope);
    }
  };

  /** Walks a node's children, assembling `primary selector*` chains into calls. */
  const visitChildren = (n: Node, scope: Scope): void => {
    let segments: string[] = [];
    let chainStart: Node | null = null;
    for (const child of namedChildren(n)) {
      if (child.type === 'selector') {
        const name = selectorName(child);
        if (name) {
          segments.push(name);
          chainStart = child;
          continue;
        }
        const argPart = namedChildren(child).find((c) => c.type === 'argument_part');
        if (argPart && segments.length) {
          const argumentsNode = namedChildren(argPart).find((c) => c.type === 'arguments');
          const callee = segments.join('.');
          const last = segments[segments.length - 1]!;
          emitCall(callee, chainStart ?? child, argumentsNode, scope, segments.length === 1 && isCapitalized(last));
          continue;
        }
        visit(child, scope);
        continue;
      }
      // `showDialog<void>(…)`: generic arguments do not break the call chain.
      if (child.type === 'type_arguments' && segments.length) continue;
      segments = [];
      chainStart = child;
      if (child.type === 'identifier' || child.type === 'type_identifier') segments = [child.text];
      else if (child.type === 'this' || child.type === 'super') segments = [child.type];
      visit(child, scope);
    }
  };

  const visit = (n: Node, scope: Scope): void => {
    switch (n.type) {
      case 'class_definition':
      case 'mixin_declaration':
      case 'extension_declaration':
      case 'enum_declaration': {
        const name = n.childForFieldName('name')?.text ?? namedChildren(n).find((c) => c.type === 'identifier')?.text;
        if (!name) break;
        const supertypes: string[] = [];
        const supertypeArgs: string[] = [];
        const superNode = n.childForFieldName('superclass');
        if (superNode) {
          for (const c of namedChildren(superNode)) {
            if (c.type === 'type_identifier') supertypes.push(c.text);
            if (c.type === 'type_arguments') supertypeArgs.push(...namedChildren(c).filter((t) => t.type === 'type_identifier').map((t) => t.text));
            if (c.type === 'mixins') supertypes.push(...namedChildren(c).filter((t) => t.type === 'type_identifier').map((t) => t.text));
          }
        }
        const interfaces = n.childForFieldName('interfaces') ?? namedChildren(n).find((c) => c.type === 'interfaces');
        if (interfaces) walk(interfaces, (t) => void (t.type === 'type_identifier' && supertypes.push(t.text)));
        facts.classes.push({
          name,
          kind: n.type === 'enum_declaration' ? 'enum' : n.type === 'extension_declaration' ? 'extension' : 'class',
          supertypes,
          supertypeArgs,
          annotations: [],
          endLine: n.endPosition.row + 1,
          ...pos(n),
        });
        const body = n.childForFieldName('body') ?? namedChildren(n).find((c) => c.type.endsWith('body'));
        if (body) visitChildren(body, { ...scope, cls: name, fn: undefined });
        return;
      }
      case 'function_body': {
        const fn = signatureName(n.previousNamedSibling);
        const childScope: Scope = { ...scope, fn };
        if (fn && HANDLER_FUNCTION.test(fn) && !scope.handler) childScope.handler = handler(fn);
        if (fn && !scope.cls && n.previousNamedSibling) {
          facts.functions.push({
            name: fn,
            annotations: [],
            endLine: n.endPosition.row + 1,
            exported: !fn.startsWith('_'),
            ...pos(n.previousNamedSibling),
          });
        }
        visitChildren(n, childScope);
        return;
      }
      case 'static_final_declaration':
      case 'initialized_variable_definition':
      case 'initialized_identifier': {
        const nameNode = n.childForFieldName('name') ?? namedChildren(n).find((c) => c.type === 'identifier');
        const values = nameNode ? namedChildren(n).filter((c) => c.startIndex > nameNode.endIndex) : [];
        if (nameNode && values.length) {
          const value = buildArg(values, spec);
          if (value.stringValue !== undefined && values.length === 1) {
            facts.constants.push({ name: scope.cls ? `${scope.cls}.${nameNode.text}` : nameNode.text, value: value.stringValue, line: pos(n).line });
          }
          facts.variables.push({
            name: nameNode.text,
            value,
            enclosingClass: scope.cls,
            enclosingFunction: scope.fn,
            initCallee: values[0]?.type === 'identifier' ? values[0].text : undefined,
            ...pos(nameNode),
          });
          visitChildren(n, { ...scope, variable: nameNode.text });
          return;
        }
        break;
      }
      case 'const_object_expression':
      case 'new_expression': {
        const type = namedChildren(n).find((c) => c.type === 'type_identifier');
        const argumentsNode = namedChildren(n).find((c) => c.type === 'arguments');
        if (type) {
          emitCall(type.text, type, argumentsNode, scope, true);
          return;
        }
        break;
      }
      case 'set_or_map_literal': {
        for (const pair of namedChildren(n).filter((c) => c.type === 'pair')) {
          // `Routes.home: (_) => …` spreads the key over several nodes; split at the `:` token.
          const parts = children(pair);
          const colon = parts.findIndex((c) => c.type === ':');
          if (colon < 0) continue;
          const keyNodes = parts.slice(0, colon).filter((c) => c.isNamed);
          const valueNodes = parts.slice(colon + 1).filter((c) => c.isNamed);
          if (!keyNodes.length || !valueNodes.length) continue;
          const key = buildArg(keyNodes, spec);
          facts.pairs.push({
            key,
            value: buildArg(valueNodes, spec),
            line: pos(pair).line,
            ownerVariable: scope.variable,
            parentCall: scope.parentCall,
            parentKeys: scope.pairKeys,
          });
          const childScope = { ...scope, pairKeys: [...scope.pairKeys, key.stringValue ?? key.text] };
          visitChildren(pair, childScope);
        }
        return;
      }
      case 'import_or_export': {
        let uri: string | undefined;
        walk(n, (c) => {
          if (c.type === 'string_literal') {
            uri = stringOf(c)?.value;
            return false;
          }
          return true;
        });
        if (uri) facts.imports.push({ source: uri, names: [], line: pos(n).line, isExport: namedChildren(n).some((c) => c.type === 'library_export') });
        return;
      }
      case 'string_literal': {
        const s = stringOf(n);
        if (s?.value !== undefined) facts.strings.push({ value: s.value, ...pos(n) });
        visitChildren(n, scope);
        return;
      }
    }
    visitChildren(n, scope);
  };

  visit(root, { pairKeys: [] });
  return facts;
}
