import { visibleFlow } from '@appflow/model';
import { useReactFlow } from '@xyflow/react';
import { useCallback } from 'react';
import { useExplorer } from '../store';
import { GROUP_PADDING, NODE_SIZES } from './layout';

/**
 * Fits every visible node in view. Bounds come from the layout positions and
 * known node sizes, so the result does not depend on React Flow having
 * measured the nodes yet (feature boxes render a frame after their screens).
 */
export function useFitAll() {
  const rf = useReactFlow();
  return useCallback(
    (duration = 0) => {
      const { graph, positions, project, filters } = useExplorer.getState();
      const visible = visibleFlow(graph, project, filters);
      const types = new Map(graph.nodes.map((n) => [n.id, n.type]));
      const boxes = [...visible.nodeIds].filter((id) => positions[id]).map((id) => ({ ...positions[id]!, ...NODE_SIZES[types.get(id) ?? 'screen'] }));
      if (!boxes.length) return;
      const pad = graph.groups.length ? GROUP_PADDING.top : 0;
      const x = Math.min(...boxes.map((b) => b.x)) - pad;
      const y = Math.min(...boxes.map((b) => b.y)) - pad;
      const right = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
      const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
      // Extra room at the top for the canvas title and legend, at the bottom for the toolbars.
      const h = bottom - y;
      void rf.fitBounds({ x, y: y - h * 0.08, width: right - x, height: h * 1.16 }, { padding: 0.04, duration });
    },
    [rf],
  );
}
