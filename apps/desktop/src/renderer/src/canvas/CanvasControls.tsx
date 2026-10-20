import { ALL_STATUSES, defaultFilters, featureLabel, type EdgeStatus, type ScreenKind } from '@appflow/model';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FilterIcon, FitIcon, LayoutIcon } from '../components/icons';
import { STATUS_META } from '../components/StatusBadge';
import { useExplorer } from '../store';
import { useFitAll } from './useFitAll';

function ToolButton({ label, onClick, children, disabled, active }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean; active?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] hover:bg-raised hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent ${active ? 'bg-raised text-ink' : 'text-ink-2'}`}
    >
      {children}
    </button>
  );
}

function Check({ checked, onChange, children, count }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; count?: number }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-raised">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[#3b82f6]" />
      <span className="min-w-0 flex-1 truncate text-ink">{children}</span>
      {count !== undefined && <span className="font-mono text-[10.5px] text-muted">{count}</span>}
    </label>
  );
}

const KIND_LABEL: Record<ScreenKind, string> = { page: 'Pages', dialog: 'Dialogs', bottomSheet: 'Bottom sheets' };

function FilterMenu({ onClose }: { onClose: () => void }) {
  const filters = useExplorer((s) => s.filters);
  const setFilters = useExplorer((s) => s.setFilters);
  const resetFilters = useExplorer((s) => s.resetFilters);
  const view = useExplorer((s) => s.view);
  const setView = useExplorer((s) => s.setView);
  const counts = useExplorer((s) => s.index.statusCounts);
  const graph = useExplorer((s) => s.graph);
  const screens = useExplorer((s) => s.project.screens);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element;
      // The toolbar button toggles the menu itself.
      if (ref.current?.contains(target) || target.closest?.('[data-filter-toggle]')) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const features = useMemo(() => {
    const byFeature = new Map<string, number>();
    for (const n of graph.nodes) if (n.type === 'screen') byFeature.set(n.feature, (byFeature.get(n.feature) ?? 0) + 1);
    return [...byFeature].sort(([a], [b]) => a.localeCompare(b));
  }, [graph]);
  const kindCounts = useMemo(() => {
    const c: Record<ScreenKind, number> = { page: 0, dialog: 0, bottomSheet: 0 };
    for (const s of screens) c[s.kind]++;
    return c;
  }, [screens]);

  const toggle = <T,>(list: T[], value: T, on: boolean) => (on ? [...list, value] : list.filter((v) => v !== value));

  return (
    <div ref={ref} className="absolute bottom-12 left-0 w-[280px] rounded-lg border border-line bg-panel/98 p-3 text-[12px] shadow-2xl backdrop-blur" data-testid="filter-menu">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Connections</div>
      {ALL_STATUSES.filter((s) => counts[s] > 0).map((status: EdgeStatus) => (
        <Check key={status} checked={filters.statuses.includes(status)} count={counts[status]} onChange={(on) => setFilters({ statuses: toggle(filters.statuses, status, on) })}>
          {STATUS_META[status].label}
        </Check>
      ))}

      <div className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Screens</div>
      {(Object.keys(KIND_LABEL) as ScreenKind[])
        .filter((k) => kindCounts[k] > 0)
        .map((kind) => (
          <Check key={kind} checked={filters.screenKinds.includes(kind)} count={kindCounts[kind]} onChange={(on) => setFilters({ screenKinds: toggle(filters.screenKinds, kind, on) })}>
            {KIND_LABEL[kind]}
          </Check>
        ))}
      <Check checked={filters.hideIsolated} onChange={(on) => setFilters({ hideIsolated: on })}>
        Hide screens without visible connections
      </Check>

      {features.length > 1 && (
        <>
          <div className="mb-1 mt-3 flex items-center text-[11px] font-semibold uppercase tracking-wider text-muted">
            Features
            <button type="button" className="ml-auto text-[10.5px] normal-case text-primary hover:underline" onClick={() => setFilters({ hiddenFeatures: filters.hiddenFeatures.length ? [] : features.map(([f]) => f) })}>
              {filters.hiddenFeatures.length ? 'Show all' : 'Hide all'}
            </button>
          </div>
          <div className="max-h-[180px] overflow-y-auto">
            {features.map(([feature, n]) => (
              <Check key={feature} checked={!filters.hiddenFeatures.includes(feature)} count={n} onChange={(on) => setFilters({ hiddenFeatures: toggle(filters.hiddenFeatures, feature, !on) })}>
                {featureLabel(feature)}
              </Check>
            ))}
          </div>
        </>
      )}

      <div className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Arrangement</div>
      <Check checked={view.groupByFeature} onChange={(on) => void setView({ groupByFeature: on })}>
        Group screens by feature
      </Check>
      <Check checked={view.collapseSharedTargets} onChange={(on) => void setView({ collapseSharedTargets: on })}>
        Draw shared destinations once
      </Check>

      <button
        type="button"
        onClick={resetFilters}
        disabled={JSON.stringify(filters) === JSON.stringify(defaultFilters())}
        className="mt-3 w-full rounded-md border border-line-strong py-1.5 text-ink-2 hover:bg-raised hover:text-ink disabled:opacity-40"
      >
        Reset filters
      </button>
    </div>
  );
}

export function CanvasControls() {
  const fitAll = useFitAll();
  const pinnedCount = useExplorer((s) => Object.keys(s.pinned).length);
  const layoutStatus = useExplorer((s) => s.layoutStatus);
  const resetLayout = useExplorer((s) => s.resetLayout);
  const filtersActive = useExplorer((s) => JSON.stringify(s.filters) !== JSON.stringify(defaultFilters()));
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="absolute bottom-4 left-4 z-10">
      {menuOpen && <FilterMenu onClose={() => setMenuOpen(false)} />}
      <div className="flex items-center gap-0.5 rounded-lg border border-line bg-panel/95 p-1 shadow-xl backdrop-blur">
        <ToolButton label="Fit all screens in view" onClick={() => fitAll(300)}>
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
        <div className="mx-0.5 h-5 w-px bg-line" />
        <span data-filter-toggle>
          <ToolButton label="Filter and arrange the map" active={menuOpen || filtersActive} onClick={() => setMenuOpen((v) => !v)}>
            <FilterIcon size={14} /> Filters
            {filtersActive && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
          </ToolButton>
        </span>
      </div>
    </div>
  );
}
