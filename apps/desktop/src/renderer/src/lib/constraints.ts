import type { PreviewAnchor, PreviewConstraint, PreviewNode } from '@appflow/model';

/**
 * Places the children of a ConstraintLayout or RelativeLayout along one axis.
 * Children are resolved once the siblings they refer to are; references in a
 * cycle (chains) or to missing views are dropped, so every child gets a place.
 */

export interface Span {
  pos: number;
  size: number;
}

type Axis = 'h' | 'v';

const num = (v: unknown) => (typeof v === 'number' ? v : 0);

export function solveAxis(axis: Axis, children: PreviewNode[], measured: number[], extent: number | undefined, ignore: Set<string> = new Set()): Span[] {
  const out: Array<Span | undefined> = children.map(() => undefined);
  const ids = new Map<string, number>();
  children.forEach((c, i) => c.constraint?.id && !ignore.has(c.constraint.id) && ids.set(c.constraint.id, i));

  const edge = (a: PreviewAnchor | undefined, strict: boolean): number | null | undefined => {
    // undefined: no anchor; null: not resolved yet.
    if (!a) return undefined;
    if (a.to === 'parent') {
      if (a.edge === 'left' || a.edge === 'top') return 0;
      if (extent === undefined) return undefined;
      return a.edge === 'centerX' || a.edge === 'centerY' ? extent / 2 : extent;
    }
    const i = ids.get(a.to);
    if (i === undefined) return undefined;
    const s = out[i];
    if (!s) return strict ? null : undefined;
    if (a.edge === 'left' || a.edge === 'top') return s.pos;
    if (a.edge === 'right' || a.edge === 'bottom') return s.pos + s.size;
    return s.pos + s.size / 2;
  };

  const place = (i: number, strict: boolean): boolean => {
    const c: PreviewConstraint = children[i]!.constraint ?? { width: 'wrap', height: 'wrap' };
    const style = children[i]!.style ?? {};
    const m1 = num(axis === 'h' ? style.marginLeft : style.marginTop);
    const m2 = num(axis === 'h' ? style.marginRight : style.marginBottom);
    if (c.guide) {
      const along = (c.guide.orientation === 'vertical') === (axis === 'h');
      const total = extent ?? 0;
      const pos = !along ? 0 : c.guide.percent !== undefined ? c.guide.percent * total : c.guide.begin !== undefined ? c.guide.begin : total - (c.guide.end ?? 0);
      out[i] = { pos, size: 0 };
      return true;
    }
    const e1 = edge(axis === 'h' ? c.left : c.top, strict);
    const e2 = edge(axis === 'h' ? c.right : c.bottom, strict);
    if (e1 === null || e2 === null) return false;
    const kind = axis === 'h' ? c.width : c.height;
    let size: number;
    if (typeof kind === 'number') size = kind;
    else if (kind === 'parent') size = extent !== undefined ? extent - m1 - m2 : measured[i]!;
    else if (kind === 'match' && e1 !== undefined && e2 !== undefined) size = Math.max(0, e2 - m2 - (e1 + m1));
    else size = measured[i]!;
    const bias = (axis === 'h' ? c.hBias : c.vBias) ?? 0.5;
    let pos: number;
    if (kind === 'parent') pos = m1;
    else if (e1 !== undefined && e2 !== undefined) pos = e1 + m1 + (e2 - m2 - (e1 + m1) - size) * bias;
    else if (e1 !== undefined) pos = e1 + m1;
    else if (e2 !== undefined) pos = e2 - m2 - size;
    else pos = m1;
    out[i] = { pos, size };
    return true;
  };

  for (let pass = 0; pass <= children.length && out.some((s) => !s); pass++) {
    let progress = false;
    children.forEach((_, i) => {
      if (!out[i] && place(i, true)) progress = true;
    });
    if (!progress) break;
  }
  children.forEach((_, i) => out[i] ?? place(i, false));
  return out as Span[];
}

/**
 * Height a wrap_content container needs: the children placed from the top,
 * plus the children tied only to its bottom (a footer), which sit below them.
 */
export function wrapExtent(children: PreviewNode[], measured: number[]): number {
  const bottomOnly = children.map((c) => !c.constraint?.guide && !c.constraint?.top && c.constraint?.bottom?.to === 'parent');
  const ignore = new Set(children.filter((c, i) => bottomOnly[i] && c.constraint?.id).map((c) => c.constraint!.id!));
  const spans = solveAxis('v', children, measured, undefined, ignore);
  let max = 0;
  let footers = 0;
  children.forEach((c, i) => {
    if (c.constraint?.guide) return;
    if (bottomOnly[i]) footers += measured[i]! + num(c.style?.marginTop) + num(c.style?.marginBottom);
    else max = Math.max(max, spans[i]!.pos + spans[i]!.size + num(c.style?.marginBottom));
  });
  return max + footers;
}
