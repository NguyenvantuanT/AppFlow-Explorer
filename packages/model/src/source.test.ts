import { describe, expect, it } from 'vitest';
import { anchorOf, bestEdgeLocation, canvasTargetAt, edgeSourceTargets, relocate, sourceMarkers } from './source';
import type { AppProject, NavigationEdge, Screen } from './types';

const file = ['import x;', '', 'class Home {', '  build() {', '    onTap: () => push(Details()),', '  }', '}', '', 'class Details {', '}'].join('\n');

describe('relocate', () => {
  const loc = { line: 5, anchor: anchorOf('    onTap: () => push(Details()),') };

  it('keeps the line when the file is unchanged or the text is still there', () => {
    expect(relocate({ line: 5 }, file, true)).toEqual({ status: 'exact', line: 5, endLine: 5 });
    expect(relocate(loc, file)).toEqual({ status: 'exact', line: 5, endLine: 5 });
  });

  it('follows code that moved, keeping the range length', () => {
    const edited = `// header\n// more\n${file}`;
    expect(relocate({ ...loc, endLine: 6 }, edited)).toEqual({ status: 'moved', line: 7, endLine: 8, delta: 2 });
    const crlf = edited.replace(/\n/g, '\r\n');
    expect(relocate(loc, crlf).line).toBe(7);
  });

  it('picks the nearest match when the text appears several times', () => {
    // The call was removed from line 5 and now appears on lines 2 and 10: line 2 is nearer.
    const lines = file.split('\n');
    lines.splice(4, 1, '    // removed');
    lines.splice(1, 0, '    onTap: () => push(Details()),');
    lines.splice(9, 0, '    onTap: () => push(Details()),');
    expect(relocate(loc, lines.join('\n'))).toMatchObject({ status: 'moved', line: 2, delta: -3 });
  });

  it('marks the location stale when the code is gone, and clamps to the file', () => {
    const removed = file.replace('    onTap: () => push(Details()),\n', '');
    expect(relocate(loc, removed)).toEqual({ status: 'stale', line: 5, endLine: 5 });
    expect(relocate({ line: 400, anchor: 'gone' }, 'one line')).toEqual({ status: 'stale', line: 1, endLine: 1 });
  });

  it('cannot verify locations without recorded text', () => {
    expect(relocate({ line: 3 }, file)).toEqual({ status: 'unverified', line: 3, endLine: 3 });
  });
});

const screen = (id: string, line: number, endLine?: number): Screen => ({
  id,
  name: id,
  kind: 'page',
  widgetClass: `${id}Screen`,
  location: { fileId: 'lib/home.dart', line, endLine },
  isEntryPoint: false,
  keyWidgets: [],
  states: [],
});

const edge = (overrides: Partial<NavigationEdge> = {}): NavigationEdge => ({
  id: 'home->details:push',
  from: 'home',
  to: 'details',
  kind: 'push',
  trigger: { label: 'Tap', description: 'onTap: push(Details())', widget: 'InkWell', handler: 'onTap', location: { fileId: 'lib/home.dart', line: 5 } },
  evidence: [{ source: 'static', detail: 'Navigator.push', location: { fileId: 'lib/home.dart', line: 5 }, confidence: 'high' }],
  ...overrides,
});

const project: Pick<AppProject, 'screens' | 'edges' | 'routes'> = {
  screens: [screen('home', 3, 7), screen('details', 9, 10)],
  edges: [edge()],
  routes: [{ id: 'r:/details', path: '/details', screenId: 'details', router: 'flutter-navigator', location: { fileId: 'lib/routes.dart', line: 12 }, evidence: [{ source: 'declared', detail: 'routes', confidence: 'high' }] }],
};

describe('edgeSourceTargets', () => {
  it('lists the handler first, then the destination', () => {
    const t = edgeSourceTargets(edge(), project);
    expect(t.map((x) => [x.role, x.location?.line, x.uncertain])).toEqual([
      ['handler', 5, false],
      ['destination-screen', 9, false],
    ]);
    expect(t[0]!.label).toBe('InkWell.onTap');
    expect(bestEdgeLocation(edge(), project)).toEqual({ fileId: 'lib/home.dart', line: 5 });
  });

  it('includes the route declaration when navigation goes through a route', () => {
    const t = edgeSourceTargets(edge({ routeId: 'r:/details' }), project);
    expect(t.map((x) => x.role)).toEqual(['handler', 'route-declaration', 'destination-screen']);
    expect(t[1]!.location).toEqual({ fileId: 'lib/routes.dart', line: 12 });
    const undeclared = edgeSourceTargets(edge({ routeId: 'r:/nowhere' }), project);
    expect(undeclared[1]).toMatchObject({ role: 'route-declaration', uncertain: true });
    expect(undeclared[1]!.location).toBeUndefined();
  });

  it('says when the handler is not identified and falls back to the navigation call', () => {
    const noHandler = edge({ trigger: { label: 'push', description: 'Navigator.push', location: { fileId: 'lib/home.dart', line: 5 } } });
    expect(edgeSourceTargets(noHandler, project)[0]).toMatchObject({ role: 'navigation-call', uncertain: true, location: { line: 5 } });
    const onlyEvidence = edge({ trigger: { label: 'push', description: '' } });
    expect(edgeSourceTargets(onlyEvidence, project)[0]).toMatchObject({ role: 'navigation-call', location: { line: 5 } });
  });

  it('handles unresolved destinations and missing locations without inventing them', () => {
    const unresolved = edge({ to: null, unresolvedReason: 'Route name is computed at runtime.' });
    const t = edgeSourceTargets(unresolved, project);
    expect(t.find((x) => x.role === 'destination-screen')).toEqual({ role: 'destination-screen', label: 'Unknown destination', uncertain: true, note: 'Route name is computed at runtime.' });

    const observed = edge({ id: 'runtime:home->details', trigger: { label: 'Observed at runtime', description: '' }, evidence: [{ source: 'runtime', detail: 'seen' }] });
    const o = edgeSourceTargets(observed, project);
    expect(o[0]).toMatchObject({ role: 'handler', uncertain: true });
    expect(o[0]!.location).toBeUndefined();
    expect(o[0]!.note).toMatch(/Observed at runtime only/);
    expect(bestEdgeLocation({ ...observed, to: null }, project)).toBeUndefined();

    const added = edge({ trigger: { label: 'Back', description: '' }, evidence: [{ source: 'manual', detail: 'by hand' }], correction: { key: 'manual:1', addedByUser: true } });
    expect(edgeSourceTargets(added, project)[0]!.note).toMatch(/Added by hand/);

    const missingScreen = edge({ to: 'ghost' });
    expect(edgeSourceTargets(missingScreen, project).at(-1)).toMatchObject({ uncertain: true });
    expect(edgeSourceTargets(missingScreen, project).at(-1)!.location).toBeUndefined();
  });

  it('marks a destination chosen by hand as uncertain', () => {
    const resolved = edge({ correction: { key: 'k', resolvedByUser: true } });
    expect(edgeSourceTargets(resolved, project).at(-1)).toMatchObject({ role: 'destination-screen', uncertain: true });
  });
});

describe('source → canvas', () => {
  it('lists what analysis placed in a file', () => {
    expect(sourceMarkers(project, 'lib/home.dart').map((m) => [m.kind, m.line])).toEqual([
      ['screen', 3],
      ['edge', 5],
      ['screen', 9],
    ]);
    expect(sourceMarkers(project, 'lib/routes.dart').map((m) => m.kind)).toEqual(['route']);
    expect(sourceMarkers(project, 'lib/none.dart')).toEqual([]);
  });

  it('maps a line to a navigation call, the enclosing screen, or a routed screen', () => {
    expect(canvasTargetAt(project, 'lib/home.dart', 5)).toEqual({ kind: 'edge', id: 'home->details:push' });
    expect(canvasTargetAt(project, 'lib/home.dart', 6)).toEqual({ kind: 'screen', id: 'home' });
    expect(canvasTargetAt(project, 'lib/home.dart', 10)).toEqual({ kind: 'screen', id: 'details' });
    expect(canvasTargetAt(project, 'lib/routes.dart', 12)).toEqual({ kind: 'screen', id: 'details' });
    expect(canvasTargetAt(project, 'lib/routes.dart', 3)).toBeNull();
    expect(canvasTargetAt(project, 'lib/none.dart', 1)).toBeNull();
  });
});
