import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isIgnoredDirectory, isIgnoredPath, isSensitiveFile } from './sensitive';

/** Raised when a path would leave the project directory or touch an excluded file. */
export class AccessDeniedError extends Error {
  readonly code = 'access_denied';
}

export interface ScannedFile {
  /** Project-relative path with forward slashes. */
  path: string;
  sizeBytes: number;
  /** Last modification time, used to notice edits after an analysis. */
  mtimeMs?: number;
}

export interface ScanResult {
  files: ScannedFile[];
  /** Project-relative paths of sensitive files that were skipped (never read). */
  excludedSensitive: string[];
  /** True when the scan stopped at `maxFiles`. */
  truncated: boolean;
}

export interface ProjectFsOptions {
  maxFiles?: number;
  /** Largest file `readText` will return. */
  maxReadBytes?: number;
}

const DEFAULT_MAX_FILES = 20_000;
const DEFAULT_MAX_READ_BYTES = 2 * 1024 * 1024;

/**
 * Read-only view of one project directory. Every path is resolved against the
 * real (symlink-free) root, so nothing outside the selected directory and no
 * sensitive file can be read through it.
 */
export class ProjectFs {
  private constructor(
    readonly root: string,
    private readonly options: Required<ProjectFsOptions>,
  ) {}

  static async open(root: string, options: ProjectFsOptions = {}): Promise<ProjectFs> {
    const real = await fs.realpath(path.resolve(root));
    const stat = await fs.stat(real);
    if (!stat.isDirectory()) throw new Error(`Not a directory: ${root}`);
    return new ProjectFs(real, {
      maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
      maxReadBytes: options.maxReadBytes ?? DEFAULT_MAX_READ_BYTES,
    });
  }

  /** Normalizes a project-relative path, rejecting absolute paths and `..` escapes. */
  relative(relPath: string): string {
    if (typeof relPath !== 'string' || relPath.includes('\0')) throw new AccessDeniedError('Invalid path');
    const normalized = path.posix.normalize(relPath.replace(/\\/g, '/'));
    if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || normalized === '..' || normalized.startsWith('../')) {
      throw new AccessDeniedError(`Path is outside the project: ${relPath}`);
    }
    return normalized === '.' ? '' : normalized;
  }

  /** Resolves to an absolute path that is guaranteed to stay inside the root, following symlinks. */
  async resolve(relPath: string): Promise<string> {
    const rel = this.relative(relPath);
    const absolute = path.join(this.root, rel);
    let real: string;
    try {
      real = await fs.realpath(absolute);
    } catch {
      real = absolute; // does not exist; the caller's own fs call will report it
    }
    if (real !== this.root && !real.startsWith(this.root + path.sep)) {
      throw new AccessDeniedError(`Path resolves outside the project: ${relPath}`);
    }
    return real;
  }

  isSensitive(relPath: string): boolean {
    return relPath.split('/').some((segment) => isSensitiveFile(segment));
  }

  /** Reads a UTF-8 text file. Sensitive files are refused even when asked for explicitly. */
  async readText(relPath: string): Promise<string> {
    const rel = this.relative(relPath);
    if (this.isSensitive(rel)) throw new AccessDeniedError(`Refusing to read a sensitive file: ${rel}`);
    const absolute = await this.resolve(rel);
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) throw new AccessDeniedError(`Not a file: ${rel}`);
    if (stat.size > this.options.maxReadBytes) throw new AccessDeniedError(`File too large to read: ${rel}`);
    return fs.readFile(absolute, 'utf8');
  }

  /** Reads a binary file (images, fonts). Sensitive files are refused like text. */
  async readBytes(relPath: string, maxBytes = this.options.maxReadBytes): Promise<Buffer> {
    const rel = this.relative(relPath);
    if (this.isSensitive(rel)) throw new AccessDeniedError(`Refusing to read a sensitive file: ${rel}`);
    const absolute = await this.resolve(rel);
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) throw new AccessDeniedError(`Not a file: ${rel}`);
    if (stat.size > maxBytes) throw new AccessDeniedError(`File too large to read: ${rel}`);
    return fs.readFile(absolute);
  }

  async exists(relPath: string): Promise<boolean> {
    try {
      await fs.access(await this.resolve(relPath));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Lists project files, skipping dependency/build folders and symlinked
   * directories (which could point outside the project).
   */
  async scan(signal?: AbortSignal): Promise<ScanResult> {
    const files: ScannedFile[] = [];
    const excludedSensitive: string[] = [];
    let truncated = false;

    const walk = async (relDir: string): Promise<void> => {
      if (truncated) return;
      signal?.throwIfAborted();
      const entries = await fs.readdir(path.join(this.root, relDir), { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (!isIgnoredDirectory(entry.name) && !isIgnoredPath(rel)) await walk(rel);
        } else if (entry.isFile()) {
          if (isSensitiveFile(entry.name)) {
            excludedSensitive.push(rel);
            continue;
          }
          if (files.length >= this.options.maxFiles) {
            truncated = true;
            return;
          }
          const stat = await fs.stat(path.join(this.root, rel));
          files.push({ path: rel, sizeBytes: stat.size, mtimeMs: stat.mtimeMs });
        }
      }
    };

    await walk('');
    return { files, excludedSensitive, truncated };
  }
}
