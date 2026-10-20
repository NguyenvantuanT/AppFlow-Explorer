import { useReactFlow } from '@xyflow/react';
import type { ReactNode } from 'react';
import { FitIcon, LayoutIcon } from '../components/icons';
import { useExplorer } from '../store';
import { FIT_PADDING } from './layout';

function ToolButton({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] text-ink-2 hover:bg-raised hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

export function CanvasControls() {
  const rf = useReactFlow();
  const pinnedCount = useExplorer((s) => Object.keys(s.pinned).length);
  const layoutStatus = useExplorer((s) => s.layoutStatus);
  const resetLayout = useExplorer((s) => s.resetLayout);

  return (
    <div className="absolute bottom-4 left-4 z-10 flex items-center gap-0.5 rounded-lg border border-line bg-panel/95 p-1 shadow-xl backdrop-blur">
      <ToolButton label="Fit all screens in view" onClick={() => void rf.fitView({ padding: FIT_PADDING, duration: 300 })}>
        <FitIcon size={15} /> Fit
      </ToolButton>
      <div className="mx-0.5 h-5 w-px bg-line" />
      <ToolButton
        label={pinnedCount ? `Re-arrange all screens (resets ${pinnedCount} moved)` : 'Re-arrange all screens'}
        disabled={layoutStatus === 'computing'}
        onClick={() => void resetLayout()}
      >
        <LayoutIcon size={15} /> Auto layout
      </ToolButton>
    </div>
  );
}
