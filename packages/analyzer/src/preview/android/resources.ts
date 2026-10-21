import type { PreviewNode, PreviewStyle } from '@appflow/model';
import { documentElement, parseXml, type XmlElement } from '../../parsing/xml';
import type { PreviewSource } from '../modules';

/**
 * Android resources for drawing layouts: values (colors, dimensions,
 * strings, styles) from the default `values/` folders of every module,
 * layouts, fonts and drawables, including XML drawables (shapes, selectors,
 * layer lists, vectors) turned into styles or SVG.
 */

export type Drawable =
  | { kind: 'image'; path: string; density: number }
  | { kind: 'color'; color: string }
  | { kind: 'shape'; style: PreviewStyle; gradient?: PreviewNode['gradient']; size?: { width?: number; height?: number } }
  | { kind: 'vector'; node: PreviewNode; width: number; height: number };

interface StyleDef {
  parent?: string;
  items: Record<string, string>;
}

const DENSITY: Record<string, number> = { ldpi: 0.75, mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4, nodpi: 1, anydpi: 1 };
const FRAMEWORK_COLORS: Record<string, string> = {
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',
  darker_gray: '#AAAAAA',
  holo_red_light: '#FF4444',
  holo_blue_light: '#33B5E5',
  holo_green_light: '#99CC00',
  holo_orange_light: '#FFBB33',
};

export class AndroidResources {
  readonly colors = new Map<string, string>();
  readonly dimens = new Map<string, string>();
  readonly strings = new Map<string, string>();
  readonly styles = new Map<string, StyleDef>();
  readonly layouts = new Map<string, string[]>();
  readonly drawables = new Map<string, string[]>();
  readonly colorFiles = new Map<string, string>();
  readonly fonts = new Map<string, string>();
  private readonly drawableCache = new Map<string, Promise<Drawable | undefined>>();

  private constructor(private readonly source: PreviewSource) {}

  static async load(source: PreviewSource, files: string[]): Promise<AndroidResources> {
    const res = new AndroidResources(source);
    for (const f of files) {
      const m = /(^|\/)res\/([\w-]+)\/([^/]+)$/.exec(f);
      if (!m) continue;
      const [, , folder, file] = m as unknown as [string, string, string, string];
      const name = file.replace(/\.9\.png$/, '').replace(/\.\w+$/, '');
      const type = folder.split('-')[0];
      if (type === 'layout') push(res.layouts, name, f, folder === 'layout');
      else if (type === 'drawable' || type === 'mipmap') push(res.drawables, name, f, false);
      else if (type === 'color' && folder === 'color') res.colorFiles.set(name, f);
      else if (type === 'font' && /\.(ttf|otf)$/i.test(file)) res.fonts.set(name, f);
    }
    // Default values only; qualified folders (values-en, values-night) are other configurations.
    for (const f of files.filter((x) => /(^|\/)res\/values\/[^/]+\.xml$/.test(x))) {
      const text = await source.readText(f);
      const root = text ? safeRoot(text) : undefined;
      if (!root) continue;
      for (const el of root.children) {
        const name = el.attrs.name;
        if (!name) continue;
        if (el.name === 'color') res.colors.set(name, el.text ?? '');
        else if (el.name === 'dimen') res.dimens.set(name, el.text ?? '');
        else if (el.name === 'string') res.strings.set(name, unescapeString(el.text ?? ''));
        else if (el.name === 'item' && el.attrs.type === 'color') res.colors.set(name, el.text ?? '');
        else if (el.name === 'item' && el.attrs.type === 'dimen') res.dimens.set(name, el.text ?? '');
        else if (el.name === 'style') {
          const items: Record<string, string> = {};
          for (const it of el.children.filter((c) => c.name === 'item' && c.attrs.name)) items[it.attrs.name!] = it.text ?? '';
          res.styles.set(name, { parent: el.attrs.parent, items });
        }
      }
    }
    return res;
  }

  /** A color value or reference as CSS. */
  color(value: string | undefined, depth = 0): string | undefined {
    if (!value || depth > 8) return undefined;
    const v = value.trim();
    if (v.startsWith('#')) return androidHex(v);
    let m = /^@android:color\/(\w+)$/.exec(v);
    if (m) return FRAMEWORK_COLORS[m[1]!];
    m = /^@(?:\+?color)\/([\w.]+)$/.exec(v);
    if (m) {
      const direct = this.colors.get(m[1]!);
      if (direct !== undefined) return this.color(direct, depth + 1);
      return this.stateColors.get(m[1]!);
    }
    return undefined;
  }

  /** Default colors of color state lists (`res/color/x.xml`). */
  private readonly stateColors = new Map<string, string>();

  /** Reads color state lists (the item without state conditions); call before drawing. */
  async loadColorStates(): Promise<void> {
    for (const [name, file] of this.colorFiles) {
      const root = safeRoot((await this.source.readText(file)) ?? '');
      const items = root?.children.filter((c) => c.name === 'item') ?? [];
      const item = items.find((i) => !Object.keys(i.attrs).some((k) => /state_/.test(k))) ?? items.at(-1);
      const color = item && this.color(item.attrs['android:color']);
      if (color) this.stateColors.set(name, color);
    }
  }

  /** A dimension (`16dp`, `14sp`, `2px`, `@dimen/x`) in points. */
  dimen(value: string | undefined, depth = 0): number | undefined {
    if (!value || depth > 8) return undefined;
    const v = value.trim();
    const ref = /^@dimen\/([\w.]+)$/.exec(v);
    if (ref) return this.dimen(this.dimens.get(ref[1]!), depth + 1);
    const m = /^(-?\d*\.?\d+)\s*(dp|dip|sp|px|pt|in|mm)?$/.exec(v);
    if (!m) return undefined;
    const n = parseFloat(m[1]!);
    switch (m[2]) {
      case 'px':
        return n / 3;
      case 'pt':
        return (n * 160) / 72;
      case 'in':
        return n * 160;
      case 'mm':
        return (n * 160) / 25.4;
      default:
        return n;
    }
  }

  string(value: string | undefined, depth = 0): string | undefined {
    if (value === undefined || depth > 8) return undefined;
    const m = /^@(?:\+?string)\/([\w.]+)$/.exec(value);
    if (m) return this.string(this.strings.get(m[1]!), depth + 1) ?? m[1];
    if (/^@android:string\/(ok|cancel|yes|no)$/.test(value)) return { ok: 'OK', cancel: 'Cancel', yes: 'Yes', no: 'No' }[value.split('/')[1]!];
    return value.startsWith('@') || value.startsWith('?') ? undefined : unescapeString(value);
  }

  /** Items of a style and its parents (explicit `parent`, or the dotted name). */
  style(name: string | undefined): Record<string, string> {
    const chain: Record<string, string>[] = [];
    let current = name?.replace(/^@style\//, '');
    for (let i = 0; current && i < 12; i++) {
      const def = this.styles.get(current);
      if (!def) break;
      chain.unshift(def.items);
      current = def.parent?.replace(/^@style\//, '') ?? (current.includes('.') ? current.slice(0, current.lastIndexOf('.')) : undefined);
    }
    return Object.assign({}, ...chain);
  }

  /** The names of a style's ancestors, including framework parents (`Theme.AppCompat.Light`). */
  styleLineage(name: string | undefined): string[] {
    const out: string[] = [];
    let current = name?.replace(/^@style\//, '');
    for (let i = 0; current && i < 12; i++) {
      out.push(current);
      const def = this.styles.get(current);
      current = def ? (def.parent?.replace(/^@(android:)?style\//, '') ?? (current.includes('.') ? current.slice(0, current.lastIndexOf('.')) : undefined)) : undefined;
    }
    return out;
  }

  layout(name: string): string | undefined {
    return this.layouts.get(name)?.[0];
  }

  /** A drawable reference or color as something drawable. */
  drawable(value: string | undefined): Promise<Drawable | undefined> {
    if (!value) return Promise.resolve(undefined);
    const v = value.trim();
    const color = this.color(v);
    if (color) return Promise.resolve({ kind: 'color', color });
    const m = /^@(?:\+?(?:drawable|mipmap))\/([\w.]+)$/.exec(v);
    if (!m) return Promise.resolve(undefined);
    let p = this.drawableCache.get(m[1]!);
    if (!p) {
      p = this.loadDrawable(m[1]!);
      this.drawableCache.set(m[1]!, p);
    }
    return p;
  }

  private async loadDrawable(name: string): Promise<Drawable | undefined> {
    const files = this.drawables.get(name) ?? [];
    // Prefer a vector or XML drawable, then the densest bitmap up to xxhdpi.
    const xml = files.find((f) => f.endsWith('.xml'));
    if (xml) {
      const root = safeRoot((await this.source.readText(xml)) ?? '');
      return root ? this.xmlDrawable(root, 0) : undefined;
    }
    const ranked = files.map((f) => ({ f, d: densityOf(f) })).sort((a, b) => Math.abs(a.d - 3) - Math.abs(b.d - 3));
    return ranked[0] ? { kind: 'image', path: ranked[0].f, density: ranked[0].d } : undefined;
  }

  private async xmlDrawable(el: XmlElement, depth: number): Promise<Drawable | undefined> {
    if (depth > 6) return undefined;
    const ref = async (e: XmlElement) => (e.attrs['android:drawable'] ? this.drawable(e.attrs['android:drawable']) : e.children[0] ? this.xmlDrawable(e.children[0], depth + 1) : undefined);
    switch (el.name) {
      case 'shape':
        return this.shape(el);
      case 'vector':
        return this.vector(el);
      case 'selector':
      case 'animated-selector': {
        const items = el.children.filter((c) => c.name === 'item');
        const item = items.find((i) => !Object.keys(i.attrs).some((k) => /state_/.test(k))) ?? items.at(-1);
        return item ? ref(item) : undefined;
      }
      case 'layer-list': {
        // The top layer without insets is what shows; fall back to the bottom one.
        const items = el.children.filter((c) => c.name === 'item');
        for (const item of [...items].reverse()) {
          if (Object.keys(item.attrs).some((k) => /android:(top|bottom|left|right|start|end)$/.test(k))) continue;
          const d = await ref(item);
          if (d) return d;
        }
        return items[0] ? ref(items[0]) : undefined;
      }
      case 'ripple': {
        const item = el.children.find((c) => c.name === 'item' && c.attrs['android:id'] !== '@android:id/mask');
        return item ? ref(item) : undefined;
      }
      case 'inset':
      case 'clip':
      case 'scale':
      case 'rotate':
        return ref(el);
      case 'bitmap':
      case 'nine-patch':
        return this.drawable(el.attrs['android:src']);
      case 'level-list':
      case 'animation-list':
      case 'transition': {
        const item = el.children.find((c) => c.name === 'item');
        return item ? ref(item) : undefined;
      }
      case 'color':
        return { kind: 'color', color: this.color(el.attrs['android:color']) ?? 'transparent' };
    }
    return undefined;
  }

  private shape(el: XmlElement): Drawable {
    const style: PreviewStyle = {};
    const child = (name: string) => el.children.find((c) => c.name === name);
    const oval = el.attrs['android:shape'] === 'oval';
    const solid = child('solid');
    const solidColor = solid && this.color(solid.attrs['android:color']);
    if (solidColor) style.backgroundColor = solidColor;
    const corners = child('corners');
    if (corners) {
      const r = this.dimen(corners.attrs['android:radius']);
      if (r !== undefined) style.borderRadius = r;
      for (const [attr, key] of [['topLeftRadius', 'borderTopLeftRadius'], ['topRightRadius', 'borderTopRightRadius'], ['bottomLeftRadius', 'borderBottomLeftRadius'], ['bottomRightRadius', 'borderBottomRightRadius']] as const) {
        const v = this.dimen(corners.attrs[`android:${attr}`]);
        if (v !== undefined) style[key] = v;
      }
    }
    if (oval) style.borderRadius = 9999;
    const stroke = child('stroke');
    if (stroke) {
      const w = this.dimen(stroke.attrs['android:width']);
      const c = this.color(stroke.attrs['android:color']);
      if (w) style.borderWidth = w;
      if (c) style.borderColor = c;
      if (this.dimen(stroke.attrs['android:dashWidth'])) style.borderStyle = 'dashed';
    }
    let gradient: PreviewNode['gradient'];
    const g = child('gradient');
    if (g && (g.attrs['android:type'] ?? 'linear') === 'linear') {
      const colors = [g.attrs['android:startColor'], g.attrs['android:centerColor'], g.attrs['android:endColor']].map((c) => this.color(c)).filter((c): c is string => !!c);
      const angle = ((parseFloat(g.attrs['android:angle'] ?? '0') % 360) + 360) % 360;
      const rad = (angle * Math.PI) / 180;
      // Android angles go counter-clockwise from left→right; y grows downwards on screen.
      const dx = Math.cos(rad) / 2;
      const dy = -Math.sin(rad) / 2;
      gradient = { colors, start: { x: 0.5 - dx, y: 0.5 - dy }, end: { x: 0.5 + dx, y: 0.5 + dy } };
    } else if (g) {
      const c = this.color(g.attrs['android:startColor']);
      if (c) style.backgroundColor = c;
    }
    const size = child('size');
    return { kind: 'shape', style, gradient, size: size ? { width: this.dimen(size.attrs['android:width']), height: this.dimen(size.attrs['android:height']) } : undefined };
  }

  private vector(el: XmlElement): Drawable {
    const width = this.dimen(el.attrs['android:width']) ?? 24;
    const height = this.dimen(el.attrs['android:height']) ?? 24;
    const vw = parseFloat(el.attrs['android:viewportWidth'] ?? String(width));
    const vh = parseFloat(el.attrs['android:viewportHeight'] ?? String(height));
    const tint = this.color(el.attrs['android:tint']);
    const convert = (e: XmlElement): PreviewNode | undefined => {
      if (e.name === 'path') {
        const attrs: Record<string, string | number> = { d: e.attrs['android:pathData'] ?? '' };
        const fill = this.color(e.attrs['android:fillColor']);
        attrs.fill = tint && fill ? tint : (fill ?? 'none');
        const stroke = this.color(e.attrs['android:strokeColor']);
        if (stroke) attrs.stroke = tint ?? stroke;
        const sw = parseFloat(e.attrs['android:strokeWidth'] ?? '');
        if (!Number.isNaN(sw)) attrs.strokeWidth = sw;
        for (const [a, k] of [['fillAlpha', 'fillOpacity'], ['strokeAlpha', 'strokeOpacity']] as const) if (e.attrs[`android:${a}`]) attrs[k] = parseFloat(e.attrs[`android:${a}`]!);
        if (e.attrs['android:strokeLineCap']) attrs.strokeLinecap = e.attrs['android:strokeLineCap']!;
        if (e.attrs['android:strokeLineJoin']) attrs.strokeLinejoin = e.attrs['android:strokeLineJoin']!;
        if (e.attrs['android:fillType'] === 'evenOdd') attrs.fillRule = 'evenodd';
        return { type: 'svg', svg: { tag: 'path', attrs } };
      }
      if (e.name === 'group') {
        const n = (k: string, d: number) => parseFloat(e.attrs[`android:${k}`] ?? String(d));
        const t = `translate(${n('translateX', 0)} ${n('translateY', 0)}) rotate(${n('rotation', 0)} ${n('pivotX', 0)} ${n('pivotY', 0)}) translate(${n('pivotX', 0)} ${n('pivotY', 0)}) scale(${n('scaleX', 1)} ${n('scaleY', 1)}) translate(${-n('pivotX', 0)} ${-n('pivotY', 0)})`;
        return { type: 'svg', svg: { tag: 'g', attrs: { transform: t } }, children: e.children.map(convert).filter((x): x is PreviewNode => !!x) };
      }
      return undefined;
    };
    const node: PreviewNode = { type: 'svg', component: 'vector', svg: { tag: 'svg', attrs: { viewBox: `0 0 ${vw} ${vh}`, width, height, preserveAspectRatio: 'xMidYMid meet' } }, children: el.children.map(convert).filter((x): x is PreviewNode => !!x) };
    if (el.attrs['android:alpha']) node.style = { opacity: parseFloat(el.attrs['android:alpha']) };
    return { kind: 'vector', node, width, height };
  }
}

function push(map: Map<string, string[]>, key: string, value: string, first: boolean): void {
  const list = map.get(key) ?? [];
  if (first) list.unshift(value);
  else list.push(value);
  map.set(key, list);
}

function safeRoot(text: string): XmlElement | undefined {
  try {
    return documentElement(parseXml(text));
  } catch {
    return undefined;
  }
}

function densityOf(path: string): number {
  const folder = /res\/([\w-]+)\//.exec(path)?.[1] ?? '';
  for (const part of folder.split('-')) if (DENSITY[part] !== undefined) return DENSITY[part]!;
  return 1;
}

/** `#RGB`, `#ARGB`, `#RRGGBB`, `#AARRGGBB` as CSS. */
export function androidHex(v: string): string | undefined {
  let h = v.slice(1);
  if (!/^[0-9a-f]+$/i.test(h)) return undefined;
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  if (h.length === 6) return `#${h.toUpperCase()}`;
  if (h.length !== 8) return undefined;
  const a = parseInt(h.slice(0, 2), 16) / 255;
  const [r, g, b] = [2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16));
  return a === 1 ? `#${h.slice(2).toUpperCase()}` : `rgba(${r},${g},${b},${Math.round(a * 1000) / 1000})`;
}

function unescapeString(s: string): string {
  return s
    .replace(/^"(.*)"$/s, '$1')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\(['"@?])/g, '$1')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, c: string) => String.fromCharCode(parseInt(c, 16)));
}
