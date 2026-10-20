import { emptyCorrections, type GraphCorrections, type ManualEdge, type NavigationKind } from '@appflow/model';
import type { Positions } from './layout';

const key = (projectId: string) => `appflow:layout:${projectId}:v1`;
const correctionsKey = (projectId: string) => `appflow:corrections:${projectId}:v1`;
const viewKey = 'appflow:view:v1';

/** Loads manually placed node positions. Storage failures degrade to "no saved layout". */
export function loadPinnedLayout(projectId: string): Positions {
  try {
    const raw = localStorage.getItem(key(projectId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const result: Positions = {};
    for (const [id, value] of Object.entries(parsed)) {
      const { x, y } = (value ?? {}) as Partial<Record<'x' | 'y', unknown>>;
      if (typeof x === 'number' && typeof y === 'number') result[id] = { x, y };
    }
    return result;
  } catch {
    return {};
  }
}

export function savePinnedLayout(projectId: string, pinned: Positions): void {
  try {
    localStorage.setItem(key(projectId), JSON.stringify(pinned));
  } catch {
    // Non-fatal: layout simply won't survive a restart.
  }
}

const KINDS = new Set<NavigationKind>(['push', 'replace', 'reset', 'pop', 'modal', 'tab']);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const stringMap = (v: unknown): Record<string, string> =>
  typeof v === 'object' && v !== null ? Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string')) : {};

/** Loads the user's graph corrections. Malformed entries are dropped, never trusted. */
export function loadCorrections(projectId: string): GraphCorrections {
  try {
    const raw = localStorage.getItem(correctionsKey(projectId));
    if (!raw) return emptyCorrections();
    const p = JSON.parse(raw) as Record<string, unknown>;
    const added = Array.isArray(p['addedEdges']) ? p['addedEdges'] : [];
    return {
      hiddenEdges: strings(p['hiddenEdges']),
      edgeTargets: stringMap(p['edgeTargets']),
      featureOverrides: stringMap(p['featureOverrides']),
      addedEdges: added.flatMap((m: Partial<ManualEdge>): ManualEdge[] =>
        typeof m?.id === 'string' && typeof m.from === 'string' && typeof m.to === 'string' && typeof m.label === 'string' && KINDS.has(m.kind as NavigationKind)
          ? [{ id: m.id, from: m.from, to: m.to, label: m.label, kind: m.kind as NavigationKind, createdAt: typeof m.createdAt === 'string' ? m.createdAt : '' }]
          : [],
      ),
    };
  } catch {
    return emptyCorrections();
  }
}

export function saveCorrections(projectId: string, corrections: GraphCorrections): void {
  try {
    localStorage.setItem(correctionsKey(projectId), JSON.stringify(corrections));
  } catch {
    // Non-fatal: corrections won't survive a restart.
  }
}

export interface ViewPrefs {
  groupByFeature: boolean;
  collapseSharedTargets: boolean;
  showMinimap: boolean;
}

export function loadViewPrefs(): ViewPrefs {
  const defaults: ViewPrefs = { groupByFeature: true, collapseSharedTargets: true, showMinimap: true };
  try {
    const p = JSON.parse(localStorage.getItem(viewKey) ?? '{}') as Partial<ViewPrefs>;
    return {
      groupByFeature: typeof p.groupByFeature === 'boolean' ? p.groupByFeature : defaults.groupByFeature,
      collapseSharedTargets: typeof p.collapseSharedTargets === 'boolean' ? p.collapseSharedTargets : defaults.collapseSharedTargets,
      showMinimap: typeof p.showMinimap === 'boolean' ? p.showMinimap : defaults.showMinimap,
    };
  } catch {
    return defaults;
  }
}

export function saveViewPrefs(prefs: ViewPrefs): void {
  try {
    localStorage.setItem(viewKey, JSON.stringify(prefs));
  } catch {
    // Non-fatal.
  }
}
