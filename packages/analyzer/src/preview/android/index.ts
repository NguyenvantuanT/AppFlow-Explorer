import type { PreviewNode, ScreenPreview } from '@appflow/model';
import { documentElement, parseXml } from '../../parsing/xml';
import type { PreviewSource } from '../modules';
import { AndroidLayoutBuilder, screenLayout, type AndroidTheme } from './layout';
import { AndroidResources } from './resources';

export const ANDROID_WIDTH = 360;
export const ANDROID_HEIGHT = 780;
const STATUS_BAR = 24;
const ACTION_BAR = 56;

interface ManifestEntry {
  theme?: string;
  label?: string;
}

/**
 * Draws Android activities, fragments and dialogs from their layout XML and
 * resources. One instance per project keeps the resource index.
 */
export class AndroidPreviewer {
  private constructor(
    private readonly source: PreviewSource,
    private readonly files: string[],
    private readonly res: AndroidResources,
    private readonly activities: Map<string, ManifestEntry>,
    private readonly appTheme: ManifestEntry,
  ) {}

  static async open(source: PreviewSource, files: string[]): Promise<AndroidPreviewer> {
    const res = await AndroidResources.load(source, files);
    await res.loadColorStates();
    const activities = new Map<string, ManifestEntry>();
    let appTheme: ManifestEntry = {};
    // The app module's manifest first, so its application theme wins.
    const manifests = files.filter((f) => f.endsWith('AndroidManifest.xml') && !/\/(build|debug|androidTest|test)\//.test(f)).sort((a, b) => Number(!/(^|\/)app\//.test(a)) - Number(!/(^|\/)app\//.test(b)));
    for (const m of manifests) {
      let root;
      try {
        root = documentElement(parseXml((await source.readText(m)) ?? ''));
      } catch {
        continue;
      }
      const app = root?.children.find((c) => c.name === 'application');
      if (!app) continue;
      if (!appTheme.theme && app.attrs['android:theme']) appTheme = { theme: app.attrs['android:theme'], label: app.attrs['android:label'] };
      for (const act of app.children.filter((c) => c.name === 'activity' || c.name === 'activity-alias')) {
        const name = act.attrs['android:name'];
        if (name) activities.set(name.slice(name.lastIndexOf('.') + 1), { theme: act.attrs['android:theme'], label: act.attrs['android:label'] });
      }
    }
    return new AndroidPreviewer(source, files, res, activities, appTheme);
  }

  async preview(req: { screenId: string; file: string; component: string }): Promise<ScreenPreview> {
    const notes = new Set<string>();
    const src = (await this.source.readText(req.file)) ?? '';
    const entry = this.activities.get(req.component);
    const themeName = entry?.theme ?? this.appTheme.theme;
    const { theme, actionBar } = this.theme(themeName);
    const builder = new AndroidLayoutBuilder(this.res, this.source, this.files, theme, notes);
    const layout = screenLayout(src);
    let content: PreviewNode[] = [];
    if (layout) content = await builder.inflate(layout, 'frame');
    else notes.add(`No layout was found for ${req.component} (setContentView, inflate or view binding).`);

    const dialog = /\bextends\s+(\w*Dialog\w*)|:\s*(\w*Dialog\w*)\s*\(/.exec(src);
    const sheet = /BottomSheet/.test(dialog?.[1] ?? dialog?.[2] ?? '');
    const children: PreviewNode[] = [];
    if (dialog) {
      // A dialog window wraps its content: a match_parent root is as tall as what it holds.
      for (const n of content) if (n.layout === 'constraints') n.wrapHeight = true;
      const card: PreviewNode = {
        type: 'view',
        component: 'Dialog',
        style: { ...FRAME, backgroundColor: theme.dark ? '#424242' : '#FFFFFF', ...(sheet ? { borderTopLeftRadius: 16, borderTopRightRadius: 16, gridArea: '1 / 1', alignSelf: 'end', justifySelf: 'stretch' } : { borderRadius: 8, width: '88%', gridArea: '1 / 1', alignSelf: 'center', justifySelf: 'center', overflow: 'hidden' }) },
        children: content,
      };
      children.push({ type: 'view', component: 'Window', style: { ...FRAME, flexGrow: 1, backgroundColor: 'rgba(0,0,0,0.6)' }, children: [card] });
    } else {
      if (actionBar) {
        const title = this.res.string(entry?.label ?? this.appTheme.label) ?? req.component;
        children.push({ type: 'view', component: 'ActionBar', style: { height: ACTION_BAR, flexDirection: 'row', alignItems: 'center', paddingLeft: 16, backgroundColor: theme.colorPrimary, elevation: 4 }, children: [{ type: 'text', style: { fontSize: 20, fontWeight: '500', color: theme.dark || isDark(theme.colorPrimary) ? '#FFFFFF' : 'rgba(0,0,0,0.87)' }, children: [{ type: 'raw', text: title }] }] });
      }
      children.push({ type: 'view', component: 'Content', style: { ...FRAME, flexGrow: 1, flexShrink: 1 }, children: content });
    }
    const root: PreviewNode = { type: 'view', component: req.component, style: { flex: 1, backgroundColor: dialog ? 'transparent' : theme.windowBackground, paddingTop: STATUS_BAR }, children };
    const fonts = [...builder.fontFamilies].map(([family, path]) => ({ family, path }));
    return { screenId: req.screenId, platform: 'android', width: ANDROID_WIDTH, height: ANDROID_HEIGHT, root, notes: [...notes], ...(fonts.length ? { fonts } : {}) };
  }

  private theme(name: string | undefined): { theme: AndroidTheme; actionBar: boolean } {
    const lineage = this.res.styleLineage(name);
    const items: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.res.style(name))) items[k.replace(/^android:/, '')] = v;
    const framework = lineage.find((n) => !this.res.styles.has(n)) ?? name ?? 'Theme.AppCompat.Light';
    const dark = /^Theme\.(AppCompat|MaterialComponents|Material3|Material|Holo)(\.NoActionBar|\.Dialog\w*|\.Translucent)?$/.test(framework.replace(/^android:/, '')) && !/Light|DayNight/.test(framework);
    const color = (k: string) => this.res.color(items[k]);
    const theme: AndroidTheme = {
      dark,
      windowBackground: color('windowBackground') ?? (dark ? '#303030' : '#FAFAFA'),
      textColor: color('textColorPrimary') ?? color('textColor') ?? (dark ? '#FFFFFF' : 'rgba(0,0,0,0.87)'),
      textColorSecondary: color('textColorSecondary') ?? (dark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.54)'),
      colorPrimary: color('colorPrimary') ?? (dark ? '#212121' : '#3F51B5'),
      colorAccent: color('colorAccent') ?? color('colorSecondary') ?? (dark ? '#80CBC4' : '#009688'),
    };
    const actionBar = !lineage.some((n) => /NoActionBar|NoTitleBar|Fullscreen/.test(n)) && items.windowNoTitle !== 'true' && items.windowActionBar !== 'false';
    return { theme, actionBar };
  }
}

const FRAME = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr)' } as const;

function isDark(color: string): boolean {
  const m = /^#([0-9A-F]{6})$/i.exec(color);
  if (!m) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16));
  return 0.299 * r! + 0.587 * g! + 0.114 * b! < 150;
}
