import { createHash } from 'node:crypto';
import type { ProjectFs, ScannedFile } from '@appflow/analyzer';
import type { AppProject } from '@appflow/model';

/** Size and modification time of each project file when an analysis started. */
export type Snapshot = Map<string, { size: number; mtimeMs?: number }>;

export function snapshotOf(files: ScannedFile[]): Snapshot {
  return new Map(files.map((f) => [f.path, { size: f.sizeBytes, mtimeMs: f.mtimeMs }]));
}

export interface SourceChanges {
  changed: boolean;
  counts: { added: number; removed: number; modified: number };
  /** Up to `MAX_LISTED` paths of each kind. */
  added: string[];
  removed: string[];
  modified: string[];
}

const MAX_LISTED = 50;

/**
 * Files added, removed or edited since an analysis. A file whose time changed
 * but whose content still matches the analyzed hash (e.g. after `git checkout`
 * of the same content) does not count as modified.
 */
export async function detectChanges(fs: ProjectFs, before: Snapshot, analyzed: AppProject | undefined, signal?: AbortSignal): Promise<SourceChanges> {
  const now = await fs.scan(signal);
  const hashes = new Map((analyzed?.files ?? []).filter((f) => f.contentHash).map((f) => [f.path, f.contentHash!]));
  const added: string[] = [];
  const modified: string[] = [];
  const seen = new Set<string>();
  for (const f of now.files) {
    seen.add(f.path);
    const old = before.get(f.path);
    if (!old) {
      added.push(f.path);
      continue;
    }
    if (old.size === f.sizeBytes && old.mtimeMs === f.mtimeMs) continue;
    const hash = hashes.get(f.path);
    if (hash && old.size === f.sizeBytes) {
      try {
        if (createHash('sha1').update(await fs.readText(f.path), 'utf8').digest('hex') === hash) continue;
      } catch {
        // unreadable now: report it as modified
      }
    }
    modified.push(f.path);
  }
  const removed = [...before.keys()].filter((p) => !seen.has(p));
  return {
    changed: added.length + removed.length + modified.length > 0,
    counts: { added: added.length, removed: removed.length, modified: modified.length },
    added: added.slice(0, MAX_LISTED),
    removed: removed.slice(0, MAX_LISTED),
    modified: modified.slice(0, MAX_LISTED),
  };
}
