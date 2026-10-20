import { describe, expect, it } from 'vitest';
import { applyRuntime, buildProjectIndex, edgeStatus, validateProject } from './graph';
import type { AppProject, NavigationEdge } from './types';

const edge = (overrides: Partial<NavigationEdge>): NavigationEdge => ({
  id: 'e1',
  from: 'a',
  to: 'b',
  kind: 'push',
  trigger: { label: 'Tap', description: 'tap' },
  evidence: [],
  ...overrides,
});

const project = (edges: NavigationEdge[]): AppProject => ({
  id: 'p',
  name: 'P',
  framework: 'flutter',
  rootPath: '/p',
  source: 'mock',
  files: [{ id: 'lib/a.dart', path: 'lib/a.dart', language: 'dart' }],
  screens: ['a', 'b'].map((id) => ({
    id,
    name: id.toUpperCase(),
    kind: 'page' as const,
    widgetClass: `${id}Screen`,
    location: { fileId: 'lib/a.dart', line: 1 },
    isEntryPoint: id === 'a',
    keyWidgets: [],
    states: [],
  })),
  edges,
});

describe('edgeStatus', () => {
  it('is verified only with runtime evidence', () => {
    expect(edgeStatus(edge({ evidence: [{ source: 'runtime', detail: 'tap observed' }] }))).toBe(
      'verified',
    );
  });

  it('is declared for explicit configuration without runtime evidence', () => {
    const declared = edge({
      evidence: [
        { source: 'declared', detail: 'nav graph action' },
        { source: 'static', detail: 'navigate()' },
      ],
    });
    expect(edgeStatus(declared)).toBe('declared');
  });

  it('is inferred when only static evidence exists', () => {
    expect(edgeStatus(edge({ evidence: [{ source: 'static', detail: 'pushNamed' }] }))).toBe(
      'inferred',
    );
  });

  it('is unresolved without a target, even with runtime evidence', () => {
    expect(edgeStatus(edge({ to: null, evidence: [{ source: 'runtime', detail: 'x' }] }))).toBe(
      'unresolved',
    );
  });

  it('is unresolved without any evidence', () => {
    expect(edgeStatus(edge({}))).toBe('unresolved');
  });
});

describe('buildProjectIndex', () => {
  it('groups incoming/outgoing edges and counts statuses', () => {
    const p = project([
      edge({ id: 'e1', evidence: [{ source: 'static', detail: '' }] }),
      edge({ id: 'e2', to: null }),
      edge({ id: 'e3', from: 'b', to: 'a', evidence: [{ source: 'runtime', detail: '' }] }),
    ]);
    const index = buildProjectIndex(p);
    expect(index.outgoing.get('a')?.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(index.incoming.get('b')?.map((e) => e.id)).toEqual(['e1']);
    expect(index.incoming.get('a')?.map((e) => e.id)).toEqual(['e3']);
    expect(index.screensByFile.get('lib/a.dart')).toHaveLength(2);
    expect(index.statusCounts).toEqual({ verified: 1, manual: 0, declared: 0, inferred: 1, unresolved: 1 });
  });
});

describe('applyRuntime', () => {
  const capture = (id: string, screenId: string | null, at: string) => ({
    id,
    projectId: 'p',
    screenId,
    association: { method: 'manual' as const },
    width: 1080,
    height: 2400,
    pixelRatio: 2.625,
    device: { id: 'emulator-5554', name: 'Pixel 6a', platform: 'android' as const },
    capturedAt: at,
    navigation: { detectedScreens: [] },
  });

  it('adds runtime states for assigned captures, latest first, and ignores unassigned ones', () => {
    const p = applyRuntime(project([]), [capture('c1', 'a', '2026-10-20T10:00:00Z'), capture('c2', 'a', '2026-10-20T11:00:00Z'), capture('c3', null, '2026-10-20T12:00:00Z')], [], (c) => `img:${c.id}`);
    const a = p.screens.find((s) => s.id === 'a')!;
    expect(a.states.map((s) => [s.provenance, s.captureId, s.screenshot?.uri])).toEqual([
      ['runtime', 'c2', 'img:c2'],
      ['runtime', 'c1', 'img:c1'],
    ]);
    expect(p.screens.find((s) => s.id === 'b')!.states).toEqual([]);
  });

  it('verifies an edge only when an observed transition matches exactly one edge', () => {
    const obs = [{ id: 'o1', sessionId: 's', fromScreenId: 'a', toScreenId: 'b', observedAt: '2026-10-20T10:00:00Z' }];
    const single = applyRuntime(project([edge({ id: 'e1', evidence: [{ source: 'static', detail: '' }] })]), [], obs, () => undefined);
    expect(edgeStatus(single.edges[0]!)).toBe('verified');

    const twice = applyRuntime(project([edge({ id: 'e1', evidence: [{ source: 'static', detail: '' }] }), edge({ id: 'e2', kind: 'modal', evidence: [{ source: 'static', detail: '' }] })]), [], obs, () => undefined);
    expect(twice.edges.map(edgeStatus)).toEqual(['inferred', 'inferred']);

    const none = applyRuntime(project([]), [], obs, () => undefined);
    expect(none.edges.map((e) => [e.id, e.from, e.to, edgeStatus(e), e.trigger.label])).toEqual([['runtime:a->b', 'a', 'b', 'verified', 'Observed at runtime']]);
  });

  it('adds one observed-only edge per pair, ignores unknown screens, and is idempotent', () => {
    const at = (t: string) => ({ id: t, sessionId: 's', fromScreenId: 'a', toScreenId: 'b', observedAt: t });
    const obs = [at('2026-10-20T11:00:00Z'), at('2026-10-20T10:00:00Z'), { ...at('x'), toScreenId: 'ghost' }];
    const once = applyRuntime(project([]), [], obs, () => undefined);
    expect(once.edges).toHaveLength(1);
    expect(once.edges[0]!.evidence[0]!.observedAt).toBe('2026-10-20T10:00:00Z');
    expect(applyRuntime(once, [], obs, () => undefined).edges).toEqual(once.edges);
  });
});

describe('validateProject', () => {
  it('accepts a consistent project', () => {
    expect(validateProject(project([edge({})]))).toEqual([]);
  });

  it('reports dangling references and duplicates', () => {
    const issues = validateProject(
      project([
        edge({ id: 'x', to: 'missing' }),
        edge({ id: 'x', trigger: { label: '', description: '', location: { fileId: 'nope', line: 1 } } }),
      ]),
    );
    expect(issues).toEqual([
      'Edge "x": unknown target "missing"',
      'Duplicate edge id "x"',
      'Edge "x" trigger: unknown file "nope"',
    ]);
  });
});
