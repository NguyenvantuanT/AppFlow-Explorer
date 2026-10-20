import { edgeStatus, validateProject, type AppProject } from '@appflow/model';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeProject } from '../../core/engine';
import { flutterAdapter } from './index';

const fixture = path.resolve(__dirname, '../../../fixtures/flutter_auto_route');
const edge = (p: AppProject, from: string, to: string | null) => p.edges.find((e) => e.from === `flutter:${from}` && e.to === (to && `flutter:${to}`));

describe('Flutter adapter — AutoRoute (flutter_auto_route)', () => {
  let p: AppProject;
  beforeAll(async () => {
    p = (await analyzeProject(fixture, { adapters: [flutterAdapter] })).project;
  });

  it('produces a consistent project without unsupported-router warnings', () => {
    expect(validateProject(p)).toEqual([]);
    expect(p.warnings!.map((w) => w.code)).not.toContain('unsupported-router');
    expect(p.edges.some((e) => e.unresolvedKind === 'unsupported')).toBe(false);
  });

  it('reads the router config: paths, nested children, PageInfo getters and generated route classes', () => {
    expect(p.routes!.map((r) => [r.name, r.path, r.screenId])).toEqual([
      ['SplashRoute', '/splash', 'flutter:SplashPage'],
      ['LoginRoute', '/login', 'flutter:LoginPage'],
      ['MainRoute', '/main', 'flutter:MainPage'],
      ['HomeRoute', '/main/home', 'flutter:HomePage'],
      ['ProfileRoute', '/main/profile', 'flutter:ProfilePage'],
      ['DetailRoute', '/detail', 'flutter:DetailPage'],
      ['FilterSheetRoute', undefined, 'flutter:FilterSheet'],
      ['LogoutDialogRoute', undefined, 'flutter:LogoutDialogPage'],
    ]);
    expect(p.screens.find((s) => s.isEntryPoint)!.id).toBe('flutter:SplashPage');
    expect(p.screens.find((s) => s.id === 'flutter:FilterSheet')!.kind).toBe('bottomSheet');
    expect(p.screens.find((s) => s.id === 'flutter:LogoutDialogPage')!.kind).toBe('dialog');
  });

  it('folds a private Scaffold widget into the route page that wraps it', () => {
    expect(p.screens.some((s) => s.id === 'flutter:_LoginPage')).toBe(false);
    const login = p.screens.find((s) => s.id === 'flutter:LoginPage')!;
    expect(login.keyWidgets.map((w) => w.name)).toContain('BodyContent');
    expect(login.keyWidgets.map((w) => w.name)).not.toContain('_LoginPage');
  });

  it('attributes router callbacks to the page they are passed to', () => {
    expect(edge(p, 'SplashPage', 'LoginPage')).toMatchObject({ kind: 'replace', trigger: { handler: 'onToLogin', widget: 'SplashPage' } });
    expect(edge(p, 'SplashPage', 'MainPage')!.kind).toBe('reset');
  });

  it('keeps same-named widgets apart: each BodyContent belongs only to its own page', () => {
    expect(edge(p, 'LoginPage', 'MainPage')).toMatchObject({ kind: 'reset', trigger: { label: 'Tap “Sign in”' } });
    expect(edge(p, 'HomePage', 'FilterSheet')!.kind).toBe('push');
    expect(edge(p, 'LoginPage', 'FilterSheet')).toBeUndefined();
    expect(edge(p, 'HomePage', 'MainPage')).toBeUndefined();
    // OfferCard, two levels below HomePage, uses context.pushRoute.
    expect(edge(p, 'HomePage', 'DetailPage')).toBeDefined();
  });

  it('draws tabs for children of a page that uses AutoTabsScaffold', () => {
    expect(edgeStatus(edge(p, 'MainPage', 'HomePage')!)).toBe('declared');
    expect(edge(p, 'MainPage', 'ProfilePage')!.kind).toBe('tab');
  });

  it('reports undeclared and runtime routes, and never mistakes toString() for navigation', () => {
    expect(p.edges.find((e) => e.unresolvedReason?.includes('SettingsRoute'))).toMatchObject({ from: 'flutter:ProfilePage', unresolvedKind: 'missing-target' });
    expect(p.edges.find((e) => e.from === 'flutter:ProfilePage' && e.unresolvedKind === 'dynamic')).toBeDefined();
    expect(p.edges.some((e) => e.evidence.some((ev) => ev.detail.startsWith('toString')))).toBe(false);
    expect(p.warnings!.some((w) => w.message.startsWith('toString'))).toBe(false);
  });
});
