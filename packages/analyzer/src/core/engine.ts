import type { AdapterRun, AppProject, PlatformId, SourceFile, SourceFileKind, SourceLanguage } from '@appflow/model';
import { ProjectFs, type ScannedFile } from '../fs/projectFs';
import { codeLanguageOf, extractFacts, type FileFacts } from '../parsing';
import { ProjectGraphBuilder } from './builder';
import { basename, type AnalysisAdapter, type AnalysisContext, type DetectionMatch, type DetectContext } from './types';

export type AnalysisPhase = 'scanning' | 'detecting' | 'analyzing' | 'assembling' | 'done';

export interface AnalysisProgress {
  phase: AnalysisPhase;
  message: string;
  /** 0–100. */
  percent: number;
}

export interface AnalyzeOptions {
  adapters: AnalysisAdapter[];
  signal?: AbortSignal;
  onProgress?: (progress: AnalysisProgress) => void;
  maxFiles?: number;
  /** Code files larger than this are listed but not parsed. */
  maxParseBytes?: number;
  /** Clock for `analyzedAt` (tests pass a fixed one). */
  now?: () => Date;
}

export interface AnalysisResult {
  project: AppProject;
  durationMs: number;
}

const LANGUAGE_BY_EXT: Record<string, SourceLanguage> = {
  '.dart': 'dart', '.kt': 'kotlin', '.kts': 'kotlin', '.java': 'java', '.swift': 'swift', '.m': 'objc', '.mm': 'objc', '.h': 'objc',
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.xml': 'xml', '.storyboard': 'xml', '.xib': 'xml', '.yaml': 'yaml', '.yml': 'yaml', '.json': 'json', '.gradle': 'gradle',
  '.plist': 'plist', '.md': 'markdown', '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image', '.svg': 'image',
};

const CONFIG_NAMES = new Set(['pubspec.yaml', 'package.json', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'AndroidManifest.xml', 'Info.plist', 'project.pbxproj', 'Package.swift', 'Podfile', 'app.json', 'analysis_options.yaml', 'tsconfig.json', 'babel.config.js', 'metro.config.js', 'gradle.properties']);

export function languageOf(path: string): SourceLanguage {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  return LANGUAGE_BY_EXT[ext] ?? 'text';
}

function kindOf(path: string, language: SourceLanguage): SourceFileKind {
  const name = basename(path);
  if (CONFIG_NAMES.has(name) || path.endsWith('.pbxproj')) return 'config';
  if (/(^|\/)(test|tests|__tests__|androidTest|testDebug|[A-Za-z]+Tests|[A-Za-z]+UITests)\//.test(path) || /(_test\.dart|\.test\.[jt]sx?|\.spec\.[jt]sx?|Test\.(kt|java|swift))$/.test(path)) return 'test';
  if (language === 'image' || /\.(ttf|otf|woff2?|mp3|mp4|lottie)$/i.test(path) || /(^|\/)assets?\//.test(path)) return 'asset';
  if (/\/res\//.test(path) || /\.(storyboard|xib|xcassets)/.test(path) || path.includes('.xcassets/')) return 'resource';
  if (codeLanguageOf(path)) return 'source';
  return 'other';
}

const PRIMARY_ORDER: PlatformId[] = ['react-native', 'flutter', 'android', 'ios'];

/** Marks native matches inside a cross-platform app's `android/` or `ios/` folder as hosts. */
function assignRoles(matches: DetectionMatch[]): DetectionMatch[] {
  const crossPlatform = matches.filter((m) => m.platform === 'flutter' || m.platform === 'react-native');
  return matches.map((m) => {
    if (m.platform !== 'android' && m.platform !== 'ios') return m;
    const host = crossPlatform.find((c) => m.root === [c.root, m.platform].filter(Boolean).join('/'));
    return host ? { ...m, role: 'host' } : m;
  });
}

/**
 * Analyzes a project directory: scans files (never reading sensitive ones),
 * detects project types, runs each matching adapter, and assembles the
 * normalized project model. An adapter failure is reported as a warning and
 * the remaining adapters still run, so partial results stay usable.
 */
export async function analyzeProject(root: string, options: AnalyzeOptions): Promise<AnalysisResult> {
  const started = Date.now();
  const { signal } = options;
  const report = (phase: AnalysisPhase, message: string, percent: number) => options.onProgress?.({ phase, message, percent: Math.round(percent) });

  report('scanning', 'Scanning project files', 2);
  const fs = await ProjectFs.open(root, { maxFiles: options.maxFiles });
  const scan = await fs.scan(signal);
  const out = new ProjectGraphBuilder();
  if (scan.excludedSensitive.length) {
    out.warn({
      code: 'sensitive-files-excluded',
      severity: 'info',
      message: `${scan.excludedSensitive.length} file(s) that may contain secrets were skipped and never read (e.g. ${scan.excludedSensitive.slice(0, 3).join(', ')}).`,
    });
  }
  if (scan.truncated) {
    out.warn({ code: 'scan-truncated', severity: 'warning', message: `The project has more than ${options.maxFiles ?? 20000} files; only the first ones were analyzed.` });
  }

  const readText = async (path: string) => {
    try {
      return await fs.readText(path);
    } catch {
      return null;
    }
  };
  const detectCtx: DetectContext = { files: scan.files, fs, readText };

  report('detecting', 'Detecting project type', 8);
  let matches: DetectionMatch[] = [];
  for (const adapter of options.adapters) {
    signal?.throwIfAborted();
    try {
      matches.push(...(await adapter.detect(detectCtx)));
    } catch (error) {
      out.setAdapter(adapter.id);
      out.warn({ code: 'detection-failed', severity: 'error', message: `${adapter.name} detection failed: ${String(error)}` });
    }
  }
  matches = assignRoles(matches);
  if (!matches.length) {
    out.warn({
      code: 'unsupported-project',
      severity: 'warning',
      message: 'No supported project type was detected (Flutter, Android, iOS or React Native). Only the file tree is available.',
    });
  }

  const factsCache = new Map<string, Promise<FileFacts | null>>();
  const maxParseBytes = options.maxParseBytes ?? 1024 * 1024;
  const sizes = new Map(scan.files.map((f) => [f.path, f.sizeBytes]));
  const runs: AdapterRun[] = [];

  const ordered = [...matches].sort((a, b) => PRIMARY_ORDER.indexOf(a.platform) - PRIMARY_ORDER.indexOf(b.platform));
  for (let i = 0; i < ordered.length; i++) {
    const match = ordered[i]!;
    const adapter = options.adapters.find((a) => a.id === match.adapterId)!;
    signal?.throwIfAborted();
    out.setAdapter(adapter.id);
    const warningsBefore = out.warnings.length;
    const base = 10 + (80 * i) / ordered.length;
    const span = 80 / ordered.length;
    report('analyzing', `${adapter.name}: ${match.root || 'project root'}`, base);

    const ctx: AnalysisContext = {
      ...detectCtx,
      signal,
      matches,
      warn: (w) => out.warn(w),
      progress: (message) => report('analyzing', `${adapter.name}: ${message}`, base + span / 2),
      facts: (path) => {
        let cached = factsCache.get(path);
        if (!cached) {
          cached = (async () => {
            if ((sizes.get(path) ?? 0) > maxParseBytes) {
              out.warn({ code: 'file-too-large', severity: 'info', message: `Skipped parsing a large file (${path}).`, location: { fileId: path, line: 1 } });
              return null;
            }
            const text = await readText(path);
            if (text === null) return null;
            try {
              const facts = await extractFacts(path, text);
              if (facts && facts.syntaxErrors > 0) {
                out.warn({ code: 'parse-errors', severity: 'info', message: `${facts.syntaxErrors} syntax error(s) in ${path}; results for this file may be incomplete.`, location: { fileId: path, line: 1 } });
              }
              return facts;
            } catch (error) {
              out.warn({ code: 'parse-failed', severity: 'warning', message: `Could not parse ${path}: ${String(error)}`, location: { fileId: path, line: 1 } });
              return null;
            }
          })();
          factsCache.set(path, cached);
        }
        return cached;
      },
    };

    const t0 = Date.now();
    let status: AdapterRun['status'] = 'complete';
    try {
      await adapter.analyze(ctx, match, out);
      if (out.warnings.slice(warningsBefore).some((w) => w.severity !== 'info')) status = 'partial';
    } catch (error) {
      if (signal?.aborted) throw error;
      status = 'failed';
      out.warn({ code: 'adapter-failed', severity: 'error', message: `${adapter.name} failed on ${match.root || 'the project root'}: ${error instanceof Error ? error.message : String(error)}` });
    }
    const existing = runs.find((r) => r.id === adapter.id);
    if (existing) existing.status = existing.status === 'failed' || status === 'failed' ? 'failed' : status === 'partial' ? 'partial' : existing.status;
    else runs.push({ id: adapter.id, name: adapter.name, status, capabilities: adapter.capabilities.map((c) => c.description), durationMs: Date.now() - t0 });
  }

  report('assembling', 'Assembling project model', 94);
  const modules = [...out.modules.values()].sort((a, b) => b.path.length - a.path.length);
  const moduleOf = (path: string) => modules.find((m) => m.path === '' || path === m.path || path.startsWith(`${m.path}/`))?.id;
  const files: SourceFile[] = scan.files.map((f: ScannedFile) => {
    const language = languageOf(f.path);
    return { id: f.path, path: f.path, language, kind: kindOf(f.path, language), moduleId: moduleOf(f.path), sizeBytes: f.sizeBytes };
  });
  for (const screen of out.screens.values()) screen.moduleId ??= moduleOf(screen.location.fileId);
  for (const asset of out.assets.values()) asset.moduleId ??= moduleOf(asset.path);

  const primary = ordered.find((m) => m.role === 'primary');
  const platforms = [...new Set(ordered.filter((m) => m.role === 'primary').map((m) => m.platform))];
  const rootModule = modules.find((m) => m.path === (primary?.root ?? ''));
  const project: AppProject = {
    id: `project:${fs.root}`,
    name: rootModule?.name ?? basename(fs.root.replace(/\\/g, '/')),
    framework: primary?.platform ?? 'flutter',
    platforms,
    frameworks: ordered.map((m) => m.framework),
    rootPath: fs.root,
    source: 'analysis',
    analyzedAt: (options.now?.() ?? new Date()).toISOString(),
    modules: [...out.modules.values()],
    files,
    screens: [...out.screens.values()],
    routes: [...out.routes.values()],
    edges: [...out.edges.values()],
    assets: [...out.assets.values()],
    warnings: out.warnings,
    adapters: runs,
    excludedSensitiveFiles: scan.excludedSensitive.length,
  };
  report('done', 'Analysis complete', 100);
  return { project, durationMs: Date.now() - started };
}
