import type { DeepLink, Evidence, NavigationRoute, Screen } from '@appflow/model';
import type { ScannedFile } from '../fs/projectFs';
import { descendants, documentElement, parseXml, type XmlElement } from '../parsing/xml';
import type { WarningInput } from './types';

/**
 * Deep links declared in platform configuration. They live in the native
 * shell of every framework (an Android manifest or an iOS plist), so they are
 * collected once for the whole project instead of per adapter.
 */

const MAX_LINKS_PER_FILTER = 24;

const declaredEvidence = (fileId: string, line: number, detail: string): Evidence => ({ source: 'declared', detail, location: { fileId, line }, confidence: 'high', adapter: 'deep-links' });

interface Ctx {
  files: ScannedFile[];
  readText(path: string): Promise<string | null>;
  warn(w: WarningInput): void;
  screens: Screen[];
  routes: NavigationRoute[];
}

const segments = (path: string) => path.split('/').filter(Boolean);
const isParam = (seg: string) => seg.startsWith(':') || seg === '*' || seg.startsWith('{') || seg.startsWith('<');

/**
 * Route a link path opens: same segments, where a route parameter or a link
 * wildcard matches anything. With `prefix`, the route may be longer; the
 * shortest such route wins.
 */
export function routeForPath(path: string, routes: NavigationRoute[], prefix = false): NavigationRoute | undefined {
  const link = segments(path.replace(/(\.\*|\*)$/, ''));
  const candidates = routes
    .filter((r) => r.path && r.screenId)
    .filter((r) => {
      const route = segments(r.path!);
      if (prefix ? route.length < link.length : route.length !== link.length) return false;
      return link.every((seg, i) => seg === route[i] || isParam(route[i]!) || seg === '*' || seg === '.*');
    });
  return candidates.sort((a, b) => segments(a.path!).length - segments(b.path!).length || (a.path! < b.path! ? -1 : 1))[0];
}

function attr(el: XmlElement, name: string): string | undefined {
  return el.attrs[`android:${name}`];
}

async function androidLinks(ctx: Ctx, file: string): Promise<DeepLink[]> {
  const text = await ctx.readText(file);
  if (text === null) return [];
  let root: XmlElement | undefined;
  try {
    root = documentElement(parseXml(text));
  } catch {
    return []; // the Android adapter reports unparsable manifests
  }
  if (!root) return [];
  const out: DeepLink[] = [];
  for (const activity of descendants(root).filter((e) => e.name === 'activity' || e.name === 'activity-alias')) {
    const className = attr(activity, 'targetActivity') ?? attr(activity, 'name') ?? '';
    const simple = className.slice(className.lastIndexOf('.') + 1);
    const screen = ctx.screens.find((s) => s.id === `android:${simple}`);
    for (const filter of activity.children.filter((c) => c.name === 'intent-filter')) {
      const has = (tag: string, value: string) => filter.children.some((c) => c.name === tag && attr(c, 'name') === value);
      if (!has('action', 'android.intent.action.VIEW') || !has('category', 'android.intent.category.BROWSABLE')) continue;
      const data = filter.children.filter((c) => c.name === 'data');
      // Android combines every <data> of one filter: schemes × hosts × paths.
      const schemes = [...new Set(data.map((d) => attr(d, 'scheme')).filter((s): s is string => !!s))];
      const hosts = [...new Set(data.map((d) => attr(d, 'host')).filter((s): s is string => !!s))];
      const paths = data.flatMap((d) => {
        const p = attr(d, 'path') ?? (attr(d, 'pathPrefix') ? `${attr(d, 'pathPrefix')}*` : undefined) ?? attr(d, 'pathPattern') ?? attr(d, 'pathAdvancedPattern');
        return p ? [{ path: p, prefix: !attr(d, 'path'), line: d.line }] : [];
      });
      const verified = filter.attrs['android:autoVerify'] === 'true';
      const combos: Array<{ scheme: string; host?: string; path?: string; prefix: boolean; line: number }> = [];
      for (const scheme of schemes) {
        for (const host of hosts.length ? hosts : [undefined]) {
          for (const p of paths.length ? paths : [undefined]) combos.push({ scheme, host, path: p?.path, prefix: p?.prefix ?? true, line: p?.line ?? data[0]?.line ?? filter.line });
        }
      }
      for (const c of combos.slice(0, MAX_LINKS_PER_FILTER)) {
        const web = c.scheme === 'http' || c.scheme === 'https';
        const url = `${c.scheme}://${c.host ?? ''}${c.path ?? ''}`;
        const route = !screen && c.path ? routeForPath(c.path, ctx.routes, c.prefix) : undefined;
        const screenId = screen?.id ?? route?.screenId ?? null;
        out.push({
          id: `android:${file}:${url}`,
          url,
          scheme: c.scheme,
          host: c.host,
          path: c.path,
          kind: web ? (verified ? 'app-link' : 'web-link') : 'custom-scheme',
          platform: 'android',
          screenId,
          routeId: route?.id,
          unresolvedReason: screenId
            ? undefined
            : c.path
              ? `No route matches ${c.path}; ${simple || 'the activity'} routes it at runtime.`
              : `The link has no path; ${simple || 'the activity'} decides what to show at runtime.`,
          location: { fileId: file, line: c.line },
          evidence: [declaredEvidence(file, c.line, `<intent-filter> VIEW/BROWSABLE on ${simple || className}: ${url}`)],
        });
      }
      if (combos.length > MAX_LINKS_PER_FILTER) {
        ctx.warn({ code: 'deep-links-truncated', severity: 'info', message: `An intent filter in ${file} declares ${combos.length} link combinations; only the first ${MAX_LINKS_PER_FILTER} are listed.`, location: { fileId: file, line: filter.line } });
      }
    }
  }
  return out;
}

/** `<key>name</key><value/>` pairs of a plist `<dict>`. */
function dictEntries(dict: XmlElement): Array<[XmlElement, XmlElement]> {
  const out: Array<[XmlElement, XmlElement]> = [];
  for (let i = 0; i + 1 < dict.children.length; i++) {
    const k = dict.children[i]!;
    if (k.name === 'key') out.push([k, dict.children[++i]!]);
  }
  return out;
}

async function iosLinks(ctx: Ctx, file: string): Promise<DeepLink[]> {
  const text = await ctx.readText(file);
  if (text === null) return [];
  let doc: XmlElement;
  try {
    doc = parseXml(text);
  } catch {
    return [];
  }
  const out: DeepLink[] = [];
  const unresolved = 'Handled in app code at runtime (onOpenURL / application(_:open:)); the destination screen is not known statically.';
  for (const dict of descendants(doc).filter((e) => e.name === 'dict')) {
    for (const [key, value] of dictEntries(dict)) {
      if (key.text === 'CFBundleURLSchemes' && value.name === 'array') {
        for (const s of value.children.filter((c) => c.name === 'string' && c.text)) {
          out.push({
            id: `ios:${file}:${s.text}://`,
            url: `${s.text}://`,
            scheme: s.text!,
            kind: 'custom-scheme',
            platform: 'ios',
            screenId: null,
            unresolvedReason: unresolved,
            location: { fileId: file, line: s.line },
            evidence: [declaredEvidence(file, s.line, `CFBundleURLSchemes: ${s.text}`)],
          });
        }
      }
      if (key.text === 'com.apple.developer.associated-domains' && value.name === 'array') {
        for (const s of value.children.filter((c) => c.name === 'string' && c.text?.startsWith('applinks:'))) {
          const host = s.text!.slice('applinks:'.length).split('?')[0]!;
          out.push({
            id: `ios:${file}:https://${host}`,
            url: `https://${host}`,
            scheme: 'https',
            host,
            kind: 'app-link',
            platform: 'ios',
            screenId: null,
            unresolvedReason: `Paths are listed in the apple-app-site-association file on ${host}, which is not read. ${unresolved}`,
            location: { fileId: file, line: s.line },
            evidence: [declaredEvidence(file, s.line, `Associated domain ${s.text}`)],
          });
        }
      }
    }
  }
  return out;
}

export async function collectDeepLinks(ctx: Ctx): Promise<DeepLink[]> {
  const out: DeepLink[] = [];
  for (const f of ctx.files) {
    if (f.path.endsWith('src/main/AndroidManifest.xml')) out.push(...(await androidLinks(ctx, f.path)));
    else if ((f.path.endsWith('/Info.plist') || f.path === 'Info.plist' || f.path.endsWith('.entitlements')) && !/Tests?\//.test(f.path)) out.push(...(await iosLinks(ctx, f.path)));
  }
  const seen = new Set<string>();
  return out.filter((d) => !seen.has(d.id) && seen.add(d.id));
}
