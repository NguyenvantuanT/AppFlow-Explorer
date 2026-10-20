import { edgeStatus, validateProject, type AppProject } from '@appflow/model';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeProject } from '../../core/engine';
import { flutterAdapter } from './index';

const fixture = (name: string) => path.resolve(__dirname, '../../../fixtures', name);
const edge = (p: AppProject, from: string, to: string | null) => p.edges.find((e) => e.from === `flutter:${from}` && e.to === (to && `flutter:${to}`));

describe('Flutter adapter — Navigator + routes table (flutter_shop)', () => {
  let p: AppProject;
  beforeAll(async () => {
    p = (await analyzeProject(fixture('flutter_shop'), { adapters: [flutterAdapter] })).project;
  });

  it('produces a consistent project', () => {
    expect(validateProject(p)).toEqual([]);
    expect(p.name).toBe('shoplite');
    expect(p.platforms).toEqual(['flutter']);
  });

  it('detects the app and the nested package as modules', () => {
    expect(p.modules!.map((m) => [m.name, m.kind, m.path]).sort()).toEqual([
      ['shoplite', 'app', ''],
      ['ui_kit', 'package', 'packages/ui_kit'],
    ]);
    expect(p.modules!.find((m) => m.name === 'shoplite')!.dependencies.map((d) => d.name)).toContain('provider');
  });

  it('reads named routes declared through constants in a top-level map', () => {
    const routes = p.routes!.filter((r) => r.router === 'flutter-navigator');
    expect(routes).toHaveLength(12);
    const cart = routes.find((r) => r.path === '/cart')!;
    expect(cart.screenId).toBe('flutter:CartScreen');
    expect(cart.evidence[0]).toMatchObject({ source: 'declared', location: { fileId: 'lib/app/routes.dart' } });
  });

  it('finds screens from routes, navigation targets and modals, with the entry point', () => {
    const ids = p.screens.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['flutter:SplashScreen', 'flutter:HomeScreen', 'flutter:PaymentFailedDialog', 'flutter:ReviewsSheet', 'flutter:LogoutDialog']));
    expect(ids).not.toContain('flutter:PromoBanner');
    expect(ids).not.toContain('flutter:PrimaryButton');
    expect(p.screens.find((s) => s.isEntryPoint)!.id).toBe('flutter:SplashScreen');
    expect(p.screens.find((s) => s.id === 'flutter:ReviewsSheet')!.kind).toBe('bottomSheet');
    expect(p.screens.find((s) => s.id === 'flutter:PaymentFailedDialog')!.kind).toBe('dialog');
    expect(p.screens.find((s) => s.id === 'flutter:HomeScreen')!.location).toEqual({ fileId: 'lib/features/home/home_screen.dart', line: 7 });
  });

  it('marks every code-derived navigation as inferred, never verified or declared', () => {
    const statuses = new Set(p.edges.map(edgeStatus));
    expect(statuses.has('verified')).toBe(false);
    expect(statuses.has('declared')).toBe(false);
    const toCart = edge(p, 'HomeScreen', 'CartScreen')!;
    expect(edgeStatus(toCart)).toBe('inferred');
    expect(toCart.routeId).toBe('flutter-navigator:/cart');
    expect(toCart.trigger).toMatchObject({ handler: 'onPressed', widget: 'IconButton', location: { fileId: 'lib/features/home/home_screen.dart', line: 31 } });
  });

  it('extracts pushNamed, MaterialPageRoute, replacement, remove-until and modal navigation', () => {
    expect(edge(p, 'SplashScreen', 'OnboardingScreen')!.kind).toBe('replace');
    expect(edge(p, 'RegisterScreen', 'HomeScreen')!.kind).toBe('reset');
    expect(edge(p, 'SearchScreen', 'ProductDetailScreen')!.kind).toBe('push');
    expect(edge(p, 'CheckoutScreen', 'PaymentFailedDialog')!.kind).toBe('modal');
    expect(edge(p, 'LogoutDialog', 'LoginScreen')!.kind).toBe('reset');
    expect(edge(p, 'CartScreen', 'CheckoutScreen')!.trigger.label).toBe('Tap “Checkout”');
  });

  it('attributes navigation inside a child widget to the screen that renders it', () => {
    const promo = p.edges.find((e) => e.trigger.location?.fileId === 'lib/features/home/widgets/promo_banner.dart')!;
    expect(promo.from).toBe('flutter:HomeScreen');
    expect(promo).toMatchObject({ to: null, unresolvedKind: 'dynamic' });
  });

  it('reports undeclared routes and unsupported constructs instead of dropping them', () => {
    const orders = p.edges.find((e) => e.unresolvedReason?.includes('/orders'))!;
    expect(orders).toMatchObject({ from: 'flutter:ProfileScreen', to: null, unresolvedKind: 'missing-target' });
    const codes = p.warnings!.map((w) => w.code);
    expect(codes).toContain('unsupported-route-generator');
    expect(codes).toContain('inline-dialog');
  });

  it('lists assets with their references and links them to components', () => {
    expect(p.assets!.map((a) => a.path).sort()).toEqual(['assets/images/hero.png', 'assets/images/logo.png']);
    expect(p.assets!.find((a) => a.path === 'assets/images/logo.png')!.referencedFrom).toEqual([{ fileId: 'lib/features/splash/splash_screen.dart', line: 33 }]);
    const image = p.screens.find((s) => s.id === 'flutter:SplashScreen')!.keyWidgets.find((w) => w.kind === 'image')!;
    expect(image.assetIds).toEqual(['assets/images/logo.png']);
  });

  it('lists key widgets with their labels and handlers', () => {
    const login = p.screens.find((s) => s.id === 'flutter:LoginScreen')!;
    expect(login.keyWidgets.map((w) => w.name)).toEqual(expect.arrayContaining(['TextField “Email”', 'FilledButton “Sign in”']));
    expect(login.keyWidgets.find((w) => w.name === 'FilledButton “Sign in”')!.handlers).toEqual(['onPressed']);
  });

  it('never reads sensitive files', () => {
    expect(p.excludedSensitiveFiles).toBe(4);
    expect(p.files.map((f) => f.path)).not.toContain('.env');
    expect(p.files.some((f) => f.path.endsWith('.jks') || f.path.endsWith('key.properties'))).toBe(false);
  });
});

describe('Flutter adapter — go_router (flutter_go_router)', () => {
  let p: AppProject;
  beforeAll(async () => {
    p = (await analyzeProject(fixture('flutter_go_router'), { adapters: [flutterAdapter] })).project;
  });

  it('resolves nested GoRoute paths, names and the initial location', () => {
    expect(p.routes!.map((r) => [r.path, r.name, r.screenId])).toEqual([
      ['/', undefined, 'flutter:HomeScreen'],
      ['/trails/:id', 'trail', 'flutter:TrailScreen'],
      ['/settings', undefined, 'flutter:SettingsScreen'],
    ]);
    expect(p.screens.find((s) => s.isEntryPoint)!.id).toBe('flutter:HomeScreen');
  });

  it('matches context.go/push/goNamed by path, pattern and name', () => {
    expect(edge(p, 'HomeScreen', 'SettingsScreen')).toMatchObject({ kind: 'replace', routeId: 'go-router:/settings' });
    const toTrail = p.edges.filter((e) => e.to === 'flutter:TrailScreen').map((e) => e.kind).sort();
    expect(toTrail).toEqual(['push', 'replace']);
  });

  it('reports unknown and runtime-computed locations as unresolved', () => {
    expect(p.edges.find((e) => e.unresolvedReason?.includes('/archive'))).toMatchObject({ to: null, unresolvedKind: 'missing-target' });
    expect(p.edges.find((e) => e.from === 'flutter:TrailScreen')).toMatchObject({ to: null, unresolvedKind: 'dynamic' });
  });
});
