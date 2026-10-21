import type { PreviewStyle } from '@appflow/model';
import type { CSSProperties } from 'react';

/**
 * React Native styles as CSS. React Native lays out with flexbox, so a
 * `View` is a flex column with `flex-shrink: 0`, numbers are points (pixels
 * here), and `flex: n` means grow n from a zero basis.
 */

const UNITLESS = new Set(['opacity', 'zIndex', 'flexGrow', 'flexShrink', 'aspectRatio', 'fontWeight']);
const SKIP = new Set(['flex', 'resizeMode', 'tintColor', 'numberOfLines', 'placeholderColor', 'shadowColor', 'shadowOffset', 'shadowOpacity', 'shadowRadius', 'elevation', 'transform', 'textDecorationLine', 'fontFamily', 'includeFontPadding', 'textAlignVertical', 'writingDirection', 'direction', 'backfaceVisibility', 'overlayColor']);
const BOX_SIDES = ['margin', 'padding'] as const;

export const VIEW_BASE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  boxSizing: 'border-box',
  flexShrink: 0,
  alignItems: 'stretch',
  alignContent: 'flex-start',
  minWidth: 0,
  border: '0 solid black',
};

export const TEXT_BASE: CSSProperties = {
  position: 'relative',
  boxSizing: 'border-box',
  flexShrink: 0,
  color: '#000',
  fontSize: 14,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
  border: '0 solid black',
};

const px = (v: string | number) => (typeof v === 'number' ? `${v}px` : v);

export function rnStyleToCss(style: PreviewStyle | undefined): CSSProperties {
  if (!style) return {};
  const css: Record<string, string | number> = {};
  const num = (k: string) => (typeof style[k] === 'number' || typeof style[k] === 'string' ? (style[k] as string | number) : undefined);

  for (const [k, v] of Object.entries(style)) {
    if (SKIP.has(k) || Array.isArray(v)) continue;
    if (/^(margin|padding)(Horizontal|Vertical)$/.test(k)) continue;
    css[k] = typeof v === 'number' && !UNITLESS.has(k) ? `${v}px` : v;
  }
  // margin/padding: shorthand < horizontal/vertical < one side.
  for (const box of BOX_SIDES) {
    const all = num(box);
    const h = num(`${box}Horizontal`);
    const v = num(`${box}Vertical`);
    for (const [side, axis] of [['Top', v], ['Bottom', v], ['Left', h], ['Right', h]] as const) {
      const value = num(`${box}${side}`) ?? axis ?? all;
      if (value !== undefined) css[`${box}${side}`] = px(value);
    }
    delete css[box];
  }
  const flex = style.flex;
  if (typeof flex === 'number') {
    if (flex > 0) Object.assign(css, { flexGrow: flex, flexShrink: 1, flexBasis: '0%' });
    else if (flex === -1) Object.assign(css, { flexGrow: 0, flexShrink: 1 });
    else Object.assign(css, { flexGrow: 0, flexShrink: 0 });
  }
  if (style.flexBasis !== undefined) css.flexBasis = px(style.flexBasis as number);
  if (typeof style.lineHeight === 'number') css.lineHeight = `${style.lineHeight}px`;
  if (typeof style.textDecorationLine === 'string') css.textDecoration = style.textDecorationLine === 'none' ? 'none' : style.textDecorationLine;
  if (typeof style.fontFamily === 'string') {
    css.fontFamily = `"${style.fontFamily}", "Hiragino Sans", "Noto Sans JP", system-ui, -apple-system, "Segoe UI", sans-serif`;
    if (style.fontWeight === undefined) {
      const w = /thin/i.test(style.fontFamily) ? 100 : /extra-?light/i.test(style.fontFamily) ? 200 : /light/i.test(style.fontFamily) ? 300 : /medium/i.test(style.fontFamily) ? 500 : /semi-?bold/i.test(style.fontFamily) ? 600 : /extra-?bold|heavy/i.test(style.fontFamily) ? 800 : /black/i.test(style.fontFamily) ? 900 : /bold/i.test(style.fontFamily) ? 700 : undefined;
      if (w) css.fontWeight = w;
    }
  }
  const transform = transformCss(style.transform);
  if (transform) css.transform = transform;
  const shadow = shadowCss(style);
  if (shadow) css.boxShadow = shadow;
  if (typeof style.numberOfLines === 'number' && style.numberOfLines > 0) {
    Object.assign(css, { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: style.numberOfLines, overflow: 'hidden' });
  }
  if (style.display === 'none') css.display = 'none';
  return css as CSSProperties;
}

function transformCss(t: PreviewStyle[string] | undefined): string | undefined {
  if (!Array.isArray(t)) return undefined;
  const parts: string[] = [];
  for (const item of t) {
    if (typeof item !== 'object') continue;
    for (const [fn, value] of Object.entries(item)) {
      if (/^translate[XY]$/.test(fn)) parts.push(`${fn}(${px(value)})`);
      else if (/^(scale|scale[XY])$/.test(fn)) parts.push(`${fn}(${value})`);
      else if (/^(rotate|rotate[XYZ]|skew[XY])$/.test(fn)) parts.push(`${fn}(${typeof value === 'number' ? `${value}rad` : value})`);
    }
  }
  return parts.join(' ') || undefined;
}

function shadowCss(s: PreviewStyle): string | undefined {
  if (typeof s.elevation === 'number' && s.elevation > 0) {
    const e = s.elevation;
    return `0 ${Math.round(e * 0.5)}px ${Math.round(e * 1.2)}px rgba(0,0,0,${Math.min(0.12 + e * 0.02, 0.35)})`;
  }
  if (typeof s.shadowOpacity !== 'number' || s.shadowOpacity <= 0) return undefined;
  const offset = Array.isArray(s.shadowOffset) && typeof s.shadowOffset[0] === 'object' ? s.shadowOffset[0] : {};
  const color = typeof s.shadowColor === 'string' ? s.shadowColor : '#000';
  const radius = typeof s.shadowRadius === 'number' ? s.shadowRadius : 3;
  return `${Number(offset.width ?? 0)}px ${Number(offset.height ?? 0)}px ${radius}px ${withAlpha(color, s.shadowOpacity)}`;
}

/** `#rrggbb` with an opacity; other colors are returned as they are. */
function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const hex = m[1]!.length === 3 ? m[1]!.split('').map((c) => c + c).join('') : m[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

/** `resizeMode` to `object-fit`. */
export function objectFit(mode: string | undefined): CSSProperties['objectFit'] {
  switch (mode) {
    case 'contain':
      return 'contain';
    case 'stretch':
      return 'fill';
    case 'center':
      return 'none';
    default:
      return 'cover';
  }
}
