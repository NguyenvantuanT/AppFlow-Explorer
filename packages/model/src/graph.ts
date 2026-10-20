import type {
  AppProject,
  EdgeStatus,
  NavigationEdge,
  RuntimeCapture,
  RuntimeObservation,
  Screen,
  ScreenState,
  SourceFile,
  SourceLocation,
} from './types';

/**
 * Status is derived from evidence so that a static-only relationship can never
 * be displayed as verified.
 */
export function edgeStatus(edge: NavigationEdge): EdgeStatus {
  if (edge.to === null) return 'unresolved';
  if (edge.evidence.some((e) => e.source === 'runtime')) return 'verified';
  if (edge.evidence.some((e) => e.source === 'manual')) return 'manual';
  if (edge.evidence.some((e) => e.source === 'declared')) return 'declared';
  if (edge.evidence.some((e) => e.source === 'static')) return 'inferred';
  return 'unresolved';
}

export interface ProjectIndex {
  screensById: Map<string, Screen>;
  filesById: Map<string, SourceFile>;
  edgesById: Map<string, NavigationEdge>;
  incoming: Map<string, NavigationEdge[]>;
  outgoing: Map<string, NavigationEdge[]>;
  screensByFile: Map<string, Screen[]>;
  statusCounts: Record<EdgeStatus, number>;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function buildProjectIndex(project: AppProject): ProjectIndex {
  const screensById = new Map(project.screens.map((s) => [s.id, s]));
  const filesById = new Map(project.files.map((f) => [f.id, f]));
  const edgesById = new Map(project.edges.map((e) => [e.id, e]));
  const incoming = new Map<string, NavigationEdge[]>();
  const outgoing = new Map<string, NavigationEdge[]>();
  const screensByFile = new Map<string, Screen[]>();
  const statusCounts: Record<EdgeStatus, number> = { verified: 0, manual: 0, declared: 0, inferred: 0, unresolved: 0 };

  for (const screen of project.screens) push(screensByFile, screen.location.fileId, screen);
  for (const edge of project.edges) {
    push(outgoing, edge.from, edge);
    if (edge.to !== null) push(incoming, edge.to, edge);
    statusCounts[edgeStatus(edge)] += 1;
  }

  return { screensById, filesById, edgesById, incoming, outgoing, screensByFile, statusCounts };
}

/**
 * Overlays runtime captures and observed transitions on an analyzed project:
 * - each screen with an assigned capture gets a `runtime` state (latest first);
 * - an observed transition adds `runtime` evidence to the edge between the two
 *   screens when exactly one such edge exists;
 * - with several candidate edges, none is verified (the observation cannot
 *   tell which one fired);
 * - with no candidate edge, an observed-only edge is added. Its trigger is
 *   reported as unknown, never guessed.
 */
export function applyRuntime(
  project: AppProject,
  captures: RuntimeCapture[],
  observations: RuntimeObservation[],
  imageUri: (capture: RuntimeCapture) => string | undefined,
): AppProject {
  const byScreen = new Map<string, RuntimeCapture[]>();
  for (const c of captures) if (c.screenId) push(byScreen, c.screenId, c);
  const screens = project.screens.map((s) => {
    const list = (byScreen.get(s.id) ?? []).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    if (!list.length) return s;
    const runtime: ScreenState[] = list.map((c, i) => ({
      id: `${s.id}:capture:${c.id}`,
      label: i === 0 ? 'Captured' : `Capture ${list.length - i}`,
      provenance: 'runtime',
      captureId: c.id,
      build: c.build,
      screenshot: { uri: imageUri(c) ?? '', width: c.width, height: c.height, capturedAt: c.capturedAt, device: c.device.name, pixelRatio: c.pixelRatio },
    }));
    return { ...s, states: [...runtime, ...s.states.filter((st) => st.provenance !== 'runtime')] };
  });
  const edges = project.edges
    .filter((e) => !e.id.startsWith(RUNTIME_EDGE_PREFIX))
    // Re-applying replaces only what a previous overlay added; other runtime evidence is kept.
    .map((e) => ({ ...e, evidence: e.evidence.filter((ev) => ev.adapter !== RUNTIME_OVERLAY) }));
  const screenIds = new Set(project.screens.map((s) => s.id));
  const observedOnly = new Map<string, NavigationEdge>();
  for (const o of [...observations].sort((a, b) => a.observedAt.localeCompare(b.observedAt))) {
    if (!screenIds.has(o.fromScreenId) || !screenIds.has(o.toScreenId)) continue;
    const runtimeEvidence = { source: 'runtime' as const, detail: 'Transition observed while the app was running', observedAt: o.observedAt, confidence: 'high' as const, adapter: RUNTIME_OVERLAY };
    const matching = edges.filter((e) => e.from === o.fromScreenId && e.to === o.toScreenId);
    if (matching.length === 1) {
      const ev = matching[0]!.evidence;
      if (!ev.some((x) => x.source === 'runtime')) ev.push(runtimeEvidence);
    } else if (matching.length === 0) {
      // Seen in the running app, but analysis found no code path: keep it as an
      // observed-only edge. Its trigger is unknown and is not guessed.
      const id = runtimeEdgeId(o.fromScreenId, o.toScreenId);
      if (!observedOnly.has(id)) {
        observedOnly.set(id, {
          id,
          from: o.fromScreenId,
          to: o.toScreenId,
          kind: 'push',
          trigger: { label: 'Observed at runtime', description: 'Seen while the app was running; the action that triggered it is unknown.' },
          evidence: [runtimeEvidence],
        });
      }
    }
    // Several candidate edges: the observation cannot tell which one fired, so none is verified.
  }
  return { ...project, screens, edges: [...edges, ...observedOnly.values()] };
}

const RUNTIME_EDGE_PREFIX = 'runtime:';
/** Marks evidence added by `applyRuntime`, so re-applying it is idempotent. */
const RUNTIME_OVERLAY = 'runtime-capture';
export const runtimeEdgeId = (from: string, to: string): string => `${RUNTIME_EDGE_PREFIX}${from}->${to}`;

/**
 * Observed transitions that match more than one edge. None of those edges is
 * verified, because the observation cannot tell which one fired.
 */
export function ambiguousObservations(project: AppProject, observations: RuntimeObservation[]): Array<{ from: string; to: string; candidates: string[] }> {
  const seen = new Map<string, { from: string; to: string; candidates: string[] }>();
  for (const o of observations) {
    const candidates = project.edges.filter((e) => e.from === o.fromScreenId && e.to === o.toScreenId).map((e) => e.id);
    if (candidates.length > 1) seen.set(`${o.fromScreenId}->${o.toScreenId}`, { from: o.fromScreenId, to: o.toScreenId, candidates });
  }
  return [...seen.values()];
}

/** Returns human-readable integrity problems; an empty list means the project is consistent. */
export function validateProject(project: AppProject): string[] {
  const issues: string[] = [];
  const fileIds = new Set(project.files.map((f) => f.id));
  const screenIds = new Set<string>();
  const edgeIds = new Set<string>();

  const checkLocation = (where: string, loc: SourceLocation | undefined) => {
    if (!loc) return;
    if (!fileIds.has(loc.fileId)) issues.push(`${where}: unknown file "${loc.fileId}"`);
    if (loc.line < 1) issues.push(`${where}: invalid line ${loc.line}`);
  };

  for (const screen of project.screens) {
    if (screenIds.has(screen.id)) issues.push(`Duplicate screen id "${screen.id}"`);
    screenIds.add(screen.id);
    checkLocation(`Screen "${screen.id}"`, screen.location);
    for (const widget of screen.keyWidgets) {
      checkLocation(`Widget "${widget.name}" of "${screen.id}"`, widget.location);
    }
  }

  for (const edge of project.edges) {
    if (edgeIds.has(edge.id)) issues.push(`Duplicate edge id "${edge.id}"`);
    edgeIds.add(edge.id);
    if (!screenIds.has(edge.from)) issues.push(`Edge "${edge.id}": unknown source "${edge.from}"`);
    if (edge.to !== null && !screenIds.has(edge.to)) {
      issues.push(`Edge "${edge.id}": unknown target "${edge.to}"`);
    }
    checkLocation(`Edge "${edge.id}" trigger`, edge.trigger.location);
    for (const ev of edge.evidence) checkLocation(`Edge "${edge.id}" evidence`, ev.location);
  }

  for (const route of project.routes ?? []) {
    if (route.screenId !== null && !screenIds.has(route.screenId)) {
      issues.push(`Route "${route.id}": unknown screen "${route.screenId}"`);
    }
    checkLocation(`Route "${route.id}"`, route.location);
  }
  for (const asset of project.assets ?? []) {
    for (const loc of asset.referencedFrom) checkLocation(`Asset "${asset.id}" reference`, loc);
  }
  for (const warning of project.warnings ?? []) checkLocation(`Warning "${warning.id}"`, warning.location);

  return issues;
}
