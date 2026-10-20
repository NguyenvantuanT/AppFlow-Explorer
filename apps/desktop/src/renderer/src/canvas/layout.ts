import type { FlowGraph, FlowNodeType } from '@appflow/model';
import ELK, { type ElkExtendedEdge, type ElkNode } from 'elkjs/lib/elk.bundled.js';

export interface XY {
  x: number;
  y: number;
}

export type Positions = Record<string, XY>;

export interface Size {
  width: number;
  height: number;
}

/** Size of a screen node (header + phone frame). Keep in sync with PhoneNode styles. */
export const PHONE_NODE_SIZE = { width: 220, height: 512 } as const;
/** Size of the placeholder node standing in for an unknown navigation target. */
export const UNRESOLVED_NODE_SIZE = { width: 180, height: 92 } as const;
/** Size of a reference to a destination drawn elsewhere on the map. */
export const ALIAS_NODE_SIZE = { width: 180, height: 64 } as const;

export const NODE_SIZES: Record<FlowNodeType, Size> = { screen: PHONE_NODE_SIZE, unresolved: UNRESOLVED_NODE_SIZE, alias: ALIAS_NODE_SIZE };

/** Space between a feature group's border and its screens; the top includes the title. */
export const GROUP_PADDING = { top: 56, side: 28, bottom: 28 } as const;

const GAP = 48;

const elk = new ELK();

const LAYERED = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.layered.spacing.nodeNodeBetweenLayers': '150',
  'elk.spacing.nodeNode': '56',
  'elk.spacing.componentComponent': '120',
  'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.thoroughness': '20',
} as const;

/**
 * Arranges the map left-to-right following navigation, start screens first.
 * With feature groups, each group's screens are kept together in one box
 * (ELK compound layout). Returns absolute top-left positions.
 */
export async function computeAutoLayout(graph: FlowGraph, entryIds: ReadonlySet<string> = new Set()): Promise<Positions> {
  const nodes = [...graph.nodes].sort((a, b) => (a.id < b.id ? -1 : 1));
  const edges = [...graph.edges].sort((a, b) => (a.id < b.id ? -1 : 1));
  const leaf = (n: (typeof nodes)[number], constrain: boolean): ElkNode => ({
    id: n.id,
    ...NODE_SIZES[n.type],
    layoutOptions: constrain && entryIds.has(n.id) ? { 'elk.layered.layering.layerConstraint': 'FIRST' } : {},
  });
  const elkEdges: ElkExtendedEdge[] = edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] }));

  let root: ElkNode;
  if (graph.groups.length) {
    const groupOf = new Map<string, string>();
    for (const g of graph.groups) for (const id of g.nodeIds) groupOf.set(id, g.id);
    root = {
      id: 'root',
      layoutOptions: { ...LAYERED, 'elk.hierarchyHandling': 'INCLUDE_CHILDREN', 'elk.spacing.componentComponent': '160' },
      children: [
        ...graph.groups.map((g) => ({
          id: g.id,
          layoutOptions: {
            ...LAYERED,
            'elk.padding': `[top=${GROUP_PADDING.top},left=${GROUP_PADDING.side},bottom=${GROUP_PADDING.bottom},right=${GROUP_PADDING.side}]`,
          },
          children: nodes.filter((n) => groupOf.get(n.id) === g.id).map((n) => leaf(n, false)),
        })),
        // Screens of single-screen features are not boxed.
        ...nodes.filter((n) => !groupOf.has(n.id)).map((n) => leaf(n, true)),
      ],
      edges: elkEdges,
    };
  } else {
    // Keep the (sorted) input order where it costs no crossings. Not used with groups:
    // ELK's compound layout fails with this option.
    root = { id: 'root', layoutOptions: { ...LAYERED, 'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES' }, children: nodes.map((n) => leaf(n, true)), edges: elkEdges };
  }

  const laid = await elk.layout(root);
  const positions: Positions = {};
  const collect = (node: ElkNode, ox: number, oy: number) => {
    for (const child of node.children ?? []) {
      const x = ox + (child.x ?? 0);
      const y = oy + (child.y ?? 0);
      if (child.children?.length) collect(child, x, y);
      else positions[child.id] = { x, y };
    }
  };
  collect(laid, 0, 0);
  return positions;
}

/**
 * Manual positions win over the automatic layout; stale entries for nodes that
 * no longer exist (e.g. after re-analysis) are ignored.
 */
export function mergeLayout(auto: Positions, pinned: Positions): Positions {
  const merged: Positions = { ...auto };
  for (const [id, pos] of Object.entries(pinned)) {
    if (id in auto) merged[id] = pos;
  }
  return merged;
}

const overlaps = (a: XY & Size, b: XY & Size, gap = 0) =>
  a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;

/**
 * Moves nodes that are not fixed down until they no longer overlap anything.
 * Fixed nodes (moved by hand, or kept from the previous layout) never move.
 */
export function resolveOverlaps(positions: Positions, sizeOf: (id: string) => Size, fixed: ReadonlySet<string>): Positions {
  const result: Positions = { ...positions };
  const settled: Array<XY & Size & { id: string }> = [];
  const box = (id: string) => ({ id, ...result[id]!, ...sizeOf(id) });
  for (const id of Object.keys(result).filter((id) => fixed.has(id))) settled.push(box(id));
  const movable = Object.keys(result)
    .filter((id) => !fixed.has(id))
    .sort((a, b) => result[a]!.x - result[b]!.x || result[a]!.y - result[b]!.y || (a < b ? -1 : 1));
  for (const id of movable) {
    const b = box(id);
    for (let guard = 0; guard < 500; guard++) {
      const hit = settled.find((s) => overlaps(b, s, GAP / 2));
      if (!hit) break;
      b.y = hit.y + hit.height + GAP;
    }
    result[id] = { x: b.x, y: b.y };
    settled.push(b);
  }
  return result;
}

/**
 * Layout after re-analysis: every node that still exists keeps where it was
 * (whether placed by hand or automatically), so the map does not jump. New
 * nodes go next to a neighbor that already has a place, and never on top of
 * existing nodes.
 */
export function stabilizeLayout(previous: Positions, auto: Positions, graph: FlowGraph, pinned: Positions, sizeOf: (id: string) => Size): Positions {
  const result: Positions = {};
  const fixed = new Set<string>();
  const newIds: string[] = [];
  for (const n of graph.nodes) {
    const kept = pinned[n.id] ?? previous[n.id];
    if (kept) {
      result[n.id] = kept;
      fixed.add(n.id);
    } else {
      newIds.push(n.id);
    }
  }
  if (!newIds.length) return result;

  const keptBoxes = [...fixed].map((id) => ({ ...result[id]!, ...sizeOf(id) }));
  const bottom = keptBoxes.length ? Math.max(...keptBoxes.map((b) => b.y + b.height)) : 0;
  const left = keptBoxes.length ? Math.min(...keptBoxes.map((b) => b.x)) : 0;
  const autoTop = Math.min(...newIds.map((id) => auto[id]?.y ?? 0));
  const autoLeft = Math.min(...newIds.map((id) => auto[id]?.x ?? 0));

  const sorted = [...newIds].sort();
  // Place in passes so chains of new nodes anchor on each other.
  for (let pass = 0; pass < sorted.length && sorted.some((id) => !result[id]); pass++) {
    for (const id of sorted) {
      if (result[id]) continue;
      const size = sizeOf(id);
      const incoming = graph.edges.find((e) => e.target === id && result[e.source]);
      const outgoing = graph.edges.find((e) => e.source === id && result[e.target]);
      if (incoming) {
        const a = result[incoming.source]!;
        result[id] = { x: a.x + sizeOf(incoming.source).width + 150, y: a.y };
      } else if (outgoing) {
        const a = result[outgoing.target]!;
        result[id] = { x: a.x - size.width - 150, y: a.y };
      } else if (pass === sorted.length - 1 || !sorted.some((o) => o !== id && !result[o] && graph.edges.some((e) => (e.source === o && e.target === id) || (e.target === o && e.source === id)))) {
        // Unconnected to anything placed: below the existing map, keeping the auto layout's arrangement.
        const a = auto[id] ?? { x: autoLeft, y: autoTop };
        result[id] = { x: left + (a.x - autoLeft), y: bottom + 160 + (a.y - autoTop) };
      }
    }
  }
  return resolveOverlaps(result, sizeOf, fixed);
}

