import type {
  AnalysisWarning,
  Asset,
  AssetKind,
  Evidence,
  Module,
  NavigationEdge,
  NavigationRoute,
  Screen,
  SourceLocation,
  WidgetRef,
} from '@appflow/model';
import type { WarningInput } from './types';

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 } as const;

function sameLocation(a?: SourceLocation, b?: SourceLocation): boolean {
  return !!a && !!b && a.fileId === b.fileId && a.line === b.line;
}

function mergeEvidence(target: Evidence[], incoming: Evidence[]): void {
  for (const ev of incoming) {
    const dup = target.some((t) => t.source === ev.source && t.detail === ev.detail && (t.location === ev.location || sameLocation(t.location, ev.location)));
    if (!dup) target.push(ev);
  }
}

export type EdgeInput = Omit<NavigationEdge, 'id'>;

/**
 * Accumulates the entities adapters discover and merges duplicates, so several
 * observations of the same screen or navigation become one entity with
 * several pieces of evidence.
 */
export class ProjectGraphBuilder {
  readonly modules = new Map<string, Module>();
  readonly screens = new Map<string, Screen>();
  readonly routes = new Map<string, NavigationRoute>();
  readonly edges = new Map<string, NavigationEdge>();
  readonly assets = new Map<string, Asset>();
  readonly warnings: AnalysisWarning[] = [];
  private adapterId = 'engine';

  /** Attributes subsequent warnings and evidence to an adapter. */
  setAdapter(id: string): void {
    this.adapterId = id;
  }

  warn(w: WarningInput): void {
    const id = `w${this.warnings.length + 1}`;
    this.warnings.push({ ...w, id, adapter: this.adapterId });
  }

  addModule(module: Module): Module {
    const existing = this.modules.get(module.id);
    if (existing) return existing;
    this.modules.set(module.id, module);
    return module;
  }

  /** Adds or merges a screen; the higher-confidence observation keeps its location. */
  addScreen(screen: Screen): Screen {
    const evidence = (screen.evidence ?? []).map((e) => ({ adapter: this.adapterId, ...e }));
    const existing = this.screens.get(screen.id);
    if (!existing) {
      const created = { ...screen, evidence };
      this.screens.set(screen.id, created);
      return created;
    }
    mergeEvidence((existing.evidence ??= []), evidence);
    existing.isEntryPoint ||= screen.isEntryPoint;
    existing.route ??= screen.route;
    existing.moduleId ??= screen.moduleId;
    if (screen.kind !== 'page') existing.kind = screen.kind;
    for (const w of screen.keyWidgets) {
      if (!existing.keyWidgets.some((k) => k.name === w.name && sameLocation(k.location, w.location))) existing.keyWidgets.push(w);
    }
    return existing;
  }

  addWidget(screenId: string, widget: WidgetRef): void {
    const screen = this.screens.get(screenId);
    if (screen && !screen.keyWidgets.some((k) => k.name === widget.name && sameLocation(k.location, widget.location))) screen.keyWidgets.push(widget);
  }

  addRoute(route: NavigationRoute): NavigationRoute {
    const evidence = route.evidence.map((e) => ({ adapter: this.adapterId, ...e }));
    const existing = this.routes.get(route.id);
    if (existing) {
      mergeEvidence(existing.evidence, evidence);
      existing.screenId ??= route.screenId;
      return existing;
    }
    const created = { ...route, evidence };
    this.routes.set(route.id, created);
    const screen = route.screenId ? this.screens.get(route.screenId) : undefined;
    if (screen && !screen.route) screen.route = route.path ?? route.name;
    return created;
  }

  /**
   * Adds a navigation edge. Resolved edges with the same endpoints, kind and
   * route merge their evidence; unresolved edges stay separate per call site.
   */
  addEdge(input: EdgeInput): NavigationEdge {
    const evidence = input.evidence.map((e) => ({ adapter: this.adapterId, ...e }));
    const loc = input.trigger.location ?? evidence.find((e) => e.location)?.location;
    const key =
      input.to === null
        ? `${input.from}->?@${loc ? `${loc.fileId}:${loc.line}` : this.edges.size}`
        : `${input.from}->${input.to}:${input.kind}${input.routeId ? `:${input.routeId}` : ''}`;
    const existing = this.edges.get(key);
    if (existing) {
      mergeEvidence(existing.evidence, evidence);
      // A code call site is a better trigger than a declaration.
      if (input.trigger.handler && !existing.trigger.handler) existing.trigger = input.trigger;
      return existing;
    }
    const edge: NavigationEdge = { ...input, id: key, evidence };
    this.edges.set(key, edge);
    return edge;
  }

  addAsset(path: string, kind: AssetKind, moduleId?: string): Asset {
    const existing = this.assets.get(path);
    if (existing) return existing;
    const asset: Asset = { id: path, path, kind, moduleId, referencedFrom: [] };
    this.assets.set(path, asset);
    return asset;
  }

  referenceAsset(path: string, location: SourceLocation): Asset | undefined {
    const asset = this.assets.get(path);
    if (asset && !asset.referencedFrom.some((l) => sameLocation(l, location))) asset.referencedFrom.push(location);
    return asset;
  }

  static betterConfidence(a?: Evidence['confidence'], b?: Evidence['confidence']): boolean {
    return CONFIDENCE_RANK[a ?? 'low'] > CONFIDENCE_RANK[b ?? 'low'];
  }
}
