import { edgeStatus } from './graph';
import type { AppProject, EdgeStatus, NavigationEdge, NavigationKind, Screen, ScreenKind } from './types';

/* ------------------------------------------------------------------------- */
/* Manual graph corrections                                                   */
/* ------------------------------------------------------------------------- */

/** A connection the user added by hand. */
export interface ManualEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  kind: NavigationKind;
  createdAt: string;
}

/**
 * Corrections the user made to the generated map. They are stored separately
 * from the analysis result and re-applied after every re-analysis.
 */
export interface GraphCorrections {
  /** Correction keys of edges the user marked as incorrect. */
  hiddenEdges: string[];
  addedEdges: ManualEdge[];
  /** Correction key of an unresolved edge → destination screen id chosen by the user. */
  edgeTargets: Record<string, string>;
  /** Screen id → feature group chosen by the user. */
  featureOverrides: Record<string, string>;
}

export const emptyCorrections = (): GraphCorrections => ({ hiddenEdges: [], addedEdges: [], edgeTargets: {}, featureOverrides: {} });

export const MANUAL_EDGE_PREFIX = 'manual:';

/**
 * The key corrections refer to. Resolved edge ids are already semantic
 * (`from->to:kind`). Unresolved edge ids contain a line number, which changes
 * whenever code above the call is edited, so their key uses the file and the
 * trigger instead.
 */
export function correctionKey(edge: NavigationEdge): string {
  if (edge.to !== null) return edge.id;
  const t = edge.trigger;
  return `${edge.from}->?|${edge.kind}|${t.location?.fileId ?? ''}|${t.handler ?? ''}|${t.label}`;
}

export interface StaleCorrection {
  kind: 'hidden' | 'target' | 'added' | 'feature';
  key: string;
  reason: string;
}

export interface CorrectionResult {
  project: AppProject;
  /** Edges hidden by the user, so they can be listed and restored. */
  hidden: NavigationEdge[];
  /** Corrections that no longer match anything after re-analysis. They are kept, not deleted. */
  stale: StaleCorrection[];
}

/** Applies user corrections to an analysis result. Never mutates its input. */
export function applyCorrections(project: AppProject, corrections: GraphCorrections): CorrectionResult {
  const screenIds = new Set(project.screens.map((s) => s.id));
  const hiddenKeys = new Set(corrections.hiddenEdges);
  const usedHidden = new Set<string>();
  const usedTargets = new Set<string>();
  const stale: StaleCorrection[] = [];
  const edges: NavigationEdge[] = [];
  const hidden: NavigationEdge[] = [];

  const consider = (edge: NavigationEdge) => {
    const key = edge.correction!.key;
    if (hiddenKeys.has(key)) {
      usedHidden.add(key);
      hidden.push(edge);
    } else {
      edges.push(edge);
    }
  };

  for (const original of project.edges) {
    const key = correctionKey(original);
    let edge: NavigationEdge = { ...original, correction: { key } };
    const target = corrections.edgeTargets[key];
    if (original.to === null && target !== undefined) {
      usedTargets.add(key);
      if (screenIds.has(target)) {
        edge = {
          ...edge,
          to: target,
          evidence: [...original.evidence, { source: 'manual', detail: 'Destination chosen by hand', confidence: 'medium' }],
          correction: { key, resolvedByUser: true },
        };
      } else {
        stale.push({ kind: 'target', key, reason: `Chosen destination "${target}" no longer exists` });
      }
    }
    consider(edge);
  }

  for (const m of corrections.addedEdges) {
    if (!screenIds.has(m.from) || !screenIds.has(m.to)) {
      stale.push({ kind: 'added', key: m.id, reason: `Added connection refers to a screen that no longer exists (${screenIds.has(m.from) ? m.to : m.from})` });
      continue;
    }
    consider({
      id: m.id,
      from: m.from,
      to: m.to,
      kind: m.kind,
      trigger: { label: m.label, description: 'Connection added by hand' },
      evidence: [{ source: 'manual', detail: 'Connection added by hand', observedAt: m.createdAt }],
      correction: { key: m.id, addedByUser: true },
    });
  }

  for (const key of hiddenKeys) {
    if (!usedHidden.has(key)) stale.push({ kind: 'hidden', key, reason: 'Hidden connection no longer found by analysis' });
  }
  for (const key of Object.keys(corrections.edgeTargets)) {
    if (!usedTargets.has(key)) stale.push({ kind: 'target', key, reason: 'Unresolved navigation no longer found by analysis' });
  }
  for (const screenId of Object.keys(corrections.featureOverrides)) {
    if (!screenIds.has(screenId)) stale.push({ kind: 'feature', key: screenId, reason: `Screen "${screenId}" no longer exists` });
  }

  return { project: { ...project, edges }, hidden, stale };
}

/* ------------------------------------------------------------------------- */
/* Feature grouping                                                           */
/* ------------------------------------------------------------------------- */

/** Folders that usually contain one folder per feature. */
const FEATURE_CONTAINERS = new Set(['features', 'feature', 'modules', 'module', 'pages', 'page', 'screens', 'screen', 'scenes', 'views', 'presentation', 'ui', 'flows']);
/** Folder names that never name a feature on their own. */
const GENERIC = new Set([
  ...FEATURE_CONTAINERS,
  'lib', 'src', 'app', 'main', 'java', 'kotlin', 'swift', 'res', 'sources', 'widgets', 'widget', 'components', 'component',
  'common', 'shared', 'core', 'base', 'view', 'dialogs', 'dialog', 'sheets', 'bottom_sheets', 'bottomsheet', 'routes', 'router',
  'navigation', 'com', 'org', 'io', 'net', 'example', 'android', 'ios', 'controllers', 'viewcontrollers',
]);

/** Fallback group for screens whose path names no feature. */
export const DEFAULT_FEATURE = 'app';

/** Shared folders of overlays or widgets used across features; each becomes one group. */
const SHARED_FOLDERS: Record<string, string> = {
  dialog: 'dialogs',
  dialogs: 'dialogs',
  modal: 'dialogs',
  modals: 'dialogs',
  popup: 'dialogs',
  popups: 'dialogs',
  bottom_sheet: 'bottom_sheets',
  bottom_sheets: 'bottom_sheets',
  bottomsheet: 'bottom_sheets',
  bottomsheets: 'bottom_sheets',
  sheets: 'bottom_sheets',
  widgets: 'shared',
  components: 'shared',
  common: 'shared',
  shared: 'shared',
};

/**
 * Feature a source file belongs to, from its path:
 * - the folder after a feature container (`lib/features/auth/…` → `auth`,
 *   `lib/src/pages/voucher/voucher_list/…` → `voucher`);
 * - a shared folder of dialogs, bottom sheets or widgets met first
 *   (`lib/src/dialog/map/…` → `dialogs`);
 * - otherwise the closest non-generic folder.
 */
export function featureOfPath(fileId: string): string {
  const dirs = fileId.split('/').slice(0, -1).map((d) => d.toLowerCase());
  for (let i = 0; i < dirs.length; i++) {
    const dir = dirs[i]!;
    if (FEATURE_CONTAINERS.has(dir) && i + 1 < dirs.length && !GENERIC.has(dirs[i + 1]!)) return dirs[i + 1]!;
    if (SHARED_FOLDERS[dir]) return SHARED_FOLDERS[dir];
  }
  for (let i = dirs.length - 1; i >= 0; i--) {
    if (!GENERIC.has(dirs[i]!)) return dirs[i]!;
  }
  return DEFAULT_FEATURE;
}

export function featureOf(screen: Screen, overrides: Record<string, string> = {}): string {
  return overrides[screen.id] ?? featureOfPath(screen.location.fileId);
}

/** `order_history` → `Order history`. */
export function featureLabel(feature: string): string {
  const words = feature.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1).toLowerCase() : feature;
}

/* ------------------------------------------------------------------------- */
/* View graph                                                                 */
/* ------------------------------------------------------------------------- */

export type FlowNodeType = 'screen' | 'unresolved' | 'alias';

export interface FlowGraphNode {
  id: string;
  type: FlowNodeType;
  /** The screen shown (screen) or referenced (alias). */
  screenId?: string;
  /** The navigation edge this node exists for (unresolved and alias nodes). */
  edgeId?: string;
  feature: string;
}

export interface FlowGraphEdge {
  /** The navigation edge id; one drawn edge per navigation edge. */
  id: string;
  source: string;
  target: string;
  status: EdgeStatus;
  label: string;
  kind: NavigationKind;
  /** Position among edges drawn between the same two nodes, for offsetting. */
  parallelIndex: number;
  parallelCount: number;
  /** Drawn to a reference of a shared destination instead of the screen itself. */
  viaAlias: boolean;
}

/** A feature with at least two screens, drawn as a box. Single-screen features are not boxed. */
export interface FeatureGroup {
  id: string;
  feature: string;
  label: string;
  nodeIds: string[];
}

export interface FlowGraph {
  nodes: FlowGraphNode[];
  edges: FlowGraphEdge[];
  groups: FeatureGroup[];
}

export interface FlowViewOptions {
  groupByFeature: boolean;
  /**
   * Draw edges into a destination reached from many screens (e.g. Login) to a
   * small reference next to each source instead of long crossing lines.
   */
  collapseSharedTargets: boolean;
  /** Minimum number of distinct source screens for a destination to count as shared. */
  sharedTargetThreshold?: number;
  featureOverrides?: Record<string, string>;
}

export const unresolvedNodeId = (edgeId: string): string => `unresolved:${edgeId}`;
export const aliasNodeId = (edgeId: string): string => `alias:${edgeId}`;
export const groupNodeId = (feature: string): string => `group:${feature}`;

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Number of navigation steps from the nearest start screen (breadth-first). */
function distancesFromEntries(entries: Set<string>, edges: NavigationEdge[]): Map<string, number> {
  const out = new Map<string, NavigationEdge[]>();
  for (const e of edges) {
    const list = out.get(e.from);
    if (list) list.push(e);
    else out.set(e.from, [e]);
  }
  const depth = new Map([...entries].map((id) => [id, 0]));
  let frontier = [...entries];
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of out.get(id) ?? []) {
        if (e.to === null || depth.has(e.to)) continue;
        depth.set(e.to, depth.get(id)! + 1);
        next.push(e.to);
      }
    }
    frontier = next;
  }
  return depth;
}

/**
 * Turns a (corrected, runtime-annotated) project into the graph drawn on the
 * canvas. Output order is independent of input order, so layouts are stable.
 */
export function buildFlowGraph(project: AppProject, options: FlowViewOptions): FlowGraph {
  const overrides = options.featureOverrides ?? {};
  const threshold = options.sharedTargetThreshold ?? 4;
  const screens = [...project.screens].sort(byId);
  const featureById = new Map(screens.map((s) => [s.id, featureOf(s, overrides)]));
  const entryIds = new Set(screens.filter((s) => s.isEntryPoint).map((s) => s.id));
  const nodes: FlowGraphNode[] = screens.map((s) => ({ id: s.id, type: 'screen', screenId: s.id, feature: featureById.get(s.id)! }));
  const edgesIn = [...project.edges].filter((e) => featureById.has(e.from)).sort(byId);

  // Destinations reached from many different screens.
  const sources = new Map<string, Set<string>>();
  for (const e of edgesIn) {
    if (e.to === null || e.to === e.from) continue;
    const set = sources.get(e.to) ?? new Set<string>();
    set.add(e.from);
    sources.set(e.to, set);
  }
  const shared = new Set(
    options.collapseSharedTargets ? [...sources].filter(([to, from]) => from.size >= threshold && !entryIds.has(to)).map(([to]) => to) : [],
  );
  // For each shared destination, the edge closest to a start screen stays a real line.
  const depth = distancesFromEntries(entryIds, edgesIn);
  const primaryInto = new Map<string, NavigationEdge>();
  for (const e of edgesIn) {
    if (e.to === null || !shared.has(e.to) || e.to === e.from) continue;
    const current = primaryInto.get(e.to);
    if (current === undefined || (depth.get(e.from) ?? Infinity) < (depth.get(current.from) ?? Infinity)) primaryInto.set(e.to, e);
  }

  const edges: FlowGraphEdge[] = [];
  for (const e of edgesIn) {
    const sourceFeature = featureById.get(e.from)!;
    let target: string;
    let viaAlias = false;
    if (e.to === null) {
      target = unresolvedNodeId(e.id);
      nodes.push({ id: target, type: 'unresolved', edgeId: e.id, feature: sourceFeature });
    } else if (shared.has(e.to) && e.to !== e.from) {
      if (primaryInto.get(e.to) === e) {
        target = e.to;
      } else {
        target = aliasNodeId(e.id);
        viaAlias = true;
        nodes.push({ id: target, type: 'alias', screenId: e.to, edgeId: e.id, feature: sourceFeature });
      }
    } else {
      target = e.to;
    }
    edges.push({ id: e.id, source: e.from, target, status: edgeStatus(e), label: e.trigger.label || e.kind, kind: e.kind, parallelIndex: 0, parallelCount: 1, viaAlias });
  }

  // Several edges between the same two nodes (different actions, or both directions).
  const pairs = new Map<string, FlowGraphEdge[]>();
  for (const e of edges) {
    const key = e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`;
    const list = pairs.get(key);
    if (list) list.push(e);
    else pairs.set(key, [e]);
  }
  for (const list of pairs.values()) {
    list.forEach((e, i) => {
      e.parallelIndex = i;
      e.parallelCount = list.length;
    });
  }

  let groups: FeatureGroup[] = [];
  if (options.groupByFeature) {
    const members = new Map<string, string[]>();
    const screenCount = new Map<string, number>();
    for (const n of nodes) {
      const list = members.get(n.feature);
      if (list) list.push(n.id);
      else members.set(n.feature, [n.id]);
      if (n.type === 'screen') screenCount.set(n.feature, (screenCount.get(n.feature) ?? 0) + 1);
    }
    // A box around a single screen, or around everything, adds nothing.
    if (members.size > 1) {
      groups = [...members]
        .filter(([feature]) => (screenCount.get(feature) ?? 0) >= 2)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([feature, nodeIds]) => ({ id: groupNodeId(feature), feature, label: featureLabel(feature), nodeIds }));
    }
  }

  return { nodes, edges, groups };
}

/* ------------------------------------------------------------------------- */
/* Filters                                                                    */
/* ------------------------------------------------------------------------- */

export interface FlowFilters {
  /** Edge statuses to show. */
  statuses: EdgeStatus[];
  screenKinds: ScreenKind[];
  hiddenFeatures: string[];
  /** Hide screens left without any visible connection (start screens always stay). */
  hideIsolated: boolean;
}

export const ALL_STATUSES: EdgeStatus[] = ['verified', 'manual', 'declared', 'inferred', 'unresolved'];
export const defaultFilters = (): FlowFilters => ({ statuses: [...ALL_STATUSES], screenKinds: ['page', 'dialog', 'bottomSheet'], hiddenFeatures: [], hideIsolated: false });

export interface VisibleFlow {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  hiddenScreens: number;
  hiddenEdges: number;
}

/** Which nodes and edges pass the filters. Filters never change the layout. */
export function visibleFlow(graph: FlowGraph, project: AppProject, filters: FlowFilters): VisibleFlow {
  const screens = new Map(project.screens.map((s) => [s.id, s]));
  const statuses = new Set(filters.statuses);
  const kinds = new Set(filters.screenKinds);
  const hiddenFeatures = new Set(filters.hiddenFeatures);
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));

  const screenPasses = (id: string | undefined) => {
    const s = id ? screens.get(id) : undefined;
    const node = id ? nodesById.get(id) : undefined;
    return !!s && !!node && kinds.has(s.kind) && !hiddenFeatures.has(node.feature);
  };

  const nodeIds = new Set<string>();
  for (const n of graph.nodes) if (n.type === 'screen' && screenPasses(n.id)) nodeIds.add(n.id);

  const edgeIds = new Set<string>();
  for (const e of graph.edges) {
    if (!statuses.has(e.status) || !nodeIds.has(e.source)) continue;
    const target = nodesById.get(e.target);
    if (!target) continue;
    if (target.type === 'screen' && !nodeIds.has(target.id)) continue;
    if (target.type === 'alias' && !screenPasses(target.screenId)) continue;
    edgeIds.add(e.id);
    if (target.type !== 'screen') nodeIds.add(target.id);
  }

  if (filters.hideIsolated) {
    const connected = new Set<string>();
    for (const e of graph.edges) {
      if (!edgeIds.has(e.id)) continue;
      connected.add(e.source);
      connected.add(e.target);
    }
    for (const id of [...nodeIds]) {
      if (!connected.has(id) && !screens.get(id)?.isEntryPoint) nodeIds.delete(id);
    }
  }

  const totalScreens = graph.nodes.filter((n) => n.type === 'screen').length;
  const shownScreens = graph.nodes.filter((n) => n.type === 'screen' && nodeIds.has(n.id)).length;
  return { nodeIds, edgeIds, hiddenScreens: totalScreens - shownScreens, hiddenEdges: graph.edges.length - edgeIds.size };
}

/* ------------------------------------------------------------------------- */
/* Limitations                                                                */
/* ------------------------------------------------------------------------- */

export interface FlowLimitation {
  id: string;
  severity: 'info' | 'warning';
  message: string;
  /** Edges the limitation is about, so the UI can link to them. */
  edgeIds?: string[];
}

export interface LimitationContext {
  ambiguous?: Array<{ from: string; to: string; candidates: string[] }>;
  stale?: StaleCorrection[];
  hiddenByUser?: number;
  hiddenByFilters?: { screens: number; edges: number };
}

/**
 * What the map cannot show or does not know, stated explicitly so a
 * relationship is never presented with more certainty than its evidence.
 */
export function flowLimitations(project: AppProject, ctx: LimitationContext = {}): FlowLimitation[] {
  const out: FlowLimitation[] = [];
  const names = new Map(project.screens.map((s) => [s.id, s.name]));
  const byStatus = (status: EdgeStatus) => project.edges.filter((e) => edgeStatus(e) === status);

  for (const a of project.adapters ?? []) {
    if (a.status === 'partial' || a.status === 'failed') {
      out.push({ id: `adapter:${a.id}`, severity: 'warning', message: `${a.name} analysis ${a.status === 'failed' ? 'failed' : 'is partial'}: screens or flows it covers may be missing.` });
    }
  }

  const unresolved = byStatus('unresolved');
  if (unresolved.length) {
    out.push({ id: 'unresolved', severity: 'warning', message: `${unresolved.length} navigation call(s) have no known destination. They point to "Unknown destination" instead of a guessed screen.`, edgeIds: unresolved.map((e) => e.id) });
  }

  const unverified = project.edges.filter((e) => ['inferred', 'declared'].includes(edgeStatus(e)));
  if (unverified.length) {
    out.push({ id: 'unverified', severity: 'info', message: `${unverified.length} of ${project.edges.length} flow(s) come from code or configuration and have not been observed in the running app.` });
  }

  const manual = byStatus('manual');
  if (manual.length) {
    out.push({ id: 'manual', severity: 'info', message: `${manual.length} flow(s) were added or completed by hand and are not verified.`, edgeIds: manual.map((e) => e.id) });
  }

  const observedOnly = project.edges.filter((e) => e.id.startsWith('runtime:'));
  if (observedOnly.length) {
    out.push({ id: 'observed-only', severity: 'info', message: `${observedOnly.length} transition(s) were observed at runtime without a matching code path. The action that triggers them is unknown.`, edgeIds: observedOnly.map((e) => e.id) });
  }

  for (const a of ctx.ambiguous ?? []) {
    out.push({
      id: `ambiguous:${a.from}->${a.to}`,
      severity: 'info',
      message: `${names.get(a.from) ?? a.from} → ${names.get(a.to) ?? a.to} was observed at runtime, but ${a.candidates.length} connections match it, so none is marked verified.`,
      edgeIds: a.candidates,
    });
  }

  const incoming = new Set(project.edges.filter((e) => e.to !== null).map((e) => e.to));
  const orphans = project.screens.filter((s) => !s.isEntryPoint && !incoming.has(s.id));
  if (orphans.length) {
    out.push({ id: 'orphans', severity: 'info', message: `${orphans.length} screen(s) have no incoming navigation found (reached through unresolved or unsupported navigation, or unused).` });
  }

  const warnings = (project.warnings ?? []).filter((w) => w.severity !== 'info');
  if (warnings.length) out.push({ id: 'warnings', severity: 'warning', message: `${warnings.length} analysis warning(s); see the Overview panel.` });

  if (ctx.hiddenByUser) out.push({ id: 'hidden-by-user', severity: 'info', message: `${ctx.hiddenByUser} connection(s) hidden because you marked them as incorrect.` });
  if (ctx.stale?.length) out.push({ id: 'stale', severity: 'warning', message: `${ctx.stale.length} of your correction(s) no longer match the latest analysis. They are kept but have no effect.` });
  if (ctx.hiddenByFilters && (ctx.hiddenByFilters.screens || ctx.hiddenByFilters.edges)) {
    out.push({ id: 'filters', severity: 'info', message: `Filters hide ${ctx.hiddenByFilters.screens} screen(s) and ${ctx.hiddenByFilters.edges} connection(s).` });
  }
  return out;
}
