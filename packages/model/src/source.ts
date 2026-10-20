import { edgeStatus } from './graph';
import type { AppProject, Confidence, NavigationEdge, SourceLocation } from './types';

/* ------------------------------------------------------------------------- */
/* Stale line numbers                                                         */
/* ------------------------------------------------------------------------- */

/** Longest anchor stored per location; longer lines are compared on this prefix. */
export const ANCHOR_MAX = 160;

export const anchorOf = (lineText: string): string => lineText.trim().slice(0, ANCHOR_MAX);

/**
 * Where a recorded location is in the file as it is now.
 * - `exact`: the file is unchanged, or the line still has the recorded text.
 * - `moved`: the recorded text was found on another line (nearest match).
 * - `stale`: the file changed and the recorded text is gone; the original line is shown but may be wrong.
 * - `unverified`: no recorded text to compare (older analysis or mock data).
 */
export type LocationStatus = 'exact' | 'moved' | 'stale' | 'unverified';

export interface RelocatedRange {
  status: LocationStatus;
  line: number;
  endLine: number;
  /** Lines the range moved by (`moved` only). */
  delta?: number;
}

/**
 * Finds a location again in the current text of its file. Never throws: an
 * out-of-range line is clamped to the file.
 */
export function relocate(location: Pick<SourceLocation, 'line' | 'endLine' | 'anchor'>, content: string, fileUnchanged = false): RelocatedRange {
  const lines = content.split(/\r?\n/);
  const clamp = (n: number) => Math.min(Math.max(1, n), Math.max(lines.length, 1));
  const span = Math.max(0, (location.endLine ?? location.line) - location.line);
  const at = (line: number, status: LocationStatus, delta?: number): RelocatedRange => {
    const start = clamp(line);
    return { status, line: start, endLine: clamp(start + span), ...(delta !== undefined ? { delta } : {}) };
  };

  if (fileUnchanged) return at(location.line, 'exact');
  const anchor = location.anchor;
  if (!anchor) return at(location.line, 'unverified');
  const matches = (i: number) => anchorOf(lines[i] ?? '') === anchor;
  if (matches(location.line - 1)) return at(location.line, 'exact');

  let best = -1;
  for (let i = 0; i < lines.length; i++) {
    if (matches(i) && (best < 0 || Math.abs(i + 1 - location.line) < Math.abs(best + 1 - location.line))) best = i;
  }
  if (best < 0) return at(location.line, 'stale');
  return at(best + 1, 'moved', best + 1 - location.line);
}

/* ------------------------------------------------------------------------- */
/* Screen → source, edge → source                                             */
/* ------------------------------------------------------------------------- */

export type SourceRole = 'handler' | 'navigation-call' | 'route-declaration' | 'destination-screen' | 'evidence';

export interface SourceTarget {
  role: SourceRole;
  label: string;
  /** Absent when no location is known; `note` then says why. */
  location?: SourceLocation;
  confidence?: Confidence;
  /** True when this part of the navigation is not known for sure. */
  uncertain: boolean;
  note?: string;
}

const sameLocation = (a?: SourceLocation, b?: SourceLocation) => !!a && !!b && a.fileId === b.fileId && a.line === b.line;

/**
 * Source locations explaining a navigation edge, best first:
 * 1. the event handler (or, without a handler name, the navigation call);
 * 2. how the destination was resolved: the route declaration, then the destination screen;
 * 3. any other evidence location.
 * Missing knowledge is returned as an entry without a location and with a note.
 */
export function edgeSourceTargets(edge: NavigationEdge, project: Pick<AppProject, 'screens' | 'routes'>): SourceTarget[] {
  const out: SourceTarget[] = [];
  const t = edge.trigger;
  const staticEvidence = edge.evidence.find((e) => e.location && (e.source === 'static' || e.source === 'declared'));
  const callLocation = t.location ?? staticEvidence?.location;
  const status = edgeStatus(edge);

  if (callLocation) {
    out.push(
      t.handler
        ? { role: 'handler', label: `${t.widget ? `${t.widget}.` : ''}${t.handler}`, location: callLocation, confidence: staticEvidence?.confidence, uncertain: false }
        : {
            role: 'navigation-call',
            label: t.description || 'Navigation call',
            location: callLocation,
            confidence: staticEvidence?.confidence,
            uncertain: true,
            note: 'The event handler that runs this navigation was not identified; this is the navigation call itself.',
          },
    );
  } else {
    out.push({
      role: 'handler',
      label: t.label,
      uncertain: true,
      note:
        status === 'verified' && edge.evidence.every((e) => e.source === 'runtime')
          ? 'Observed at runtime only: no code location is known for the action that triggers it.'
          : edge.correction?.addedByUser
            ? 'Added by hand: there is no code location for it.'
            : 'No source location was recorded for this navigation.',
    });
  }

  const route = edge.routeId ? project.routes?.find((r) => r.id === edge.routeId) : undefined;
  if (route) {
    const where = route.location ?? route.evidence.find((e) => e.location)?.location;
    out.push({
      role: 'route-declaration',
      label: `Route ${route.path ?? route.name ?? route.id}`,
      location: where,
      confidence: route.evidence[0]?.confidence,
      uncertain: !where || route.screenId === null,
      note: !where ? 'The route is known but its declaration has no recorded location.' : route.screenId === null ? 'The route declaration does not resolve to a known screen.' : undefined,
    });
  } else if (edge.routeId) {
    out.push({ role: 'route-declaration', label: `Route ${edge.routeId}`, uncertain: true, note: 'The route used here is not declared in the analyzed configuration.' });
  }

  if (edge.to === null) {
    out.push({
      role: 'destination-screen',
      label: 'Unknown destination',
      uncertain: true,
      note: edge.unresolvedReason ?? 'The destination could not be determined from the source code.',
    });
  } else {
    const target = project.screens.find((s) => s.id === edge.to);
    out.push(
      target
        ? {
            role: 'destination-screen',
            label: target.widgetClass,
            location: target.location,
            uncertain: !!edge.correction?.resolvedByUser,
            note: edge.correction?.resolvedByUser ? 'Destination chosen by hand; analysis could not resolve it.' : undefined,
          }
        : { role: 'destination-screen', label: edge.to, uncertain: true, note: 'The destination screen is not part of the analysis result.' },
    );
  }

  for (const ev of edge.evidence) {
    if (!ev.location || out.some((o) => sameLocation(o.location, ev.location))) continue;
    out.push({ role: 'evidence', label: ev.detail, location: ev.location, confidence: ev.confidence, uncertain: false });
  }
  return out;
}

/** The single best place to open for an edge, if any. */
export function bestEdgeLocation(edge: NavigationEdge, project: Pick<AppProject, 'screens' | 'routes'>): SourceLocation | undefined {
  return edgeSourceTargets(edge, project).find((t) => t.location)?.location;
}

/* ------------------------------------------------------------------------- */
/* Source → canvas                                                            */
/* ------------------------------------------------------------------------- */

export interface SourceMarker {
  line: number;
  endLine?: number;
  kind: 'screen' | 'edge' | 'route';
  /** Screen id, edge id or route id. */
  id: string;
  label: string;
  /** The location the marker comes from (for relocation). */
  location: SourceLocation;
}

/** Everything the analysis placed in a file, by line: screens, navigation calls, route declarations. */
export function sourceMarkers(project: Pick<AppProject, 'screens' | 'edges' | 'routes'>, fileId: string): SourceMarker[] {
  const markers: SourceMarker[] = [];
  for (const s of project.screens) {
    if (s.location.fileId === fileId) markers.push({ line: s.location.line, endLine: s.location.endLine, kind: 'screen', id: s.id, label: s.widgetClass, location: s.location });
  }
  for (const e of project.edges) {
    const loc = e.trigger.location;
    if (loc?.fileId === fileId) markers.push({ line: loc.line, endLine: loc.endLine, kind: 'edge', id: e.id, label: e.trigger.label, location: loc });
  }
  for (const r of project.routes ?? []) {
    if (r.location?.fileId === fileId) markers.push({ line: r.location.line, endLine: r.location.endLine, kind: 'route', id: r.id, label: r.path ?? r.name ?? r.id, location: r.location });
  }
  return markers.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
}

export type CanvasTarget = { kind: 'screen'; id: string } | { kind: 'edge'; id: string };

/**
 * What a line of source corresponds to on the canvas: a navigation call on
 * that line first, then the screen whose declaration encloses it (or the
 * nearest one declared above it), then a screen a route on that line leads to.
 */
export function canvasTargetAt(project: Pick<AppProject, 'screens' | 'edges' | 'routes'>, fileId: string, line: number): CanvasTarget | null {
  const markers = sourceMarkers(project, fileId);
  const edgeOn = markers.find((m) => m.kind === 'edge' && m.line <= line && line <= (m.endLine ?? m.line));
  if (edgeOn) return { kind: 'edge', id: edgeOn.id };

  const screens = markers.filter((m) => m.kind === 'screen');
  const enclosing = screens.filter((m) => m.endLine !== undefined && m.line <= line && line <= m.endLine).sort((a, b) => b.line - a.line)[0];
  if (enclosing) return { kind: 'screen', id: enclosing.id };
  const above = screens.filter((m) => m.line <= line).sort((a, b) => b.line - a.line)[0];
  if (above) return { kind: 'screen', id: above.id };

  const route = markers.find((m) => m.kind === 'route' && m.line === line);
  const routeScreen = route ? project.routes?.find((r) => r.id === route.id)?.screenId : null;
  if (routeScreen) return { kind: 'screen', id: routeScreen };
  return screens[0] ? { kind: 'screen', id: screens[0].id } : null;
}
