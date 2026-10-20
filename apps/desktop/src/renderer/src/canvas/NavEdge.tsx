import type { EdgeStatus, NavigationKind } from '@appflow/model';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useStore,
  type Edge,
  type EdgeProps,
  type ReactFlowState,
} from '@xyflow/react';
import { memo } from 'react';

export interface NavEdgeData extends Record<string, unknown> {
  status: EdgeStatus;
  kind: NavigationKind;
  label: string;
  emphasized: boolean;
}

export type NavFlowEdge = Edge<NavEdgeData, 'nav'>;

/** Hex values (not CSS vars) because they are also used for SVG marker ids. */
export const EDGE_COLORS: Record<EdgeStatus, string> = {
  verified: '#60a5fa',
  declared: '#c4b5fd',
  inferred: '#a9bce6',
  unresolved: '#fbbf24',
};

const DASH: Record<EdgeStatus, string | undefined> = {
  verified: undefined,
  declared: undefined,
  inferred: '8 5',
  unresolved: '2 6',
};

/** Below this zoom, labels are unreadable and only add noise. */
const selectLabelsVisible = (s: ReactFlowState) => s.transform[2] >= 0.38;

export const NavEdge = memo(function NavEdge(props: EdgeProps<NavFlowEdge>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected, data } = props;
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 14,
    offset: 28,
  });
  const labelsVisible = useStore(selectLabelsVisible);
  if (!data) return null;
  const color = selected ? '#93c5fd' : EDGE_COLORS[data.status];
  const strong = selected || data.emphasized;

  return (
    <>
      <BaseEdge
        path={path}
        markerEnd={markerEnd}
        interactionWidth={18}
        style={{
          stroke: color,
          strokeWidth: selected ? 3.25 : data.emphasized ? 2.75 : 2.25,
          // Keep lines readable when zoomed out to see a large map.
          vectorEffect: 'non-scaling-stroke',
          strokeDasharray: DASH[data.status],
          strokeLinecap: 'round',
          filter: selected ? 'drop-shadow(0 0 4px rgb(59 130 246 / 0.6))' : undefined,
        }}
      />
      {(labelsVisible || selected) && (
        <EdgeLabelRenderer>
          <div
            className={`nodrag nopan pointer-events-none absolute max-w-[180px] truncate rounded-md border px-2 py-0.5 text-[11.5px] font-medium ${
              strong ? 'bg-panel text-white shadow-lg' : 'bg-panel/95 text-[#c7d6f5]'
            }`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              borderColor: strong ? `${color}aa` : 'transparent',
            }}
          >
            {data.kind === 'modal' && <span className="mr-1 text-[10px] uppercase text-muted">modal</span>}
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
