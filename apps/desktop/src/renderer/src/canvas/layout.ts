import type { AppProject } from '@appflow/model';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';

export interface XY {
  x: number;
  y: number;
}

export type Positions = Record<string, XY>;

/** Size of a screen node (header + phone frame). Keep in sync with PhoneNode styles. */
export const PHONE_NODE_SIZE = { width: 220, height: 512 } as const;
/** Size of the placeholder node standing in for an unknown navigation target. */
export const UNRESOLVED_NODE_SIZE = { width: 180, height: 92 } as const;

export const unresolvedNodeId = (edgeId: string): string => `unresolved:${edgeId}`;

const elk = new ELK();

/**
 * Arranges screens left-to-right following navigation flow, starting from entry points.
 * Unresolved edges get their own placeholder node so they stay visible.
 */
export async function computeAutoLayout(project: AppProject): Promise<Positions> {
  const children = project.screens.map((screen): ElkNode => ({
    id: screen.id,
    ...PHONE_NODE_SIZE,
    layoutOptions: screen.isEntryPoint ? { 'elk.layered.layering.layerConstraint': 'FIRST' } : {},
  }));
  const edges = project.edges.map((edge) => {
    const target = edge.to ?? unresolvedNodeId(edge.id);
    if (edge.to === null) children.push({ id: target, ...UNRESOLVED_NODE_SIZE });
    return { id: edge.id, sources: [edge.from], targets: [target] };
  });

  const graph = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'SPLINES',
      'elk.layered.spacing.nodeNodeBetweenLayers': '150',
      'elk.spacing.nodeNode': '56',
      'elk.spacing.componentComponent': '120',
      'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    },
    children,
    edges,
  });

  const positions: Positions = {};
  for (const child of graph.children ?? []) {
    positions[child.id] = { x: child.x ?? 0, y: child.y ?? 0 };
  }
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

/** Fit-to-view padding that keeps screens clear of the canvas header and toolbars. */
export const FIT_PADDING = { top: '96px', bottom: '64px', left: '40px', right: '40px' } as const;
