import { describe, expect, it } from 'vitest';
import { exportJson, exportMarkdown, exportMermaid, exportSvg } from './export';
import { buildFlowGraph, defaultFilters, visibleFlow } from './flow';
import { coverageReport, reachableScreens, unresolvedReport } from './report';
import type { AppProject, NavigationEdge, Screen } from './types';

const screen = (id: string, extra: Partial<Screen> = {}): Screen => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  kind: 'page',
  widgetClass: id,
  location: { fileId: `lib/features/${id}/${id}_screen.dart`, line: 3 },
  isEntryPoint: false,
  keyWidgets: [],
  states: [],
  ...extra,
});

const edge = (from: string, to: string | null, extra: Partial<NavigationEdge> = {}): NavigationEdge => ({
  id: to === null ? `${from}->?@x:${extra.trigger?.location?.line ?? 1}` : `${from}->${to}:push`,
  from,
  to,
  kind: 'push',
  trigger: { label: `Open ${to ?? '?'}`, description: '', location: { fileId: `lib/features/${from}/${from}_screen.dart`, line: 10 } },
  evidence: [{ source: 'static', detail: 'Navigator.push' }],
  ...extra,
});

function project(): AppProject {
  return {
    id: 'p',
    name: 'Shop',
    framework: 'flutter',
    rootPath: '/Users/someone/secret/shop',
    source: 'analysis',
    files: [
      { id: 'lib/features/home/home_screen.dart', path: 'lib/features/home/home_screen.dart', language: 'dart', kind: 'source' },
      { id: 'lib/features/login/login_screen.dart', path: 'lib/features/login/login_screen.dart', language: 'dart', kind: 'source' },
      { id: 'lib/util.dart', path: 'lib/util.dart', language: 'dart', kind: 'source' },
      { id: 'pubspec.yaml', path: 'pubspec.yaml', language: 'yaml', kind: 'config' },
    ],
    screens: [
      screen('login', { isEntryPoint: true, discoveredStates: [{ id: 'auth', kind: 'auth', label: 'Signed out', detail: 'AuthService', confidence: 'medium' }] }),
      screen('home', {
        discoveredStates: [
          { id: 'loading', kind: 'loading', label: 'Loading', detail: 'CircularProgressIndicator', confidence: 'high', location: { fileId: 'lib/features/home/home_screen.dart', line: 20 } },
          { id: 'error', kind: 'error', label: 'Error', detail: 'snapshot.hasError', confidence: 'medium' },
        ],
        states: [{ id: 'c1', label: 'Captured', provenance: 'runtime' }],
      }),
      screen('cart'),
      screen('legacy'),
      screen('confirm', { kind: 'dialog' }),
    ],
    edges: [
      edge('login', 'home', { evidence: [{ source: 'declared', detail: 'routes' }] }),
      edge('home', 'cart'),
      edge('home', 'confirm', { kind: 'modal', evidence: [{ source: 'runtime', detail: 'seen' }] }),
      edge('cart', null, { unresolvedKind: 'dynamic', unresolvedReason: 'Route `route` is computed at runtime.', trigger: { label: 'Tap Pay', description: '', location: { fileId: 'lib/features/cart/cart_screen.dart', line: 30 } } }),
      edge('legacy', null, { trigger: { label: 'Tap Help', description: '', location: { fileId: 'lib/features/legacy/legacy_screen.dart', line: 5 } } }),
    ],
    deepLinks: [
      { id: 'd1', url: 'https://shop.example.com/home', scheme: 'https', host: 'shop.example.com', path: '/home', kind: 'app-link', platform: 'android', screenId: 'home', evidence: [] },
      { id: 'd2', url: 'shop://', scheme: 'shop', kind: 'custom-scheme', platform: 'ios', screenId: null, unresolvedReason: 'Handled by app code at runtime.', evidence: [] },
    ],
    warnings: [
      { id: 'w1', code: 'x', severity: 'warning', message: 'm' },
      { id: 'w2', code: 'y', severity: 'info', message: 'm' },
    ],
  };
}

describe('coverageReport', () => {
  it('counts screens, reachability, captures, states, edges, links and files', () => {
    const cov = coverageReport(project());
    expect(cov.screens).toMatchObject({ total: 5, byKind: { page: 4, dialog: 1, bottomSheet: 0 }, entryPoints: 1, reachable: 4, captured: 1, withDiscoveredStates: 2 });
    expect(cov.screens.unreachable).toEqual(['legacy']);
    expect(cov.edges.byStatus).toEqual({ verified: 1, manual: 0, declared: 1, inferred: 1, unresolved: 2 });
    expect(cov.uiStates).toMatchObject({ loading: 1, error: 1, auth: 1, empty: 0 });
    expect(cov.deepLinks).toEqual({ total: 2, resolved: 1 });
    expect(cov.files).toEqual({ total: 4, source: 3, sourceWithFindings: 2 });
    expect(cov.warnings).toEqual({ errors: 0, warnings: 1, info: 1 });
  });

  it('follows connections from every start screen', () => {
    const p = project();
    p.screens.find((s) => s.id === 'legacy')!.isEntryPoint = true;
    expect([...reachableScreens(p)].sort()).toEqual(['cart', 'confirm', 'home', 'legacy', 'login']);
  });
});

describe('unresolvedReport', () => {
  it('lists unresolved flows grouped by reason, and unresolved deep links', () => {
    const r = unresolvedReport(project());
    expect(r.flows.map((f) => [f.fromName, f.category, f.trigger])).toEqual([
      ['Cart', 'dynamic', 'Tap Pay'],
      ['Legacy', 'unknown', 'Tap Help'],
    ]);
    expect(r.byCategory).toEqual({ dynamic: 1, 'missing-target': 0, unsupported: 0, unknown: 1 });
    expect(r.flows[0]!.location).toEqual({ fileId: 'lib/features/cart/cart_screen.dart', line: 30 });
    expect(r.deepLinks).toEqual([{ id: 'd2', url: 'shop://', reason: 'Handled by app code at runtime.', location: undefined }]);
  });
});

describe('exports', () => {
  const now = () => new Date('2026-01-02T03:04:05Z');

  it('JSON keeps structure and status but no absolute path or file contents', () => {
    const p = project();
    p.files[0]!.content = 'class HomeScreen {}';
    const text = exportJson(p, { now, positions: { home: { x: 1, y: 2 } } });
    const doc = JSON.parse(text);
    expect(doc.format).toBe('appflow-map/1');
    expect(doc.exportedAt).toBe('2026-01-02T03:04:05.000Z');
    expect(doc.screens.find((s: { id: string }) => s.id === 'home')).toMatchObject({ feature: 'home', source: 'lib/features/home/home_screen.dart:3', position: { x: 1, y: 2 } });
    expect(doc.connections.find((c: { id: string }) => c.id === 'home->confirm:push')).toMatchObject({ status: 'verified' });
    expect(text).not.toContain('/Users/someone');
    expect(text).not.toContain('class HomeScreen');
  });

  it('Markdown has coverage, tables, unresolved flows and deep links', () => {
    const md = exportMarkdown(project(), { now });
    expect(md).toContain('# Shop — App flow map');
    expect(md).toContain('- Reachable from a start screen: 4 of 5');
    expect(md).toContain('| Login (start) | page |');
    expect(md).toContain('| Cart | Unknown destination | Tap Pay | Unresolved | lib/features/cart/cart_screen.dart:30 |');
    expect(md).toContain('## Unresolved flows');
    expect(md).toContain('`shop://` (ios) → unknown: Handled by app code at runtime.');
  });

  it('Mermaid draws placeholders for unknown destinations and escapes quotes', () => {
    const p = project();
    p.screens[0]!.name = 'Say "hi"';
    const mmd = exportMermaid(p);
    expect(mmd.startsWith('flowchart LR\n')).toBe(true);
    expect(mmd).toContain('s0["Say #quot;hi#quot;"]');
    expect(mmd).toContain('s4(["Confirm"])');
    expect(mmd).toContain('s0 -->|"Open home · declared"| s1');
    expect(mmd).toContain('u0{{"?"}}');
    expect(mmd).toContain('s2 -.->|"Tap Pay · unresolved"| u0');
  });

  it('SVG draws positioned nodes and edges, escaping names and leaving out unplaced nodes', () => {
    const p = project();
    p.screens[0]!.name = 'Log <in>';
    const graph = buildFlowGraph(p, { groupByFeature: false, collapseSharedTargets: false });
    const positions = { login: { x: 0, y: 0 }, home: { x: 400, y: 0 } };
    const svg = exportSvg(p, { graph, positions });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('Log &lt;in&gt;');
    expect(svg).toContain('• Loading');
    expect(svg).toContain('marker-end="url(#arrow-declared)"');
    expect(svg).not.toContain('>Cart<');
    expect(svg).not.toContain('/Users/someone');
    expect(() => exportSvg(p, { positions })).toThrow();
  });
});

describe('large projects', () => {
  it('builds and filters a 3,000-screen, 15,000-edge map quickly', () => {
    const screens: Screen[] = [];
    const edges: NavigationEdge[] = [];
    for (let i = 0; i < 3000; i++) screens.push(screen(`s${i}`, { isEntryPoint: i === 0, location: { fileId: `lib/features/f${i % 60}/s${i}.dart`, line: 1 } }));
    for (let i = 0; i < 3000; i++) {
      for (let k = 1; k <= 5; k++) edges.push(edge(`s${i}`, k === 5 && i % 10 === 0 ? null : `s${(i * 7 + k * 13) % 3000}`, { id: `e${i}-${k}` }));
      // A destination reached from everywhere (collapsed into references).
      if (i % 3 === 0) edges.push(edge(`s${i}`, 's1', { id: `login${i}` }));
    }
    const p: AppProject = { id: 'big', name: 'Big', framework: 'flutter', rootPath: '/', source: 'analysis', files: [], screens, edges };
    const t0 = performance.now();
    const graph = buildFlowGraph(p, { groupByFeature: true, collapseSharedTargets: true });
    const visible = visibleFlow(graph, p, defaultFilters());
    const cov = coverageReport(p);
    const elapsed = performance.now() - t0;
    expect(graph.edges).toHaveLength(edges.length);
    expect(visible.edgeIds.size).toBe(edges.length);
    expect(cov.screens.total).toBe(3000);
    expect(elapsed).toBeLessThan(1500);
  });
});
