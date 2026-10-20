import { edgeStatus, validateProject, type AppProject } from '@appflow/model';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeProject } from '../../core/engine';
import { androidAdapter } from './index';

const fixture = path.resolve(__dirname, '../../../fixtures/android_tasky');
const edge = (p: AppProject, from: string, to: string | null) => p.edges.find((e) => e.from === `android:${from}` && e.to === (to && `android:${to}`));

describe('Android adapter (android_tasky)', () => {
  let p: AppProject;
  beforeAll(async () => {
    p = (await analyzeProject(fixture, { adapters: [androidAdapter] })).project;
  });

  it('produces a consistent project with Gradle modules', () => {
    expect(validateProject(p)).toEqual([]);
    expect(p.modules!.map((m) => [m.name, m.kind])).toEqual([
      [':app', 'app'],
      [':feature:profile', 'feature'],
    ]);
    const app = p.modules!.find((m) => m.name === ':app')!;
    expect(app.dependencies).toContainEqual({ name: 'androidx.navigation:navigation-fragment-ktx', version: '2.7.7' });
    expect(app.dependencies).toContainEqual({ name: ':feature:profile', version: 'project' });
  });

  it('finds manifest activities, fragments, dialogs and composables', () => {
    const byId = new Map(p.screens.map((s) => [s.id, s]));
    expect(byId.get('android:MainActivity')).toMatchObject({ platformKind: 'activity', isEntryPoint: true });
    expect(byId.get('android:LegacyHelpActivity')!.location.fileId).toMatch(/LegacyHelpActivity\.java$/);
    expect(byId.get('android:TaskListFragment')!.platformKind).toBe('fragment');
    expect(byId.get('android:DeleteTaskDialog')!.kind).toBe('dialog');
    expect(byId.get('android:ProfileOverviewScreen')!.platformKind).toBe('composable');
    expect(byId.get('android:SignOutDialog')!.kind).toBe('dialog');
    // A library activity from another package is not a screen of this app.
    expect([...byId.keys()].some((id) => id.includes('OssLicenses'))).toBe(false);
  });

  it('reports a declared activity without source and keeps it visible', () => {
    expect(p.screens.find((s) => s.id === 'android:ArchiveActivity')!.location.fileId).toBe('app/src/main/AndroidManifest.xml');
    expect(p.warnings!.map((w) => w.code)).toContain('activity-source-missing');
  });

  it('reads the navigation graph as declared configuration, including nested graphs', () => {
    expect(p.routes!.filter((r) => r.router === 'android-nav-graph').map((r) => r.name)).toEqual(['taskList', 'taskDetail', 'editTask']);
    const toEdit = edge(p, 'TaskListFragment', 'EditTaskFragment')!;
    expect(edgeStatus(toEdit)).toBe('declared');
    expect(edge(p, 'EditTaskFragment', 'TaskListFragment')!.kind).toBe('reset');
    expect(edgeStatus(edge(p, 'MainActivity', 'TaskListFragment')!)).toBe('declared');
  });

  it('merges navigate(R.id.action) and Safe Args calls into the declared action edge', () => {
    const toDetail = edge(p, 'TaskListFragment', 'TaskDetailFragment')!;
    expect(toDetail.evidence.map((e) => e.source).sort()).toEqual(['declared', 'static']);
    expect(toDetail.trigger).toMatchObject({ handler: 'setOnClickListener', location: { line: 17 } });
    const safeArgs = edge(p, 'TaskListFragment', 'EditTaskFragment')!;
    expect(safeArgs.evidence.some((e) => e.source === 'static' && e.detail.includes('TaskListFragmentDirections'))).toBe(true);
  });

  it('extracts explicit intents (Kotlin and Java), fragment transactions and dialog fragments as inferred', () => {
    expect(edgeStatus(edge(p, 'MainActivity', 'SettingsActivity')!)).toBe('inferred');
    expect(edge(p, 'MainActivity', 'ProfileActivity')).toBeDefined(); // via a local `val intent`
    expect(edge(p, 'LegacyHelpActivity', 'MainActivity')).toBeDefined();
    expect(edge(p, 'SettingsActivity', 'SettingsFragment')!.kind).toBe('replace');
    expect(edge(p, 'TaskDetailFragment', 'DeleteTaskDialog')!.kind).toBe('modal');
    expect(p.warnings!.find((w) => w.code === 'implicit-intent')!.message).toMatch(/^1 implicit/);
  });

  it('resolves Compose routes through constants and templates, and reports unknown ones', () => {
    expect(p.routes!.filter((r) => r.router === 'compose-navigation').map((r) => r.path)).toEqual(['profile/overview', 'profile/edit', 'profile/badge/{badgeId}', 'profile/sign-out']);
    expect(edge(p, 'ProfileActivity', 'ProfileOverviewScreen')!.trigger.label).toBe('Start destination');
    expect(edge(p, 'ProfileOverviewScreen', 'BadgeScreen')).toBeDefined();
    expect(edge(p, 'ProfileOverviewScreen', 'SignOutDialog')!.kind).toBe('modal');
    expect(edge(p, 'ProfileOverviewScreen', 'EditProfileScreen')!.trigger).toMatchObject({ handler: 'onEdit', widget: 'ProfileOverviewScreen' });
    expect(p.edges.find((e) => e.from === 'android:ProfileOverviewScreen' && e.to === null)).toMatchObject({ unresolvedKind: 'dynamic' });
  });

  it('reports navigation to an action missing from the graph', () => {
    expect(p.edges.find((e) => e.unresolvedReason?.includes('action_taskDetail_to_share'))).toMatchObject({ from: 'android:TaskDetailFragment', to: null, unresolvedKind: 'missing-target' });
  });

  it('lists layout views and Compose components with labels', () => {
    const legacy = p.screens.find((s) => s.id === 'android:LegacyHelpActivity')!;
    expect(legacy.keyWidgets.map((w) => w.name)).toEqual(['Button @id/btn_home “Back to tasks”', 'Button @id/btn_web “Open website”']);
    expect(legacy.keyWidgets[0]!.location).toEqual({ fileId: 'app/src/main/res/layout/activity_legacy_help.xml', line: 5 });
    const overview = p.screens.find((s) => s.id === 'android:ProfileOverviewScreen')!;
    expect(overview.keyWidgets.map((w) => w.name)).toContain('Button “Edit profile”');
  });

  it('lists resources with their references and excludes signing files', () => {
    expect(p.assets!.map((a) => [a.path, a.referencedFrom.length])).toEqual([
      ['app/src/main/res/drawable/ic_task.xml', 1],
      ['app/src/main/res/mipmap-hdpi/ic_launcher.png', 1],
    ]);
    expect(p.excludedSensitiveFiles).toBe(2);
    expect(p.files.some((f) => f.path.endsWith('.keystore') || f.path.endsWith('local.properties'))).toBe(false);
  });
});
