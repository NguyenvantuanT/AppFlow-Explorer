/**
 * Minimal, position-aware XML parser for configuration files (Android
 * manifests, navigation graphs and layouts, iOS storyboards and XIBs).
 *
 * It builds an element tree with line numbers so discovered entities can link
 * back to the exact source line. DTDs, entities beyond the five predefined
 * ones and namespaces-as-URIs are not interpreted (prefixes are kept as-is).
 */

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  parent?: XmlElement;
  line: number;
  /** Concatenated, trimmed text content directly inside the element. */
  text?: string;
}

export class XmlParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`${message} (line ${line})`);
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

export function parseXml(source: string): XmlElement {
  const root: XmlElement = { name: '#document', attrs: {}, children: [], line: 1 };
  const stack: XmlElement[] = [root];
  let i = 0;
  let line = 1;

  const advance = (to: number) => {
    for (let k = i; k < to; k++) if (source.charCodeAt(k) === 10) line++;
    i = to;
  };

  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt < 0) break;
    const text = source.slice(i, lt).trim();
    if (text && stack.length > 1) {
      const top = stack[stack.length - 1]!;
      top.text = (top.text ? `${top.text} ` : '') + decode(text);
    }
    advance(lt);
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i);
      if (end < 0) throw new XmlParseError('Unterminated comment', line);
      advance(end + 3);
    } else if (source.startsWith('<![CDATA[', i)) {
      const end = source.indexOf(']]>', i);
      if (end < 0) throw new XmlParseError('Unterminated CDATA', line);
      advance(end + 3);
    } else if (source.startsWith('<?', i) || source.startsWith('<!', i)) {
      const end = source.indexOf('>', i);
      if (end < 0) throw new XmlParseError('Unterminated declaration', line);
      advance(end + 1);
    } else if (source.startsWith('</', i)) {
      const end = source.indexOf('>', i);
      if (end < 0) throw new XmlParseError('Unterminated closing tag', line);
      const name = source.slice(i + 2, end).trim();
      const open = stack.pop();
      if (!open || open.name !== name) throw new XmlParseError(`Unexpected </${name}>`, line);
      advance(end + 1);
    } else {
      const startLine = line;
      let j = i + 1;
      while (j < source.length && !/[\s/>]/.test(source[j]!)) j++;
      const name = source.slice(i + 1, j);
      if (!name) throw new XmlParseError('Empty tag name', line);
      const attrs: Record<string, string> = {};
      let selfClosing = false;
      for (;;) {
        while (j < source.length && /\s/.test(source[j]!)) j++;
        if (source[j] === '>') {
          j++;
          break;
        }
        if (source.startsWith('/>', j)) {
          selfClosing = true;
          j += 2;
          break;
        }
        if (j >= source.length) throw new XmlParseError(`Unterminated <${name}>`, startLine);
        let k = j;
        while (k < source.length && !/[\s=/>]/.test(source[k]!)) k++;
        const attr = source.slice(j, k);
        while (k < source.length && /\s/.test(source[k]!)) k++;
        if (source[k] !== '=') throw new XmlParseError(`Attribute ${attr} has no value`, startLine);
        k++;
        while (k < source.length && /\s/.test(source[k]!)) k++;
        const quote = source[k];
        if (quote !== '"' && quote !== "'") throw new XmlParseError(`Unquoted attribute ${attr}`, startLine);
        const end = source.indexOf(quote, k + 1);
        if (end < 0) throw new XmlParseError(`Unterminated attribute ${attr}`, startLine);
        attrs[attr] = decode(source.slice(k + 1, end));
        j = end + 1;
      }
      const parent = stack[stack.length - 1]!;
      const el: XmlElement = { name, attrs, children: [], parent, line: startLine };
      parent.children.push(el);
      advance(j);
      if (!selfClosing) stack.push(el);
    }
  }
  if (stack.length > 1) throw new XmlParseError(`Unclosed <${stack[stack.length - 1]!.name}>`, line);
  return root;
}

/** Depth-first list of all elements under `el` (excluding `el`). */
export function descendants(el: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  const visit = (e: XmlElement) => {
    for (const c of e.children) {
      out.push(c);
      visit(c);
    }
  };
  visit(el);
  return out;
}

export function documentElement(doc: XmlElement): XmlElement | undefined {
  return doc.children[0];
}
