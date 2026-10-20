import { edgeStatus, validateProject, type AppProject } from '@appflow/model';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { defaultAdapters } from '..';
import { analyzeProject } from '../../core/engine';

const fixture = path.resolve(__dirname, '../../../fixtures/rn_recipebox');
const edge = (p: AppProject, from: string, to: string | null) => p.edges.find((e) => e.from === `react-native:${from}` && e.to === (to && `react-native:${to}`));

describe('React Native adapter (rn_recipebox)', () => {
  let p: AppProject;
  beforeAll(async () => {
    p = (await analyzeProject(fixture, { adapters: defaultAdapters })).project;
  });

  it('detects React Native as primary and the native folders as hosts', () => {
    expect(validateProject(p)).toEqual([]);
    expect(p.platforms).toEqual(['react-native']);
    expect(p.modules!.map((m) => [m.platform, m.kind])).toEqual([
      ['react-native', 'app'],
      ['android', 'host'],
      ['ios', 'host'],
    ]);
    // ReactActivity is the host, not a screen; the app's own native screens are.
    expect(p.screens.filter((s) => !s.id.startsWith('react-native:')).map((s) => s.id)).toEqual(['android:CheckoutActivity', 'android:ScanActivity', 'ios:ScanViewController']);
  });

  it('connects a native module method to the native screens it opens', () => {
    const bridged = p.edges.filter((e) => e.bridge).map((e) => [e.from, e.to, e.kind, e.trigger.label, e.bridge]);
    const bridge = { kind: 'native-module', name: 'CookingTimer', method: 'openScanner' };
    expect(bridged).toEqual([
      ['react-native:CookingScreen', 'android:ScanActivity', 'push', 'Tap “Scan ingredients”', bridge],
      ['react-native:CookingScreen', 'ios:ScanViewController', 'modal', 'Tap “Scan ingredients”', bridge],
      // Java module named by its NAME constant, called as NativeModules.Payments.
      ['react-native:RecipeDetailScreen', 'android:CheckoutActivity', 'push', 'Tap “Buy ingredients”', { kind: 'native-module', name: 'Payments', method: 'openCheckout' }],
    ]);
    const checkout = p.edges.find((e) => e.to === 'android:CheckoutActivity')!;
    expect(checkout.evidence.map((e) => `${e.location!.fileId}:${e.location!.line}`)).toEqual(['src/screens/RecipeDetailScreen.tsx:15', 'android/app/src/main/java/com/recipebox/PaymentsModule.java:26']);
    const ios = p.edges.find((e) => e.to === 'ios:ScanViewController')!;
    expect(ios.evidence.map((e) => `${e.location!.fileId}:${e.location!.line}`)).toEqual(['src/screens/CookingScreen.tsx:9', 'ios/RecipeBox/TimerModule.m:16']);
    // start() returns no screen, so it draws nothing.
    expect(p.edges.filter((e) => e.bridge?.method === 'start')).toEqual([]);
  });

  it('lists native modules exported to JavaScript', () => {
    expect(p.modules!.find((m) => m.platform === 'react-native')!.exports!.map((e) => [e.name, e.location!.fileId])).toEqual([
      ['PaymentsModule', 'android/app/src/main/java/com/recipebox/PaymentsModule.java'],
      ['TimerModule', 'android/app/src/main/java/com/recipebox/TimerModule.kt'],
      ['TimerModule', 'ios/RecipeBox/TimerModule.m'],
    ]);
  });

  it('reads stack and tab screens through imports and route constants', () => {
    expect(p.routes!.map((r) => r.name)).toEqual(['Welcome', 'Main', 'RecipeDetail', 'Cooking', 'Share', 'Recipes', 'Favorites', 'Profile']);
    expect(p.screens.find((s) => s.id === 'react-native:RecipeDetailScreen')!.location).toMatchObject({ fileId: 'src/screens/RecipeDetailScreen.tsx', line: 4 });
    expect(p.screens.find((s) => s.isEntryPoint)!.id).toBe('react-native:WelcomeScreen');
    expect(p.screens.find((s) => s.id === 'react-native:ShareSheet')!.kind).toBe('dialog');
  });

  it('resolves a nested navigator route to its initial screen', () => {
    expect(p.routes!.find((r) => r.name === 'Main')!.screenId).toBe('react-native:RecipeListScreen');
    expect(edge(p, 'WelcomeScreen', 'RecipeListScreen')).toMatchObject({ kind: 'replace', trigger: { label: 'Tap “Get started”' } });
  });

  it('marks tab siblings as declared and code navigation as inferred', () => {
    expect(edgeStatus(edge(p, 'RecipeListScreen', 'FavoritesScreen')!)).toBe('declared');
    expect(edgeStatus(edge(p, 'RecipeDetailScreen', 'CookingScreen')!)).toBe('inferred');
    expect(edge(p, 'RecipeDetailScreen', 'CookingScreen')!.trigger.handler).toBe('handleStartCooking');
    expect(edge(p, 'RecipeDetailScreen', 'ShareSheet')!.kind).toBe('modal');
    expect(edge(p, 'CookingScreen', 'RecipeListScreen')!.kind).toBe('reset');
  });

  it('attributes navigation in a list item component to its screen', () => {
    expect(edge(p, 'RecipeListScreen', 'RecipeDetailScreen')!.trigger).toMatchObject({ handler: 'onPress', widget: 'RecipeCard' });
  });

  it('reports undeclared and runtime route names', () => {
    expect(p.edges.find((e) => e.unresolvedReason?.includes('"Settings"'))).toMatchObject({ from: 'react-native:FavoritesScreen', unresolvedKind: 'missing-target' });
    expect(p.edges.find((e) => e.unresolvedKind === 'dynamic')).toMatchObject({ from: 'react-native:RecipeDetailScreen' });
  });

  it('links required images to components and excludes secrets', () => {
    expect(p.assets!.map((a) => [a.path, a.referencedFrom.length])).toEqual([
      ['assets/logo.png', 1],
      ['assets/recipe.png', 1],
    ]);
    expect(p.screens.find((s) => s.id === 'react-native:WelcomeScreen')!.keyWidgets.find((w) => w.kind === 'image')!.assetIds).toEqual(['assets/logo.png']);
    expect(p.excludedSensitiveFiles).toBe(2);
  });
});
