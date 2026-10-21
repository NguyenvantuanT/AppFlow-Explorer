import type { PreviewAnchor, PreviewConstraint, PreviewNode, PreviewStyle } from '@appflow/model';
import { documentElement, parseXml, type XmlElement } from '../../parsing/xml';
import type { PreviewSource } from '../modules';
import type { AndroidResources, Drawable } from './resources';

/**
 * Android layout XML as preview nodes. LinearLayout becomes a flex row or
 * column, FrameLayout a one-cell grid (children stacked, sized to the
 * largest), ConstraintLayout and RelativeLayout a `constraints` container
 * solved when drawn. Custom views are opened to the layout they inflate.
 */

export interface AndroidTheme {
  dark: boolean;
  windowBackground: string;
  textColor: string;
  textColorSecondary: string;
  colorPrimary: string;
  colorAccent: string;
}

type Parent = 'column' | 'row' | 'frame' | 'constraints' | 'relative' | 'scroll' | 'hscroll';
type Kind =
  | { kind: 'linear' }
  | { kind: 'frame' }
  | { kind: 'card' }
  | { kind: 'constraints'; relative: boolean }
  | { kind: 'scroll'; horizontal: boolean }
  | { kind: 'list' }
  | { kind: 'text' }
  | { kind: 'button'; material: boolean }
  | { kind: 'edit' }
  | { kind: 'check'; radio: boolean }
  | { kind: 'switch' }
  | { kind: 'image'; circle: boolean }
  | { kind: 'progress' }
  | { kind: 'seek' }
  | { kind: 'video' }
  | { kind: 'view' }
  | { kind: 'toolbar' }
  | { kind: 'fab' }
  | { kind: 'placeholder' };

type Attrs = Record<string, string>;

const MAX_DEPTH = 40;
const SAMPLE_ROWS = 3;

export class AndroidLayoutBuilder {
  private depth = 0;
  private readonly classSources = new Map<string, Promise<string | null>>();
  readonly fontFamilies = new Map<string, string>();
  nodeCount = 0;

  constructor(
    private readonly res: AndroidResources,
    private readonly source: PreviewSource,
    private readonly files: string[],
    readonly theme: AndroidTheme,
    readonly notes: Set<string>,
  ) {}

  /** Inflates `@layout/name` for a parent of the given kind. */
  async inflate(name: string, parent: Parent, overrides: Attrs = {}): Promise<PreviewNode[]> {
    const file = this.res.layout(name);
    if (!file) {
      this.notes.add(`Layout ${name} was not found.`);
      return [];
    }
    if (++this.depth > MAX_DEPTH) {
      this.depth--;
      return [];
    }
    try {
      const text = await this.source.readText(file);
      let root: XmlElement | undefined;
      try {
        root = text ? documentElement(parseXml(text)) : undefined;
      } catch {
        root = undefined;
      }
      if (!root) {
        this.notes.add(`Layout ${name} could not be read.`);
        return [];
      }
      if (root.name === 'merge') return this.children(root, parent, file);
      return this.node(root, parent, file, overrides);
    } finally {
      this.depth--;
    }
  }

  private async children(el: XmlElement, parent: Parent, file: string): Promise<PreviewNode[]> {
    const out: PreviewNode[] = [];
    for (const c of el.children) out.push(...(await this.node(c, parent, file)));
    return out;
  }

  /** Attributes without namespace prefixes, over the view's style and text appearance. */
  private attrs(el: XmlElement, overrides: Attrs): Attrs {
    const own: Attrs = {};
    for (const [k, v] of Object.entries(el.attrs)) {
      if (k.startsWith('xmlns')) continue;
      own[k.startsWith('tools:') ? k : k.replace(/^\w+:/, '')] = v;
    }
    for (const [k, v] of Object.entries(overrides)) own[k] = v;
    const style = this.stripped(this.res.style(own.style));
    const appearance = this.stripped(this.res.style(own.textAppearance ?? style.textAppearance));
    return { ...appearance, ...style, ...own };
  }

  private stripped(items: Record<string, string>): Attrs {
    const out: Attrs = {};
    for (const [k, v] of Object.entries(items)) out[k.replace(/^\w+:/, '')] = v;
    return out;
  }

  async node(el: XmlElement, parent: Parent, file: string, overrides: Attrs = {}): Promise<PreviewNode[]> {
    if (++this.nodeCount > 3000) return [];
    if (el.name === 'include') {
      const layout = /^@layout\/(\w+)$/.exec(el.attrs.layout ?? '')?.[1];
      if (!layout) return [];
      const passed: Attrs = {};
      for (const [k, v] of Object.entries(el.attrs)) if (/^android:(layout_|id$|visibility$)/.test(k)) passed[k.replace(/^android:/, '')] = v;
      return this.inflate(layout, parent, passed);
    }
    if (el.name === 'merge') return this.children(el, parent, file);
    if (/^(ViewStub|requestFocus|tag|TabItem|data|layout)$/.test(el.name) && el.name !== 'layout') return [];
    if (el.name === 'layout') {
      // Data binding: <layout><data/>the root view</layout>
      const root = el.children.find((c) => c.name !== 'data');
      return root ? this.node(root, parent, file, overrides) : [];
    }
    const a = this.attrs(el, overrides);
    if (a.visibility === 'gone') {
      // In a ConstraintLayout or RelativeLayout a gone view still anchors its neighbours, as a point.
      if (parent !== 'constraints' && parent !== 'relative') return [];
      const point: PreviewNode = { type: 'view', component: el.name.slice(el.name.lastIndexOf('.') + 1), style: {} };
      this.params(point, { ...a, layout_width: '0dp', layout_height: '0dp', layout_margin: '0dp', layout_marginTop: '0dp', layout_marginBottom: '0dp', layout_marginStart: '0dp', layout_marginEnd: '0dp', layout_marginLeft: '0dp', layout_marginRight: '0dp' }, parent, idOf(a.id));
      if (point.constraint) {
        point.constraint.width = 0;
        point.constraint.height = 0;
      }
      return [point];
    }
    const tag = el.name.slice(el.name.lastIndexOf('.') + 1);
    const location = { fileId: file, line: el.line };
    const { kind, inflated } = await this.classify(el.name, a);
    const id = idOf(a.id);
    let node: PreviewNode;
    const style: PreviewStyle = {};

    switch (kind.kind) {
      case 'linear': {
        // LinearLayout is horizontal by default; RadioGroup, AppBarLayout and TableLayout are vertical.
        const vertical = a.orientation === 'vertical' || (a.orientation === undefined && /^(RadioGroup|AppBarLayout|TableLayout)$/.test(tag));
        const g = gravity(a.gravity);
        Object.assign(style, { flexDirection: vertical ? 'column' : 'row' }, vertical ? { alignItems: g.h ?? 'flex-start', justifyContent: g.v ?? 'flex-start' } : { alignItems: g.v ?? 'flex-start', justifyContent: g.h ?? 'flex-start' });
        node = { type: 'view', component: tag, style, children: inflated ?? (await this.children(el, vertical ? 'column' : 'row', file)) };
        break;
      }
      case 'frame':
      case 'card': {
        Object.assign(style, FRAME_STYLE);
        if (kind.kind === 'card') {
          style.borderRadius = this.res.dimen(a.cardCornerRadius) ?? 4;
          style.backgroundColor = this.res.color(a.cardBackgroundColor) ?? (this.theme.dark ? '#424242' : '#FFFFFF');
          style.elevation = this.res.dimen(a.cardElevation) ?? 2;
          style.overflow = 'hidden';
          const cp = this.res.dimen(a.contentPadding);
          if (cp !== undefined) style.padding = cp;
        }
        node = { type: 'view', component: tag, style, children: inflated ?? (await this.children(el, 'frame', file)) };
        break;
      }
      case 'constraints': {
        const children = inflated ?? (await this.children(el, kind.relative ? 'relative' : 'constraints', file));
        node = { type: 'view', component: tag, style, layout: 'constraints', children };
        break;
      }
      case 'scroll':
        node = { type: 'scroll', component: tag, style, horizontal: kind.horizontal, contentStyle: {}, children: inflated ?? (await this.children(el, kind.horizontal ? 'hscroll' : 'scroll', file)) };
        break;
      case 'list':
        node = await this.list(el, a, tag, file);
        break;
      case 'text':
      case 'button':
      case 'edit':
      case 'check':
      case 'switch':
        node = await this.textual(kind, a, tag);
        break;
      case 'image':
        node = await this.image(a, tag, kind.circle);
        break;
      case 'progress': {
        const horizontal = /Horizontal/.test(a.style ?? '');
        node = horizontal
          ? { type: 'view', component: tag, style: { height: 4, backgroundColor: 'rgba(0,0,0,0.12)' }, children: [{ type: 'view', style: { width: '40%', height: 4, backgroundColor: this.theme.colorAccent } }] }
          : { type: 'spinner', component: tag, style: { width: 48, height: 48, color: this.theme.colorAccent } };
        break;
      }
      case 'seek':
        node = { type: 'view', component: tag, style: { height: 32, justifyContent: 'center', paddingHorizontal: 16 }, children: [{ type: 'view', style: { height: 2, backgroundColor: this.theme.colorAccent, opacity: 0.5 } }] };
        break;
      case 'video':
        node = { type: 'view', component: tag, style: { backgroundColor: '#000000' }, children: inflated ?? [] };
        break;
      case 'toolbar': {
        const title = this.res.string(a.title);
        Object.assign(style, { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingLeft: 16, backgroundColor: this.theme.colorPrimary });
        const kids = await this.children(el, 'row', file);
        node = { type: 'view', component: tag, style, children: [...(title ? [{ type: 'text' as const, style: { fontSize: 20, fontWeight: '500', color: '#FFFFFF' }, children: [{ type: 'raw' as const, text: title }] }] : []), ...kids] };
        break;
      }
      case 'fab': {
        const icon = await this.drawableNode(a.src ?? a.srcCompat, 24, 24, this.res.color(a.tint) ?? '#FFFFFF');
        node = { type: 'view', component: tag, style: { width: 56, height: 56, borderRadius: 28, backgroundColor: this.res.color(a.backgroundTint) ?? this.theme.colorAccent, alignItems: 'center', justifyContent: 'center', elevation: 6 }, children: icon ? [icon] : [] };
        break;
      }
      case 'view':
        node = { type: 'view', component: tag, style, children: inflated ?? (await this.children(el, 'frame', file)) };
        if (node.children!.length) Object.assign(style, FRAME_STYLE);
        break;
      default:
        this.notes.add(`${tag} is drawn as a box.`);
        node = { type: 'placeholder', component: tag, text: tag, style };
    }

    node.location = location;
    node.style = { ...(node.style ?? {}), ...(await this.box(a, node)) };
    if (a.visibility === 'invisible') node.style.opacity = 0;
    this.params(node, a, parent, id);
    return [node];
  }

  /** Which kind of view a tag is; project classes are followed to their base class and inflated layout. */
  private async classify(name: string, a: Attrs, depth = 0): Promise<{ kind: Kind; inflated?: PreviewNode[] }> {
    const simple = name.slice(name.lastIndexOf('.') + 1);
    const known = builtinKind(simple, a);
    if (known) return { kind: known };
    if (name === 'fragment' || simple === 'FragmentContainerView') {
      const cls = a.name ?? a.class;
      const layout = cls ? await this.classLayout(cls.slice(cls.lastIndexOf('.') + 1)) : undefined;
      return { kind: { kind: 'frame' }, inflated: layout ? await this.inflate(layout, 'frame') : [] };
    }
    // A project view class: its base class and the layout it inflates into itself.
    const src = depth < 3 ? await this.classSource(simple) : null;
    if (src) {
      const base = new RegExp(`class\\s+${simple}\\b[^{]*?(?:extends\\s+([\\w.]+)|:\\s*([\\w.]+)\\s*\\()`).exec(src);
      const baseName = base?.[1] ?? base?.[2];
      const layout = inflatedLayout(src);
      const baseKind = baseName ? await this.classify(baseName, a, depth + 1) : { kind: { kind: 'frame' } as Kind };
      if (layout) {
        const container = baseKind.kind.kind === 'linear' ? (a.orientation === 'vertical' || /setOrientation\(\s*(?:LinearLayout\.)?VERTICAL/.test(src) ? 'column' : 'row') : baseKind.kind.kind === 'constraints' ? 'constraints' : 'frame';
        const inflated = await this.inflate(layout, container as Parent);
        const kind: Kind = baseKind.kind.kind === 'linear' || baseKind.kind.kind === 'constraints' ? baseKind.kind : { kind: 'frame' };
        if (kind.kind === 'linear' && container === 'column') a.orientation = 'vertical';
        return { kind, inflated };
      }
      return baseKind;
    }
    if (/Layout$/.test(simple)) return { kind: { kind: 'frame' } };
    if (/VideoView|PlayerView|SurfaceView|TextureView|CameraView|PreviewView/.test(simple)) return { kind: { kind: 'video' } };
    if (/TextView$/.test(simple)) return { kind: { kind: 'text' } };
    if (/ImageView$/.test(simple)) return { kind: { kind: 'image', circle: /Circle|Round/.test(simple) } };
    if (/Button$/.test(simple)) return { kind: { kind: 'button', material: false } };
    return { kind: { kind: 'placeholder' } };
  }

  private classSource(simple: string): Promise<string | null> {
    let p = this.classSources.get(simple);
    if (!p) {
      const file = this.files.find((f) => f.endsWith(`/${simple}.java`) || f.endsWith(`/${simple}.kt`));
      p = file ? this.source.readText(file) : Promise.resolve(null);
      this.classSources.set(simple, p);
    }
    return p;
  }

  /** The layout a fragment or dialog class shows. */
  async classLayout(simple: string): Promise<string | undefined> {
    const src = await this.classSource(simple);
    return src ? screenLayout(src) : undefined;
  }

  // ---- Widgets -------------------------------------------------------------------------------------------

  private async textual(kind: Kind, a: Attrs, tag: string): Promise<PreviewNode> {
    const style: PreviewStyle = {};
    const button = kind.kind === 'button';
    const material = kind.kind === 'button' && kind.material;
    const fontSize = this.res.dimen(a.textSize) ?? (kind.kind === 'edit' ? 18 : 14);
    style.fontSize = fontSize;
    const defaultColor = button ? (material ? '#FFFFFF' : this.theme.dark ? '#FFFFFF' : 'rgba(0,0,0,0.87)') : this.theme.textColor;
    style.color = this.res.color(a.textColor) ?? defaultColor;
    if (/bold/.test(a.textStyle ?? '')) style.fontWeight = 'bold';
    if (/italic/.test(a.textStyle ?? '')) style.fontStyle = 'italic';
    const font = a.fontFamily;
    const fontRes = font && /^@font\/(\w+)$/.exec(font)?.[1];
    if (fontRes && this.res.fonts.has(fontRes)) {
      style.fontFamily = fontRes;
      this.fontFamilies.set(fontRes, this.res.fonts.get(fontRes)!);
    } else if (font) {
      const w = /medium/.test(font) ? '500' : /light/.test(font) ? '300' : /black/.test(font) ? '900' : /thin/.test(font) ? '100' : undefined;
      if (w) style.fontWeight = w;
    }
    if (button) style.fontWeight ??= '500';
    const g = gravity(a.gravity ?? (button ? 'center' : undefined));
    if (g.h) style.textAlign = g.h === 'center' ? 'center' : g.h === 'flex-end' ? 'right' : 'left';
    if (g.v && g.v !== 'flex-start') Object.assign(style, { display: 'flex', flexDirection: 'column', justifyContent: g.v });
    const lines = a.maxLines ?? a.lines ?? (a.singleLine === 'true' ? '1' : undefined);
    if (lines && Number(lines) > 0 && kind.kind !== 'edit') style.numberOfLines = Number(lines);
    const extra = this.res.dimen(a.lineSpacingExtra) ?? 0;
    const mult = parseFloat(a.lineSpacingMultiplier ?? '1');
    if (extra || mult !== 1) style.lineHeight = Math.round(fontSize * 1.17 * mult + extra);
    if (a.letterSpacing) style.letterSpacing = parseFloat(a.letterSpacing) * fontSize;
    if (a.textAllCaps === 'true' || (button && a.textAllCaps !== 'false')) style.textTransform = 'uppercase';

    const text = this.res.string(a.text) ?? this.res.string(a['tools:text']);
    const runs: PreviewNode[] = text !== undefined && text !== '' ? [{ type: 'raw', text }] : kind.kind === 'edit' ? [] : idOf(a.id) && !button ? [{ type: 'raw', text: idOf(a.id)!, dynamic: true }] : [];

    if (kind.kind === 'edit') {
      const node: PreviewNode = {
        type: 'input',
        component: tag,
        value: text,
        placeholder: this.res.string(a.hint) ?? this.res.string(a['tools:hint']),
        secure: /Password/i.test(a.inputType ?? ''),
        style: { ...style, placeholderColor: this.res.color(a.textColorHint) ?? (this.theme.dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.38)') },
      };
      if (a.background === undefined) Object.assign(node.style!, { borderBottomWidth: 1, borderColor: this.theme.dark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.42)', paddingVertical: 10, paddingHorizontal: 4 });
      return node;
    }
    let node: PreviewNode = { type: 'text', component: tag, style, children: runs };
    if (button) {
      Object.assign(style, { minWidth: 88, minHeight: material ? 36 : 48, paddingHorizontal: 16, display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: style.textAlign ?? 'center' });
      if (a.background === undefined && !/Borderless|TextButton/.test(a.style ?? '')) {
        Object.assign(style, material ? { backgroundColor: this.res.color(a.backgroundTint) ?? this.theme.colorPrimary, borderRadius: 4, minHeight: 36, marginVertical: 6 } : { backgroundColor: this.theme.dark ? '#5A595B' : '#D6D7D7', borderRadius: 2, minHeight: 36, marginVertical: 6, elevation: 2 });
      }
    }
    if (kind.kind === 'check' || kind.kind === 'switch') {
      const checked = a.checked === 'true';
      const accent = this.res.color(a.buttonTint) ?? this.theme.colorAccent;
      const off = this.theme.dark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.54)';
      const mark: PreviewNode =
        kind.kind === 'switch'
          ? { type: 'switch', checked, style: { transform: [{ scale: 0.8 }] } }
          : kind.radio
            ? { type: 'svg', svg: { tag: 'svg', attrs: { width: 20, height: 20, viewBox: '0 0 20 20' } }, style: { margin: 6 }, children: [{ type: 'svg', svg: { tag: 'circle', attrs: { cx: 10, cy: 10, r: 8, fill: 'none', stroke: checked ? accent : off, strokeWidth: 2 } } }, ...(checked ? [{ type: 'svg' as const, svg: { tag: 'circle', attrs: { cx: 10, cy: 10, r: 5, fill: accent } } }] : [])] }
            : { type: 'svg', svg: { tag: 'svg', attrs: { width: 18, height: 18, viewBox: '0 0 18 18' } }, style: { margin: 7 }, children: [{ type: 'svg', svg: { tag: 'rect', attrs: { x: 1, y: 1, width: 16, height: 16, rx: 2, fill: checked ? accent : 'none', stroke: checked ? accent : off, strokeWidth: 2 } } }] };
      const label: PreviewNode = { type: 'text', style: { fontSize: style.fontSize!, color: style.color! }, children: runs };
      node = { type: 'view', component: tag, style: { flexDirection: 'row', alignItems: 'center', ...(kind.kind === 'switch' ? { justifyContent: 'space-between' } : {}) }, children: kind.kind === 'switch' ? [label, mark] : [mark, label] };
      return node;
    }
    return this.compound(node, a);
  }

  /** drawableStart / Top / End / Bottom around a TextView's text. */
  private async compound(text: PreviewNode, a: Attrs): Promise<PreviewNode> {
    const side = async (...names: string[]) => {
      for (const n of names) if (a[n]) return this.drawableNode(a[n], undefined, undefined, this.res.color(a.drawableTint));
      return undefined;
    };
    const start = await side('drawableStart', 'drawableLeft', 'drawableStartCompat', 'drawableLeftCompat');
    const end = await side('drawableEnd', 'drawableRight', 'drawableEndCompat', 'drawableRightCompat');
    const top = await side('drawableTop', 'drawableTopCompat');
    const bottom = await side('drawableBottom', 'drawableBottomCompat');
    if (!start && !end && !top && !bottom) return text;
    const gap = this.res.dimen(a.drawablePadding) ?? 0;
    const vertical = !!(top || bottom) && !start && !end;
    // The box styles stay on the text's wrapper; the text keeps only its text styles.
    const textStyle: PreviewStyle = {};
    for (const [k, v] of Object.entries(text.style ?? {})) if (/^(font|color|textAlign|textTransform|letterSpacing|lineHeight|numberOfLines)/.test(k)) textStyle[k] = v;
    const g = gravity(a.gravity);
    return {
      type: 'view',
      component: text.component,
      style: { ...text.style, display: 'flex', flexDirection: vertical ? 'column' : 'row', alignItems: 'center', justifyContent: (vertical ? g.v : g.h) ?? 'flex-start', gap },
      children: [top ?? start, { ...text, style: { ...textStyle, flexShrink: 1 } }, bottom ?? end].filter((x): x is PreviewNode => !!x),
    };
  }

  private async image(a: Attrs, tag: string, circle: boolean): Promise<PreviewNode> {
    const tint = this.res.color(a.tint);
    const src = await this.drawableNode(a.src ?? a.srcCompat ?? a['tools:src'], undefined, undefined, tint, scaleTypeMode(a.scaleType));
    const style: PreviewStyle = circle ? { borderRadius: 9999, overflow: 'hidden' } : {};
    if (circle) {
      const bw = this.res.dimen(a.civ_border_width);
      if (bw) Object.assign(style, { borderWidth: bw, borderColor: this.res.color(a.civ_border_color) ?? '#000000' });
    }
    if (!src) return { type: 'image', component: tag, style, image: {} };
    if (src.type === 'image') return { ...src, component: tag, style: { ...src.style, ...style } };
    // Vectors and shapes sit inside the view's box like fitCenter.
    return { type: 'view', component: tag, style: { ...style, alignItems: 'center', justifyContent: 'center' }, children: [{ ...src, style: { ...src.style, maxWidth: '100%', maxHeight: '100%' } }] };
  }

  /** A drawable as a node: bitmap image, SVG for vectors, styled box for shapes and colors. */
  async drawableNode(ref: string | undefined, width?: number, height?: number, tint?: string, resizeMode = 'contain'): Promise<PreviewNode | undefined> {
    const d: Drawable | undefined = await this.res.drawable(ref);
    if (!d) return undefined;
    switch (d.kind) {
      case 'image':
        return { type: 'image', image: { assetPath: d.path, resizeMode, density: d.density }, style: { ...(width ? { width } : {}), ...(height ? { height } : {}), ...(tint ? { tintColor: tint } : {}) } };
      case 'vector': {
        const node = tint ? tintSvg(d.node, tint) : d.node;
        return { ...node, style: { ...(node.style ?? {}), width: width ?? d.width, height: height ?? d.height } };
      }
      case 'shape':
        return { type: 'view', style: { ...d.style, width: width ?? d.size?.width ?? 24, height: height ?? d.size?.height ?? 24 }, gradient: d.gradient };
      case 'color':
        return { type: 'view', style: { backgroundColor: d.color, width: width ?? 24, height: height ?? 24 } };
    }
  }

  private async list(el: XmlElement, a: Attrs, tag: string, file: string): Promise<PreviewNode> {
    const item = /^@layout\/(\w+)$/.exec(a['tools:listitem'] ?? '')?.[1];
    const horizontal = a.orientation === 'horizontal' || a['tools:orientation'] === 'horizontal' || /horizontal/i.test(a['tools:layoutManager'] ?? '');
    const span = Number(a.spanCount ?? a['tools:spanCount'] ?? 1);
    const children: PreviewNode[] = [];
    if (item) {
      const count = Number(a['tools:itemCount'] ?? SAMPLE_ROWS);
      for (let i = 0; i < Math.min(count, 8); i++) {
        const rows = await this.inflate(item, span > 1 ? 'frame' : horizontal ? 'hscroll' : 'scroll');
        children.push(...(span > 1 ? rows.map((r) => ({ type: 'view' as const, style: { width: `${100 / span}%` }, children: [r] })) : rows));
      }
    } else {
      children.push(...(await this.children(el, 'scroll', file)));
    }
    return { type: 'scroll', component: tag, horizontal, style: {}, contentStyle: span > 1 ? { flexDirection: 'row', flexWrap: 'wrap' } : {}, children };
  }

  // ---- Box and layout parameters ---------------------------------------------------------------------

  /** Padding, background, alpha, elevation and size limits of any view. */
  private async box(a: Attrs, node: PreviewNode): Promise<PreviewStyle> {
    const s: PreviewStyle = {};
    const d = (k: string) => this.res.dimen(a[k]);
    const all = d('padding');
    const h = d('paddingHorizontal');
    const v = d('paddingVertical');
    const sides: Array<[string, number | undefined]> = [
      ['paddingTop', d('paddingTop') ?? v ?? all],
      ['paddingBottom', d('paddingBottom') ?? v ?? all],
      ['paddingLeft', d('paddingStart') ?? d('paddingLeft') ?? h ?? all],
      ['paddingRight', d('paddingEnd') ?? d('paddingRight') ?? h ?? all],
    ];
    for (const [k, val] of sides) if (val !== undefined) s[k] = val;
    if (a.background && node.type !== 'input') {
      const bg = await this.res.drawable(a.background);
      if (bg?.kind === 'color') s.backgroundColor = bg.color;
      else if (bg?.kind === 'shape') {
        Object.assign(s, bg.style);
        if (bg.gradient?.colors.length) node.gradient = bg.gradient;
      } else if (bg?.kind === 'image' && (node.type === 'view' || node.type === 'text')) {
        // A bitmap background: the view becomes an image with its content on top.
        const inner = node.type === 'text' ? [{ ...node, style: { ...node.style } }] : node.children;
        node.type = 'image';
        node.image = { assetPath: bg.path, resizeMode: 'stretch', density: bg.density };
        node.children = inner;
      }
    }
    const bgTint = this.res.color(a.backgroundTint);
    if (bgTint && s.backgroundColor) s.backgroundColor = bgTint;
    if (a.alpha) s.opacity = parseFloat(a.alpha);
    const elevation = d('elevation');
    if (elevation) s.elevation = elevation;
    for (const k of ['minWidth', 'minHeight', 'maxWidth', 'maxHeight'] as const) {
      const val = d(k);
      if (val !== undefined) s[k] = val;
    }
    if (a.rotation) s.transform = [{ rotate: `${parseFloat(a.rotation)}deg` }];
    return s;
  }

  /** How the view sits in its parent: size, margins, gravity, weight or constraints. */
  private params(node: PreviewNode, a: Attrs, parent: Parent, id: string | undefined): void {
    const s = (node.style ??= {});
    const d = (k: string) => this.res.dimen(a[k]);
    const all = d('layout_margin');
    const h = d('layout_marginHorizontal');
    const v = d('layout_marginVertical');
    const margins: Array<[string, number | undefined]> = [
      ['marginTop', d('layout_marginTop') ?? v ?? all],
      ['marginBottom', d('layout_marginBottom') ?? v ?? all],
      ['marginLeft', d('layout_marginStart') ?? d('layout_marginLeft') ?? h ?? all],
      ['marginRight', d('layout_marginEnd') ?? d('layout_marginRight') ?? h ?? all],
    ];
    for (const [k, val] of margins) if (val !== undefined) s[k] = val;
    let w = sizeOf(a.layout_width, this.res);
    const ht = sizeOf(a.layout_height, this.res);
    // Constraint layouts and scroll views have no natural width of their own when drawn (their
    // children are placed, not flowed): a wrap_content width fills the parent, as their content usually does.
    if (w === 'wrap' && (node.layout === 'constraints' || node.type === 'scroll') && parent !== 'constraints' && parent !== 'relative') w = 'match';
    const weight = parseFloat(a.layout_weight ?? '0');
    const lg = gravity(a.layout_gravity);
    if (node.layout === 'constraints') node.wrapHeight = ht === 'wrap';

    if (parent === 'constraints' || parent === 'relative') {
      node.constraint = parent === 'constraints' ? constraintOf(a, w, ht, id, this.res) : relativeOf(a, w, ht, id);
      return;
    }
    const setSize = (axis: 'width' | 'height', size: Size) => {
      if (typeof size === 'number') s[axis] = size;
    };
    if (parent === 'column' || parent === 'scroll') {
      setSize('width', w);
      if (w === 'match') s.alignSelf = 'stretch';
      else if (lg.h) s.alignSelf = lg.h;
      if (parent === 'column' && weight > 0) Object.assign(s, { flexGrow: weight, flexShrink: 1, flexBasis: ht === 0 ? 0 : 'auto' });
      else if (parent === 'column' && ht === 'match') Object.assign(s, { flexGrow: 1, flexShrink: 1 });
      else setSize('height', ht);
    } else if (parent === 'row' || parent === 'hscroll') {
      setSize('height', ht);
      if (ht === 'match') s.alignSelf = 'stretch';
      else if (lg.v) s.alignSelf = lg.v;
      if (parent === 'row' && weight > 0) Object.assign(s, { flexGrow: weight, flexShrink: 1, flexBasis: w === 0 ? 0 : 'auto' });
      else if (parent === 'row' && w === 'match') Object.assign(s, { flexGrow: 1, flexShrink: 1 });
      else setSize('width', w);
    } else {
      // Frame: every child in the same grid cell, placed by layout_gravity.
      s.gridArea = '1 / 1';
      setSize('width', w);
      setSize('height', ht);
      s.justifySelf = w === 'match' ? 'stretch' : gridAlign(lg.h);
      s.alignSelf = ht === 'match' ? 'stretch' : gridAlign(lg.v);
    }
  }
}

// ---- Helpers ---------------------------------------------------------------------------------------------

type Size = number | 'match' | 'wrap';

const FRAME_STYLE: PreviewStyle = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr)' };

function sizeOf(v: string | undefined, res: AndroidResources): Size {
  if (v === 'match_parent' || v === 'fill_parent') return 'match';
  if (v === undefined || v === 'wrap_content') return 'wrap';
  return res.dimen(v) ?? 'wrap';
}

function idOf(v: string | undefined): string | undefined {
  return v ? /^@(?:\+?id|android:id)\/(\w+)$/.exec(v)?.[1] : undefined;
}

/** Gravity flags as flex alignment on each axis. */
export function gravity(v: string | undefined): { h?: string; v?: string } {
  const out: { h?: string; v?: string } = {};
  for (const f of (v ?? '').split('|').map((x) => x.trim())) {
    if (f === 'center') {
      out.h = 'center';
      out.v = 'center';
    } else if (f === 'center_horizontal') out.h = 'center';
    else if (f === 'center_vertical') out.v = 'center';
    else if (f === 'start' || f === 'left') out.h = 'flex-start';
    else if (f === 'end' || f === 'right') out.h = 'flex-end';
    else if (f === 'top') out.v = 'flex-start';
    else if (f === 'bottom') out.v = 'flex-end';
    else if (f === 'fill_horizontal') out.h = 'stretch';
    else if (f === 'fill_vertical') out.v = 'stretch';
    else if (f === 'fill') {
      out.h = 'stretch';
      out.v = 'stretch';
    }
  }
  return out;
}

function gridAlign(flex: string | undefined): string {
  return flex === 'center' ? 'center' : flex === 'flex-end' ? 'end' : flex === 'stretch' ? 'stretch' : 'start';
}

function scaleTypeMode(v: string | undefined): string {
  switch (v) {
    case 'centerCrop':
      return 'cover';
    case 'fitXY':
      return 'stretch';
    case 'center':
      return 'center';
    default:
      return 'contain';
  }
}

function anchorRef(v: string | undefined, edge: PreviewAnchor['edge']): PreviewAnchor | undefined {
  if (!v) return undefined;
  if (v === 'parent') return { to: 'parent', edge };
  const id = idOf(v);
  return id ? { to: id, edge } : undefined;
}

function constraintOf(a: Attrs, w: Size, h: Size, id: string | undefined, res: AndroidResources): PreviewConstraint {
  const kind = (s: Size): PreviewConstraint['width'] => (s === 'match' ? 'parent' : s === 0 ? 'match' : s);
  const c: PreviewConstraint = { id, width: kind(w), height: kind(h) };
  c.left = anchorRef(a.layout_constraintStart_toStartOf ?? a.layout_constraintLeft_toLeftOf, 'left') ?? anchorRef(a.layout_constraintStart_toEndOf ?? a.layout_constraintLeft_toRightOf, 'right');
  c.right = anchorRef(a.layout_constraintEnd_toEndOf ?? a.layout_constraintRight_toRightOf, 'right') ?? anchorRef(a.layout_constraintEnd_toStartOf ?? a.layout_constraintRight_toLeftOf, 'left');
  c.top = anchorRef(a.layout_constraintTop_toTopOf, 'top') ?? anchorRef(a.layout_constraintTop_toBottomOf, 'bottom') ?? anchorRef(a.layout_constraintBaseline_toBaselineOf, 'top');
  c.bottom = anchorRef(a.layout_constraintBottom_toBottomOf, 'bottom') ?? anchorRef(a.layout_constraintBottom_toTopOf, 'top');
  if (a.layout_constraintHorizontal_bias) c.hBias = parseFloat(a.layout_constraintHorizontal_bias);
  if (a.layout_constraintVertical_bias) c.vBias = parseFloat(a.layout_constraintVertical_bias);
  if (a.orientation && (a.layout_constraintGuide_percent || a.layout_constraintGuide_begin || a.layout_constraintGuide_end)) {
    c.guide = {
      orientation: a.orientation === 'vertical' ? 'vertical' : 'horizontal',
      percent: a.layout_constraintGuide_percent ? parseFloat(a.layout_constraintGuide_percent) : undefined,
      begin: res.dimen(a.layout_constraintGuide_begin),
      end: res.dimen(a.layout_constraintGuide_end),
    };
  }
  return c;
}

function relativeOf(a: Attrs, w: Size, h: Size, id: string | undefined): PreviewConstraint {
  const yes = (k: string) => a[k] === 'true';
  const c: PreviewConstraint = { id, width: w === 'match' ? 'parent' : w, height: h === 'match' ? 'parent' : h };
  if (yes('layout_centerInParent') || yes('layout_centerHorizontal')) {
    c.left = { to: 'parent', edge: 'left' };
    c.right = { to: 'parent', edge: 'right' };
  }
  if (yes('layout_centerInParent') || yes('layout_centerVertical')) {
    c.top = { to: 'parent', edge: 'top' };
    c.bottom = { to: 'parent', edge: 'bottom' };
  }
  const left = (yes('layout_alignParentStart') || yes('layout_alignParentLeft') ? { to: 'parent', edge: 'left' as const } : undefined) ?? anchorRef(a.layout_toEndOf ?? a.layout_toRightOf, 'right') ?? anchorRef(a.layout_alignStart ?? a.layout_alignLeft, 'left');
  const right = (yes('layout_alignParentEnd') || yes('layout_alignParentRight') ? { to: 'parent', edge: 'right' as const } : undefined) ?? anchorRef(a.layout_toStartOf ?? a.layout_toLeftOf, 'left') ?? anchorRef(a.layout_alignEnd ?? a.layout_alignRight, 'right');
  const top = (yes('layout_alignParentTop') ? { to: 'parent', edge: 'top' as const } : undefined) ?? anchorRef(a.layout_below, 'bottom') ?? anchorRef(a.layout_alignTop ?? a.layout_alignBaseline, 'top');
  const bottom = (yes('layout_alignParentBottom') ? { to: 'parent', edge: 'bottom' as const } : undefined) ?? anchorRef(a.layout_above, 'top') ?? anchorRef(a.layout_alignBottom, 'bottom');
  if (left) c.left = left;
  if (right) c.right = right;
  if (top) c.top = top;
  if (bottom) c.bottom = bottom;
  // In a RelativeLayout a view tied on both sides fills the space between (it is not centered).
  if (left && right && c.width === 'wrap') c.width = 'match';
  if (top && bottom && c.height === 'wrap') c.height = 'match';
  if (!c.left && !c.right) c.left = { to: 'parent', edge: 'left' };
  if (!c.top && !c.bottom) c.top = { to: 'parent', edge: 'top' };
  return c;
}

function tintSvg(node: PreviewNode, tint: string): PreviewNode {
  const attrs = node.svg ? { ...node.svg.attrs } : undefined;
  if (attrs && node.svg!.tag !== 'svg') {
    if (attrs.fill && attrs.fill !== 'none') attrs.fill = tint;
    if (attrs.stroke && attrs.stroke !== 'none') attrs.stroke = tint;
  }
  return { ...node, svg: node.svg && attrs ? { tag: node.svg.tag, attrs } : node.svg, children: node.children?.map((c) => tintSvg(c, tint)) };
}

/** Widgets of the Android framework and common libraries. */
function builtinKind(simple: string, a: Attrs): Kind | undefined {
  switch (simple) {
    case 'LinearLayout':
    case 'LinearLayoutCompat':
    case 'RadioGroup':
    case 'TableLayout':
    case 'TableRow':
    case 'AppBarLayout':
      return { kind: 'linear' };
    case 'FrameLayout':
    case 'CoordinatorLayout':
    case 'DrawerLayout':
    case 'SwipeRefreshLayout':
    case 'NavigationView':
    case 'CollapsingToolbarLayout':
    case 'TextInputLayout':
    case 'ViewFlipper':
    case 'ViewAnimator':
      return { kind: 'frame' };
    case 'CardView':
    case 'MaterialCardView':
      return { kind: 'card' };
    case 'ConstraintLayout':
    case 'MotionLayout':
      return { kind: 'constraints', relative: false };
    case 'RelativeLayout':
    case 'PercentRelativeLayout':
      return { kind: 'constraints', relative: true };
    case 'ScrollView':
    case 'NestedScrollView':
      return { kind: 'scroll', horizontal: false };
    case 'HorizontalScrollView':
      return { kind: 'scroll', horizontal: true };
    case 'RecyclerView':
    case 'ListView':
    case 'GridView':
    case 'ViewPager':
    case 'ViewPager2':
      return { kind: 'list' };
    case 'TextView':
    case 'AppCompatTextView':
    case 'MaterialTextView':
    case 'CheckedTextView':
    case 'Chronometer':
    case 'TextClock':
      return { kind: 'text' };
    case 'Button':
    case 'AppCompatButton':
    case 'ToggleButton':
      return { kind: 'button', material: false };
    case 'MaterialButton':
    case 'Chip':
      return { kind: 'button', material: true };
    case 'EditText':
    case 'AppCompatEditText':
    case 'TextInputEditText':
    case 'AutoCompleteTextView':
    case 'MaterialAutoCompleteTextView':
      return { kind: 'edit' };
    case 'CheckBox':
    case 'AppCompatCheckBox':
    case 'MaterialCheckBox':
      return { kind: 'check', radio: false };
    case 'RadioButton':
    case 'AppCompatRadioButton':
    case 'MaterialRadioButton':
      return { kind: 'check', radio: true };
    case 'Switch':
    case 'SwitchCompat':
    case 'SwitchMaterial':
    case 'MaterialSwitch':
      return { kind: 'switch' };
    case 'ImageView':
    case 'AppCompatImageView':
    case 'ImageButton':
    case 'AppCompatImageButton':
    case 'ShapeableImageView':
      return { kind: 'image', circle: false };
    case 'CircleImageView':
    case 'CircularImageView':
    case 'RoundedImageView':
      return { kind: 'image', circle: !a.riv_corner_radius };
    case 'ProgressBar':
    case 'ContentLoadingProgressBar':
    case 'CircularProgressIndicator':
    case 'LinearProgressIndicator':
      return { kind: 'progress' };
    case 'SeekBar':
    case 'AppCompatSeekBar':
    case 'Slider':
      return { kind: 'seek' };
    case 'View':
    case 'Space':
    case 'Guideline':
    case 'Barrier':
    case 'Group':
    case 'Flow':
    case 'Layer':
    case 'Placeholder':
      return { kind: 'view' };
    case 'SurfaceView':
    case 'TextureView':
    case 'VideoView':
    case 'TXCloudVideoView':
    case 'PlayerView':
    case 'StyledPlayerView':
    case 'PreviewView':
      return { kind: 'video' };
    case 'Toolbar':
    case 'MaterialToolbar':
      return { kind: 'toolbar' };
    case 'FloatingActionButton':
    case 'ExtendedFloatingActionButton':
      return { kind: 'fab' };
  }
  return undefined;
}

/** The layout a project view class inflates into itself. */
function inflatedLayout(src: string): string | undefined {
  const direct = /(?:inflate|View\.inflate)\([^;]*?R\.layout\.(\w+)/.exec(src)?.[1];
  if (direct) return direct;
  const binding = /(\w+)Binding\.inflate\(/.exec(src)?.[1];
  return binding ? snake(binding) : undefined;
}

/** The layout an Activity, Fragment or Dialog class shows. */
export function screenLayout(src: string): string | undefined {
  const patterns = [
    /(?<![\w.])(?:this\.)?setContentView\([^;]*?R\.layout\.(\w+)/,
    /DataBindingUtil\.setContentView\([^;]*?R\.layout\.(\w+)/,
    // A DialogFragment building its Dialog: dialog.setContentView(R.layout.x) in onCreateDialog.
    /onCreateDialog[\s\S]*?\b\w+\.setContentView\([^;]*?R\.layout\.(\w+)/,
    /inflater\.inflate\(\s*R\.layout\.(\w+)/,
    /(?:super|Fragment|DialogFragment|BottomSheetDialogFragment)\(\s*R\.layout\.(\w+)\s*\)/,
    /(?:getLayoutId|getLayoutResId|layoutId)\s*\(\s*\)[^{]*\{\s*return\s+R\.layout\.(\w+)/,
    /override\s+val\s+layoutId[^=]*=\s*R\.layout\.(\w+)/,
    /inflate\([^;]*?R\.layout\.(\w+)/,
  ];
  for (const p of patterns) {
    const m = p.exec(src);
    if (m) return m[1];
  }
  const binding = /(\w+)Binding\.inflate\(/.exec(src)?.[1];
  return binding ? snake(binding) : undefined;
}

function snake(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}
