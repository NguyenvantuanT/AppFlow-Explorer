import { validateProject, type AppProject, type NavigationRoute, type Screen } from '@appflow/model';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { defaultAdapters } from '../adapters';
import { REACT_NATIVE_UI_STATES } from '../adapters/uiStateRules';
import { extractFacts } from '../parsing';
import { routeForPath } from './deepLinks';
import { analyzeProject } from './engine';
import { discoverUiStates } from './uiStates';

const fixture = (name: string) => path.resolve(__dirname, '../../fixtures', name);
const states = (p: AppProject, id: string) => (p.screens.find((s) => s.id === id)!.discoveredStates ?? []).map((s) => [s.kind, s.detail, s.location?.line]);

describe('UI states and deep links (flutter_states)', () => {
  let p: AppProject;
  beforeAll(async () => {
    p = (await analyzeProject(fixture('flutter_states'), { adapters: defaultAdapters })).project;
  });

  it('stays consistent', () => {
    expect(validateProject(p)).toEqual([]);
  });

  it('finds data, loading, empty, error, sheet and tab states in a screen and its State class', () => {
    expect(states(p, 'flutter:FeedScreen')).toEqual([
      ['data', 'http.get', 16],
      ['loading', 'ConnectionState.waiting', 39],
      ['empty', '.isEmpty', 46],
      ['error', '.hasError', 42],
      ['bottomSheet', 'showModalBottomSheet', 28],
      ['tabs', 'BottomNavigationBar', 56],
    ]);
    const loading = p.screens.find((s) => s.id === 'flutter:FeedScreen')!.discoveredStates!.find((s) => s.kind === 'loading')!;
    expect(loading).toMatchObject({ label: 'Loading', confidence: 'high', adapter: 'flutter', location: { fileId: 'lib/screens/feed_screen.dart', anchor: 'if (snapshot.connectionState == ConnectionState.waiting) {' } });
  });

  it('finds authentication, submitting and failure states of a sign-in form', () => {
    expect(states(p, 'flutter:LoginScreen')).toEqual([
      ['auth', 'AuthService', 20],
      ['loading', '_isSubmitting', 14],
      ['error', 'catch (', 22],
    ]);
  });

  it('reports inline dialogs as states and ignores comments', () => {
    expect(states(p, 'flutter:ArticleScreen')).toEqual([['dialog', 'showDialog', 16]]);
    expect(states(p, 'flutter:SettingsScreen')).toEqual([]);
  });

  it('maps an Android app link to the route it opens and keeps runtime-routed links unresolved', () => {
    const links = Object.fromEntries(p.deepLinks!.map((d) => [d.url, d]));
    expect(links['https://news.example.com/articles*']).toMatchObject({ kind: 'app-link', platform: 'android', screenId: 'flutter:ArticleScreen', path: '/articles*', location: { fileId: 'android/app/src/main/AndroidManifest.xml', line: 14 } });
    expect(links['newsreader://open']).toMatchObject({ kind: 'custom-scheme', screenId: null, unresolvedReason: expect.stringContaining('MainActivity') });
    expect(links['newsreader://']).toMatchObject({ platform: 'ios', screenId: null, location: { fileId: 'ios/Runner/Info.plist' } });
    expect(links['https://news.example.com']).toMatchObject({ platform: 'ios', kind: 'app-link', location: { fileId: 'ios/Runner/Runner.entitlements' } });
  });

  it('declares the capabilities in every adapter', () => {
    for (const a of defaultAdapters) {
      expect(a.capabilities.some((c) => c.kind === 'ui-states')).toBe(true);
      expect(a.uiStateRules?.length).toBeGreaterThan(0);
    }
  });
});

describe('routeForPath', () => {
  const route = (id: string, path: string): NavigationRoute => ({ id, path, screenId: `s:${id}`, router: 'go-router', evidence: [] });
  const routes = [route('root', '/'), route('article', '/articles/:id'), route('comments', '/articles/:id/comments'), route('login', '/login')];

  it('matches parameters, exact paths and prefixes', () => {
    expect(routeForPath('/articles/42', routes)?.id).toBe('article');
    expect(routeForPath('/login', routes)?.id).toBe('login');
    expect(routeForPath('/articles*', routes, true)?.id).toBe('article');
    expect(routeForPath('/articles/.*/comments', routes)?.id).toBe('comments');
    expect(routeForPath('/missing', routes)).toBeUndefined();
  });
});

describe('UI states for another framework', () => {
  it('uses the same matching with React Native rules', async () => {
    const text = [
      'import { ActivityIndicator, FlatList, Text } from "react-native";',
      'export function RecipesScreen() {',
      '  const { data, isLoading, error } = useQuery(["recipes"], load);',
      '  if (isLoading) return <ActivityIndicator />;',
      '  if (error) return <Text>Failed</Text>;',
      '  return <FlatList data={data} ListEmptyComponent={<Text>No recipes</Text>} />;',
      '}',
      'export function Other() { return <ActivityIndicator />; }',
    ].join('\n');
    const facts = await extractFacts('src/RecipesScreen.tsx', text);
    const screen: Screen = { id: 'rn:Recipes', name: 'Recipes', kind: 'page', widgetClass: 'RecipesScreen', location: { fileId: 'src/RecipesScreen.tsx', line: 2 }, isEntryPoint: false, keyWidgets: [], states: [] };
    expect(discoverUiStates(screen, text, facts, REACT_NATIVE_UI_STATES).map((s) => [s.kind, s.location?.line])).toEqual([
      ['data', 3],
      ['loading', 3],
      ['empty', 6],
    ]);
  });
});
