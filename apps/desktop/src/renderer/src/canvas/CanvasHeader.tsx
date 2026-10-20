import type { EdgeStatus } from '@appflow/model';
import { useReactFlow, useViewport } from '@xyflow/react';
import { MinusIcon, PlusIcon } from '../components/icons';
import { STATUS_META } from '../components/StatusBadge';
import { useExplorer } from '../store';
import { EDGE_COLORS } from './NavEdge';

const ORDER: EdgeStatus[] = ['verified', 'manual', 'declared', 'inferred', 'unresolved'];
const DASH: Record<EdgeStatus, string | undefined> = { verified: undefined, manual: '7 3 2 3', declared: undefined, inferred: '5 4', unresolved: '2 4' };

function ZoomControl() {
  const rf = useReactFlow();
  const { zoom } = useViewport();
  return (
    <div className="flex items-center rounded-lg border border-line bg-panel/95 shadow-xl backdrop-blur">
      <button type="button" aria-label="Zoom out" onClick={() => void rf.zoomOut({ duration: 150 })} className="p-2 text-ink-2 hover:text-white">
        <MinusIcon size={14} />
      </button>
      <button
        type="button"
        title="Reset zoom to 100%"
        onClick={() => void rf.zoomTo(1, { duration: 200 })}
        className="w-12 border-x border-line py-1 text-center text-[12px] text-ink hover:bg-raised"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" aria-label="Zoom in" onClick={() => void rf.zoomIn({ duration: 150 })} className="p-2 text-ink-2 hover:text-white">
        <PlusIcon size={14} />
      </button>
    </div>
  );
}

/** Canvas title, legend and zoom, overlaid on the top of the canvas. */
export function CanvasHeader() {
  const counts = useExplorer((s) => s.index.statusCounts);
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-canvas via-canvas/80 to-transparent px-6 pb-8 pt-4">
        <h1 className="text-[18px] font-semibold text-white">App Flow Map</h1>
        <p className="text-[12.5px] text-ink-2">How screens connect and navigate.</p>
      </div>
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        <div className="flex items-center gap-4 rounded-lg border border-line bg-panel/95 px-3 py-2 text-[11.5px] text-ink-2 shadow-xl backdrop-blur">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-success" /> Start screen
          </span>
          {/* Only the kinds of relationship present in this project. */}
          {ORDER.filter((status) => counts[status] > 0).map((status) => (
            <span key={status} className="flex items-center gap-1.5" title={STATUS_META[status].description}>
              <svg width="22" height="8" aria-hidden>
                <line x1="1" y1="4" x2="21" y2="4" stroke={EDGE_COLORS[status]} strokeWidth="2" strokeDasharray={DASH[status]} strokeLinecap="round" />
              </svg>
              {STATUS_META[status].short}
              <span className="text-muted">{counts[status]}</span>
            </span>
          ))}
        </div>
        <ZoomControl />
      </div>
    </>
  );
}
