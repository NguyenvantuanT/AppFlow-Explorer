import { buildArg, countErrors, handler, HANDLER_FUNCTION, HANDLER_LABEL, isCapitalized, namedChildren, ownerLabel, pos, unquote, walk, type ArgSpec, type Node } from '../ast';
import { emptyFacts, type ArgFact, type FileFacts, type HandlerContext } from '../facts';

interface Scope {
  cls?: string;
  fn?: string;
  handler?: HandlerContext;
  parentCall?: number;
  parentJsx?: number;
  variable?: string;
  pairKeys: string[];
  exported?: boolean;
}

function stringOf(n: Node): { value?: string; pattern?: string } | null {
  if (n.type === 'string') return { value: unquote(n.text), pattern: unquote(n.text) };
  if (n.type === 'template_string') {
    const subs = namedChildren(n).filter((c) => c.type === 'template_substitution');
    if (!subs.length) return { value: unquote(n.text), pattern: unquote(n.text) };
    let pattern = '';
    let cursor = n.startIndex;
    for (const s of subs) {
      pattern += n.text.slice(cursor - n.startIndex, s.startIndex - n.startIndex) + '*';
      cursor = s.endIndex;
    }
    return { pattern: unquote(pattern + n.text.slice(cursor - n.startIndex)) };
  }
  return null;
}

const JSX_TAG = new Set(['jsx_self_closing_element', 'jsx_opening_element']);

function typeRefOf(n: Node): string | null {
  if (n.type === 'identifier' && isCapitalized(n.text)) {
    const p = n.parent?.type;
    if (p === 'jsx_expression' || p === 'pair' || p === 'arguments' || p === 'arrow_function' || p === 'return_statement') return n.text;
  }
  if (JSX_TAG.has(n.type)) {
    const name = n.childForFieldName('name')?.text;
    if (name && isCapitalized(name)) return name;
  }
  if (n.type === 'new_expression') return n.childForFieldName('constructor')?.text ?? null;
  return null;
}

const spec: ArgSpec = {
  stringOf,
  typeRefOf,
  isLambda: (n) => n.type === 'arrow_function' || n.type === 'function_expression' || n.type === 'function',
};

function calleeName(n: Node | null): string {
  if (!n) return '';
  if (n.type === 'identifier' || n.type === 'property_identifier' || n.type === 'this') return n.text;
  if (n.type === 'member_expression') return `${calleeName(n.childForFieldName('object'))}.${n.childForFieldName('property')?.text ?? ''}`;
  if (n.type === 'call_expression') return calleeName(n.childForFieldName('function'));
  if (n.type === 'non_null_expression' || n.type === 'parenthesized_expression') return calleeName(n.namedChild(0));
  return '…';
}

/** Extracts facts from a TypeScript, TSX or JavaScript syntax tree. */
export function extractTypeScript(root: Node): FileFacts {
  const facts = emptyFacts();
  facts.syntaxErrors = countErrors(root);

  const jsxText = (el: Node): string | undefined => {
    let text: string | undefined;
    walk(el, (c) => {
      if (text) return false;
      if (c.type === 'jsx_text' && c.text.trim()) text = c.text.trim();
      return true;
    });
    return text;
  };

  const visitJsx = (el: Node, tag: Node, scope: Scope): void => {
    const name = tag.childForFieldName('name')?.text ?? '';
    const attrNodes = namedChildren(tag).filter((c) => c.type === 'jsx_attribute');
    const attrs: Array<{ node: Node; fact: ArgFact }> = attrNodes.map((a) => {
      const [key, ...rest] = namedChildren(a);
      const value = rest.map((v) => (v.type === 'jsx_expression' ? (v.namedChild(0) ?? v) : v));
      return { node: a, fact: value.length ? buildArg(value, spec, key?.text) : { label: key?.text, text: 'true', typeRefs: [], strings: [], isLambda: false } };
    });
    const childComponents: string[] = [];
    if (el.type === 'jsx_element') {
      for (const c of namedChildren(el)) {
        const childTag = c.type === 'jsx_element' ? c.childForFieldName('open_tag') : c.type === 'jsx_self_closing_element' ? c : null;
        const childName = childTag?.childForFieldName('name')?.text;
        if (childName && isCapitalized(childName)) childComponents.push(childName);
      }
    }
    const index = facts.jsx.length;
    facts.jsx.push({
      index,
      name,
      attrs: attrs.map((a) => a.fact),
      enclosingFunction: scope.fn,
      enclosingClass: scope.cls,
      handler: scope.handler,
      parentJsx: scope.parentJsx,
      childComponents,
      ...pos(tag),
    });
    const label = ownerLabel(attrs.map((a) => a.fact)) ?? (el.type === 'jsx_element' ? jsxText(el) : undefined);
    for (const a of attrs) {
      const childScope: Scope = { ...scope, parentJsx: index };
      if (a.fact.label && HANDLER_LABEL.test(a.fact.label)) childScope.handler = handler(a.fact.label, name, label);
      visit(a.node, childScope);
    }
    if (el.type === 'jsx_element') {
      for (const c of namedChildren(el)) if (c.type !== 'jsx_opening_element' && c.type !== 'jsx_closing_element') visit(c, { ...scope, parentJsx: index });
    }
  };

  const visit = (n: Node, scope: Scope): void => {
    switch (n.type) {
      case 'export_statement': {
        for (const c of namedChildren(n)) visit(c, { ...scope, exported: true });
        return;
      }
      case 'import_statement': {
        const source = n.childForFieldName('source');
        const names: Array<{ local: string; imported: string }> = [];
        const clause = namedChildren(n).find((c) => c.type === 'import_clause');
        if (clause) {
          for (const c of namedChildren(clause)) {
            if (c.type === 'identifier') names.push({ local: c.text, imported: 'default' });
            if (c.type === 'named_imports') {
              for (const s of namedChildren(c).filter((x) => x.type === 'import_specifier')) {
                const imported = s.childForFieldName('name')?.text ?? s.text;
                names.push({ local: s.childForFieldName('alias')?.text ?? imported, imported });
              }
            }
            if (c.type === 'namespace_import') {
              const id = namedChildren(c).find((x) => x.type === 'identifier');
              if (id) names.push({ local: id.text, imported: '*' });
            }
          }
        }
        if (source) facts.imports.push({ source: unquote(source.text), names, line: pos(n).line });
        return;
      }
      case 'class_declaration':
      case 'class': {
        const name = n.childForFieldName('name')?.text;
        if (name) {
          const heritage = namedChildren(n).find((c) => c.type === 'class_heritage');
          const supertypes: string[] = [];
          if (heritage) walk(heritage, (c) => void ((c.type === 'identifier' || c.type === 'member_expression') && c.parent?.type === 'extends_clause' && supertypes.push(c.text)));
          facts.classes.push({ name, kind: 'class', supertypes, supertypeArgs: [], annotations: [], endLine: n.endPosition.row + 1, ...pos(n) });
          facts.functions.push({ name, annotations: ['class'], endLine: n.endPosition.row + 1, exported: !!scope.exported, ...pos(n) });
        }
        for (const c of namedChildren(n)) visit(c, { ...scope, cls: name ?? scope.cls, fn: name ?? scope.fn });
        return;
      }
      case 'function_declaration':
      case 'generator_function_declaration':
      case 'method_definition': {
        const name = n.childForFieldName('name')?.text;
        if (name && n.type !== 'method_definition') {
          facts.functions.push({ name, annotations: [], endLine: n.endPosition.row + 1, exported: !!scope.exported, ...pos(n) });
        }
        const fn = n.type === 'method_definition' && scope.fn ? scope.fn : name;
        const childScope: Scope = { ...scope, fn, exported: false };
        if (name && HANDLER_FUNCTION.test(name) && !scope.handler) childScope.handler = handler(name);
        for (const c of namedChildren(n)) visit(c, childScope);
        return;
      }
      case 'variable_declarator': {
        const nameNode = n.childForFieldName('name');
        const valueNode = n.childForFieldName('value');
        if (nameNode?.type === 'identifier' && valueNode) {
          const value = buildArg([valueNode], spec);
          const isFunction = spec.isLambda(valueNode);
          if (isFunction && !scope.fn) {
            facts.functions.push({ name: nameNode.text, annotations: [], endLine: n.endPosition.row + 1, exported: !!scope.exported, ...pos(n) });
          }
          if (value.stringValue !== undefined) facts.constants.push({ name: nameNode.text, value: value.stringValue, line: pos(n).line });
          facts.variables.push({
            name: nameNode.text,
            value,
            enclosingClass: scope.cls,
            enclosingFunction: scope.fn,
            initCallee: valueNode.type === 'call_expression' ? calleeName(valueNode) : undefined,
            ...pos(nameNode),
          });
          const childScope: Scope = isFunction && !scope.fn ? { ...scope, fn: nameNode.text, exported: false } : { ...scope, variable: nameNode.text };
          if (isFunction && HANDLER_FUNCTION.test(nameNode.text) && !scope.handler) childScope.handler = handler(nameNode.text);
          visit(valueNode, childScope);
          return;
        }
        break;
      }
      case 'call_expression':
      case 'new_expression': {
        const fnNode = n.childForFieldName(n.type === 'new_expression' ? 'constructor' : 'function');
        const argsNode = n.childForFieldName('arguments');
        const argNodes = argsNode ? namedChildren(argsNode) : [];
        const args = argNodes.map((a) => buildArg([a], spec));
        const callee = calleeName(fnNode);
        const name = callee.split('.').pop() ?? callee;
        const index = facts.calls.length;
        const nameNode = fnNode?.type === 'member_expression' ? (fnNode.childForFieldName('property') ?? fnNode) : (fnNode ?? n);
        facts.calls.push({
          index,
          callee,
          name,
          args,
          hasTrailingLambda: false,
          enclosingClass: scope.cls,
          enclosingFunction: scope.fn,
          handler: scope.handler,
          parentCall: scope.parentCall,
          isInstantiation: n.type === 'new_expression',
          ...pos(nameNode),
        });
        if (fnNode && fnNode.type !== 'identifier') visit(fnNode, scope);
        for (const a of argNodes) visit(a, { ...scope, parentCall: index });
        return;
      }
      case 'jsx_element': {
        const tag = n.childForFieldName('open_tag');
        if (tag) {
          visitJsx(n, tag, scope);
          return;
        }
        break;
      }
      case 'jsx_self_closing_element':
        visitJsx(n, n, scope);
        return;
      case 'object': {
        for (const pair of namedChildren(n).filter((c) => c.type === 'pair')) {
          const keyNode = pair.childForFieldName('key');
          const valueNode = pair.childForFieldName('value');
          if (!keyNode || !valueNode) continue;
          const key: ArgFact = keyNode.type === 'property_identifier' ? { text: keyNode.text, stringValue: keyNode.text, stringPattern: keyNode.text, typeRefs: [], strings: [], isLambda: false } : buildArg([keyNode], spec);
          facts.pairs.push({ key, value: buildArg([valueNode], spec), line: pos(pair).line, ownerVariable: scope.variable, parentCall: scope.parentCall, parentKeys: scope.pairKeys });
          if (scope.variable && key.stringValue && scope.pairKeys.length === 0) {
            const v = stringOf(valueNode);
            if (v?.value !== undefined) facts.constants.push({ name: `${scope.variable}.${key.stringValue}`, value: v.value, line: pos(pair).line });
          }
          visit(valueNode, { ...scope, pairKeys: [...scope.pairKeys, key.stringValue ?? key.text] });
        }
        for (const c of namedChildren(n).filter((x) => x.type !== 'pair')) visit(c, scope);
        return;
      }
      case 'string': {
        const s = stringOf(n);
        if (s?.value !== undefined) facts.strings.push({ value: s.value, ...pos(n) });
        return;
      }
    }
    for (const c of namedChildren(n)) visit(c, scope);
  };

  visit(root, { pairKeys: [] });
  return facts;
}
