import { describe, expect, it } from 'vitest';
import {
  aliasNodeId,
  applyCorrections,
  buildFlowGraph,
  correctionKey,
  defaultFilters,
  emptyCorrections,
  featureLabel,
  featureOfPath,
  flowLimitations,
  unresolvedNodeId,
  visibleFlow,
  type GraphCorrections,
} from './flow';
import { ambiguousObservations, applyRuntime, edgeStatus } from './graph';
import type { AppProject, NavigationEdge, Screen } from './types';

const screen = (id: string, file: string, extra: Partial<Screen> = {}): Screen => ({
  id,
  name: id,
  kind: 'page',
  widgetClass: id,
  location: { fileId: file, line: 1 },
  isEntryPoint: false,
  keyWidgets: [],
  states: [],
  ...extra,
});

const staticEdge = (from: string, to: string | null, extra: Partial<NavigationEdge> = {}): NavigationEdge => ({
  id: to === null ? `${from}->?@lib/x.dart:${extra.trigger?.location?.line ?? 1}` : `${from}->${to}:push`,
  from,
  to,
  kind: 'push',
  trigger: { label: `Go ${to ?? '?'}`, description: '' },
  evidence: [{ source: 'static', detail: 'Navigator.push' }],
  ...extra,
});

/**
 * splash → login → home; home branches to cart, profile and a dialog;
 * profile, cart, settings and orders all lead to login (shared destination);
 * home has one navigation with an unknown destination.
 */
function shop(): AppProject {
  const screens = [
    screen('splash', 'lib/features/splash/splash_screen.dart', { isEntryPoint: true }),
    screen('login', 'lib/features/auth/login_screen.dart'),
    screen('home', 'lib/features/home/home_screen.dart'),
    screen('logout', 'lib/features/home/widgets/logout_dialog.dart', { kind: 'dialog' }),
    screen('cart', 'lib/features/cart/cart_screen.dart'),
    screen('profile', 'lib/features/profile/profile_screen.dart'),
    screen('settings', 'lib/features/profile/settings_screen.dart'),
    screen('orders', 'lib/features/cart/orders_screen.dart'),
  ];
  const edges = [
    staticEdge('splash', 'login', { evidence: [{ source: 'declared', detail: 'routes' }] }),
    staticEdge('login', 'home'),
    staticEdge('home', 'cart'),
    staticEdge('home', 'profile'),
    staticEdge('home', 'logout', { id: 'home->logout:modal', kind: 'modal' }),
    staticEdge('home', 'cart', { id: 'home->cart:replace', kind: 'replace', trigger: { label: 'Buy again', description: '' } }),
    staticEdge('profile', 'settings'),
    staticEdge('cart', 'orders'),
    staticEdge('profile', 'login'),
    staticEdge('cart', 'login'),
    staticEdge('settings', 'login'),
    staticEdge('orders', 'login'),
    staticEdge('logout', 'login'),
    staticEdge('home', null, { trigger: { label: 'Open promo', description: '', handler: 'onTap', location: { fileId: 'lib/features/home/home_screen.dart', line: 40 } }, unresolvedReason: 'dynamic' }),
  ];
  return { id: 'shop', name: 'Shop', framework: 'flutter', rootPath: '/shop', source: 'analysis', files: [], screens, edges };
}

const options = { groupByFeature: true, collapseSharedTargets: true, sharedTargetThreshold: 4 };

describe('feature grouping', () => {
  it('derives features from folder conventions', () => {
    expect(featureOfPath('lib/features/auth/presentation/pages/login_page.dart')).toBe('auth');
    expect(featureOfPath('lib/src/presentation/pages/voucher/search_voucher_page.dart')).toBe('voucher');
    expect(featureOfPath('lib/features/home/widgets/promo_banner.dart')).toBe('home');
    expect(featureOfPath('app/src/main/java/com/example/tasky/profile/ProfileFragment.kt')).toBe('profile');
    expect(featureOfPath('src/screens/HomeScreen.tsx')).toBe('app');
    expect(featureOfPath('lib/src/dialog/map/dialog_map_page.dart')).toBe('dialogs');
    expect(featureOfPath('lib/src/bottom_sheets/bottom_sheet_qr_voucher_page.dart')).toBe('bottom_sheets');
    expect(featureOfPath('lib/src/pages/qr_scan/dialog/dialog_earn_point_success_page.dart')).toBe('qr_scan');
    expect(featureOfPath('lib/src/widgets/photo_viewer.dart')).toBe('shared');
    expect(featureLabel('order_history')).toBe('Order history');
  });
});

describe('buildFlowGraph', () => {
  it('builds one node per screen and per unknown destination, and one edge per navigation', () => {
    const g = buildFlowGraph(shop(), { ...options, collapseSharedTargets: false });
    expect(g.nodes.filter((n) => n.type === 'screen')).toHaveLength(8);
    const unresolved = g.nodes.filter((n) => n.type === 'unresolved');
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]!.feature).toBe('home');
    expect(g.edges).toHaveLength(14);
    expect(g.edges.find((e) => e.target === unresolved[0]!.id)!.status).toBe('unresolved');
  });

  it('keeps branches, dialogs and repeated destinations as separate labeled edges', () => {
    const g = buildFlowGraph(shop(), { ...options, collapseSharedTargets: false });
    const fromHome = g.edges.filter((e) => e.source === 'home');
    expect(fromHome.map((e) => e.target).sort()).toEqual(['cart', 'cart', 'logout', 'profile', unresolvedNodeId(shop().edges.at(-1)!.id)].sort());
    expect(fromHome.find((e) => e.target === 'logout')!.kind).toBe('modal');
    const toCart = fromHome.filter((e) => e.target === 'cart');
    expect(toCart.map((e) => e.label).sort()).toEqual(['Buy again', 'Go cart']);
    expect(toCart.map((e) => [e.parallelIndex, e.parallelCount])).toEqual([
      [0, 2],
      [1, 2],
    ]);
  });

  it('draws a shared destination once and references it elsewhere', () => {
    const g = buildFlowGraph(shop(), options);
    // The line kept is the one from the start screen; the five others become references.
    const intoLogin = g.edges.filter((e) => e.target === 'login');
    expect(intoLogin.map((e) => e.id)).toEqual(['splash->login:push']);
    const aliases = g.nodes.filter((n) => n.type === 'alias');
    expect(aliases.map((n) => n.screenId)).toEqual(['login', 'login', 'login', 'login', 'login']);
    for (const a of aliases) {
      const e = g.edges.find((x) => x.target === a.id)!;
      expect(e.viaAlias).toBe(true);
      expect(a.id).toBe(aliasNodeId(e.id));
      expect(a.feature).toBe(g.nodes.find((n) => n.id === e.source)!.feature);
    }
    // Every navigation is still drawn exactly once.
    expect(g.edges).toHaveLength(14);
  });

  it('boxes features with several screens, only when there is more than one feature', () => {
    const g = buildFlowGraph(shop(), options);
    // Auth and Splash have one screen each: not boxed.
    expect(g.groups.map((x) => x.label)).toEqual(['Cart', 'Home', 'Profile']);
    expect(g.groups.find((x) => x.feature === 'home')!.nodeIds).toContain('logout');

    const single = shop();
    single.screens = single.screens.map((s) => ({ ...s, location: { fileId: 'lib/main.dart', line: 1 } }));
    expect(buildFlowGraph(single, options).groups).toEqual([]);
    expect(buildFlowGraph(shop(), { ...options, groupByFeature: false }).groups).toEqual([]);
  });

  it('honours feature overrides', () => {
    const g = buildFlowGraph(shop(), { ...options, featureOverrides: { logout: 'auth' } });
    expect(g.groups.find((x) => x.feature === 'auth')!.nodeIds).toEqual(expect.arrayContaining(['login', 'logout']));
  });

  it('does not depend on input order', () => {
    const p = shop();
    const shuffled = { ...p, screens: [...p.screens].reverse(), edges: [...p.edges].reverse() };
    expect(buildFlowGraph(shuffled, options)).toEqual(buildFlowGraph(p, options));
  });
});

describe('edge provenance', () => {
  it('distinguishes declared, inferred, runtime-verified, observed-only and manual edges', () => {
    const corrected = applyCorrections(shop(), {
      ...emptyCorrections(),
      addedEdges: [{ id: 'manual:1', from: 'orders', to: 'home', label: 'Back home', kind: 'push', createdAt: '2026-10-20T00:00:00Z' }],
    }).project;
    const observed = applyRuntime(
      corrected,
      [],
      [
        { id: 'o1', sessionId: 's', fromScreenId: 'login', toScreenId: 'home', observedAt: '2026-10-20T10:00:00Z' },
        { id: 'o2', sessionId: 's', fromScreenId: 'settings', toScreenId: 'cart', observedAt: '2026-10-20T10:01:00Z' },
      ],
      () => undefined,
    );
    const status = (id: string) => edgeStatus(observed.edges.find((e) => e.id === id)!);
    expect(status('splash->login:push')).toBe('declared');
    expect(status('home->profile:push')).toBe('inferred');
    expect(status('login->home:push')).toBe('verified');
    expect(status('runtime:settings->cart')).toBe('verified');
    expect(status('manual:1')).toBe('manual');
    expect(observed.edges.find((e) => e.id === 'runtime:settings->cart')!.evidence.map((e) => e.source)).toEqual(['runtime']);
  });

  it('never verifies any of several candidates for one observation', () => {
    const obs = [{ id: 'o', sessionId: 's', fromScreenId: 'home', toScreenId: 'cart', observedAt: '2026-10-20T10:00:00Z' }];
    const p = applyRuntime(shop(), [], obs, () => undefined);
    expect(p.edges.filter((e) => e.from === 'home' && e.to === 'cart').map(edgeStatus)).toEqual(['inferred', 'inferred']);
    expect(ambiguousObservations(p, obs)).toEqual([{ from: 'home', to: 'cart', candidates: ['home->cart:push', 'home->cart:replace'] }]);
  });
});

describe('applyCorrections', () => {
  const unresolvedEdge = () => shop().edges.at(-1)!;

  it('hides, resolves and adds edges without mutating the analysis result', () => {
    const base = shop();
    const snapshot = JSON.stringify(base);
    const c: GraphCorrections = {
      hiddenEdges: ['home->profile:push'],
      addedEdges: [{ id: 'manual:1', from: 'orders', to: 'home', label: 'Back home', kind: 'push', createdAt: '2026-10-20T00:00:00Z' }],
      edgeTargets: { [correctionKey(unresolvedEdge())]: 'cart' },
      featureOverrides: {},
    };
    const r = applyCorrections(base, c);
    expect(JSON.stringify(base)).toBe(snapshot);
    expect(r.hidden.map((e) => e.id)).toEqual(['home->profile:push']);
    expect(r.project.edges.some((e) => e.id === 'home->profile:push')).toBe(false);
    const resolved = r.project.edges.find((e) => e.id === unresolvedEdge().id)!;
    expect(resolved.to).toBe('cart');
    expect(edgeStatus(resolved)).toBe('manual');
    expect(resolved.correction).toMatchObject({ resolvedByUser: true });
    expect(r.project.edges.find((e) => e.id === 'manual:1')!.correction).toMatchObject({ addedByUser: true });
    expect(r.stale).toEqual([]);
  });

  it('keeps unresolved-edge corrections when the call moves to another line', () => {
    const c = { ...emptyCorrections(), edgeTargets: { [correctionKey(unresolvedEdge())]: 'cart' } };
    const moved = shop();
    const last = moved.edges.at(-1)!;
    moved.edges[moved.edges.length - 1] = { ...last, id: `home->?@lib/x.dart:55`, trigger: { ...last.trigger, location: { ...last.trigger.location!, line: 55 } } };
    expect(applyCorrections(moved, c).project.edges.find((e) => e.id === 'home->?@lib/x.dart:55')!.to).toBe('cart');
  });

  it('reports corrections that no longer match after re-analysis instead of dropping them', () => {
    const c: GraphCorrections = {
      hiddenEdges: ['gone->away:push'],
      addedEdges: [{ id: 'manual:2', from: 'ghost', to: 'home', label: 'x', kind: 'push', createdAt: '' }],
      edgeTargets: { 'nothing->?|push||||x': 'home' },
      featureOverrides: { ghost: 'auth' },
    };
    const r = applyCorrections(shop(), c);
    expect(r.stale.map((s) => s.kind).sort()).toEqual(['added', 'feature', 'hidden', 'target']);
    expect(r.project.edges).toHaveLength(shop().edges.length);
  });
});

describe('visibleFlow', () => {
  const p = shop();
  const g = buildFlowGraph(p, { ...options, collapseSharedTargets: false });

  it('shows everything by default', () => {
    const v = visibleFlow(g, p, defaultFilters());
    expect(v.nodeIds.size).toBe(g.nodes.length);
    expect(v.edgeIds.size).toBe(g.edges.length);
  });

  it('filters by status, screen kind and feature', () => {
    const onlyDeclared = visibleFlow(g, p, { ...defaultFilters(), statuses: ['declared'] });
    expect([...onlyDeclared.edgeIds]).toEqual(['splash->login:push']);
    expect(onlyDeclared.nodeIds.has(unresolvedNodeId(p.edges.at(-1)!.id))).toBe(false);

    const noDialogs = visibleFlow(g, p, { ...defaultFilters(), screenKinds: ['page', 'bottomSheet'] });
    expect(noDialogs.nodeIds.has('logout')).toBe(false);
    expect(noDialogs.edgeIds.has('home->logout:modal')).toBe(false);

    const noCart = visibleFlow(g, p, { ...defaultFilters(), hiddenFeatures: ['cart'] });
    expect(noCart.nodeIds.has('cart') || noCart.nodeIds.has('orders')).toBe(false);
    expect(noCart.hiddenScreens).toBe(2);
  });

  it('can hide screens left without visible connections, but never start screens', () => {
    const v = visibleFlow(g, p, { ...defaultFilters(), statuses: ['declared'], hideIsolated: true });
    expect([...v.nodeIds].sort()).toEqual(['login', 'splash']);
  });
});

describe('flowLimitations', () => {
  it('states unknown destinations, unverified flows and stale corrections', () => {
    const r = applyCorrections(shop(), { ...emptyCorrections(), hiddenEdges: ['home->profile:push', 'gone->away:push'] });
    const lims = flowLimitations(r.project, { stale: r.stale, hiddenByUser: r.hidden.length });
    const ids = lims.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(['unresolved', 'unverified', 'hidden-by-user', 'stale']));
    expect(lims.find((l) => l.id === 'unresolved')!.message).toMatch(/1 navigation call/);
    expect(lims.find((l) => l.id === 'unverified')!.message).toMatch(/^12 of 13 flow/);
  });

  it('reports partial adapters and screens nothing navigates to', () => {
    const p = { ...shop(), adapters: [{ id: 'flutter', name: 'Flutter / Dart', status: 'partial' as const, capabilities: [] }] };
    p.edges = p.edges.filter((e) => e.to !== 'orders');
    const lims = flowLimitations(p);
    expect(lims.find((l) => l.id === 'adapter:flutter')!.severity).toBe('warning');
    expect(lims.find((l) => l.id === 'orphans')!.message).toMatch(/^1 screen/);
  });
});
