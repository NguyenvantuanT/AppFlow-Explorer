import { AccessDeniedError, AndroidPreviewer, iconFontPaths, IosPreviewer, ReactNativePreviewer, type ProjectFs } from '@appflow/analyzer';
import type { AppProject, ScreenPreview } from '@appflow/model';
import { ApiError } from './errors';

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' };
const FONT_TYPES: Record<string, string> = { ttf: 'font/ttf', otf: 'font/otf' };
const MAX_ASSET_BYTES = 4 * 1024 * 1024;
// CJK fonts are large (Noto Sans JP is about 6 MB per weight).
const MAX_FONT_BYTES = 12 * 1024 * 1024;

interface Cached {
  analyzedAt?: string;
  reactNative?: Promise<ReactNativePreviewer>;
  android?: Promise<AndroidPreviewer>;
  ios?: IosPreviewer;
}

/**
 * Draws screens from their source code: React Native components and Android
 * layouts. Parsed modules and resources are kept per project and dropped
 * when a newer analysis exists.
 */
export class PreviewService {
  private readonly cache = new Map<string, Cached>();

  async screen(projectId: string, fs: ProjectFs, project: AppProject | undefined, screenId: string): Promise<ScreenPreview> {
    if (!project) throw new ApiError('conflict', 'The project has not been analyzed yet.');
    const screen = project.screens.find((s) => s.id === screenId);
    if (!screen) throw new ApiError('not_found', `No screen "${screenId}" in the latest analysis.`);
    const cached = this.entry(projectId, project.analyzedAt);
    const request = { screenId, file: screen.location.fileId, component: screen.widgetClass };
    if (screen.id.startsWith('react-native:')) {
      const module = project.modules?.find((m) => m.id === screen.moduleId) ?? project.modules?.find((m) => m.platform === 'react-native' && m.kind === 'app');
      cached.reactNative ??= ReactNativePreviewer.open(source(fs), module?.path ?? '');
      return (await cached.reactNative).preview(request);
    }
    if (screen.id.startsWith('android:') && (screen.platformKind === 'activity' || screen.platformKind === 'fragment')) {
      cached.android ??= AndroidPreviewer.open(source(fs), project.files.map((f) => f.path));
      return (await cached.android).preview(request);
    }
    if (screen.id.startsWith('ios:')) {
      cached.ios ??= IosPreviewer.open(source(fs), project.files.map((f) => f.path));
      const preview = await cached.ios.preview(request);
      if (preview) return preview;
      throw new ApiError('unsupported_media_type', 'This view controller builds its views in code; only XIB and storyboard screens can be drawn.');
    }
    throw new ApiError('unsupported_media_type', 'This kind of screen cannot be drawn from code yet.');
  }

  /** An image or font of the project as a data URI. */
  async asset(fs: ProjectFs, path: string): Promise<string> {
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    const type = IMAGE_TYPES[ext] ?? FONT_TYPES[ext];
    if (!type) throw new ApiError('unsupported_media_type', 'Only images and fonts can be loaded for a preview.');
    return `data:${type};base64,${(await read(fs, path, FONT_TYPES[ext] ? MAX_FONT_BYTES : MAX_ASSET_BYTES)).toString('base64')}`;
  }

  /** A react-native-vector-icons font, as a data URI. */
  async iconFont(fs: ProjectFs, project: AppProject | undefined, set: string): Promise<string> {
    if (!/^\w+$/.test(set)) throw new ApiError('invalid_request', 'Invalid icon set.');
    const root = project?.modules?.find((m) => m.platform === 'react-native' && m.kind === 'app')?.path ?? '';
    return `data:font/ttf;base64,${(await read(fs, iconFontPaths(root, set).font, MAX_FONT_BYTES)).toString('base64')}`;
  }

  forget(projectId: string): void {
    const c = this.cache.get(projectId);
    this.cache.delete(projectId);
    void c?.reactNative?.then((p) => p.dispose()).catch(() => undefined);
  }

  private entry(projectId: string, analyzedAt: string | undefined): Cached {
    const cached = this.cache.get(projectId);
    if (cached && cached.analyzedAt === analyzedAt) return cached;
    if (cached) this.forget(projectId);
    const fresh: Cached = { analyzedAt };
    this.cache.set(projectId, fresh);
    return fresh;
  }
}

function source(fs: ProjectFs) {
  return {
    readText: async (p: string) => {
      try {
        return await fs.readText(p);
      } catch {
        return null;
      }
    },
    exists: (p: string) => fs.exists(p),
  };
}

async function read(fs: ProjectFs, path: string, max: number): Promise<Buffer> {
  try {
    return await fs.readBytes(path, max);
  } catch (error) {
    if (error instanceof AccessDeniedError) throw new ApiError('forbidden', error.message);
    throw new ApiError('not_found', 'File not found.');
  }
}
