import { validateProject, type AppProject } from '@appflow/model';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { defaultAdapters } from '../adapters';
import { analyzeProject } from './engine';

const fixture = path.resolve(__dirname, '../../fixtures/flutter_native');
const at = (e: { location?: { fileId: string; line: number } }) => `${e.location!.fileId}:${e.location!.line}`;

describe('Native bridges — Flutter app with its own native screens (flutter_native)', () => {
  let p: AppProject;
  beforeAll(async () => {
    p = (await analyzeProject(fixture, { adapters: defaultAdapters })).project;
  });

  it('analyzes the native screens of the Android and iOS hosts, but not the host classes', () => {
    expect(validateProject(p)).toEqual([]);
    expect(p.platforms).toEqual(['flutter']);
    expect(p.screens.map((s) => s.id).sort()).toEqual(['android:KycActivity', 'android:ScannerActivity', 'flutter:HomeScreen', 'flutter:TransferScreen', 'ios:ScannerViewController']);
    expect(p.warnings!.map((w) => w.code)).not.toContain('navigation-outside-screen');
  });

  it('follows MethodChannel calls to the native handler branch that opens a screen', () => {
    const bridged = p.edges.filter((e) => e.bridge?.kind === 'method-channel').map((e) => [e.from, e.to, e.kind, e.trigger.label, e.bridge!.method]);
    expect(bridged).toEqual([
      ['flutter:HomeScreen', 'android:KycActivity', 'push', 'Tap “Verify identity”', 'openKyc'],
      ['flutter:HomeScreen', 'android:ScannerActivity', 'push', 'Tap “Scan QR”', 'openScanner'],
      ['flutter:HomeScreen', 'ios:ScannerViewController', 'modal', 'Tap “Scan QR”', 'openScanner'],
    ]);
    // Through the NativeBridge helper: the trigger is the button, the evidence is the channel call and the native branch.
    const scanner = p.edges.find((e) => e.to === 'android:ScannerActivity')!;
    expect(at(scanner.trigger)).toBe('lib/screens/home_screen.dart:26');
    expect(scanner.evidence.map(at)).toEqual(['lib/services/native_bridge.dart:7', 'android/app/src/main/kotlin/com/example/corebank/MainActivity.kt:18']);
    // openKyc() is a helper function of MainActivity.
    expect(p.edges.find((e) => e.to === 'android:KycActivity')!.evidence.map(at)[1]).toBe('android/app/src/main/kotlin/com/example/corebank/MainActivity.kt:33');
    // getDeviceId returns data only.
    expect(p.edges.some((e) => e.bridge?.method === 'getDeviceId')).toBe(false);
  });

  it('connects native screens that open Flutter at a route', () => {
    const back = p.edges.filter((e) => e.bridge?.kind === 'flutter-engine').map((e) => [e.from, e.to, e.bridge!.name]);
    expect(back).toEqual([
      ['android:ScannerActivity', 'flutter:TransferScreen', '/transfer'],
      ['ios:ScannerViewController', 'flutter:TransferScreen', '/transfer'],
    ]);
    const ios = p.edges.find((e) => e.bridge?.kind === 'flutter-engine' && e.from?.startsWith('ios:'))!;
    expect(ios.evidence[0]?.detail).toContain('FlutterViewController(project: nil, initialRoute: "/transfer"');
    // Not also drawn as an unresolved startActivity / present.
    expect(p.edges.filter((e) => e.to === null)).toEqual([]);
  });

  it('lists platform views with their native factories', () => {
    const home = p.screens.find((s) => s.id === 'flutter:HomeScreen')!;
    expect(home.keyWidgets[0]).toMatchObject({ name: 'Native view “corebank/card-view” · CardViewFactory', kind: 'custom', location: { fileId: 'lib/screens/home_screen.dart', line: 22 } });
  });
});

describe('Native bridges — Android host written in Java (flutter_native_java)', () => {
  let p: AppProject;
  beforeAll(async () => {
    p = (await analyzeProject(path.resolve(__dirname, '../../fixtures/flutter_native_java'), { adapters: defaultAdapters })).project;
  });

  it('follows a Java switch (call.method) handler and a helper method', () => {
    expect(p.screens.map((s) => s.id).sort()).toEqual(['android:KycActivity', 'android:ScannerActivity', 'flutter:HomeScreen', 'flutter:TransferScreen']);
    const java = 'android/app/src/main/java/com/example/corebank';
    expect(p.edges.filter((e) => e.bridge).map((e) => [e.from, e.to, e.bridge!.method ?? e.bridge!.name, e.evidence.map(at).at(-1)])).toEqual([
      ['flutter:HomeScreen', 'android:KycActivity', 'openKyc', `${java}/MainActivity.java:38`],
      ['flutter:HomeScreen', 'android:ScannerActivity', 'openScanner', `${java}/MainActivity.java:20`],
      ['android:ScannerActivity', 'flutter:TransferScreen', '/transfer', `${java}/ScannerActivity.java:13`],
    ]);
    expect(p.edges.filter((e) => e.to === null)).toEqual([]);
  });
});
