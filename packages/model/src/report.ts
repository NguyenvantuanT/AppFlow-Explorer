import { edgeStatus } from './graph';
import type { AppProject, EdgeStatus, NavigationEdge, NavigationKind, ScreenKind, SourceLocation, UiStateKind, UnresolvedKind } from './types';

/* ------------------------------------------------------------------------- */
/* Coverage                                                                   */
/* ------------------------------------------------------------------------- */

/**
 * What the analysis found and how much of it is backed by strong evidence.
 * Every number is a count of real entities; there is no synthetic score.
 */
export interface CoverageReport {
  screens: {
    total: number;
    byKind: Record<ScreenKind, number>;
    entryPoints: number;
    /** Reachable from a start screen through resolved connections. */
    reachable: number;
    /** Not a start screen and not reachable from one. */
    unreachable: string[];
    /** Screens with at least one runtime capture. */
    captured: number;
    /** Screens with at least one UI state found in code. */
    withDiscoveredStates: number;
  };
  edges: {
    total: number;
    byStatus: Record<EdgeStatus, number>;
  };
  uiStates: Record<UiStateKind, number>;
  deepLinks: { total: number; resolved: number };
  files: {
    total: number;
    source: number;
    /** Source files that at least one screen, connection or route points into. */
    sourceWithFindings: number;
  };
  adapters: Array<{ id: string; name: string; status: string }>;
  warnings: { errors: number; warnings: number; info: number };
}

const UI_STATE_KINDS: UiStateKind[] = ['loading', 'empty', 'error', 'data', 'auth', 'dialog', 'bottomSheet', 'tabs'];

/** Screens reachable from start screens through resolved edges (breadth-first). */
export function reachableScreens(project: AppProject): Set<string> {
  const out = new Map<string, string[]>();
  for (const e of project.edges) {
    if (e.to === null) continue;
    const list = out.get(e.from);
    if (list) list.push(e.to);
    else out.set(e.from, [e.to]);
  }
  const seen = new Set(project.screens.filter((s) => s.isEntryPoint).map((s) => s.id));
  const queue = [...seen];
  while (queue.length) {
    for (const to of out.get(queue.pop()!) ?? []) {
      if (seen.has(to)) continue;
      seen.add(to);
      queue.push(to);
    }
  }
  return seen;
}

export function coverageReport(project: AppProject): CoverageReport {
  const byKind: Record<ScreenKind, number> = { page: 0, dialog: 0, bottomSheet: 0 };
  const uiStates = Object.fromEntries(UI_STATE_KINDS.map((k) => [k, 0])) as Record<UiStateKind, number>;
  let captured = 0;
  let withDiscoveredStates = 0;
  for (const s of project.screens) {
    byKind[s.kind]++;
    if (s.states.some((st) => st.provenance === 'runtime')) captured++;
    if (s.discoveredStates?.length) withDiscoveredStates++;
    for (const st of s.discoveredStates ?? []) uiStates[st.kind]++;
  }

  const byStatus: Record<EdgeStatus, number> = { verified: 0, manual: 0, declared: 0, inferred: 0, unresolved: 0 };
  for (const e of project.edges) byStatus[edgeStatus(e)]++;

  const reachable = reachableScreens(project);
  const referenced = new Set<string>();
  const ref = (loc?: SourceLocation) => loc && referenced.add(loc.fileId);
  for (const s of project.screens) ref(s.location);
  for (const e of project.edges) ref(e.trigger.location);
  for (const r of project.routes ?? []) ref(r.location);
  const sourceFiles = project.files.filter((f) => f.kind === 'source');

  const severities = { errors: 0, warnings: 0, info: 0 };
  for (const w of project.warnings ?? []) severities[w.severity === 'error' ? 'errors' : w.severity === 'warning' ? 'warnings' : 'info']++;

  return {
    screens: {
      total: project.screens.length,
      byKind,
      entryPoints: project.screens.filter((s) => s.isEntryPoint).length,
      reachable: project.screens.filter((s) => reachable.has(s.id)).length,
      unreachable: project.screens.filter((s) => !reachable.has(s.id)).map((s) => s.id),
      captured,
      withDiscoveredStates,
    },
    edges: { total: project.edges.length, byStatus },
    uiStates,
    deepLinks: { total: project.deepLinks?.length ?? 0, resolved: (project.deepLinks ?? []).filter((d) => d.screenId !== null).length },
    files: { total: project.files.length, source: sourceFiles.length, sourceWithFindings: sourceFiles.filter((f) => referenced.has(f.id)).length },
    adapters: (project.adapters ?? []).map((a) => ({ id: a.id, name: a.name, status: a.status })),
    warnings: severities,
  };
}

/* ------------------------------------------------------------------------- */
/* Unresolved flows                                                           */
/* ------------------------------------------------------------------------- */

export type UnresolvedCategory = UnresolvedKind | 'unknown';

export interface UnresolvedFlow {
  edgeId: string;
  from: string;
  fromName: string;
  kind: NavigationKind;
  category: UnresolvedCategory;
  reason: string;
  trigger: string;
  location?: SourceLocation;
}

export interface UnresolvedReport {
  flows: UnresolvedFlow[];
  byCategory: Record<UnresolvedCategory, number>;
  /** Deep links whose destination screen is not known. */
  deepLinks: Array<{ id: string; url: string; reason: string; location?: SourceLocation }>;
}

export const UNRESOLVED_CATEGORY_LABELS: Record<UnresolvedCategory, string> = {
  dynamic: 'Computed at runtime',
  'missing-target': 'Target not found',
  unsupported: 'Unsupported pattern',
  unknown: 'Unknown reason',
};

/** Navigation whose destination analysis could not determine, grouped by why. */
export function unresolvedReport(project: AppProject): UnresolvedReport {
  const names = new Map(project.screens.map((s) => [s.id, s.name]));
  const flows = project.edges
    .filter((e): e is NavigationEdge & { to: null } => e.to === null)
    .map((e): UnresolvedFlow => ({
      edgeId: e.id,
      from: e.from,
      fromName: names.get(e.from) ?? e.from,
      kind: e.kind,
      category: e.unresolvedKind ?? 'unknown',
      reason: e.unresolvedReason ?? 'The destination could not be determined.',
      trigger: e.trigger.label,
      location: e.trigger.location,
    }))
    .sort((a, b) => (a.fromName === b.fromName ? (a.location?.line ?? 0) - (b.location?.line ?? 0) : a.fromName < b.fromName ? -1 : 1));
  const byCategory: Record<UnresolvedCategory, number> = { dynamic: 0, 'missing-target': 0, unsupported: 0, unknown: 0 };
  for (const f of flows) byCategory[f.category]++;
  const deepLinks = (project.deepLinks ?? [])
    .filter((d) => d.screenId === null)
    .map((d) => ({ id: d.id, url: d.url, reason: d.unresolvedReason ?? 'The link is routed at runtime.', location: d.location }));
  return { flows, byCategory, deepLinks };
}
