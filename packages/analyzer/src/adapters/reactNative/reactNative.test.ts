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
    // ReactActivity is the host, not a screen.
    expect(p.screens.every((s) => s.id.startsWith('react-native:'))).toBe(true);
  });

  it('lists native modules exported to JavaScript', () => {
    expect(p.modules!.find((m) => m.platform === 'react-native')!.exports!.map((e) => [e.name, e.location!.fileId])).toEqual([
      ['TimerModule', 'android/app/src/main/java/com/recipebox/TimerModule.kt'],
      ['TimerModule', 'ios/RecipeBox/TimerModule.m'],
    ]);
  });

  it('reads stack and tab screens through imports and route constants', () => {
    expect(p.routes!.map((r) => r.name)).toEqual(['Welcome', 'Main', 'RecipeDetail', 'Cooking', 'Share', 'Recipes', 'Favorites', 'Profile']);
    expect(p.screens.find((s) => s.id === 'react-native:RecipeDetailScreen')!.location).toEqual({ fileId: 'src/screens/RecipeDetailScreen.tsx', line: 4 });
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
