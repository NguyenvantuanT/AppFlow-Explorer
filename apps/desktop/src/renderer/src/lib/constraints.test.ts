import type { PreviewConstraint, PreviewNode } from '@appflow/model';
import { describe, expect, it } from 'vitest';
import { solveAxis, wrapExtent } from './constraints';

const child = (constraint: Partial<PreviewConstraint>, style: PreviewNode['style'] = {}): PreviewNode => ({ type: 'view', style, constraint: { width: 'wrap', height: 'wrap', ...constraint } });

describe('constraint solver', () => {
  it('places views against the parent: start, end, centered with bias, filling with margins', () => {
    const kids = [
      child({ left: { to: 'parent', edge: 'left' } }, { marginLeft: 8 }),
      child({ right: { to: 'parent', edge: 'right' } }, { marginRight: 8 }),
      child({ left: { to: 'parent', edge: 'left' }, right: { to: 'parent', edge: 'right' } }),
      child({ left: { to: 'parent', edge: 'left' }, right: { to: 'parent', edge: 'right' }, hBias: 0.25 }),
      child({ width: 'parent' }, { marginLeft: 10, marginRight: 20 }),
    ];
    expect(solveAxis('h', kids, [40, 40, 40, 40, 0], 200)).toEqual([
      { pos: 8, size: 40 },
      { pos: 152, size: 40 },
      { pos: 80, size: 40 },
      { pos: 40, size: 40 },
      { pos: 10, size: 170 },
    ]);
  });

  it('follows siblings and guidelines, and fills between anchors for 0dp (match)', () => {
    const kids = [
      child({ id: 'avatar', width: 36, left: { to: 'parent', edge: 'left' } }),
      child({ id: 'name', width: 'match', left: { to: 'avatar', edge: 'right' }, right: { to: 'half', edge: 'left' } }, { marginLeft: 8 }),
      child({ id: 'half', guide: { orientation: 'vertical', percent: 0.5 } }),
    ];
    expect(solveAxis('h', kids, [36, 50, 0], 300)).toEqual([
      { pos: 0, size: 36 },
      { pos: 44, size: 106 },
      { pos: 150, size: 0 },
    ]);
  });

  it('drops references in a cycle (chains) and to missing views instead of failing', () => {
    const kids = [
      child({ id: 'a', right: { to: 'b', edge: 'left' } }),
      child({ id: 'b', left: { to: 'a', edge: 'right' } }),
      child({ id: 'c', top: { to: 'gone', edge: 'bottom' } }),
    ];
    const spans = solveAxis('h', kids, [20, 30, 10], 100);
    expect(spans.every((s) => Number.isFinite(s.pos))).toBe(true);
    expect(solveAxis('v', kids, [10, 10, 10], 100)[2]).toEqual({ pos: 0, size: 10 });
  });

  it('sizes a wrap_content box for its content plus a footer tied to its bottom', () => {
    const kids = [
      child({ id: 'header', top: { to: 'parent', edge: 'top' } }),
      child({ id: 'body', top: { to: 'header', edge: 'bottom' }, bottom: { to: 'footer', edge: 'top' } }, { marginTop: 4 }),
      child({ id: 'footer', bottom: { to: 'parent', edge: 'bottom' } }, { marginBottom: 6 }),
    ];
    const heights = [50, 100, 30];
    const total = wrapExtent(kids, heights);
    expect(total).toBe(50 + 4 + 100 + 30 + 6);
    expect(solveAxis('v', kids, heights, total)).toEqual([
      { pos: 0, size: 50 },
      { pos: 54, size: 100 },
      { pos: 154, size: 30 },
    ]);
  });
});
