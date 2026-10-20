import { buildArg, countErrors, handler, HANDLER_FUNCTION, HANDLER_LABEL, isCapitalized, LISTENER_CALL, namedChildren, ownerLabel, pos, type ArgSpec, type Node } from '../ast';
import { emptyFacts, type ArgFact, type ClassKind, type FileFacts, type HandlerContext } from '../facts';

interface Scope {
  cls?: string;
  fn?: string;
  handler?: HandlerContext;
  parentCall?: number;
  variable?: string;
}

function stringOf(n: Node): { value?: string; pattern?: string } | null {
  if (n.type !== 'line_string_literal' && n.type !== 'multi_line_string_literal') return null;
  let value = '';
  let pattern = '';
  let dynamic = false;
  for (const c of namedChildren(n)) {
    if (c.type === 'line_str_text' || c.type === 'multi_line_str_text' || c.type === 'str_escaped_char') {
      value += c.text;
      pattern += c.text;
    } else if (c.type === 'interpolated_expression') {
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
    case 'self_expression':
      return 'self';
    case 'navigation_expression': {
      const target = n.childForFieldName('target');
      const suffix = n.childForFieldName('suffix');
      const name = suffix ? (suffix.childForFieldName('suffix')?.text ?? namedChildren(suffix)[0]?.text) : undefined;
      return [calleeName(target), name].filter(Boolean).join('.');
    }
    case 'call_expression':
      return calleeName(n.namedChild(0));
    case 'user_type':
      return n.text;
    default:
      return '…';
  }
}

function typeRefOf(n: Node): string | null {
  if (n.type === 'call_expression') {
    const callee = n.namedChild(0);
    if (callee?.type === 'simple_identifier' && isCapitalized(callee.text)) return callee.text;
  }
  if (n.type === 'navigation_expression') {
    const target = n.childForFieldName('target');
    const suffix = n.childForFieldName('suffix');
    if (target?.type === 'simple_identifier' && isCapitalized(target.text) && suffix?.text.endsWith('self')) return target.text;
  }
  if (n.type === 'as_expression') {
    const type = namedChildren(n).find((c) => c.type === 'user_type');
    const id = type ? namedChildren(type).find((c) => c.type === 'type_identifier') : undefined;
    if (id) return id.text;
  }
  return null;
}

const spec: ArgSpec = { stringOf, typeRefOf, isLambda: (n) => n.type === 'lambda_literal' };

function attributesOf(n: Node): string[] {
  const modifiers = namedChildren(n).find((c) => c.type === 'modifiers');
  const attrs = modifiers ? namedChildren(modifiers).filter((c) => c.type === 'attribute') : [];
  return attrs.map((a) => a.text.replace(/^@/, '').split('(')[0]!.trim());
}

/** Extracts facts from a Swift syntax tree. */
export function extractSwift(root: Node): FileFacts {
  const facts = emptyFacts();
  facts.syntaxErrors = countErrors(root);

  const argsOf = (suffix: Node): Array<{ node: Node; fact: ArgFact }> => {
    const out: Array<{ node: Node; fact: ArgFact }> = [];
    for (const c of namedChildren(suffix)) {
      if (c.type === 'value_arguments') {
        for (const a of namedChildren(c).filter((x) => x.type === 'value_argument')) {
          const label = a.childForFieldName('name');
          const values = namedChildren(a).filter((x) => x !== label && x.type !== 'value_argument_label');
          out.push({ node: a, fact: buildArg(values, spec, label?.text) });
        }
      } else if (c.type === 'lambda_literal') {
        out.push({ node: c, fact: { ...buildArg([c], spec), isLambda: true } });
      } else if (c.type === 'annotated_lambda' || c.type === 'multiple_trailing_closures') {
        const lambdas = c.descendantsOfType('lambda_literal').filter((x): x is Node => !!x && (x.parent?.id === c.id || x.parent?.parent?.id === c.id));
        for (const l of lambdas) {
          out.push({ node: l, fact: { ...buildArg([l], spec), isLambda: true } });
        }
      }
    }
    return out;
  };

  const visit = (n: Node, scope: Scope): void => {
    switch (n.type) {
      case 'class_declaration':
      case 'protocol_declaration': {
        const nameNode = n.childForFieldName('name');
        const name = nameNode?.text ?? scope.cls;
        if (!name) break;
        const kindText = n.childForFieldName('declaration_kind')?.text ?? (n.type === 'protocol_declaration' ? 'protocol' : 'class');
        const kind = (['class', 'struct', 'enum', 'extension', 'protocol'].includes(kindText) ? kindText : 'class') as ClassKind;
        const supertypes = namedChildren(n)
          .filter((c) => c.type === 'inheritance_specifier')
          .map((c) => {
            const t = c.childForFieldName('inherits_from');
            return t ? (namedChildren(t).find((x) => x.type === 'type_identifier')?.text ?? t.text) : '';
          })
          .filter(Boolean);
        facts.classes.push({
          name: kind === 'extension' ? (nameNode?.text ?? name).replace(/^.*\./, '') : name,
          kind,
          supertypes,
          supertypeArgs: [],
          annotations: attributesOf(n),
          endLine: n.endPosition.row + 1,
          ...pos(n),
        });
        const body = n.childForFieldName('body');
        if (body) for (const c of namedChildren(body)) visit(c, { ...scope, cls: name, fn: undefined });
        return;
      }
      case 'function_declaration':
      case 'init_declaration': {
        const name = n.childForFieldName('name')?.text ?? (n.type === 'init_declaration' ? 'init' : undefined);
        const annotations = attributesOf(n);
        if (name) {
          facts.functions.push({ name, annotations, enclosingClass: scope.cls, endLine: n.endPosition.row + 1, exported: !n.text.startsWith('private'), ...pos(n) });
        }
        const childScope: Scope = { ...scope, fn: name };
        if (name && (annotations.includes('IBAction') || HANDLER_FUNCTION.test(name)) && !scope.handler) {
          childScope.handler = handler(annotations.includes('IBAction') ? `@IBAction ${name}` : name);
        }
        for (const c of namedChildren(n)) visit(c, childScope);
        return;
      }
      case 'property_declaration': {
        const pattern = n.childForFieldName('name');
        const nameNode = pattern?.childForFieldName('bound_identifier') ?? pattern;
        const valueNode = n.childForFieldName('value');
        if (nameNode && valueNode) {
          const value = buildArg([valueNode], spec);
          if (value.stringValue !== undefined) {
            facts.constants.push({ name: scope.cls ? `${scope.cls}.${nameNode.text}` : nameNode.text, value: value.stringValue, line: pos(n).line });
          }
          facts.variables.push({
            name: nameNode.text,
            value,
            enclosingClass: scope.cls,
            enclosingFunction: scope.fn,
            initCallee: valueNode.type === 'call_expression' ? calleeName(valueNode) : undefined,
            ...pos(nameNode),
          });
          visit(valueNode, { ...scope, variable: nameNode.text });
          for (const c of namedChildren(n)) if (c !== valueNode && c !== pattern) visit(c, scope);
          return;
        }
        break;
      }
      case 'call_expression': {
        const calleeNode = n.namedChild(0);
        const suffix = namedChildren(n).find((c) => c.type === 'call_suffix');
        if (!suffix) break;
        const args = argsOf(suffix);
        const callee = calleeName(calleeNode);
        const name = callee.split('.').pop() ?? callee;
        const index = facts.calls.length;
        const nameNode = calleeNode?.type === 'navigation_expression' ? (calleeNode.childForFieldName('suffix') ?? calleeNode) : (calleeNode ?? n);
        facts.calls.push({
          index,
          callee,
          name,
          args: args.map((a) => a.fact),
          hasTrailingLambda: args.some((a) => a.node.type === 'lambda_literal'),
          enclosingClass: scope.cls,
          enclosingFunction: scope.fn,
          handler: scope.handler,
          parentCall: scope.parentCall,
          isInstantiation: isCapitalized(name) && calleeNode?.type === 'simple_identifier',
          ...pos(nameNode),
        });
        if (calleeNode && calleeNode.type !== 'simple_identifier') visit(calleeNode, scope);
        const receiver = callee.includes('.') ? callee.slice(0, callee.lastIndexOf('.')) : undefined;
        const facts_ = args.map((a) => a.fact);
        for (const a of args) {
          const childScope: Scope = { ...scope, parentCall: index };
          const label = a.fact.label;
          if (label && HANDLER_LABEL.test(label)) {
            childScope.handler = handler(label, name, ownerLabel(facts_, a.fact));
          } else if (a.fact.isLambda && (name === 'Button' || LISTENER_CALL.test(name) || /Gesture$/.test(name))) {
            // `Button("Save") { … }`: the first trailing closure is the action.
            const isAction = name !== 'Button' || a === args.find((x) => x.fact.isLambda);
            if (isAction) childScope.handler = handler(name === 'Button' ? 'action' : name, name === 'Button' ? 'Button' : (receiver ?? name), ownerLabel(facts_, a.fact));
          }
          visit(a.node, childScope);
        }
        return;
      }
      case 'import_declaration': {
        const id = namedChildren(n).find((c) => c.type === 'identifier');
        if (id) facts.imports.push({ source: id.text, names: [], line: pos(n).line });
        return;
      }
      case 'line_string_literal': {
        const s = stringOf(n);
        if (s?.value !== undefined) facts.strings.push({ value: s.value, ...pos(n) });
        return;
      }
    }
    for (const c of namedChildren(n)) visit(c, scope);
  };

  visit(root, {});
  return facts;
}
