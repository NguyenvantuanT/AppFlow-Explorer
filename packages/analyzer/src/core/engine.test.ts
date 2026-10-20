import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { defaultAdapters } from '../adapters';
import { analyzeProject, type AnalysisProgress } from './engine';
import type { AnalysisAdapter } from './types';

const fixtures = path.resolve(__dirname, '../../fixtures');
const temp = mkdtempSync(path.join(tmpdir(), 'appflow-engine-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

describe('project detection', () => {
  it.each([
    ['flutter_shop', ['flutter'], 'Flutter'],
    ['flutter_go_router', ['flutter'], 'Flutter'],
    ['android_tasky', ['android'], 'Android (Gradle)'],
    ['ios_bookshelf', ['ios'], 'iOS (Xcode)'],
    ['rn_recipebox', ['react-native'], 'React Native'],
  ])('%s → %j', async (name, platforms, framework) => {
    const { project } = await analyzeProject(path.join(fixtures, name), { adapters: defaultAdapters });
    expect(project.platforms).toEqual(platforms);
    expect(project.frameworks![0]!.name).toBe(framework);
    expect(project.source).toBe('analysis');
  });

  it('treats a Flutter app’s native folders as hosts and does not analyze their screens', async () => {
    const { project } = await analyzeProject(path.join(fixtures, 'flutter_shop'), { adapters: defaultAdapters });
    expect(project.modules!.filter((m) => m.kind === 'host').map((m) => m.platform).sort()).toEqual(['android', 'ios']);
    expect(project.screens.every((s) => s.id.startsWith('flutter:'))).toBe(true);
  });

  it('keeps the file tree for unsupported projects and says why', async () => {
    const dir = path.join(temp, 'plain');
    mkdirSync(dir);
    writeFileSync(path.join(dir, 'main.py'), 'print("hi")\n');
    const { project } = await analyzeProject(dir, { adapters: defaultAdapters });
    expect(project.files.map((f) => f.path)).toEqual(['main.py']);
    expect(project.screens).toEqual([]);
    expect(project.warnings!.map((w) => w.code)).toEqual(['unsupported-project']);
  });
});

describe('engine behavior', () => {
  it('reports progress phases up to 100%', async () => {
    const seen: AnalysisProgress[] = [];
    await analyzeProject(path.join(fixtures, 'flutter_go_router'), { adapters: defaultAdapters, onProgress: (p) => seen.push(p) });
    expect(seen[0]!.phase).toBe('scanning');
    expect(seen.at(-1)).toEqual({ phase: 'done', message: 'Analysis complete', percent: 100 });
    expect(seen.map((p) => p.percent)).toEqual([...seen.map((p) => p.percent)].sort((a, b) => a - b));
  });

  it('can be cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(analyzeProject(path.join(fixtures, 'flutter_shop'), { adapters: defaultAdapters, signal: controller.signal })).rejects.toThrow();
  });

  it('isolates a failing adapter and still returns the other results', async () => {
    const broken: AnalysisAdapter = {
      id: 'broken',
      name: 'Broken',
      platform: 'android',
      capabilities: [],
      limitations: [],
      detect: async () => [{ adapterId: 'broken', platform: 'android', root: '', role: 'primary', framework: { id: 'x', name: 'X', evidence: [] } }],
      analyze: async () => {
        throw new Error('boom');
      },
    };
    const { project } = await analyzeProject(path.join(fixtures, 'flutter_go_router'), { adapters: [...defaultAdapters, broken] });
    expect(project.adapters!.find((a) => a.id === 'broken')!.status).toBe('failed');
    expect(project.warnings!.find((w) => w.code === 'adapter-failed')!.message).toContain('boom');
    expect(project.screens.length).toBeGreaterThan(0);
  });

  it('reports parse errors without failing the analysis', async () => {
    const dir = path.join(temp, 'broken-dart');
    mkdirSync(path.join(dir, 'lib'), { recursive: true });
    writeFileSync(path.join(dir, 'pubspec.yaml'), 'name: broken\ndependencies:\n  flutter:\n    sdk: flutter\n');
    writeFileSync(path.join(dir, 'lib', 'main.dart'), 'class HomeScreen extends StatelessWidget {\n  Widget build(BuildContext c) { return Scaffold(\n}\n');
    const { project } = await analyzeProject(dir, { adapters: defaultAdapters });
    expect(project.warnings!.some((w) => w.code === 'parse-errors' && w.location?.fileId === 'lib/main.dart')).toBe(true);
    expect(project.adapters![0]!.status).not.toBe('failed');
  });
});
