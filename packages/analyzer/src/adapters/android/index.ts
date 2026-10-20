import { lookup } from '../shared';
import { ANDROID_UI_STATES } from '../uiStateRules';
import type { Evidence, NavigationKind, PlatformId, ScreenKind, ScreenPlatformKind, WidgetRef } from '@appflow/model';
import type { ProjectGraphBuilder } from '../../core/builder';
import { CodeIndex, loc, routeMatcher } from '../../core/codeIndex';
import { basename, dirname, humanize, joinPath, type AnalysisAdapter, type AnalysisContext, type DetectionMatch } from '../../core/types';
import { HANDLER_LABEL, ownerLabel } from '../../parsing/ast';
import type { CallFact, FileFacts } from '../../parsing/facts';
import { assetKindOf, callText, declaredEvidence, staticEvidence, triggerFor, truncate, widgetKindOf } from '../shared';
import { gradleFromGroovyText, gradleFromKotlinFacts, kotlinNamespace, type GradleInfo } from './gradle';
import { parseLayout, parseManifest, parseNavGraph, resolveClassName, simpleName, type LayoutView, type NavGraph } from './resources';

interface AndroidModuleDir {
  dir: string;
  gradlePath: string;
  manifestPath: string;
}

interface AndroidDetection {
  modules: AndroidModuleDir[];
  settingsPath?: string;
}

const ACTIVITY_BASES = new Set(['Activity', 'AppCompatActivity', 'ComponentActivity', 'FragmentActivity', 'ListActivity', 'PreferenceActivity']);
const HOST_ACTIVITIES = new Set(['ReactActivity', 'FlutterActivity', 'FlutterFragmentActivity']);
const FRAGMENT_BASES = new Set(['Fragment', 'ListFragment', 'PreferenceFragmentCompat', 'PreferenceFragment']);
const DIALOG_FRAGMENTS = new Set(['DialogFragment', 'AppCompatDialogFragment']);
const SHEET_FRAGMENTS = new Set(['BottomSheetDialogFragment']);
const COMPOSE_DESTINATIONS: Record<string, ScreenKind> = lookup({ composable: 'page', dialog: 'dialog', bottomSheet: 'bottomSheet' });
const LAYOUT_TAG_NOISE = new Set(['LinearLayout', 'FrameLayout', 'ConstraintLayout', 'RelativeLayout', 'CoordinatorLayout', 'TextView', 'View', 'Space', 'merge', 'include', 'ScrollView', 'NestedScrollView', 'CardView', 'MaterialCardView', 'AppBarLayout', 'Guideline']);

interface ScreenInfo {
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

export const androidAdapter: AnalysisAdapter = {
  id: 'android',
  name: 'Android (Kotlin / Java)',
  platform: 'android',
  capabilities: [
    { kind: 'modules', description: 'Gradle modules that have an AndroidManifest.xml (app, library, feature)', confidence: 'high' },
    { kind: 'dependencies', description: 'Dependencies from build.gradle.kts (parsed) and build.gradle (best-effort, line based)', confidence: 'medium' },
    { kind: 'screens', description: 'Activities declared in AndroidManifest.xml, with the launcher activity as entry point', confidence: 'high' },
    { kind: 'screens', description: 'Activity and Fragment subclasses (incl. DialogFragment and BottomSheetDialogFragment)', confidence: 'high' },
    { kind: 'routes', description: 'Navigation component graphs (res/navigation): destinations, nested graphs and start destinations', confidence: 'high' },
    { kind: 'navigation-edges', description: 'Navigation graph actions (declared configuration)', confidence: 'high' },
    { kind: 'navigation-edges', description: 'findNavController().navigate(R.id.…) and Safe Args Directions calls matched to graph actions', confidence: 'medium' },
    { kind: 'navigation-edges', description: 'startActivity / launcher.launch with explicit Intent(…, X::class.java / X.class)', confidence: 'medium' },
    { kind: 'navigation-edges', description: 'FragmentTransaction replace/add and DialogFragment.show', confidence: 'medium' },
    { kind: 'routes', description: 'Jetpack Compose NavHost composable/dialog destinations with string routes', confidence: 'medium' },
    { kind: 'navigation-edges', description: 'Compose navController.navigate("route") matched to composable route patterns', confidence: 'medium' },
    { kind: 'components', description: 'Views with ids from layouts used via setContentView / inflate / ViewBinding, and Compose UI calls', confidence: 'medium' },
    { kind: 'handlers', description: 'setOnClickListener-style listeners, Compose onClick lambdas and android:onClick', confidence: 'medium' },
    { kind: 'assets', description: 'drawable, mipmap, font and raw resources with layout, manifest and R.* references', confidence: 'high' },
    { kind: 'ui-states', description: 'Loading, empty, error, data, authentication, dialog, bottom-sheet and tab states found in each screen\'s code', confidence: 'medium' },
  ],
  uiStateRules: ANDROID_UI_STATES,
  limitations: [
    { description: 'Implicit intents (actions, URIs) open other apps and are counted, not drawn.' },
    { description: 'Type-safe Compose navigation (navigate(SomeRoute)) and deep links are reported as unsupported.' },
    { description: 'Groovy build.gradle files are read line by line; complex Gradle logic is not evaluated.' },
    { description: 'Intents built in other functions or classes and passed around cannot be followed.' },
  ],

  async detect(ctx) {
    const paths = new Set(ctx.files.map((f) => f.path));
    const modules: AndroidModuleDir[] = [];
    for (const f of ctx.files) {
      if (!f.path.endsWith('src/main/AndroidManifest.xml')) continue;
      const dir = f.path.slice(0, -'src/main/AndroidManifest.xml'.length).replace(/\/$/, '');
      const gradlePath = [joinPath(dir, 'build.gradle.kts'), joinPath(dir, 'build.gradle')].find((p) => paths.has(p));
      if (gradlePath) modules.push({ dir, gradlePath, manifestPath: f.path });
    }
    if (!modules.length) return [];
    const settings = ctx.files.filter((f) => /(^|\/)settings\.gradle(\.kts)?$/.test(f.path)).map((f) => f.path);
    const rootOf = (dir: string) => {
      const owners = settings.map(dirname).filter((s) => s === '' || dir === s || dir.startsWith(`${s}/`));
      return owners.sort((a, b) => b.length - a.length)[0] ?? dirname(dir);
    };
    const groups = new Map<string, AndroidModuleDir[]>();
    for (const m of modules) {
      const root = rootOf(m.dir);
      groups.set(root, [...(groups.get(root) ?? []), m]);
    }
    return [...groups].map(([root, mods]): DetectionMatch => {
      const settingsPath = settings.find((s) => dirname(s) === root);
      return {
        adapterId: 'android',
        platform: 'android',
        root,
        role: 'primary',
        framework: { id: 'android', name: 'Android (Gradle)', evidence: [...(settingsPath ? [settingsPath] : []), ...mods.map((m) => m.manifestPath)] },
        data: { modules: mods, settingsPath } satisfies AndroidDetection,
      };
    });
  },

  async analyze(ctx, match, out) {
    const { modules } = match.data as AndroidDetection;
    const hostOf = match.role === 'host' ? ctx.matches.find((m) => m.role === 'primary' && (m.platform === 'flutter' || m.platform === 'react-native') && joinPath(m.root, 'android') === match.root) : undefined;

    const gradle = new Map<string, GradleInfo>();
    for (const m of modules) {
      const text = (await ctx.readText(m.gradlePath)) ?? '';
      let info: GradleInfo;
      if (m.gradlePath.endsWith('.kts')) {
        const facts = await ctx.facts(m.gradlePath);
        info = facts ? gradleFromKotlinFacts(facts, m.dir) : gradleFromGroovyText(text, m.dir);
        info.namespace ??= kotlinNamespace(text);
      } else {
        info = gradleFromGroovyText(text, m.dir);
      }
      gradle.set(m.dir, info);
      const rel = match.root ? m.dir.slice(match.root.length).replace(/^\//, '') : m.dir;
      out.addModule({
        id: `android:${m.dir || '.'}`,
        name: rel ? `:${rel.replace(/\//g, ':')}` : basename(match.root) || 'app',
        path: m.dir,
        platform: 'android',
        kind: hostOf ? 'host' : info.kind,
        dependencies: [...info.dependencies, ...info.projectDependencies.map((p) => ({ name: p, version: 'project' }))],
      });
    }

    await analyzeAndroid(ctx, match, out, modules, gradle, hostOf?.platform);
  },
};

async function analyzeAndroid(
  ctx: AnalysisContext,
  match: DetectionMatch,
  out: ProjectGraphBuilder,
  modules: AndroidModuleDir[],
  gradle: Map<string, GradleInfo>,
  host: PlatformId | undefined,
): Promise<void> {
  // ---- Code ---------------------------------------------------------------------------------------
  const index = new CodeIndex();
  const codeFiles = ctx.files.filter(
    (f) => /\.(kt|java)$/.test(f.path) && modules.some((m) => f.path.startsWith(joinPath(m.dir, 'src/'))) && !/\/src\/(test|androidTest)\w*\//.test(f.path),
  );
  for (let i = 0; i < codeFiles.length; i++) {
    ctx.signal?.throwIfAborted();
    if (i % 50 === 0) ctx.progress(`parsing Kotlin/Java (${i}/${codeFiles.length})`);
    const facts = await ctx.facts(codeFiles[i]!.path);
    if (facts) index.add(codeFiles[i]!.path, facts);
  }
  const moduleOfFile = (file: string) => modules.filter((m) => !m.dir || file.startsWith(`${m.dir}/`)).sort((a, b) => b.dir.length - a.dir.length)[0];
  const namespaces = [...gradle.values()].map((g) => g.namespace).filter((n): n is string => !!n);

  const screens = new Map<string, ScreenInfo>();
  const screenFor = (key: string, init: () => Omit<ScreenInfo, 'evidence' | 'entry' | 'widgets'>): ScreenInfo => {
    let s = screens.get(key);
    if (!s) screens.set(key, (s = { ...init(), evidence: [], entry: false, widgets: [] }));
    return s;
  };
  const classScreen = (name: string, platformKind: ScreenPlatformKind, kind: ScreenKind = 'page') => {
    const cls = index.classNamed(name)!;
    return screenFor(name, () => ({ id: `android:${name}`, name: humanize(name), kind, platformKind, file: cls.file, line: cls.fact.line }));
  };

  // ---- Activities -----------------------------------------------------------------------------------
  const hostActivities = new Set<string>();
  for (const [name] of index.classes) {
    if (index.extendsAny(name, HOST_ACTIVITIES)) {
      hostActivities.add(name);
      continue;
    }
    if (index.extendsAny(name, ACTIVITY_BASES)) classScreen(name, 'activity');
  }
  for (const h of hostActivities) {
    out.warn({ code: 'host-activity', severity: 'info', message: `${h} hosts the ${host === 'react-native' ? 'React Native' : host === 'flutter' ? 'Flutter' : 'cross-platform'} UI and is not shown as a native screen.`, location: loc(index.classNamed(h)!.file, index.classNamed(h)!.fact.line) });
  }
  const declaredActivities = new Set<string>();
  for (const m of modules) {
    const text = await ctx.readText(m.manifestPath);
    if (!text) continue;
    let manifest;
    try {
      manifest = parseManifest(text, gradle.get(m.dir)?.namespace);
    } catch (error) {
      out.warn({ code: 'xml-parse-failed', severity: 'warning', message: `Could not parse ${m.manifestPath}: ${String(error)}`, location: loc(m.manifestPath, 1) });
      continue;
    }
    for (const a of manifest.activities) {
      declaredActivities.add(a.simpleName);
      if (hostActivities.has(a.simpleName)) continue;
      const ours = namespaces.some((ns) => a.className.startsWith(ns)) || (manifest.packageName && a.className.startsWith(manifest.packageName));
      let screen = screens.get(a.simpleName);
      if (!screen) {
        if (!ours) continue; // a library's activity
        out.warn({ code: 'activity-source-missing', severity: 'warning', message: `${a.className} is declared in ${m.manifestPath} but its source was not found.`, location: loc(m.manifestPath, a.line) });
        screen = screenFor(a.simpleName, () => ({ id: `android:${a.simpleName}`, name: humanize(a.simpleName), kind: 'page', platformKind: 'activity', file: m.manifestPath, line: a.line }));
      }
      screen.evidence.push(declaredEvidence(m.manifestPath, a.line, `<activity android:name="${a.className}">${a.launcher ? ' (MAIN/LAUNCHER)' : ''}`));
      if (a.launcher) screen.entry = true;
    }
  }
  for (const s of screens.values()) {
    if (s.platformKind === 'activity' && !declaredActivities.has(s.id.slice('android:'.length))) {
      s.evidence.push({ source: 'static', detail: 'Activity subclass', location: loc(s.file, s.line), confidence: 'medium' });
      out.warn({ code: 'activity-not-declared', severity: 'info', message: `${s.id.slice(8)} extends an Activity but is not declared in any AndroidManifest.xml.`, location: loc(s.file, s.line) });
    }
  }

  // ---- Fragments ----------------------------------------------------------------------------------
  for (const [name] of index.classes) {
    if (screens.has(name)) continue;
    const kind: ScreenKind | null = index.extendsAny(name, SHEET_FRAGMENTS) ? 'bottomSheet' : index.extendsAny(name, DIALOG_FRAGMENTS) ? 'dialog' : index.extendsAny(name, FRAGMENT_BASES) ? 'page' : null;
    if (!kind) continue;
    const s = classScreen(name, 'fragment', kind);
    s.evidence.push({ source: 'static', detail: `${kind === 'page' ? 'Fragment' : kind === 'dialog' ? 'DialogFragment' : 'BottomSheetDialogFragment'} subclass`, location: loc(s.file, s.line), confidence: 'high' });
  }

  // ---- Navigation graphs ----------------------------------------------------------------------------
  const graphs: NavGraph[] = [];
  for (const f of ctx.files.filter((x) => /\/src\/main\/res\/navigation[^/]*\/[^/]+\.xml$/.test(x.path) && modules.some((m) => x.path.startsWith(joinPath(m.dir, 'src/'))))) {
    const text = await ctx.readText(f.path);
    if (!text) continue;
    try {
      graphs.push(parseNavGraph(text, f.path));
    } catch (error) {
      out.warn({ code: 'xml-parse-failed', severity: 'warning', message: `Could not parse ${f.path}: ${String(error)}`, location: loc(f.path, 1) });
    }
  }
  const destScreen = new Map<string, string>(); // destination id → screen key
  const nestedStart = new Map<string, string>();
  for (const g of graphs) {
    const ns = gradle.get(moduleOfFile(g.file)?.dir ?? '')?.namespace;
    for (const d of g.destinations) {
      if (d.type === 'navigation') {
        if (d.startDestination) nestedStart.set(d.id, d.startDestination);
        continue;
      }
      const cls = d.className ? simpleName(resolveClassName(d.className, ns)) : undefined;
      const known = cls ? screens.get(cls) ?? (index.classNamed(cls) ? classScreen(cls, d.type === 'activity' ? 'activity' : 'fragment', d.type === 'dialog' ? 'dialog' : 'page') : undefined) : undefined;
      const key = known ? cls! : `nav:${d.id}`;
      const screen = known ?? screenFor(key, () => ({ id: `android:nav:${d.id}`, name: humanize(d.label ?? d.id), kind: d.type === 'dialog' ? 'dialog' : 'page', platformKind: d.type === 'activity' ? 'activity' : 'fragment', file: g.file, line: d.line }));
      if (d.type === 'dialog') screen.kind = screen.kind === 'bottomSheet' ? 'bottomSheet' : 'dialog';
      screen.evidence.push(declaredEvidence(g.file, d.line, `<${d.type} android:id="@+id/${d.id}"> in ${basename(g.file)}`));
      if (d.className && !known) out.warn({ code: 'destination-source-missing', severity: 'warning', message: `Navigation destination ${d.id} refers to ${d.className}, whose source was not found.`, location: loc(g.file, d.line) });
      destScreen.set(d.id, key);
      out.addRoute({ id: `android-nav:${g.file}#${d.id}`, name: d.id, screenId: screen.id, router: 'android-nav-graph', location: loc(g.file, d.line), evidence: [declaredEvidence(g.file, d.line, `Destination ${d.id}`)] });
    }
  }
  const resolveDest = (id?: string): string | undefined => {
    if (!id) return undefined;
    if (destScreen.has(id)) return destScreen.get(id);
    const start = nestedStart.get(id) ?? graphs.find((g) => g.id === id)?.startDestination;
    return start && start !== id ? resolveDest(start) : undefined;
  };
  const norm = (id: string) => id.replace(/_/g, '').toLowerCase();
  const actions = new Map<string, { kind: NavigationKind; from?: string; to?: string; graph: NavGraph; line: number; id: string }>();
  for (const g of graphs) {
    for (const a of g.actions) {
      const toKey = resolveDest(a.destination);
      const toScreen = toKey ? screens.get(toKey) : undefined;
      const kind: NavigationKind = toScreen && toScreen.kind !== 'page' ? 'modal' : a.popUpToInclusive ? 'reset' : 'push';
      const fromKey = a.from ? resolveDest(a.from) : undefined;
      actions.set(norm(a.id), { kind, from: fromKey, to: toKey, graph: g, line: a.line, id: a.id });
    }
  }

  // ---- Layouts: components and NavHost hosting ------------------------------------------------------
  const layouts = new Map<string, { file: string; views: LayoutView[] }>();
  for (const f of ctx.files.filter((x) => /\/src\/main\/res\/layout[^/]*\/[^/]+\.xml$/.test(x.path))) {
    const text = await ctx.readText(f.path);
    if (!text) continue;
    try {
      layouts.set(basename(f.path).replace(/\.xml$/, ''), { file: f.path, views: parseLayout(text) });
    } catch (error) {
      out.warn({ code: 'xml-parse-failed', severity: 'warning', message: `Could not parse ${f.path}: ${String(error)}`, location: loc(f.path, 1) });
    }
  }
  const layoutOf = new Map<string, string>();
  for (const { call } of index.allCalls()) {
    if (!call.enclosingClass || !screens.has(call.enclosingClass)) continue;
    const ref = call.args.map((a) => /R\.layout\.(\w+)/.exec(a.text)?.[1]).find(Boolean);
    if (ref && (call.name === 'setContentView' || call.name === 'inflate')) layoutOf.set(call.enclosingClass, ref);
    const binding = /^(\w+)Binding\.inflate$/.exec(call.callee);
    if (binding) layoutOf.set(call.enclosingClass, binding[1]!.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase());
  }
  for (const [cls, layoutName] of layoutOf) {
    const layout = layouts.get(layoutName);
    const screen = screens.get(cls);
    if (!layout || !screen) continue;
    for (const v of layout.views) {
      const graphRef = v.attrs['app:navGraph']?.replace(/^@navigation\//, '');
      const graph = graphRef ? graphs.find((g) => basename(g.file) === `${graphRef}.xml`) : undefined;
      const startKey = graph ? resolveDest(graph.startDestination) : undefined;
      if (graph && startKey && screens.get(startKey)) {
        out.addEdge({
          from: screen.id,
          to: screens.get(startKey)!.id,
          kind: 'replace',
          trigger: { label: 'Start destination', description: `NavHost in ${basename(layout.file)} starts ${basename(graph.file)} at ${graph.startDestination}`, location: loc(layout.file, v.line) },
          evidence: [declaredEvidence(layout.file, v.line, `app:navGraph="@navigation/${graphRef}" (startDestination ${graph.startDestination})`)],
        });
      }
      if (LAYOUT_TAG_NOISE.has(v.tag) || !v.id) continue;
      const kind = widgetKindOf(v.tag);
      if (!kind) continue;
      const handlers = v.attrs['android:onClick'] ? [`android:onClick="${v.attrs['android:onClick']}"`] : undefined;
      screen.widgets.push({ name: `${v.tag} @id/${v.id}${v.text ? ` “${v.text}”` : ''}`, kind, location: loc(layout.file, v.line), ...(handlers ? { handlers } : {}) });
    }
  }

  // ---- Compose NavHost --------------------------------------------------------------------------------
  const composables = new Set([...index.functions].filter(([, list]) => list.some((f) => f.fact.annotations.includes('Composable'))).map(([n]) => n));
  const composeRoutes: Array<{ route: string; key: string; file: string; line: number; call: CallFact; facts: FileFacts }> = [];
  for (const { call, file, facts } of index.allCalls()) {
    if (call.name !== 'NavHost') continue;
    const startArg = call.args.find((a) => a.label === 'startDestination') ?? call.args[1];
    const start = index.resolveString(startArg).value;
    for (const c of facts.calls) {
      if (!(c.name in COMPOSE_DESTINATIONS) || !hasAncestor(facts, c, call.index)) continue;
      const route = index.resolveString(c.args.find((a) => a.label === 'route') ?? c.args[0]).value;
      if (route === undefined) {
        out.warn({ code: 'unresolved-route-key', severity: 'warning', message: `Compose destination route \`${c.args[0]?.text ?? '?'}\` could not be resolved (type-safe routes are not supported).`, location: loc(file, c.line) });
        continue;
      }
      const content = c.args.filter((a) => a.isLambda).flatMap((a) => a.typeRefs).find((t) => composables.has(t));
      const fn = content ? index.functions.get(content)![0]! : undefined;
      const key = content ?? `route:${route}`;
      const screen = screenFor(key, () => ({
        id: `android:${content ?? `compose:${route}`}`,
        name: humanize(content ?? route),
        kind: COMPOSE_DESTINATIONS[c.name]!,
        platformKind: 'composable',
        file: fn?.file ?? file,
        line: fn?.fact.line ?? c.line,
      }));
      screen.evidence.push(declaredEvidence(file, c.line, `${c.name}("${route}") in NavHost`));
      composeRoutes.push({ route, key, file, line: c.line, call: c, facts });
      out.addRoute({ id: `compose:${route}`, path: route, screenId: screen.id, router: 'compose-navigation', location: loc(file, c.line), evidence: [declaredEvidence(file, c.line, `${c.name}("${route}")`)] });
    }
    // The activity (or composable) that hosts this NavHost starts at its start destination.
    const startRoute = composeRoutes.find((r) => r.route === start && r.file === file);
    const hostFn = call.enclosingFunction;
    if (startRoute && hostFn) {
      const activityNames = new Set([...screens.values()].filter((s) => s.platformKind === 'activity').map((s) => s.id.slice(8)));
      for (const host of index.ownersUsing(hostFn, activityNames, 3, file)) {
        out.addEdge({
          from: `android:${host}`,
          to: screens.get(startRoute.key)!.id,
          kind: 'replace',
          trigger: { label: 'Start destination', description: `NavHost startDestination "${start}" in ${hostFn}()`, location: loc(file, call.line) },
          evidence: [declaredEvidence(file, call.line, `NavHost(startDestination = "${start}") hosted by ${host}`)],
        });
      }
    } else if (start === undefined && startArg) {
      out.warn({ code: 'unresolved-route-key', severity: 'info', message: `NavHost start destination \`${startArg.text}\` could not be resolved.`, location: loc(file, call.line) });
    }
  }

  // ---- Screens to the builder ----------------------------------------------------------------------
  for (const [key, s] of screens) {
    if (s.platformKind === 'composable' && composables.has(key)) s.widgets.push(...composeComponents(index, key));
    out.addScreen({ id: s.id, name: s.name, kind: s.kind, platformKind: s.platformKind, widgetClass: key.startsWith('nav:') || key.startsWith('route:') ? key.split(':')[1]! : key, location: loc(s.file, s.line), isEntryPoint: s.entry, keyWidgets: s.widgets.slice(0, 15), states: [], evidence: s.evidence });
  }
  for (const [actionId, a] of actions) {
    if (!a.from || !a.to) continue;
    out.addEdge({
      from: screens.get(a.from)!.id,
      to: screens.get(a.to)!.id,
      kind: a.kind,
      trigger: { label: truncate(a.id.replace(/^action_?/, '').replace(/_/g, ' '), 40), description: `Action ${a.id} in ${basename(a.graph.file)}`, location: loc(a.graph.file, a.line) },
      evidence: [declaredEvidence(a.graph.file, a.line, `<action android:id="@+id/${a.id}">`)],
      routeId: undefined,
    });
    void actionId;
  }

  // ---- Code navigation -------------------------------------------------------------------------------
  const screenKeys = new Set(screens.keys());
  const fromScreens = (call: CallFact, facts: FileFacts, file: string): string[] => {
    for (let p = call.parentCall; p !== undefined; p = facts.calls[p]?.parentCall) {
      const parent = facts.calls[p]!;
      if (parent.name in COMPOSE_DESTINATIONS) {
        const r = composeRoutes.find((x) => x.call === parent);
        if (r) return [r.key];
      }
    }
    if (call.enclosingClass && screenKeys.has(call.enclosingClass)) return [call.enclosingClass];
    if (call.enclosingFunction && screenKeys.has(call.enclosingFunction)) return [call.enclosingFunction];
    return index.ownersUsing(call.enclosingClass ?? call.enclosingFunction ?? '', screenKeys, 3, file);
  };
  let implicitIntents = 0;
  for (const { call, file, facts } of index.allCalls()) {
    const receiver = call.callee.includes('.') ? call.callee.slice(0, call.callee.lastIndexOf('.')) : '';
    let intent: { kind: NavigationKind; to: string | null; confidence: 'high' | 'medium' | 'low'; reason?: string; unresolvedKind?: 'dynamic' | 'missing-target' | 'unsupported'; mergeDeclared?: boolean } | null = null;

    if (/^(startActivity|startActivityForResult|startActivities)$/.test(call.name) || (call.name === 'launch' && /launcher|Launcher/.test(receiver))) {
      const arg = call.args[0];
      let refs = arg?.typeRefs ?? [];
      if (arg && /^\w+$/.test(arg.text)) refs = facts.variables.find((v) => v.name === arg.text && v.enclosingFunction === call.enclosingFunction)?.value.typeRefs ?? refs;
      const target = refs.find((t) => screens.get(t)?.platformKind === 'activity');
      // Opening the Flutter / React Native UI is drawn by the native bridge pass.
      if (!target && (refs.some((t) => hostActivities.has(t) || HOST_ACTIVITIES.has(t)) || /\bFlutter(Activity|FragmentActivity)\b/.test(arg?.text ?? ''))) continue;
      if (target) intent = { kind: 'push', to: target, confidence: 'medium' };
      else if (/ACTION_|Intent\.ACTION|Uri\.parse|"android\.intent/.test(arg?.text ?? '') || refs.length === 1) implicitIntents++;
      else intent = { kind: 'push', to: null, confidence: 'low', reason: `The Intent \`${truncate(arg?.text ?? '?', 60)}\` does not name an activity of this project.`, unresolvedKind: 'dynamic' };
    } else if (call.name === 'navigate' && /(findNavController|navController|NavController|Navigation\.findNavController|^nav$|navigator|controller)/i.test(receiver)) {
      const arg = call.args[0];
      const text = arg?.text ?? '';
      const rId = /^R\.id\.(\w+)$/.exec(text)?.[1];
      const directions = /\w+Directions\.(\w+)\s*\(/.exec(text)?.[1];
      if (rId || directions) {
        const action = actions.get(norm(rId ?? directions!));
        const dest = rId ? resolveDest(rId) : undefined;
        if (action?.to) intent = { kind: action.kind, to: action.to, confidence: 'high', mergeDeclared: true };
        else if (dest) intent = { kind: screens.get(dest)!.kind === 'page' ? 'push' : 'modal', to: dest, confidence: 'medium' };
        else intent = { kind: 'push', to: null, confidence: 'medium', reason: `${rId ? `R.id.${rId}` : directions} is not an action or destination of any navigation graph.`, unresolvedKind: 'missing-target' };
      } else {
        const s = index.resolveString(arg);
        const probe = s.value ?? s.pattern;
        if (probe !== undefined) {
          const r = composeRoutes.find((x) => routeMatcher(x.route)(probe));
          const target = r ? screens.get(r.key)! : undefined;
          intent = r ? { kind: target!.kind === 'page' ? 'push' : 'modal', to: r.key, confidence: s.value !== undefined ? 'high' : 'medium' } : { kind: 'push', to: null, confidence: 'medium', reason: `No composable route matches "${probe}".`, unresolvedKind: 'missing-target' };
        } else if (arg?.typeRefs.length) {
          intent = { kind: 'push', to: null, confidence: 'low', reason: `Type-safe navigation to ${arg.typeRefs[0]} is not supported yet.`, unresolvedKind: 'unsupported' };
        } else {
          intent = { kind: 'push', to: null, confidence: 'low', reason: `Route \`${truncate(text, 60)}\` is computed at runtime.`, unresolvedKind: 'dynamic' };
        }
      }
    } else if ((call.name === 'replace' || call.name === 'add') && /beginTransaction|transaction|fragmentManager/i.test(receiver)) {
      const target = call.args.flatMap((a) => a.typeRefs).find((t) => screens.get(t)?.platformKind === 'fragment');
      if (target) intent = { kind: call.name === 'replace' ? 'replace' : 'push', to: target, confidence: 'medium' };
    } else if (call.name === 'show' && receiver) {
      const cls = receiver.split('.')[0]!;
      const target = screens.get(cls);
      if (target && target.kind !== 'page') intent = { kind: 'modal', to: cls, confidence: 'medium' };
    }
    if (!intent) continue;

    const froms = fromScreens(call, facts, file);
    if (!froms.length) {
      // Native code reached from Flutter / React Native through a bridge (MethodChannel handlers, native modules).
      if (host || hostActivities.has(call.enclosingClass ?? '')) continue;
      out.warn({ code: 'navigation-outside-screen', severity: 'info', message: `${call.callee} in ${call.enclosingClass ?? call.enclosingFunction ?? 'top-level code'} could not be attributed to a screen.`, location: loc(file, call.line) });
      continue;
    }
    const fallback = call.enclosingFunction ? `${call.enclosingFunction}()` : call.name;
    for (const from of froms) {
      out.addEdge({
        from: screens.get(from)!.id,
        to: intent.to ? screens.get(intent.to)!.id : null,
        kind: intent.kind,
        trigger: triggerFor(file, call, call.handler, fallback),
        evidence: [staticEvidence(file, call, callText(call), intent.confidence)],
        ...(intent.to ? {} : { unresolvedReason: intent.reason, unresolvedKind: intent.unresolvedKind }),
      });
    }
  }
  if (implicitIntents) {
    out.warn({ code: 'implicit-intent', severity: 'info', message: `${implicitIntents} implicit Intent(s) open other apps or components and are not drawn as navigation.` });
  }

  await androidAssets(ctx, out, modules, index, layouts);
  void match;
}

function hasAncestor(facts: FileFacts, call: CallFact, ancestor: number): boolean {
  for (let p = call.parentCall; p !== undefined; p = facts.calls[p]?.parentCall) if (p === ancestor) return true;
  return false;
}

function composeComponents(index: CodeIndex, fn: string): WidgetRef[] {
  const out: WidgetRef[] = [];
  const seen = new Set<string>();
  for (const { call, file } of index.allCalls()) {
    if (call.enclosingFunction !== fn || !call.isInstantiation) continue;
    const kind = widgetKindOf(call.name);
    if (!kind) continue;
    const label = ownerLabel(call.args.filter((a) => !(a.label && HANDLER_LABEL.test(a.label))));
    const name = label && (kind === 'button' || kind === 'input') ? `${call.name} “${label}”` : call.name;
    if (seen.has(name)) continue;
    seen.add(name);
    const handlers = call.args.filter((a) => a.label && HANDLER_LABEL.test(a.label)).map((a) => a.label!);
    out.push({ name, kind, location: loc(file, call.line), ...(handlers.length ? { handlers } : {}) });
  }
  return out;
}

async function androidAssets(
  ctx: AnalysisContext,
  out: ProjectGraphBuilder,
  modules: AndroidModuleDir[],
  index: CodeIndex,
  layouts: Map<string, { file: string; views: LayoutView[] }>,
): Promise<void> {
  const byName = new Map<string, string[]>();
  for (const f of ctx.files) {
    const m = /\/src\/main\/res\/(drawable|mipmap|font|raw)[^/]*\/([^/.]+)\.[^/]+$/.exec(f.path);
    if (!m || !modules.some((mod) => f.path.startsWith(joinPath(mod.dir, 'src/')))) continue;
    out.addAsset(f.path, m[1] === 'font' ? 'font' : m[1] === 'raw' ? 'data' : assetKindOf(f.path) === 'other' ? 'image' : assetKindOf(f.path));
    const key = `${m[1]}/${m[2]}`;
    byName.set(key, [...(byName.get(key) ?? []), f.path]);
  }
  const reference = (type: string, name: string, at: { fileId: string; line: number }) => {
    for (const path of byName.get(`${type}/${name}`) ?? []) out.referenceAsset(path, at);
  };
  for (const { file, views } of layouts.values()) {
    for (const v of views) for (const value of Object.values(v.attrs)) {
      const m = /^@(drawable|mipmap|font|raw)\/(\w+)$/.exec(value);
      if (m) reference(m[1]!, m[2]!, loc(file, v.line));
    }
  }
  for (const { call, file } of index.allCalls()) {
    for (const a of call.args) {
      for (const m of a.text.matchAll(/\bR\.(drawable|mipmap|font|raw)\.(\w+)/g)) reference(m[1]!, m[2]!, loc(file, call.line));
    }
  }
  for (const m of modules) {
    const text = await ctx.readText(m.manifestPath);
    if (!text) continue;
    text.split('\n').forEach((line, i) => {
      for (const r of line.matchAll(/"@(drawable|mipmap)\/(\w+)"/g)) reference(r[1]!, r[2]!, loc(m.manifestPath, i + 1));
    });
  }
}
