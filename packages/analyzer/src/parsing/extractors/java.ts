import { buildArg, countErrors, handler, HANDLER_FUNCTION, isCapitalized, LISTENER_CALL, namedChildren, pos, walk, type ArgSpec, type Node } from '../ast';
import { emptyFacts, type FileFacts, type HandlerContext } from '../facts';

interface Scope {
  cls?: string;
  fn?: string;
  handler?: HandlerContext;
  parentCall?: number;
  variable?: string;
}

function stringOf(n: Node): { value?: string; pattern?: string } | null {
  if (n.type !== 'string_literal') return null;
  const value = namedChildren(n)
    .filter((c) => c.type === 'string_fragment' || c.type === 'escape_sequence')
    .map((c) => c.text)
    .join('');
  return { value, pattern: value };
}

function typeName(n: Node | null): string | null {
  if (!n) return null;
  if (n.type === 'type_identifier') return n.text;
  if (n.type === 'generic_type' || n.type === 'scoped_type_identifier') {
    const ids = n.descendantsOfType('type_identifier');
    return ids.length ? ids[ids.length - 1]!.text : null;
  }
  return null;
}

function typeRefOf(n: Node): string | null {
  if (n.type === 'class_literal') return typeName(n.namedChild(0));
  if (n.type === 'object_creation_expression') return typeName(n.childForFieldName('type'));
  return null;
}

const spec: ArgSpec = { stringOf, typeRefOf, isLambda: (n) => n.type === 'lambda_expression' };

function annotationsOf(n: Node): string[] {
  const modifiers = namedChildren(n).find((c) => c.type === 'modifiers');
  if (!modifiers) return [];
  return namedChildren(modifiers)
    .filter((c) => c.type === 'marker_annotation' || c.type === 'annotation')
    .map((a) => a.childForFieldName('name')?.text ?? a.text.replace(/^@/, ''));
}

function objectName(n: Node | null): string {
  if (!n) return '';
  if (n.type === 'identifier' || n.type === 'this') return n.text;
  if (n.type === 'object_creation_expression') return typeName(n.childForFieldName('type')) ?? '…';
  if (n.type === 'field_access') return `${objectName(n.childForFieldName('object'))}.${n.childForFieldName('field')?.text ?? ''}`;
  if (n.type === 'method_invocation') return `${objectName(n.childForFieldName('object'))}${n.childForFieldName('object') ? '.' : ''}${n.childForFieldName('name')?.text ?? ''}`;
  return '…';
}

/** Extracts facts from a Java syntax tree. */
export function extractJava(root: Node): FileFacts {
  const facts = emptyFacts();
  facts.syntaxErrors = countErrors(root);

  const visit = (n: Node, scope: Scope): void => {
    switch (n.type) {
      case 'class_declaration':
      case 'interface_declaration':
      case 'enum_declaration': {
        const name = n.childForFieldName('name')?.text;
        if (!name) break;
        const supertypes: string[] = [];
        const supertypeArgs: string[] = [];
        const superclass = n.childForFieldName('superclass');
        if (superclass) {
          const t = superclass.namedChild(0);
          const sn = typeName(t);
          if (sn) supertypes.push(t?.type === 'generic_type' ? (t.descendantsOfType('type_identifier')[0]?.text ?? sn) : sn);
          if (t?.type === 'generic_type') {
            const args = namedChildren(t).find((c) => c.type === 'type_arguments');
            if (args) walk(args, (x) => void (x.type === 'type_identifier' && supertypeArgs.push(x.text)));
          }
        }
        const interfaces = n.childForFieldName('interfaces');
        if (interfaces) walk(interfaces, (x) => void (x.type === 'type_identifier' && supertypes.push(x.text)));
        facts.classes.push({
          name,
          kind: n.type === 'interface_declaration' ? 'interface' : n.type === 'enum_declaration' ? 'enum' : 'class',
          supertypes,
          supertypeArgs,
          annotations: annotationsOf(n),
          endLine: n.endPosition.row + 1,
          ...pos(n),
        });
        const body = n.childForFieldName('body');
        if (body) for (const c of namedChildren(body)) visit(c, { ...scope, cls: name, fn: undefined });
        return;
      }
      case 'method_declaration':
      case 'constructor_declaration': {
        const name = n.childForFieldName('name')?.text;
        if (name) {
          facts.functions.push({
            name,
            annotations: annotationsOf(n),
            enclosingClass: scope.cls,
            endLine: n.endPosition.row + 1,
            exported: !/\bprivate\b/.test(namedChildren(n).find((c) => c.type === 'modifiers')?.text ?? ''),
            ...pos(n),
          });
        }
        const childScope: Scope = { ...scope, fn: name };
        if (name && HANDLER_FUNCTION.test(name) && !scope.handler) childScope.handler = handler(name);
        for (const c of namedChildren(n)) visit(c, childScope);
        return;
      }
      case 'variable_declarator': {
        const nameNode = n.childForFieldName('name');
        const valueNode = n.childForFieldName('value');
        if (nameNode && valueNode) {
          const value = buildArg([valueNode], spec);
          const isConstant = !scope.fn && value.stringValue !== undefined;
          if (isConstant) {
            facts.constants.push({ name: scope.cls ? `${scope.cls}.${nameNode.text}` : nameNode.text, value: value.stringValue!, line: pos(n).line });
            facts.constants.push({ name: nameNode.text, value: value.stringValue!, line: pos(n).line });
          }
          facts.variables.push({
            name: nameNode.text,
            value,
            enclosingClass: scope.cls,
            enclosingFunction: scope.fn,
            initCallee: valueNode.type === 'method_invocation' ? objectName(valueNode) : valueNode.type === 'object_creation_expression' ? (typeRefOf(valueNode) ?? undefined) : undefined,
            ...pos(nameNode),
          });
          visit(valueNode, { ...scope, variable: nameNode.text });
          return;
        }
        break;
      }
      case 'method_invocation':
      case 'object_creation_expression': {
        const isNew = n.type === 'object_creation_expression';
        const nameNode = isNew ? n.childForFieldName('type') : n.childForFieldName('name');
        const object = isNew ? null : n.childForFieldName('object');
        const name = isNew ? (typeName(nameNode) ?? '…') : (nameNode?.text ?? '…');
        const callee = object ? `${objectName(object)}.${name}` : name;
        const argumentList = n.childForFieldName('arguments');
        const argNodes = argumentList ? namedChildren(argumentList) : [];
        const args = argNodes.map((a) => buildArg([a], spec));
        const index = facts.calls.length;
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
          isInstantiation: isNew || (isCapitalized(name) && !object),
          ...pos(nameNode ?? n),
        });
        if (object) visit(object, scope);
        argNodes.forEach((a, i) => {
          const childScope: Scope = { ...scope, parentCall: index };
          if (args[i]!.isLambda && LISTENER_CALL.test(name)) childScope.handler = handler(name, object ? objectName(object) : name);
          visit(a, childScope);
        });
        const classBody = namedChildren(n).find((c) => c.type === 'class_body');
        if (classBody) visit(classBody, scope);
        return;
      }
      case 'import_declaration': {
        const id = namedChildren(n).find((c) => c.type === 'scoped_identifier' || c.type === 'identifier');
        if (id) facts.imports.push({ source: id.text, names: [{ local: id.text.split('.').pop()!, imported: id.text }], line: pos(n).line });
        return;
      }
      case 'string_literal': {
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
