import type { PreviewNode, ScreenPreview } from '@appflow/model';
import { createElement, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { agentApi } from '../agent/client';
import { solveAxis, wrapExtent, type Span } from '../lib/constraints';
import { objectFit, rnStyleToCss, TEXT_BASE, VIEW_BASE } from '../lib/rnStyle';

/**
 * A screen drawn from its React Native source by the agent: the element tree
 * with its styles, laid out with CSS flexbox at device size and scaled to fit.
 * Data that only exists at runtime is shown as the expression that produces it.
 */

const previews = new Map<string, Promise<ScreenPreview>>();
const assets = new Map<string, Promise<string>>();
const fonts = new Map<string, Promise<string | null>>();

/** Forgets drawn screens, e.g. after a new analysis. */
export function clearCodePreviews(): void {
  previews.clear();
  assets.clear();
}

function loadPreview(projectId: string, analyzedAt: string | undefined, screenId: string): Promise<ScreenPreview> {
  const key = `${projectId}|${analyzedAt ?? ''}|${screenId}`;
  let p = previews.get(key);
  if (!p) {
    p = agentApi.screenPreview(projectId, screenId);
    previews.set(key, p);
    p.catch(() => previews.delete(key));
  }
  return p;
}

function loadAsset(projectId: string, path: string): Promise<string> {
  const key = `${projectId}|${path}`;
  let p = assets.get(key);
  if (!p) {
    p = agentApi.previewAsset(projectId, path);
    assets.set(key, p);
  }
  return p;
}

/** Registers a vector-icons font once; resolves to its CSS family, or null when it is not installed. */
function loadIconFont(projectId: string, set: string): Promise<string | null> {
  const key = `${projectId}|${set}`;
  let p = fonts.get(key);
  if (!p) {
    const family = `appflow-icons-${set}`;
    p = agentApi
      .iconFont(projectId, set)
      .then(async (uri) => {
        const face = new FontFace(family, `url(${uri})`);
        await face.load();
        document.fonts.add(face);
        return family;
      })
      .catch(() => null);
    fonts.set(key, p);
  }
  return p;
}

/** Registers a font file of the project under its React Native family name (the file name). */
function loadProjectFont(projectId: string, family: string, path: string): Promise<void> {
  const key = `${projectId}|font|${path}`;
  let p = fonts.get(key);
  if (!p) {
    p = loadAsset(projectId, path)
      .then(async (uri) => {
        // One file per family: accept every weight so the browser does not fake bold.
        const face = new FontFace(family, `url(${uri})`, { weight: '100 900' });
        await face.load();
        document.fonts.add(face);
        return family;
      })
      .catch(() => null);
    fonts.set(key, p);
  }
  return p.then(() => undefined);
}

export function useScreenPreview(projectId: string | undefined, analyzedAt: string | undefined, screenId: string, enabled: boolean): { preview?: ScreenPreview; error?: string } {
  const [state, setState] = useState<{ preview?: ScreenPreview; error?: string }>({});
  useEffect(() => {
    if (!enabled || !projectId) return;
    let alive = true;
    loadPreview(projectId, analyzedAt, screenId).then(
      (preview) => alive && setState({ preview }),
      (e: unknown) => alive && setState({ error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      alive = false;
    };
  }, [projectId, analyzedAt, screenId, enabled]);
  return state;
}

/** Draws `preview` scaled to the width of its container. */
export function CodePreview({ preview, projectId }: { preview: ScreenPreview; projectId: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    for (const f of preview.fonts ?? []) void loadProjectFont(projectId, f.family, f.path);
  }, [preview, projectId]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / preview.width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [preview.width]);
  return (
    <div ref={box} className="relative h-full w-full overflow-hidden bg-white" data-testid="code-preview">
      {scale > 0 && (
        <div
          style={{ width: preview.width, height: preview.height, transform: `scale(${scale})`, transformOrigin: '0 0', position: 'absolute', left: 0, top: 0, ...VIEW_BASE, fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', textAlign: 'left', overflow: 'hidden' }}
          aria-hidden
        >
          <Draw node={preview.root} projectId={projectId} />
          <StatusBar platform={preview.platform} light={isDarkColor(preview.root.style?.backgroundColor)} />
        </div>
      )}
    </div>
  );
}

function isDarkColor(c: unknown): boolean {
  const m = typeof c === 'string' ? /^#([0-9a-f]{6})$/i.exec(c) : null;
  if (!m) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16));
  return 0.299 * r! + 0.587 * g! + 0.114 * b! < 128;
}

function StatusBar({ platform, light }: { platform?: 'ios' | 'android'; light: boolean }) {
  const ink = light ? '#FFFFFF' : '#000000';
  if (platform === 'android') {
    return (
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', fontSize: 13, color: ink, pointerEvents: 'none', boxSizing: 'border-box' }}>
        <span>9:41</span>
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ width: 0, height: 0, borderLeft: '11px solid transparent', borderBottom: `11px solid ${ink}` }} />
          <span style={{ width: 7, height: 12, background: ink, borderRadius: 1 }} />
        </span>
      </div>
    );
  }
  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 47, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 30px 0 34px', fontSize: 16, fontWeight: 600, color: ink, pointerEvents: 'none', boxSizing: 'border-box' }}>
      <span>9:41</span>
      <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        <span style={{ display: 'flex', gap: 2, alignItems: 'flex-end' }}>
          {[4, 6, 8, 10].map((h) => (
            <span key={h} style={{ width: 3, height: h, background: ink, borderRadius: 1 }} />
          ))}
        </span>
        <span style={{ width: 24, height: 11, border: `1.5px solid ${ink}`, borderRadius: 3, padding: 1, boxSizing: 'border-box', opacity: 0.9 }}>
          <span style={{ display: 'block', width: '75%', height: '100%', background: ink, borderRadius: 1 }} />
        </span>
      </span>
    </div>
  );
}

function Draw({ node, projectId, inText }: { node: PreviewNode; projectId: string; inText?: boolean }): ReactNode {
  const kids = (n: PreviewNode, text = false) => (n.children ?? []).map((c, i) => <Draw key={i} node={c} projectId={projectId} inText={text} />);
  const style = rnStyleToCss(node.style);
  const title = node.component;
  switch (node.type) {
    case 'raw':
      if (!inText && node.dynamic) return null;
      return node.dynamic ? <DynamicText expression={node.text ?? ''} /> : <>{node.text}</>;
    case 'text':
      return inText ? (
        <span style={style}>{kids(node, true)}</span>
      ) : (
        <div title={title} style={{ ...TEXT_BASE, ...style }}>
          {kids(node, true)}
        </div>
      );
    case 'view': {
      if (node.layout === 'constraints') return <ConstraintBox node={node} projectId={projectId} style={style} />;
      const gradient = node.gradient && node.gradient.colors.length ? gradientCss(node.gradient) : undefined;
      return (
        <div title={title} style={{ ...VIEW_BASE, ...style, ...(gradient ? { backgroundImage: gradient } : {}) }}>
          {kids(node)}
        </div>
      );
    }
    case 'scroll': {
      const content = rnStyleToCss(node.contentStyle);
      return (
        <div title={title} style={{ ...VIEW_BASE, flexGrow: 1, flexShrink: 1, overflow: 'hidden', ...style }}>
          <div style={{ ...VIEW_BASE, flexDirection: node.horizontal ? 'row' : 'column', ...content }}>{kids(node)}</div>
        </div>
      );
    }
    case 'image':
      return <Img node={node} projectId={projectId} style={style} />;
    case 'input': {
      const placeholderColor = typeof node.style?.placeholderColor === 'string' ? node.style.placeholderColor : '#C7C7CD';
      const value = node.value ? (node.secure ? '•'.repeat(Math.min(node.value.length, 12)) : node.value) : '';
      return (
        <div title={title} style={{ ...TEXT_BASE, display: 'flex', alignItems: 'center', minHeight: 20, ...style }}>
          {value ? value : <span style={{ color: placeholderColor }}>{node.placeholder ?? ''}</span>}
        </div>
      );
    }
    case 'icon':
      return <Icon node={node} projectId={projectId} style={style} />;
    case 'spinner': {
      const color = typeof node.style?.color === 'string' ? node.style.color : '#999';
      return <div title={title} style={{ ...VIEW_BASE, width: 20, height: 20, borderRadius: '50%', border: `2.5px solid ${color}`, borderTopColor: 'transparent', alignSelf: 'center', ...style, color: undefined }} />;
    }
    case 'switch':
      return (
        <div title={title} style={{ ...VIEW_BASE, width: 51, height: 31, borderRadius: 16, background: node.checked ? '#34C759' : '#E9E9EB', padding: 2, alignItems: node.checked ? 'flex-end' : 'flex-start', ...style }}>
          <div style={{ width: 27, height: 27, borderRadius: '50%', background: '#fff', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }} />
        </div>
      );
    case 'svg':
      return <SvgRoot node={node} style={style} />;
    case 'placeholder':
      return (
        <div title={title} style={{ ...VIEW_BASE, minWidth: 24, minHeight: 24, alignItems: 'center', justifyContent: 'center', border: '1px dashed #9aa5b8', background: 'rgba(148,163,184,0.12)', color: '#64748b', fontSize: 10, overflow: 'hidden', ...style }}>
          {node.text}
        </div>
      );
  }
}

/** Re-renders when web fonts finish loading (text sizes change). */
function useFontsLoaded(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    document.fonts.addEventListener('loadingdone', bump);
    return () => document.fonts.removeEventListener('loadingdone', bump);
  }, []);
  return tick;
}

const BOX_KEYS = /^(margin|width$|height$|alignSelf|justifySelf|gridArea|flex(Grow|Shrink|Basis)?$|position$|left$|right$|top$|bottom$)/;

/**
 * A ConstraintLayout / RelativeLayout: children are measured (widths, then
 * heights at their solved widths) and placed by the constraint solver.
 */
function ConstraintBox({ node, projectId, style }: { node: PreviewNode; projectId: string; style: CSSProperties }) {
  const box = useRef<HTMLDivElement>(null);
  const items = useRef<Array<HTMLDivElement | null>>([]);
  const kids = node.children ?? [];
  // Children as drawn inside their placed wrappers: without the box keys the solver handles.
  // Kept as the same objects across renders, so nested boxes do not start over.
  const drawn = useMemo(
    () =>
      kids.map((c): PreviewNode => {
        const fills = typeof c.constraint?.height === 'number' || c.constraint?.height === 'parent' || c.constraint?.height === 'match';
        const style = Object.fromEntries(Object.entries(c.style ?? {}).filter(([k]) => !BOX_KEYS.test(k)));
        return { ...c, constraint: undefined, style: fills ? { ...style, flexGrow: 1 } : style };
      }),
    [node],
  );
  const fontsTick = useFontsLoaded();
  type Solved = { x: Span[]; y?: Span[]; heights?: number[]; height?: number; width: number; innerHeight: number };
  const [state, setState] = useState<Solved | null>(null);
  // Re-solving after a size change waits for a new task, so nested boxes settle over a few
  // tasks instead of in one long chain of synchronous updates. (Not animation frames: those
  // pause in hidden windows.)
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
  const later = (next: Solved | null) => {
    clearTimeout(pending.current);
    pending.current = setTimeout(() => setState(next), 0);
  };
  useEffect(() => () => clearTimeout(pending.current), []);
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) first.current = false;
    else later(null);
  }, [node, fontsTick]);
  // Sizes settle in both directions: a parent still measuring gives this box a provisional width,
  // and nested constraint boxes grow after they solve. Solve again when either changes.
  const [, setResized] = useState(0);
  const [observer] = useState(() => new ResizeObserver(() => setResized((n) => n + 1)));
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    observer.observe(el);
    // A nested box that finished solving may have changed height: re-check (see below).
    const onSolved = (e: Event) => {
      if (e.target !== el) setResized((n) => n + 1);
    };
    el.addEventListener('appflow-solved', onSolved);
    return () => {
      observer.disconnect();
      el.removeEventListener('appflow-solved', onSolved);
    };
  }, [observer]);
  useLayoutEffect(() => {
    if (state?.y) box.current?.dispatchEvent(new Event('appflow-solved', { bubbles: true }));
  }, [state]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const pad = (k: string) => parseFloat(cs.getPropertyValue(k)) || 0;
    const width = el.clientWidth - pad('padding-left') - pad('padding-right');
    const innerHeight = el.clientHeight - pad('padding-top') - pad('padding-bottom');
    const childGrew = !!state?.heights && kids.some((c, i) => typeof c.constraint?.height !== 'number' && c.constraint?.height !== 'match' && c.constraint?.height !== 'parent' && Math.abs((items.current[i]?.offsetHeight ?? 0) - state.heights![i]!) > 0.5);
    if (state && Math.abs(state.width - width) > 0.5) {
      later(null);
      return;
    }
    // Heights do not change widths: only the vertical pass is redone.
    if (state?.y && (childGrew || (state.height === undefined && Math.abs(state.innerHeight - innerHeight) > 0.5))) {
      later({ x: state.x, width: state.width, innerHeight });
      return;
    }
    if (!state) {
      const widths = kids.map((_, i) => items.current[i]?.offsetWidth ?? 0);
      setState({ x: solveAxis('h', kids, widths, width), width, innerHeight });
    } else if (!state.y) {
      const heights = kids.map((_, i) => items.current[i]?.offsetHeight ?? 0);
      // Absolutely placed children do not size the box: a collapsed box is wrap_content.
      const wrap = node.wrapHeight ?? innerHeight < 1;
      let y = solveAxis('v', kids, heights, wrap ? undefined : innerHeight);
      let height: number | undefined;
      if (wrap) {
        const h = wrapExtent(kids, heights);
        y = solveAxis('v', kids, heights, h);
        height = h + pad('padding-top') + pad('padding-bottom');
      }
      setState({ ...state, y, heights, height, innerHeight });
    }
  });
  const pl = typeof node.style?.paddingLeft === 'number' ? node.style.paddingLeft : typeof node.style?.padding === 'number' ? node.style.padding : 0;
  const pt = typeof node.style?.paddingTop === 'number' ? node.style.paddingTop : typeof node.style?.padding === 'number' ? node.style.padding : 0;
  return (
    <div ref={box} title={node.component} style={{ ...VIEW_BASE, ...style, position: style.position ?? 'relative', ...(state?.height !== undefined ? { height: state.height } : {}) }}>
      {kids.map((c, i) => {
        if (c.constraint?.guide) return null;
        const fixedHeight = typeof c.constraint?.height === 'number' || c.constraint?.height === 'parent' || c.constraint?.height === 'match';
        const x = state?.x[i];
        const y = state?.y?.[i];
        const wrapper: CSSProperties = { position: 'absolute', left: pl + (x?.pos ?? 0), top: pt + (y?.pos ?? 0), display: 'flex', flexDirection: 'column' };
        if (x) wrapper.width = x.size;
        else {
          // Measuring: content-sized views at their natural width; filling views at the box width,
          // so nested constraint boxes are not measured at zero width.
          const w = c.constraint?.width;
          const margins = (typeof c.style?.marginLeft === 'number' ? c.style.marginLeft : 0) + (typeof c.style?.marginRight === 'number' ? c.style.marginRight : 0);
          wrapper.width = typeof w === 'number' ? w : w === 'wrap' || w === undefined ? 'max-content' : `calc(100% - ${margins}px)`;
          wrapper.maxWidth = '100%';
        }
        if (y && fixedHeight) wrapper.height = y.size;
        else if (typeof c.constraint?.height === 'number') wrapper.height = c.constraint.height;
        return (
          <div key={i} ref={(r) => { items.current[i] = r; if (r) observer.observe(r); }} style={{ ...wrapper, visibility: state?.y ? undefined : 'hidden' }}>
            <Draw node={drawn[i]!} projectId={projectId} />
          </div>
        );
      })}
    </div>
  );
}

/** react-native-svg drawn as SVG: the `Svg` element sizes like a View, the shapes keep their attributes. */
function SvgRoot({ node, style }: { node: PreviewNode; style: CSSProperties }) {
  const attrs = node.svg?.attrs ?? {};
  const size = (v: unknown) => (typeof v === 'number' || typeof v === 'string' ? v : undefined);
  const width = size(attrs.width ?? node.style?.width);
  const height = size(attrs.height ?? node.style?.height);
  const { width: _w, height: _h, ...rest } = attrs;
  return (
    <svg {...rest} width={width} height={height} style={{ ...VIEW_BASE, display: 'block', overflow: 'visible', ...style }}>
      {(node.children ?? []).map((c, i) => (
        <SvgChild key={i} node={c} />
      ))}
    </svg>
  );
}

function SvgChild({ node }: { node: PreviewNode }): ReactNode {
  if (node.type === 'raw') return node.text;
  if (node.type !== 'svg' || !node.svg) return null;
  return createElement(
    node.svg.tag,
    node.svg.attrs,
    (node.children ?? []).map((c, i) => <SvgChild key={i} node={c} />),
  );
}

/** Text that comes from data at runtime: a likely sample value, or a short label; the code is in the tooltip. */
function DynamicText({ expression }: { expression: string }) {
  const sample = sampleOf(expression);
  if (sample !== undefined) return <span title={expression}>{sample}</span>;
  return (
    <span title={expression} style={{ background: 'rgba(148,163,184,0.28)', opacity: 0.75, borderRadius: 3, padding: '0 3px', fontStyle: 'normal' }}>
      {labelOf(expression)}
    </span>
  );
}

/** A realistic value for common kinds of data (dates, times, counts), so text keeps its usual length. */
export function sampleOf(expression: string): string | undefined {
  const call = /\.(getFullYear|getYear|getMonth|getDate|getDay|getHours|getMinutes|getSeconds)\s*\(/.exec(expression)?.[1];
  if (call) return { getFullYear: '2026', getYear: '2026', getMonth: '10', getDate: '21', getDay: '21', getHours: '20', getMinutes: '00', getSeconds: '00' }[call];
  const label = labelOf(expression).toLowerCase();
  if (/(^|_)(date|day)s?$|date|birthday|created_?at|updated_?at/.test(label) && !/time$/.test(label)) return '2026/10/21';
  if (/duration|minutes$|mins?$/.test(label)) return '60';
  if (/time|hour|minute/.test(label)) return '20:00';
  if (/year/.test(label)) return '2026';
  if (/month/.test(label)) return '10';
  if (/(^|_)(num|count|total|point|pt|points|amount|price|fee|coin|coins|views?|likes?|followers?|number|qty|quantity|rank|ranking|balance|revenue)s?($|_)|^(num|count|total|amount|price)/.test(label)) return '1,234';
  if (/(^|_)id$/.test(label)) return '123456';
  return undefined;
}

const NOT_A_LABEL = new Set(['toString', 'toFixed', 'toLocaleString', 'replace', 'replaceAll', 'trim', 'toUpperCase', 'toLowerCase', 'slice', 'substring', 'substr', 'split', 'join', 'map', 'filter', 'format', 'length', 'padStart', 'padEnd', 'charAt', 'includes', 'indexOf', 'concat', 'reverse', 'toISOString', 'toLocaleDateString', 'toLocaleTimeString', 'valueOf', 'item', 'items', 'props', 'route', 'params', 'data', 'value', 'current', 'state', 'this', 'undefined', 'null', 'true', 'false', 'String', 'Number', 'Math', 'moment', 'dayjs', 'i18n', 't', 'g', 'd', 'B']);

/** The most telling name in an expression: `item?.start_time` → start_time, `formatTime(item.end)` → end. */
export function labelOf(expression: string): string {
  const code = expression.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '').replace(/\/(?:\\.|[^/\n])+\/[gimsuy]*/g, '');
  const useful = (n: string) => !NOT_A_LABEL.has(n) && !/^(format|get|set|to|parse|render|is|has)[A-Z_]/.test(n);
  const props = [...code.matchAll(/\.\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]!).filter(useful);
  const names = [...code.matchAll(/[A-Za-z_$][\w$]*/g)].map((m) => m[0]).filter(useful);
  return props[0] ?? names.at(-1) ?? '…';
}

function Img({ node, projectId, style }: { node: PreviewNode; projectId: string; style: CSSProperties }) {
  const path = node.image?.assetPath;
  const [uri, setUri] = useState<string>();
  useEffect(() => {
    if (!path) return;
    let alive = true;
    loadAsset(projectId, path).then(
      (u) => alive && setUri(u),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [projectId, path]);
  const [natural, setNatural] = useState<{ w: number; h: number }>();
  const fit = objectFit(node.image?.resizeMode ?? (typeof node.style?.resizeMode === 'string' ? node.style.resizeMode : undefined));
  const box: CSSProperties = { ...VIEW_BASE, overflow: 'hidden', ...style };
  // A local image without a size shows at its own size (pixels / density), keeping its aspect ratio when one side is set.
  const density = node.image?.density;
  const stretched = node.style?.alignSelf === 'stretch' || node.style?.justifySelf === 'stretch' || !!node.style?.flexGrow;
  if (natural && density && !stretched) {
    const hasW = node.style?.width !== undefined;
    const hasH = node.style?.height !== undefined;
    if (!hasW && !hasH) Object.assign(box, { width: natural.w / density, height: natural.h / density });
    else if (!hasW || !hasH) box.aspectRatio = `${natural.w} / ${natural.h}`;
  }
  if (!uri) {
    // Remote images are not fetched; images still loading show the same neutral tile.
    box.background = box.background ?? box.backgroundColor ?? (node.image?.assetPath ? undefined : '#E5E7EB');
  }
  return (
    <div title={node.component} style={box}>
      {uri && <img src={uri} alt="" draggable={false} onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: fit }} />}
      {(node.children ?? []).map((c, i) => (
        <Draw key={i} node={c} projectId={projectId} />
      ))}
    </div>
  );
}

function Icon({ node, projectId, style }: { node: PreviewNode; projectId: string; style: CSSProperties }) {
  const icon = node.icon!;
  const [family, setFamily] = useState<string | null>();
  useEffect(() => {
    let alive = true;
    void loadIconFont(projectId, icon.set).then((f) => alive && setFamily(f));
    return () => {
      alive = false;
    };
  }, [projectId, icon.set]);
  // Icons are Text in React Native: a zero height (a spacer icon) hides the glyph.
  const base: CSSProperties = { ...VIEW_BASE, width: icon.size, height: icon.size, alignItems: 'center', justifyContent: 'center', fontSize: icon.size, lineHeight: `${icon.size}px`, color: icon.color ?? '#000', overflow: 'hidden', ...style };
  if (!family || icon.glyph === undefined) return <div title={`${icon.set}/${icon.name}`} style={{ ...base, borderRadius: icon.size / 4, background: 'rgba(148,163,184,0.25)' }} />;
  return (
    <div title={`${icon.set}/${icon.name}`} style={{ ...base, fontFamily: family }}>
      {String.fromCodePoint(icon.glyph)}
    </div>
  );
}

function gradientCss(g: NonNullable<PreviewNode['gradient']>): string {
  const start = g.start ?? { x: 0.5, y: 0 };
  const end = g.end ?? { x: 0.5, y: 1 };
  const angle = (Math.atan2(end.x - start.x, -(end.y - start.y)) * 180) / Math.PI;
  return `linear-gradient(${angle}deg, ${g.colors.join(', ')})`;
}
