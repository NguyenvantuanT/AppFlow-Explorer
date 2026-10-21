import type { PreviewNode, PreviewStyle, ScreenPreview } from '@appflow/model';
import { documentElement, parseXml, type XmlElement } from '../parsing/xml';
import type { PreviewSource } from './modules';

/**
 * Draws iOS screens laid out in Interface Builder: a view controller's XIB
 * (`init(nibName:)` or the XIB named after the class) or a storyboard scene.
 * Interface Builder stores every view's frame for the designed device, so
 * views are placed at those frames. Screens built only in code are not drawn.
 */

const SYSTEM_COLORS: Record<string, string> = {
  systemBackgroundColor: '#FFFFFF',
  secondarySystemBackgroundColor: '#F2F2F7',
  tertiarySystemBackgroundColor: '#FFFFFF',
  systemGroupedBackgroundColor: '#F2F2F7',
  secondarySystemGroupedBackgroundColor: '#FFFFFF',
  labelColor: '#000000',
  secondaryLabelColor: 'rgba(60,60,67,0.6)',
  tertiaryLabelColor: 'rgba(60,60,67,0.3)',
  placeholderTextColor: 'rgba(60,60,67,0.3)',
  separatorColor: 'rgba(60,60,67,0.29)',
  opaqueSeparatorColor: '#C6C6C8',
  linkColor: '#007AFF',
  tintColor: '#007AFF',
  systemBlueColor: '#007AFF',
  systemRedColor: '#FF3B30',
  systemGreenColor: '#34C759',
  systemOrangeColor: '#FF9500',
  systemYellowColor: '#FFCC00',
  systemPinkColor: '#FF2D55',
  systemPurpleColor: '#AF52DE',
  systemTealColor: '#5AC8FA',
  systemIndigoColor: '#5856D6',
  systemGrayColor: '#8E8E93',
  systemGray2Color: '#AEAEB2',
  systemGray3Color: '#C7C7CC',
  systemGray4Color: '#D1D1D6',
  systemGray5Color: '#E5E5EA',
  systemGray6Color: '#F2F2F7',
  darkTextColor: '#000000',
  lightTextColor: 'rgba(255,255,255,0.6)',
  groupTableViewBackgroundColor: '#F2F2F7',
  whiteColor: '#FFFFFF',
  blackColor: '#000000',
  clearColor: 'transparent',
};
const WEIGHTS: Record<string, string> = { ultraLight: '100', thin: '200', light: '300', regular: '400', medium: '500', semibold: '600', bold: '700', heavy: '800', black: '900' };
const CONTENT_MODE: Record<string, string> = { scaleAspectFit: 'contain', scaleAspectFill: 'cover', scaleToFill: 'stretch', center: 'center' };

interface Doc {
  file: string;
  namedColors: Map<string, string>;
  systemColors: Map<string, string>;
  images: Map<string, { width: number; height: number }>;
}

export class IosPreviewer {
  private readonly xibs = new Map<string, string>();
  private readonly imagesets = new Map<string, string>();
  private readonly colorsets = new Map<string, string>();
  private readonly fontFiles = new Map<string, string>();
  private readonly catalogColors = new Map<string, Promise<string | undefined>>();
  private readonly catalogImages = new Map<string, Promise<{ path: string; density: number } | undefined>>();

  private constructor(private readonly source: PreviewSource) {}

  static open(source: PreviewSource, files: string[]): IosPreviewer {
    const p = new IosPreviewer(source);
    for (const f of files) {
      if (/(^|\/)Pods\//.test(f)) continue;
      const name = f.slice(f.lastIndexOf('/') + 1);
      if (name.endsWith('.xib')) p.xibs.set(name.slice(0, -4), f);
      let m = /\/([^/]+)\.imageset\/Contents\.json$/.exec(f);
      if (m) p.imagesets.set(m[1]!, f);
      m = /\/([^/]+)\.colorset\/Contents\.json$/.exec(f);
      if (m) p.colorsets.set(m[1]!, f);
      if (/\.(ttf|otf)$/i.test(name) && !/node_modules\//.test(f)) p.fontFiles.set(name.replace(/\.\w+$/, ''), f);
    }
    return p;
  }

  /** The screen, or `null` when it is built in code (no XIB or storyboard to draw). */
  async preview(req: { screenId: string; file: string; component: string }): Promise<ScreenPreview | null> {
    let file: string | undefined;
    let rootView: XmlElement | undefined;
    let root: XmlElement | undefined;
    if (req.file.endsWith('.storyboard')) {
      file = req.file;
      root = await this.xml(file);
      const id = req.screenId.slice(req.screenId.lastIndexOf('#') + 1);
      const controller = root && find(root, (e) => e.attrs.id === id || e.attrs.storyboardIdentifier === id || e.attrs.customClass === req.component);
      rootView = controller?.children.find((c) => c.attrs.key === 'view') ?? (controller?.name === 'view' ? controller : undefined);
    } else {
      const src = (await this.source.readText(req.file)) ?? '';
      // init(nibName: "X"), else the XIB named after the class (what UIKit loads for nibName: nil).
      // Not loadNibNamed: those are subviews placed by code.
      const nib = /\binit\(\s*nibName:\s*"(\w+)"/.exec(src)?.[1] ?? req.component;
      file = this.xibs.get(nib);
      if (!file) return null;
      root = await this.xml(file);
      // The File's Owner's `view` outlet, else the first top-level view.
      const objects = root?.children.find((c) => c.name === 'objects');
      const owner = objects?.children.find((c) => c.attrs.placeholderIdentifier === 'IBFilesOwner');
      const outlet = owner && find(owner, (e) => e.name === 'outlet' && e.attrs.property === 'view')?.attrs.destination;
      rootView = objects?.children.find((c) => outlet && c.attrs.id === outlet) ?? objects?.children.find((c) => c.name !== 'placeholder');
    }
    if (!root || !rootView || !file) return null;
    const doc = this.doc(root, file);
    const notes = new Set<string>();
    const fonts = new Map<string, string>();
    const frame = rectOf(rootView) ?? { x: 0, y: 0, width: 393, height: 852 };
    const node = await this.view(rootView, doc, notes, fonts, true);
    if (!node) return null;
    node.style = { ...node.style, position: 'relative', left: 0, top: 0, width: frame.width, height: frame.height };
    node.style.backgroundColor ??= '#FFFFFF';
    return {
      screenId: req.screenId,
      platform: 'ios',
      width: frame.width,
      height: frame.height,
      root: node,
      notes: [...notes],
      ...(fonts.size ? { fonts: [...fonts].map(([family, path]) => ({ family, path })) } : {}),
    };
  }

  private async xml(file: string): Promise<XmlElement | undefined> {
    try {
      return documentElement(parseXml((await this.source.readText(file)) ?? ''));
    } catch {
      return undefined;
    }
  }

  private doc(root: XmlElement, file: string): Doc {
    const doc: Doc = { file, namedColors: new Map(), systemColors: new Map(), images: new Map() };
    const resources = root.children.find((c) => c.name === 'resources');
    for (const r of resources?.children ?? []) {
      const color = r.children.find((c) => c.name === 'color');
      if (r.name === 'namedColor' && color) doc.namedColors.set(r.attrs.name!, rawColor(color) ?? '');
      if (r.name === 'systemColor' && color) doc.systemColors.set(r.attrs.name!, rawColor(color) ?? '');
      if (r.name === 'image') doc.images.set(r.attrs.name!, { width: parseFloat(r.attrs.width ?? '0'), height: parseFloat(r.attrs.height ?? '0') });
    }
    return doc;
  }

  private async color(el: XmlElement | undefined, doc: Doc): Promise<string | undefined> {
    if (!el) return undefined;
    if (el.attrs.name) return doc.namedColors.get(el.attrs.name) || (await this.catalogColor(el.attrs.name));
    if (el.attrs.systemColor) return doc.systemColors.get(el.attrs.systemColor) || SYSTEM_COLORS[el.attrs.systemColor];
    if (el.attrs.cocoaTouchSystemColor) return SYSTEM_COLORS[el.attrs.cocoaTouchSystemColor];
    return rawColor(el);
  }

  private catalogColor(name: string): Promise<string | undefined> {
    let p = this.catalogColors.get(name);
    if (!p) {
      const file = this.colorsets.get(name);
      p = file
        ? this.source.readText(file).then((t) => {
            try {
              const json = JSON.parse(t ?? '{}');
              const entry = (json.colors ?? []).find((c: { appearances?: unknown[] }) => !c.appearances) ?? json.colors?.[0];
              const comp = entry?.color?.components;
              if (!comp) return undefined;
              const ch = (v: string) => (/^0x/i.test(v) ? parseInt(v, 16) : parseFloat(v) <= 1 && v.includes('.') ? Math.round(parseFloat(v) * 255) : parseFloat(v));
              const a = parseFloat(comp.alpha ?? '1');
              return `rgba(${ch(comp.red)},${ch(comp.green)},${ch(comp.blue)},${a})`;
            } catch {
              return undefined;
            }
          })
        : Promise.resolve(undefined);
      this.catalogColors.set(name, p);
    }
    return p;
  }

  /** An image of an asset catalog: the densest file of its image set (bitmaps and SVG; PDF cannot be drawn). */
  private catalogImage(name: string): Promise<{ path: string; density: number } | undefined> {
    let p = this.catalogImages.get(name);
    if (!p) {
      const file = this.imagesets.get(name);
      p = file
        ? this.source.readText(file).then((t) => {
            try {
              const images: Array<{ filename?: string; scale?: string }> = JSON.parse(t ?? '{}').images ?? [];
              const usable = images.filter((i) => i.filename && /\.(png|jpe?g|gif|webp|svg)$/i.test(i.filename));
              const best = usable.sort((a, b) => parseFloat(b.scale ?? '1') - parseFloat(a.scale ?? '1'))[0];
              return best ? { path: `${file.slice(0, file.lastIndexOf('/'))}/${best.filename}`, density: parseFloat(best.scale ?? '1') } : undefined;
            } catch {
              return undefined;
            }
          })
        : Promise.resolve(undefined);
      this.catalogImages.set(name, p);
    }
    return p;
  }

  private async view(el: XmlElement, doc: Doc, notes: Set<string>, fonts: Map<string, string>, isRoot = false, parentWidth?: number): Promise<PreviewNode | undefined> {
    if (el.attrs.hidden === 'YES') return undefined;
    const frame = rectOf(el);
    const style: PreviewStyle = {};
    if (frame && !isRoot) Object.assign(style, { position: 'absolute', left: frame.x, top: frame.y, width: frame.width, height: frame.height });
    const colorOf = (key: string) => this.color(el.children.find((c) => c.name === 'color' && c.attrs.key === key), doc);
    const bg = await colorOf('backgroundColor');
    if (bg) style.backgroundColor = bg;
    if (el.attrs.alpha) style.opacity = parseFloat(el.attrs.alpha);
    if (el.attrs.clipsSubviews === 'YES') style.overflow = 'hidden';
    // IBInspectable / layer key paths set in Interface Builder.
    const runtime = new Map<string, string>();
    for (const a of find(el, (e) => e.name === 'userDefinedRuntimeAttributes', true)?.children ?? []) {
      const value = a.attrs.value ?? a.children.find((c) => c.attrs.key === 'value')?.attrs.value;
      if (a.attrs.keyPath && value !== undefined) runtime.set(a.attrs.keyPath, value);
      const color = a.children.find((c) => c.name === 'color');
      if (a.attrs.keyPath && color) runtime.set(a.attrs.keyPath, (await this.color(color, doc)) ?? '');
    }
    const radius = runtime.get('cornerRadius') ?? runtime.get('layer.cornerRadius');
    if (radius) style.borderRadius = parseFloat(radius);
    const bw = runtime.get('borderWidth') ?? runtime.get('layer.borderWidth');
    if (bw) style.borderWidth = parseFloat(bw);
    const bc = runtime.get('borderColor') ?? runtime.get('layer.borderUIColor');
    if (bc) style.borderColor = bc;

    const font = async (): Promise<PreviewStyle> => {
      const fd = el.children.find((c) => c.name === 'fontDescription');
      const s: PreviewStyle = { fontSize: parseFloat(fd?.attrs.pointSize ?? '17') };
      if (fd?.attrs.type === 'boldSystem') s.fontWeight = '700';
      else if (fd?.attrs.weight) s.fontWeight = WEIGHTS[fd.attrs.weight] ?? '400';
      if (fd?.attrs.type === 'italicSystem') s.fontStyle = 'italic';
      const family = runtime.get('fontName') ?? fd?.attrs.name;
      if (family) {
        s.fontFamily = family;
        const file = this.fontFiles.get(family);
        if (file) fonts.set(family, file);
      }
      return s;
    };
    const align = (v: string | undefined) => (v === 'center' ? 'center' : v === 'right' ? 'right' : v === 'justified' ? 'justify' : 'left');
    const kids = async (): Promise<PreviewNode[]> => {
      const subviews = el.children.find((c) => c.name === 'subviews');
      const out: PreviewNode[] = [];
      for (const s of subviews?.children ?? []) {
        const n = await this.view(s, doc, notes, fonts, false, frame?.width);
        if (n) out.push(n);
      }
      return out;
    };
    const location = { fileId: doc.file, line: el.line };
    const component = el.attrs.customClass ?? el.name;

    switch (el.name) {
      case 'label': {
        const color = (await colorOf('textColor')) ?? '#000000';
        const lines = parseInt(el.attrs.numberOfLines ?? '1', 10);
        const textStyle: PreviewStyle = { ...style, ...(await font()), color, textAlign: align(el.attrs.textAlignment), display: 'flex', flexDirection: 'column', justifyContent: 'center' };
        // Auto Layout sizes a one-line label to its text: the frame was measured with Interface
        // Builder's font, so let it grow (around its center when centered in its parent).
        if (lines === 1 && el.attrs.translatesAutoresizingMaskIntoConstraints === 'NO' && frame) {
          delete textStyle.width;
          Object.assign(textStyle, { minWidth: frame.width, whiteSpace: 'nowrap' });
          if (parentWidth && Math.abs(frame.x + frame.width / 2 - parentWidth / 2) < 2) Object.assign(textStyle, { left: parentWidth / 2, transform: [{ translateX: '-50%' }] });
        } else if (lines > 0) textStyle.numberOfLines = lines;
        return { type: 'text', component, location, style: textStyle, children: [{ type: 'raw', text: el.attrs.text ?? '' }] };
      }
      case 'button': {
        const state = el.children.find((c) => c.name === 'state' && c.attrs.key === 'normal');
        const config = el.children.find((c) => c.name === 'buttonConfiguration');
        const title = state?.attrs.title ?? config?.attrs.title;
        const image = state?.attrs.image ?? config?.attrs.image;
        const tint = (await this.color(state?.children.find((c) => c.attrs.key === 'titleColor'), doc)) ?? (el.attrs.buttonType === 'system' || config ? '#007AFF' : '#FFFFFF');
        const children: PreviewNode[] = [];
        if (image) {
          const img = await this.image(image, doc, notes);
          if (img) children.push(img);
        }
        if (title) children.push({ type: 'text', style: { ...(await font()), color: tint, whiteSpace: 'nowrap' }, children: [{ type: 'raw', text: title }] });
        const h = el.attrs.contentHorizontalAlignment;
        return { type: 'view', component, location, style: { ...style, flexDirection: 'row', alignItems: 'center', justifyContent: h === 'left' || h === 'leading' ? 'flex-start' : h === 'right' || h === 'trailing' ? 'flex-end' : 'center', gap: 4 }, children };
      }
      case 'imageView': {
        const name = el.attrs.image;
        const img = name ? await this.image(name, doc, notes) : undefined;
        if (img?.type === 'image') return { ...img, component, location, style: { ...style, ...(img.style ?? {}), width: style.width!, height: style.height! }, image: { ...img.image, resizeMode: CONTENT_MODE[el.attrs.contentMode ?? 'scaleToFill'] ?? 'stretch' } };
        return { type: 'view', component, location, style: { ...style, ...(img ? {} : { backgroundColor: style.backgroundColor ?? 'transparent' }) }, children: img ? [img] : [] };
      }
      case 'textField': {
        const color = (await colorOf('textColor')) ?? '#000000';
        const rounded = el.attrs.borderStyle === 'roundedRect';
        return { type: 'input', component, location, value: el.attrs.text, placeholder: el.attrs.placeholder, secure: el.children.some((c) => c.name === 'textInputTraits' && c.attrs.secureTextEntry === 'YES'), style: { ...style, ...(await font()), color, textAlign: align(el.attrs.textAlignment), ...(rounded ? { borderWidth: 0.5, borderColor: '#C7C7CC', borderRadius: 5, paddingHorizontal: 7, backgroundColor: style.backgroundColor ?? '#FFFFFF' } : {}), placeholderColor: 'rgba(60,60,67,0.3)' } };
      }
      case 'textView':
        return { type: 'text', component, location, style: { ...style, ...(await font()), color: (await colorOf('textColor')) ?? '#000000', padding: 8 }, children: [{ type: 'raw', text: el.attrs.text ?? el.children.find((c) => c.name === 'string')?.text ?? '' }] };
      case 'switch':
        return { type: 'switch', component, location, checked: el.attrs.on === 'YES', style };
      case 'activityIndicatorView':
        return { type: 'spinner', component, location, style: { ...style, color: '#8E8E93' } };
      case 'segmentedControl': {
        const segments = find(el, (e) => e.name === 'segments', true)?.children ?? [];
        return { type: 'view', component, location, style: { ...style, flexDirection: 'row', backgroundColor: '#EEEEEF', borderRadius: 8, padding: 2 }, children: segments.map((s, i) => ({ type: 'text', style: { flex: 1, textAlign: 'center', fontSize: 13, fontWeight: '500', borderRadius: 7, display: 'flex', flexDirection: 'column', justifyContent: 'center', ...(i === parseInt(el.attrs.selectedSegmentIndex ?? '0', 10) ? { backgroundColor: '#FFFFFF' } : {}) }, children: [{ type: 'raw', text: s.attrs.title ?? '' }] })) };
      }
      case 'slider':
      case 'progressView':
        return { type: 'view', component, location, style: { ...style, justifyContent: 'center' }, children: [{ type: 'view', style: { height: 4, borderRadius: 2, backgroundColor: '#007AFF' } }] };
      case 'pageControl':
        return { type: 'view', component, location, style: { ...style, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }, children: Array.from({ length: Math.min(parseInt(el.attrs.numberOfPages ?? '3', 10), 8) }, (_, i) => ({ type: 'view' as const, style: { width: 7, height: 7, borderRadius: 4, backgroundColor: i === 0 ? '#FFFFFF' : 'rgba(255,255,255,0.4)' } })) };
      case 'wkWebView':
      case 'webView':
      case 'mapView':
        notes.add(`${el.name} is drawn as a box.`);
        return { type: 'placeholder', component, location, text: el.name, style };
      case 'visualEffectView':
        return { type: 'view', component, location, style: { ...style, backgroundColor: style.backgroundColor ?? 'rgba(242,242,247,0.8)' }, children: await kids() };
      default: {
        // view, scrollView, stackView, tableView, collectionView, containerView…: a box with its subviews at their frames.
        const children = await kids();
        const inner = el.children.find((c) => c.attrs.key === 'contentView');
        if (inner) {
          const n = await this.view(inner, doc, notes, fonts);
          if (n) children.unshift(n);
        }
        return { type: 'view', component, location, style, children };
      }
    }
  }

  private async image(name: string, doc: Doc, notes: Set<string>): Promise<PreviewNode | undefined> {
    const size = doc.images.get(name);
    const found = await this.catalogImage(name);
    if (!found) {
      notes.add(`Image ${name} is not in an asset catalog (or is a PDF / SF Symbol).`);
      return size ? { type: 'view', style: { width: size.width, height: size.height, borderRadius: 4, backgroundColor: 'rgba(148,163,184,0.35)' } } : undefined;
    }
    return { type: 'image', image: { assetPath: found.path, resizeMode: 'contain', density: found.density }, style: size ? { width: size.width, height: size.height } : {} };
  }
}

function rectOf(el: XmlElement): { x: number; y: number; width: number; height: number } | undefined {
  const r = el.children.find((c) => c.name === 'rect' && c.attrs.key === 'frame');
  if (!r) return undefined;
  const n = (k: string) => Math.round(parseFloat(r.attrs[k] ?? '0') * 100) / 100;
  return { x: n('x'), y: n('y'), width: n('width'), height: n('height') };
}

/** An Interface Builder `<color>` with components (sRGB or gray) as CSS. */
function rawColor(el: XmlElement): string | undefined {
  const a = el.attrs;
  const alpha = parseFloat(a.alpha ?? '1');
  if (a.red !== undefined) {
    const [r, g, b] = [a.red, a.green, a.blue].map((v) => Math.round(parseFloat(v ?? '0') * 255));
    return `rgba(${r},${g},${b},${alpha})`;
  }
  if (a.white !== undefined) {
    const w = Math.round(parseFloat(a.white) * 255);
    return `rgba(${w},${w},${w},${alpha})`;
  }
  if (a.systemColor) return SYSTEM_COLORS[a.systemColor];
  return undefined;
}

function find(el: XmlElement, test: (e: XmlElement) => boolean, direct = false): XmlElement | undefined {
  for (const c of el.children) {
    if (test(c)) return c;
    if (!direct) {
      const deep = find(c, test);
      if (deep) return deep;
    }
  }
  return undefined;
}
