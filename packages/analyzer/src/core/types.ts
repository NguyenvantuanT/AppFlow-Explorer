import type { AnalysisWarning, Confidence, DetectedFramework, PlatformId } from '@appflow/model';
import type { ProjectFs, ScannedFile } from '../fs/projectFs';
import type { FileFacts } from '../parsing/facts';
import type { ProjectGraphBuilder } from './builder';
import type { UiStateRule } from './uiStates';

export type CapabilityKind =
  | 'modules'
  | 'dependencies'
  | 'screens'
  | 'routes'
  | 'navigation-edges'
  | 'components'
  | 'handlers'
  | 'assets'
  | 'entry-points'
  | 'ui-states'
  | 'deep-links';

/** One thing an adapter can discover, with how far it can be trusted. */
export interface Capability {
  kind: CapabilityKind;
  /** What exactly is discovered, e.g. "Activities declared in AndroidManifest.xml". */
  description: string;
  confidence: Confidence;
}

/** A known gap, documented and surfaced so partial results are never mistaken for complete ones. */
export interface Limitation {
  description: string;
}

export type WarningInput = Omit<AnalysisWarning, 'id' | 'adapter'>;

export interface DetectContext {
  files: ScannedFile[];
  fs: ProjectFs;
  /** Reads a file; returns null (never throws) when it cannot be read. */
  readText(path: string): Promise<string | null>;
}

export interface DetectionMatch {
  adapterId: string;
  platform: PlatformId;
  /** Project-relative directory the match applies to ('' = project root). */
  root: string;
  /**
   * - `primary`: an app or package to analyze fully.
   * - `host`: a native shell of a cross-platform app (e.g. a Flutter app's `android/`).
   */
  role: 'primary' | 'host';
  framework: DetectedFramework;
  /** Adapter-private data gathered during detection. */
  data?: unknown;
}

export interface AnalysisContext extends DetectContext {
  signal?: AbortSignal;
  /** Parses a code file (cached across adapters). Returns null for unsupported or unreadable files. */
  facts(path: string): Promise<FileFacts | null>;
  warn(warning: WarningInput): void;
  progress(message: string): void;
  /** Detection matches of every adapter, e.g. to know a native folder is a host. */
  matches: DetectionMatch[];
}

export interface AnalysisAdapter {
  id: string;
  name: string;
  platform: PlatformId;
  capabilities: Capability[];
  limitations: Limitation[];
  /** Code patterns of UI states (loading, error, tabs…) for this framework, matched inside each screen it found. */
  uiStateRules?: UiStateRule[];
  detect(ctx: DetectContext): Promise<DetectionMatch[]>;
  analyze(ctx: AnalysisContext, match: DetectionMatch, out: ProjectGraphBuilder): Promise<void>;
}

/** Files under `dir` ('' = all). */
export function filesUnder(files: ScannedFile[], dir: string): ScannedFile[] {
  if (!dir) return files;
  const prefix = dir.endsWith('/') ? dir : `${dir}/`;
  return files.filter((f) => f.path.startsWith(prefix));
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join('/');
}

/** `ProductDetailScreen` → `Product Detail`. */
export function humanize(className: string, suffixes = ['Screen', 'Page', 'View', 'Activity', 'Fragment', 'ViewController', 'Controller', 'Dialog', 'Sheet']): string {
  let name = className.replace(/^_+/, '');
  for (const s of suffixes) {
    if (name.length > s.length && name.endsWith(s)) {
      name = name.slice(0, -s.length);
      break;
    }
  }
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}
