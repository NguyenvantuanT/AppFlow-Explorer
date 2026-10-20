import { edgeStatus, validateProject, type AppProject } from '@appflow/model';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeProject } from '../../core/engine';
import { iosAdapter } from './index';

const fixture = path.resolve(__dirname, '../../../fixtures/ios_bookshelf');
const edge = (p: AppProject, from: string, to: string | null) => p.edges.find((e) => e.from === `ios:${from}` && e.to === (to && `ios:${to}`));

describe('iOS adapter (ios_bookshelf)', () => {
  let p: AppProject;
  beforeAll(async () => {
    p = (await analyzeProject(fixture, { adapters: [iosAdapter] })).project;
  });

  it('produces a consistent project with the Xcode project as module and SPM pins', () => {
    expect(validateProject(p)).toEqual([]);
    expect(p.modules).toEqual([expect.objectContaining({ name: 'Bookshelf', kind: 'app', platform: 'ios' })]);
    expect(p.modules![0]!.dependencies).toEqual([{ name: 'kingfisher', version: '7.12.0' }]);
  });

  it('uses the main storyboard initial controller (through its navigation controller) as entry point', () => {
    expect(p.screens.filter((s) => s.isEntryPoint).map((s) => s.id)).toEqual(['ios:LibraryViewController']);
  });

  it('turns storyboard scenes into screens, including scenes without a custom class', () => {
    const author = p.screens.find((s) => s.id === 'ios:sb:Main.storyboard#author-vc')!;
    expect(author).toMatchObject({ name: 'Author', platformKind: 'storyboard-scene', location: { fileId: 'Bookshelf/Base.lproj/Main.storyboard' } });
    expect(p.screens.find((s) => s.id === 'ios:AddBookViewController')!.keyWidgets.map((w) => w.name)).toEqual(['TextField “Title”', 'Button “Save”']);
  });

  it('marks segues as declared, resolving modal navigation controllers to their root', () => {
    const toDetail = edge(p, 'LibraryViewController', 'BookDetailViewController')!;
    expect(edgeStatus(toDetail)).toBe('declared');
    expect(toDetail.trigger.label).toBe('Tap “BookCell”');
    // performSegue(withIdentifier: "showBook") adds code evidence to the same edge.
    expect(toDetail.evidence.some((e) => e.source === 'static' && e.detail.includes('showBook'))).toBe(true);
    expect(edge(p, 'LibraryViewController', 'AddBookViewController')).toMatchObject({ kind: 'modal' });
  });

  it('follows pushes and presents, including storyboard identifiers and Objective-C', () => {
    expect(edge(p, 'BookDetailViewController', 'ReaderViewController')).toMatchObject({ kind: 'modal', trigger: { handler: '@IBAction readTapped' } });
    expect(edgeStatus(edge(p, 'LibraryViewController', 'LegacyStatsViewController')!)).toBe('inferred');
    expect(edge(p, 'LegacyStatsViewController', 'StatsDetailViewController')).toBeDefined();
    expect(p.warnings!.find((w) => w.code === 'system-controllers')!.message).toMatch(/^1 system/);
  });

  it('connects UIKit to SwiftUI and follows NavigationLink and sheet', () => {
    expect(edge(p, 'LibraryViewController', 'SettingsHostingController')).toBeDefined();
    expect(edge(p, 'SettingsHostingController', 'SettingsView')).toBeDefined();
    expect(edge(p, 'SettingsView', 'AboutView')!.trigger.label).toBe('Tap “About”');
    expect(edge(p, 'SettingsView', 'LicensesView')!.trigger.label).toBe('Tap “Licenses”');
    expect(edge(p, 'SettingsView', 'SignOutSheet')!.kind).toBe('modal');
    expect(p.screens.find((s) => s.id === 'ios:SignOutSheet')!.kind).toBe('bottomSheet');
    // A reusable row is a component, not a screen.
    expect(p.screens.some((s) => s.id === 'ios:SettingsRow')).toBe(false);
    expect(p.screens.find((s) => s.id === 'ios:SettingsView')!.keyWidgets.map((w) => w.name)).toContain('SettingsRow “Reading goal”');
  });

  it('reports an unknown segue identifier as unresolved', () => {
    expect(p.edges.find((e) => e.unresolvedReason?.includes('showArchive'))).toMatchObject({ from: 'ios:LibraryViewController', to: null, unresolvedKind: 'missing-target' });
  });

  it('links XIBs and image sets, and never reads GoogleService-Info.plist', () => {
    expect(p.screens.find((s) => s.id === 'ios:LibraryViewController')!.keyWidgets.map((w) => w.name)).toContain('BookCell (xib)');
    expect(p.assets!.map((a) => [a.path, a.referencedFrom.length])).toEqual([['Bookshelf/Assets.xcassets/BookCover.imageset/cover.png', 3]]);
    expect(p.excludedSensitiveFiles).toBe(1);
  });
});
