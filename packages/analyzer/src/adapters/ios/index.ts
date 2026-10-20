import { lookup } from '../shared';
import type { Dependency, Evidence, NavigationKind, ScreenKind, ScreenPlatformKind, WidgetRef } from '@appflow/model';
import type { ProjectGraphBuilder } from '../../core/builder';
import { CodeIndex, loc } from '../../core/codeIndex';
import { basename, dirname, filesUnder, humanize, joinPath, type AnalysisAdapter, type AnalysisContext, type DetectionMatch } from '../../core/types';
import { HANDLER_LABEL, ownerLabel } from '../../parsing/ast';
import type { CallFact, FileFacts } from '../../parsing/facts';
import { callText, declaredEvidence, staticEvidence, triggerFor, truncate, widgetKindOf } from '../shared';
import { mainStoryboardName, parseStoryboard, type SbController, type Storyboard } from './storyboard';

interface IosDetection {
  projects: string[];
}

const VC_BASES = new Set(['UIViewController', 'UITableViewController', 'UICollectionViewController', 'UIPageViewController', 'UIHostingController']);
const CONTAINERS = new Set(['UINavigationController', 'UITabBarController', 'UISplitViewController']);
const SYSTEM_CONTROLLERS = /^(UI(ActivityView|Alert|ImagePicker|DocumentPicker|DocumentBrowser|FontPicker|ColorPicker|ReferenceLibrary|PrinterPicker|Search|VideoEditor)Controller|SF\w*ViewController|MF\w+ViewController|PH\w+ViewController|CN\w+ViewController|AVPlayerViewController|SK\w+ViewController|QLPreviewController)$/;
const PUSH_CALLS: Record<string, NavigationKind> = lookup({
  pushViewController: 'push', show: 'push', showDetailViewController: 'push', setViewControllers: 'replace',
  present: 'modal', presentViewController: 'modal',
});
const SWIFTUI_MODALS = new Set(['sheet', 'fullScreenCover', 'popover']);

interface ScreenInfo {
  key: string;
  id: string;
  name: string;
  kind: ScreenKind;
  platformKind: ScreenPlatformKind;
  file: string;
  line: number;
  evidence: Evidence[];
  entry: boolean;
  widgets: WidgetRef[];
}

export const iosAdapter: AnalysisAdapter = {
  id: 'ios',
  name: 'iOS (Swift / Objective-C)',
  platform: 'ios',
  capabilities: [
    { kind: 'modules', description: 'Xcode projects (.xcodeproj) and Swift packages (Package.swift)', confidence: 'high' },
    { kind: 'dependencies', description: 'Swift Package Manager pins (Package.resolved) and CocoaPods (Podfile, best-effort)', confidence: 'medium' },
    { kind: 'screens', description: 'Storyboard scenes and their custom view controller classes', confidence: 'high' },
    { kind: 'navigation-edges', description: 'Storyboard segues (show, present, relationship) as declared configuration', confidence: 'high' },
    { kind: 'entry-points', description: 'Initial view controller of the main storyboard (Info.plist) and SwiftUI @main App WindowGroup root', confidence: 'high' },
    { kind: 'screens', description: 'UIViewController subclasses (Swift and Objective-C)', confidence: 'high' },
    { kind: 'navigation-edges', description: 'pushViewController / present / show with an instantiated or storyboard-identified controller; performSegue matched to segues', confidence: 'medium' },
    { kind: 'screens', description: 'SwiftUI views used as NavigationLink, navigationDestination, sheet/fullScreenCover, TabView or UIHostingController roots', confidence: 'medium' },
    { kind: 'navigation-edges', description: 'SwiftUI NavigationLink, navigationDestination, sheet/fullScreenCover/popover and TabView', confidence: 'medium' },
    { kind: 'components', description: 'Storyboard views (buttons, fields, tables), XIB-backed views and SwiftUI controls', confidence: 'medium' },
    { kind: 'handlers', description: '@IBAction methods, SwiftUI Button actions and gesture handlers', confidence: 'medium' },
    { kind: 'assets', description: 'Image sets in .xcassets with UIImage(named:) / Image("…") / storyboard references', confidence: 'high' },
  ],
  limitations: [
    { description: 'Objective-C support is limited to class declarations and [[X alloc] init] / [X new] pushes and presents.' },
    { description: 'Coordinators or routers that create controllers in other types are followed only one level through component usage.' },
    { description: 'Value-based NavigationLink(value:) is matched only through .navigationDestination in the same view.' },
    { description: 'System controllers (alerts, share sheets, Safari) are counted but not drawn.' },
  ],

  async detect(ctx) {
    const projects = [...new Set(ctx.files.map((f) => /^(.*?[^/]+\.xcodeproj)\//.exec(f.path)?.[1]).filter((p): p is string => !!p))];
    const packages = ctx.files.filter((f) => basename(f.path) === 'Package.swift').map((f) => dirname(f.path));
    const roots = new Map<string, string[]>();
    for (const p of projects) roots.set(dirname(p), [...(roots.get(dirname(p)) ?? []), p]);
    for (const pkg of packages) if (![...roots.keys()].some((r) => pkg === r || pkg.startsWith(r ? `${r}/` : ''))) roots.set(pkg, []);
    return [...roots].map(([root, xcodeprojs]): DetectionMatch => ({
      adapterId: 'ios',
      platform: 'ios',
      root,
      role: 'primary',
      framework: { id: 'ios', name: xcodeprojs.length ? 'iOS (Xcode)' : 'Swift package', evidence: xcodeprojs.length ? xcodeprojs.map((p) => `${p}/project.pbxproj`) : [joinPath(root, 'Package.swift')] },
      data: { projects: xcodeprojs } satisfies IosDetection,
    }));
  },

  async analyze(ctx, match, out) {
    const { projects } = match.data as IosDetection;
    const hostOf = match.role === 'host' ? ctx.matches.find((m) => m.role === 'primary' && (m.platform === 'flutter' || m.platform === 'react-native') && joinPath(m.root, 'ios') === match.root) : undefined;
    const dependencies = await iosDependencies(ctx, match.root);
    for (const p of projects.length ? projects : [match.root]) {
      out.addModule({
        id: `ios:${p || '.'}`,
        name: basename(p).replace(/\.xcodeproj$/, '') || 'app',
        path: projects.length ? dirname(p) : p,
        platform: 'ios',
        kind: hostOf ? 'host' : projects.length ? 'app' : 'package',
        dependencies,
      });
    }
    if (hostOf?.platform === 'flutter') {
      out.warn({ code: 'host-module', severity: 'info', message: `${match.root}/ is the iOS host of a Flutter app; it is listed as a module but its native screens are not analyzed.` });
      return;
    }
    await analyzeIos(ctx, match, out, !!hostOf);
  },
};

async function iosDependencies(ctx: AnalysisContext, root: string): Promise<Dependency[]> {
  const deps: Dependency[] = [];
  for (const f of filesUnder(ctx.files, root).filter((x) => basename(x.path) === 'Package.resolved')) {
    try {
      const json = JSON.parse((await ctx.readText(f.path)) ?? '{}');
      for (const pin of json.pins ?? json.object?.pins ?? []) deps.push({ name: pin.identity ?? pin.package, version: pin.state?.version ?? pin.state?.revision?.slice(0, 7) });
    } catch {
      ctx.warn({ code: 'json-parse-failed', severity: 'info', message: `Could not read ${f.path}.`, location: loc(f.path, 1) });
    }
  }
  const podfile = filesUnder(ctx.files, root).find((x) => basename(x.path) === 'Podfile');
  if (podfile) {
    for (const line of ((await ctx.readText(podfile.path)) ?? '').split('\n')) {
      const m = /^\s*pod\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/.exec(line);
      if (m) deps.push({ name: m[1]!, version: m[2] });
    }
  }
  return deps;
}

async function analyzeIos(ctx: AnalysisContext, match: DetectionMatch, out: ProjectGraphBuilder, isReactNativeHost: boolean): Promise<void> {
  const files = filesUnder(ctx.files, match.root);
  const index = new CodeIndex();
  const codeFiles = files.filter((f) => /\.(swift|m|mm|h)$/.test(f.path) && !/(Tests|UITests)\//.test(f.path));
  for (let i = 0; i < codeFiles.length; i++) {
    ctx.signal?.throwIfAborted();
    if (i % 50 === 0) ctx.progress(`parsing Swift/Objective-C (${i}/${codeFiles.length})`);
    const facts = await ctx.facts(codeFiles[i]!.path);
    if (facts) index.add(codeFiles[i]!.path, facts);
  }

  const screens = new Map<string, ScreenInfo>();
  const screenFor = (key: string, init: () => Omit<ScreenInfo, 'key' | 'evidence' | 'entry' | 'widgets'>) => {
    let s = screens.get(key);
    if (!s) screens.set(key, (s = { key, ...init(), evidence: [], entry: false, widgets: [] }));
    return s;
  };
  const classScreen = (name: string, platformKind: ScreenPlatformKind) => {
    const cls = index.classNamed(name)!;
    return screenFor(name, () => ({ id: `ios:${name}`, name: humanize(name), kind: 'page', platformKind, file: cls.file, line: cls.fact.line }));
  };

  // ---- View controllers -----------------------------------------------------------------------------
  const appDelegates = new Set<string>();
  for (const [name, list] of index.classes) {
    const cls = list[0]!.fact;
    if (cls.kind === 'extension' || cls.kind === 'protocol') continue;
    if (cls.supertypes.some((s) => /^(RCTAppDelegate|FlutterAppDelegate)$/.test(s))) appDelegates.add(name);
    if (index.extendsAny(name, CONTAINERS) && !index.extendsAny(name, VC_BASES)) continue;
    if (index.extendsAny(name, VC_BASES)) {
      const s = classScreen(name, 'view-controller');
      s.evidence.push({ source: 'static', detail: `${cls.supertypes[0]} subclass`, location: loc(s.file, s.line), confidence: 'high' });
    }
  }
  const swiftUIViews = new Set([...index.classes].filter(([, l]) => l.some((c) => c.fact.kind === 'struct' && c.fact.supertypes.includes('View'))).map(([n]) => n));
  const swiftUIScreen = (name: string, ev: Evidence, kind: ScreenKind = 'page') => {
    if (!swiftUIViews.has(name)) return undefined;
    const s = classScreen(name, 'swiftui-view');
    s.evidence.push(ev);
    if (kind !== 'page') s.kind = kind;
    return s;
  };

  // ---- Storyboards ----------------------------------------------------------------------------------
  const storyboards: Storyboard[] = [];
  for (const f of files.filter((x) => x.path.endsWith('.storyboard'))) {
    const text = await ctx.readText(f.path);
    if (!text) continue;
    try {
      storyboards.push(parseStoryboard(text, f.path));
    } catch (error) {
      out.warn({ code: 'xml-parse-failed', severity: 'warning', message: `Could not parse ${f.path}: ${String(error)}`, location: loc(f.path, 1) });
    }
  }
  const sbKey = new Map<string, string>(); // `${file}#${id}` → screen key
  const byStoryboardId = new Map<string, string>();
  for (const sb of storyboards) {
    for (const c of sb.controllers) {
      if (c.kind !== 'controller') continue;
      const known = c.customClass && index.classNamed(c.customClass);
      const key = known ? c.customClass! : `sb:${basename(sb.file)}#${c.id}`;
      const display = c.customClass ?? c.title ?? c.storyboardIdentifier ?? `Scene ${c.id}`;
      const s = known
        ? classScreen(c.customClass!, 'view-controller')
        : screenFor(key, () => ({ id: `ios:${key}`, name: humanize(display), kind: 'page', platformKind: 'storyboard-scene', file: sb.file, line: c.line }));
      if (c.customClass && !known) out.warn({ code: 'class-source-missing', severity: 'warning', message: `Storyboard scene uses ${c.customClass}, whose source was not found.`, location: loc(sb.file, c.line) });
      s.evidence.push(declaredEvidence(sb.file, c.line, `<${c.tag}${c.customClass ? ` customClass="${c.customClass}"` : ''}> in ${basename(sb.file)}`));
      s.widgets.push(...storyboardWidgets(c, sb.file));
      sbKey.set(`${sb.file}#${c.id}`, key);
      if (c.storyboardIdentifier) byStoryboardId.set(c.storyboardIdentifier, key);
      out.addRoute({ id: `storyboard:${sb.file}#${c.id}`, name: c.storyboardIdentifier ?? c.customClass ?? c.id, screenId: s.id, router: 'storyboard', location: loc(sb.file, c.line), evidence: [declaredEvidence(sb.file, c.line, `Scene ${c.storyboardIdentifier ?? c.id}`)] });
    }
  }
  const controllerOf = (sb: Storyboard, id: string) => sb.controllers.find((c) => c.id === id);
  /** Resolves containers to the screen(s) they show first (navigation root, first tab). */
  const resolveTarget = (sb: Storyboard, id: string, seen = new Set<string>()): string | undefined => {
    if (seen.has(id)) return undefined;
    seen.add(id);
    const c = controllerOf(sb, id);
    if (!c) return undefined;
    if (c.kind === 'controller') return sbKey.get(`${sb.file}#${id}`);
    const rel = sb.segues.find((s) => s.from === id && s.kind === 'relationship');
    return rel ? resolveTarget(sb, rel.destination, seen) : undefined;
  };
  const segueByIdentifier = new Map<string, { from: string; to: string; kind: NavigationKind }>();
  for (const sb of storyboards) {
    for (const seg of sb.segues) {
      if (seg.kind === 'relationship') {
        const from = controllerOf(sb, seg.from);
        if (from?.kind === 'tabBar') {
          const tabs = sb.segues.filter((s) => s.from === seg.from && s.kind === 'relationship').map((s) => resolveTarget(sb, s.destination)).filter((x): x is string => !!x);
          const first = tabs[0];
          const to = resolveTarget(sb, seg.destination);
          if (first && to && to !== first) {
            out.addEdge({ from: screens.get(first)!.id, to: screens.get(to)!.id, kind: 'tab', trigger: { label: 'Tab', description: `Tab bar item of ${from.title ?? 'tab bar controller'}`, location: loc(sb.file, seg.line) }, evidence: [declaredEvidence(sb.file, seg.line, `relationship="viewControllers" in ${basename(sb.file)}`)] });
          }
        }
        continue;
      }
      if (seg.kind === 'embed' || seg.kind === 'unwind') continue;
      const fromKey = resolveTarget(sb, seg.from);
      const toKey = resolveTarget(sb, seg.destination);
      if (!fromKey) continue;
      const destIsContainer = controllerOf(sb, seg.destination)?.kind === 'navigation';
      const kind: NavigationKind = /presentation|modal|popover/i.test(seg.kind) || destIsContainer ? 'modal' : 'push';
      if (seg.identifier && toKey) segueByIdentifier.set(seg.identifier, { from: fromKey, to: toKey, kind });
      const label = seg.triggerLabel ? `Tap “${seg.triggerLabel}”` : seg.identifier ?? seg.kind;
      out.addEdge({
        from: screens.get(fromKey)!.id,
        to: toKey ? screens.get(toKey)!.id : null,
        kind,
        trigger: { label: truncate(label, 40), description: `Segue ${seg.identifier ? `"${seg.identifier}" ` : ''}(${seg.kind})${seg.triggerTag ? ` from ${seg.triggerTag}` : ''}`, widget: seg.triggerTag, location: loc(sb.file, seg.line) },
        evidence: [declaredEvidence(sb.file, seg.line, `<segue kind="${seg.kind}"${seg.identifier ? ` identifier="${seg.identifier}"` : ''}>`)],
        ...(toKey ? {} : { unresolvedReason: `Segue destination ${seg.destination} is not a scene in ${basename(sb.file)}.`, unresolvedKind: 'missing-target' as const }),
      });
    }
  }
  // Entry: the main storyboard's initial controller.
  const plist = files.find((f) => basename(f.path) === 'Info.plist' && !f.path.includes('Tests'));
  const mainName = plist ? (() => {
    return ctx.readText(plist.path).then((t) => {
      try {
        return t ? mainStoryboardName(t) : undefined;
      } catch {
        return undefined;
      }
    });
  })() : Promise.resolve(undefined);
  const main = await mainName;
  const mainSb = storyboards.find((s) => basename(s.file) === `${main ?? 'Main'}.storyboard`);
  if (mainSb?.initialViewController) {
    const entry = resolveTarget(mainSb, mainSb.initialViewController);
    if (entry) screens.get(entry)!.entry = true;
  }

  // ---- SwiftUI roots: @main App WindowGroup and UIHostingController(rootView:) ---------------------
  for (const { call, file, facts } of index.allCalls()) {
    if (call.name === 'WindowGroup') {
      const app = index.classNamed(call.enclosingClass ?? '')?.fact;
      const root = call.args.flatMap((a) => a.typeRefs).find((t) => swiftUIViews.has(t));
      if (root && app?.annotations.includes('main')) {
        const s = swiftUIScreen(root, declaredEvidence(file, call.line, `WindowGroup root of @main ${app.name}`));
        if (s) s.entry = true;
      }
    }
    if (call.name === 'UIHostingController' || call.callee.endsWith('super.init') || call.name === 'init') {
      const rootArg = call.args.find((a) => a.label === 'rootView');
      const root = rootArg?.typeRefs.find((t) => swiftUIViews.has(t));
      if (!root) continue;
      const s = swiftUIScreen(root, staticEvidence(file, call, `UIHostingController(rootView: ${root}())`, 'high'));
      const host = call.enclosingClass && screens.get(call.enclosingClass);
      if (s && host && host !== s) {
        out.addEdge({ from: host.id, to: s.id, kind: 'replace', trigger: { label: 'Hosts SwiftUI', description: `${host.key} hosts ${root}`, location: loc(file, call.line) }, evidence: [staticEvidence(file, call, `rootView: ${root}()`, 'high')] });
      }
      void facts;
    }
  }

  // ---- Code navigation -------------------------------------------------------------------------------
  interface Intent { call: CallFact; file: string; facts: FileFacts; kind: NavigationKind; to: string | null; confidence: 'high' | 'medium' | 'low'; reason?: string; unresolvedKind?: 'dynamic' | 'missing-target' | 'unsupported' }
  const intents: Intent[] = [];
  let systemControllers = 0;
  const vcTarget = (refs: string[], strings: string[]): string | undefined =>
    refs.find((t) => screens.get(t)?.platformKind === 'view-controller') ?? strings.map((s) => byStoryboardId.get(s)).find(Boolean) ?? refs.find((t) => swiftUIViews.has(t));

  for (const { call, file, facts } of index.allCalls()) {
    const name = call.name;
    if (PUSH_CALLS[name] && !call.isInstantiation) {
      const arg = call.args.find((a) => !a.label || a.label === 'pushViewController' || a.label === 'presentViewController' || a.label === '_') ?? call.args[0];
      if (!arg) continue;
      let refs = arg.typeRefs;
      let strings = arg.strings;
      if (/^\w+$/.test(arg.text)) {
        const v = facts.variables.find((x) => x.name === arg.text && x.enclosingFunction === call.enclosingFunction);
        if (v) {
          refs = v.value.typeRefs;
          strings = v.value.strings;
        }
      }
      if (refs.some((t) => SYSTEM_CONTROLLERS.test(t)) && !vcTarget(refs, strings)) {
        systemControllers++;
        continue;
      }
      const target = vcTarget(refs, strings);
      if (target && swiftUIViews.has(target)) swiftUIScreen(target, staticEvidence(file, call, `Hosted and ${name === 'present' ? 'presented' : 'pushed'} by ${call.enclosingClass ?? 'code'}`, 'medium'));
      intents.push(target ? { call, file, facts, kind: PUSH_CALLS[name]!, to: target, confidence: 'medium' } : { call, file, facts, kind: PUSH_CALLS[name]!, to: null, confidence: 'low', reason: `\`${truncate(arg.text, 60)}\` is not a view controller of this project.`, unresolvedKind: 'dynamic' });
    } else if (name === 'performSegue' || name === 'performSegueWithIdentifier') {
      const id = index.resolveString(call.args[0]).value;
      const seg = id ? segueByIdentifier.get(id) : undefined;
      intents.push(seg ? { call, file, facts, kind: seg.kind, to: seg.to, confidence: 'high' } : { call, file, facts, kind: 'push', to: null, confidence: id ? 'medium' : 'low', reason: id ? `No storyboard segue has the identifier "${id}".` : 'Segue identifier is computed at runtime.', unresolvedKind: id ? 'missing-target' : 'dynamic' });
    } else if (name === 'NavigationLink' || name === 'navigationDestination') {
      const dest = call.args.find((a) => a.label === 'destination') ?? call.args.find((a) => a.isLambda);
      const target = dest?.typeRefs.find((t) => swiftUIViews.has(t));
      if (name === 'NavigationLink' && call.args.some((a) => a.label === 'value') && !target) continue; // resolved through navigationDestination
      if (target) {
        swiftUIScreen(target, staticEvidence(file, call, `${name} destination`, 'medium'));
        // A link is its own trigger: its label is the text it shows.
        const label = name === 'NavigationLink' ? ownerLabel(call.args.filter((a) => a !== dest)) : undefined;
        const linkCall = label && !call.handler ? { ...call, handler: { name: 'NavigationLink', owner: 'NavigationLink', ownerLabel: label } } : call;
        intents.push({ call: linkCall, file, facts, kind: 'push', to: target, confidence: 'medium' });
      } else {
        intents.push({ call, file, facts, kind: 'push', to: null, confidence: 'low', reason: `${name} destination \`${truncate(dest?.text ?? '?', 60)}\` is not a SwiftUI view of this project.`, unresolvedKind: 'dynamic' });
      }
    } else if (SWIFTUI_MODALS.has(name) && call.callee.includes('.')) {
      const content = call.args.filter((a) => a.isLambda || a.label === 'content').flatMap((a) => a.typeRefs).find((t) => swiftUIViews.has(t));
      if (content) {
        swiftUIScreen(content, staticEvidence(file, call, `.${name} content`, 'medium'), name === 'popover' ? 'dialog' : 'bottomSheet');
        intents.push({ call, file, facts, kind: 'modal', to: content, confidence: 'medium' });
      }
    } else if (name === 'TabView') {
      const tabs = call.args.filter((a) => a.isLambda).flatMap((a) => a.typeRefs).filter((t) => swiftUIViews.has(t));
      tabs.forEach((t) => swiftUIScreen(t, staticEvidence(file, call, 'TabView tab', 'medium')));
      for (const t of tabs.slice(1)) intents.push({ call, file, facts, kind: 'tab', to: t, confidence: 'medium', reason: tabs[0] });
    }
  }
  if (systemControllers) out.warn({ code: 'system-controllers', severity: 'info', message: `${systemControllers} system controller presentation(s) (alerts, share sheets, …) are not drawn.` });

  // Name-based SwiftUI screens that were not reached by navigation.
  for (const v of swiftUIViews) {
    if (screens.has(v) || !/(Screen|Page)$/.test(v)) continue;
    swiftUIScreen(v, { source: 'static', detail: `${v} is named like a screen`, location: loc(index.classNamed(v)!.file, index.classNamed(v)!.fact.line), confidence: 'low' });
  }

  const screenKeys = new Set(screens.keys());
  const fromScreens = (call: CallFact, file: string): string[] => {
    if (call.enclosingClass && screenKeys.has(call.enclosingClass)) return [call.enclosingClass];
    return index.ownersUsing(call.enclosingClass ?? call.enclosingFunction ?? '', screenKeys, 3, file);
  };
  for (const intent of intents) {
    const { call, file } = intent;
    const froms = intent.kind === 'tab' && intent.reason ? [intent.reason] : fromScreens(call, file);
    if (!froms.length) {
      if (!appDelegates.has(call.enclosingClass ?? '')) {
        out.warn({ code: 'navigation-outside-screen', severity: 'info', message: `${call.callee} in ${call.enclosingClass ?? call.enclosingFunction ?? 'top-level code'} could not be attributed to a screen.`, location: loc(file, call.line) });
      }
      continue;
    }
    const fallback = call.enclosingFunction ? `${call.enclosingFunction}()` : call.name;
    for (const from of froms) {
      if (from === intent.to) continue;
      out.addEdge({
        from: screens.get(from)!.id,
        to: intent.to ? screens.get(intent.to)!.id : null,
        kind: intent.kind,
        trigger: triggerFor(file, call, call.handler, intent.kind === 'tab' ? 'Tab' : fallback),
        evidence: [staticEvidence(file, call, callText(call), intent.confidence)],
        ...(intent.to ? {} : { unresolvedReason: intent.reason, unresolvedKind: intent.unresolvedKind }),
      });
    }
  }
  if (isReactNativeHost && !screens.size) {
    out.warn({ code: 'host-module', severity: 'info', message: `${match.root}/ hosts the React Native app; no native screens were found.` });
  }

  // ---- Components, XIBs and assets ------------------------------------------------------------------
  const xibs = new Map(files.filter((f) => f.path.endsWith('.xib')).map((f) => [basename(f.path).replace(/\.xib$/, ''), f.path]));
  for (const s of screens.values()) {
    if (s.platformKind === 'swiftui-view') s.widgets.push(...swiftUIComponents(index, s.key, swiftUIViews, screenKeys));
    for (const { call, file } of index.allCalls()) {
      if (call.enclosingClass !== s.key) continue;
      for (const str of call.args.flatMap((a) => a.strings)) {
        const xib = xibs.get(str);
        if (xib && !s.widgets.some((w) => w.location?.fileId === xib)) s.widgets.push({ name: `${str} (xib)`, kind: 'custom', location: loc(xib, 1) });
      }
      void file;
    }
    out.addScreen({ id: s.id, name: s.name, kind: s.kind, platformKind: s.platformKind, widgetClass: s.key.startsWith('sb:') ? s.key.split('#')[1]! : s.key, location: loc(s.file, s.line), isEntryPoint: s.entry, keyWidgets: s.widgets.slice(0, 15), states: [], evidence: s.evidence });
  }
  await iosAssets(ctx, out, files, index, storyboards);
}

function storyboardWidgets(c: SbController, file: string): WidgetRef[] {
  const out: WidgetRef[] = [];
  for (const v of c.views) {
    const tag = v.tag.charAt(0).toUpperCase() + v.tag.slice(1);
    const kind = widgetKindOf(`UI${tag}`) ?? (v.tag === 'barButtonItem' ? 'button' : v.tag === 'tableViewCell' || v.tag === 'collectionViewCell' ? 'list' : null);
    if (!kind) continue;
    const name = v.label && kind !== 'list' ? `${tag} “${v.label}”` : tag;
    if (!out.some((w) => w.name === name)) out.push({ name, kind, location: loc(file, v.line) });
  }
  return out;
}

function swiftUIComponents(index: CodeIndex, view: string, swiftUIViews: Set<string>, screens: Set<string>): WidgetRef[] {
  const out: WidgetRef[] = [];
  for (const { call, file } of index.allCalls()) {
    if (call.enclosingClass !== view || !call.isInstantiation) continue;
    const kind = swiftUIViews.has(call.name) ? (screens.has(call.name) ? null : 'custom') : widgetKindOf(call.name);
    if (!kind || call.name === 'NavigationLink') continue;
    const label = ownerLabel(call.args.filter((a) => !(a.label && HANDLER_LABEL.test(a.label))));
    const name = label && (kind === 'button' || kind === 'input' || kind === 'custom') ? `${call.name} “${label}”` : call.name;
    if (out.some((w) => w.name === name)) continue;
    out.push({ name, kind, location: loc(file, call.line) });
  }
  return out;
}

async function iosAssets(ctx: AnalysisContext, out: ProjectGraphBuilder, files: Array<{ path: string }>, index: CodeIndex, storyboards: Storyboard[]): Promise<void> {
  const byName = new Map<string, string>();
  for (const f of files) {
    const m = /\.xcassets\/(?:.*\/)?([^/]+)\.(imageset|appiconset|colorset|dataset)\/([^/]+)$/.exec(f.path);
    if (!m || (m[3] === 'Contents.json' && files.some((x) => x !== f && x.path.startsWith(f.path.replace(/Contents\.json$/, '')) && !x.path.endsWith('Contents.json')))) continue;
    if (byName.has(m[1]!)) continue;
    byName.set(m[1]!, f.path);
    out.addAsset(f.path, m[2] === 'dataset' ? 'data' : m[2] === 'colorset' ? 'other' : 'image');
  }
  for (const [file, facts] of index.files) {
    for (const call of facts.calls) {
      if (!/^(UIImage|Image|NSImage|imageNamed)$/.test(call.name)) continue;
      const name = call.args[0]?.stringValue;
      const path = name ? byName.get(name) : undefined;
      if (path) out.referenceAsset(path, loc(file, call.line));
    }
  }
  for (const sb of storyboards) {
    for (const c of sb.controllers) for (const v of c.views) {
      const path = v.image ? byName.get(v.image) : undefined;
      if (path) out.referenceAsset(path, loc(sb.file, v.line));
    }
  }
  void ctx;
}
