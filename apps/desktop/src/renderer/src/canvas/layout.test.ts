import { buildFlowGraph, type AppProject, type FlowGraph } from '@appflow/model';
import { describe, expect, it } from 'vitest';
import { shopliteProject } from '../mock/shoplite/project';
import { computeAutoLayout, mergeLayout, NODE_SIZES, resolveOverlaps, stabilizeLayout, type Positions } from './layout';

const entries = new Set(shopliteProject.screens.filter((s) => s.isEntryPoint).map((s) => s.id));
const flat = (p: AppProject = shopliteProject) => buildFlowGraph(p, { groupByFeature: false, collapseSharedTargets: false });
const grouped = (p: AppProject = shopliteProject) => buildFlowGraph(p, { groupByFeature: true, collapseSharedTargets: true, sharedTargetThreshold: 3 });
const sizeOf = (graph: FlowGraph) => {
  const types = new Map(graph.nodes.map((n) => [n.id, n.type]));
  return (id: string) => NODE_SIZES[types.get(id) ?? 'screen'];
};

function expectNoOverlap(graph: FlowGraph, positions: Positions) {
  const size = sizeOf(graph);
  const boxes = graph.nodes.map((n) => ({ id: n.id, ...positions[n.id]!, ...size(n.id) }));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
    }
  }
}

describe('computeAutoLayout', () => {
  it('positions every screen and placeholder without overlaps', async () => {
    const graph = flat();
    const positions = await computeAutoLayout(graph, entries);
    expect(Object.keys(positions).sort()).toEqual(graph.nodes.map((n) => n.id).sort());
    expectNoOverlap(graph, positions);
  });

  it('places start screens in the first column', async () => {
    const positions = await computeAutoLayout(flat(), entries);
    const minX = Math.min(...Object.values(positions).map((p) => p.x));
    expect(positions['splash']!.x).toBe(minX);
  });

  it('keeps each feature together and features apart', async () => {
    const graph = grouped();
    expect(graph.groups.length).toBeGreaterThan(1);
    const positions = await computeAutoLayout(graph, entries);
    // Boxed and unboxed (single-screen feature) nodes are all placed.
    expect(Object.keys(positions).sort()).toEqual(graph.nodes.map((n) => n.id).sort());
    expect(graph.nodes.length).toBeGreaterThan(graph.groups.flatMap((g) => g.nodeIds).length);
    expectNoOverlap(graph, positions);
    const size = sizeOf(graph);
    const boxes = graph.groups.map((g) => {
      const xs = g.nodeIds.map((id) => positions[id]!.x);
      const ys = g.nodeIds.map((id) => positions[id]!.y);
      return {
        id: g.id,
        x: Math.min(...xs),
        y: Math.min(...ys),
        right: Math.max(...g.nodeIds.map((id) => positions[id]!.x + size(id).width)),
        bottom: Math.max(...g.nodeIds.map((id) => positions[id]!.y + size(id).height)),
      };
    });
    for (const a of boxes) {
      for (const b of boxes) {
        if (a === b) continue;
        const overlap = a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
        expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it('is deterministic: same graph, same picture, whatever the input order', async () => {
    const reversed = { ...shopliteProject, screens: [...shopliteProject.screens].reverse(), edges: [...shopliteProject.edges].reverse() };
    expect(await computeAutoLayout(grouped(reversed), entries)).toEqual(await computeAutoLayout(grouped(), entries));
    expect(await computeAutoLayout(flat(), entries)).toEqual(await computeAutoLayout(flat(), entries));
  });
});

describe('mergeLayout', () => {
  it('prefers pinned positions and drops stale ones', () => {
    const merged = mergeLayout(
      { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      { b: { x: 99, y: 99 }, gone: { x: 1, y: 1 } },
    );
    expect(merged).toEqual({ a: { x: 0, y: 0 }, b: { x: 99, y: 99 } });
  });
});

describe('resolveOverlaps', () => {
  it('moves only nodes that are not fixed', () => {
    const size = () => ({ width: 100, height: 100 });
    const result = resolveOverlaps({ pinned: { x: 0, y: 0 }, auto: { x: 50, y: 50 }, far: { x: 500, y: 0 } }, size, new Set(['pinned']));
    expect(result['pinned']).toEqual({ x: 0, y: 0 });
    expect(result['far']).toEqual({ x: 500, y: 0 });
    expect(result['auto']!.x).toBe(50);
    expect(result['auto']!.y).toBeGreaterThanOrEqual(100);
  });
});

describe('re-analysis layout stability', () => {
  /** The same app after a code change: one screen removed, one added next to the cart. */
  function changed(): AppProject {
    const screens = shopliteProject.screens.filter((s) => s.id !== 'search');
    const wishlist = { ...shopliteProject.screens.find((s) => s.id === 'cart')!, id: 'wishlist', name: 'Wishlist', widgetClass: 'WishlistScreen', isEntryPoint: false };
    const edges = shopliteProject.edges.filter((e) => e.from !== 'search' && e.to !== 'search');
    const fromCart = edges.find((e) => e.from === 'cart' && e.to !== null)!;
    return { ...shopliteProject, screens: [...screens, wishlist], edges: [...edges, { ...fromCart, id: 'cart->wishlist:push', to: 'wishlist' }] };
  }

  it('keeps every surviving node where it was, including manual moves, and places new nodes without overlap', async () => {
    const before = flat();
    const previous = await computeAutoLayout(before, entries);
    const pinned = { home: { x: -2000, y: -2000 } };
    previous['home'] = pinned.home;

    const after = flat(changed());
    const auto = await computeAutoLayout(after, entries);
    const positions = stabilizeLayout(previous, auto, after, pinned, sizeOf(after));

    for (const n of after.nodes) {
      if (n.id in previous) expect(positions[n.id], n.id).toEqual(previous[n.id]);
    }
    expect(positions['home']).toEqual(pinned.home);
    expect(positions['search']).toBeUndefined();
    expect(positions['wishlist']).toBeDefined();
    // Placed next to the screen it is reached from.
    expect(positions['wishlist']!.x).toBeGreaterThan(previous['cart']!.x);
    expectNoOverlap(after, positions);
  });

  it('changes nothing when re-analysis returns the same graph', async () => {
    const graph = grouped();
    const previous = await computeAutoLayout(graph, entries);
    expect(stabilizeLayout(previous, previous, grouped(), {}, sizeOf(graph))).toEqual(previous);
  });
});
