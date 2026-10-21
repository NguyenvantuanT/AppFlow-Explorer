import { lookup } from '../shared';
import { REACT_NATIVE_UI_STATES } from '../uiStateRules';
import type { Dependency, Evidence, NavigationKind, ScreenKind, WidgetRef } from '@appflow/model';
import type { ProjectGraphBuilder } from '../../core/builder';
import { CodeIndex, loc, routeMatcher, type ImportAlias } from '../../core/codeIndex';
import { basename, dirname, filesUnder, humanize, joinPath, type AnalysisAdapter, type AnalysisContext, type DetectionMatch } from '../../core/types';
import { HANDLER_LABEL, ownerLabel } from '../../parsing/ast';
import type { ArgFact, CallFact, FileFacts, JsxFact } from '../../parsing/facts';
import { assetKindOf, callText, declaredEvidence, staticEvidence, triggerFor, truncate, widgetKindOf } from '../shared';

interface RnDetection {
  packageJson: string;
  name: string;
  dependencies: Dependency[];
  expo: boolean;
}

const NAVIGATOR_FACTORY = /^create(\w*?)(Stack|Tab|Tabs|Drawer)Navigator$/;
const NAV_RECEIVER = /(^|\.)(navigation|nav|navigationRef(\.current)?|navigator|rootNavigation)$/i;
const NAV_METHODS: Record<string, NavigationKind> = lookup({ navigate: 'push', push: 'push', replace: 'replace', reset: 'reset', jumpTo: 'tab', navigateDeprecated: 'push', popTo: 'push' });
const ROUTER_METHODS: Record<string, NavigationKind> = lookup({ push: 'push', navigate: 'push', replace: 'replace', dismissTo: 'push', setParams: 'push' });
const UNSUPPORTED_ROUTERS: Record<string, string> = { 'react-native-navigation': 'React Native Navigation (Wix)', 'react-router-native': 'React Router Native', 'react-native-router-flux': 'react-native-router-flux' };
const CODE_EXT = ['.tsx', '.ts', '.jsx', '.js'];

interface Navigator {
  local: string;
  type: 'stack' | 'tab' | 'drawer';
  file: string;
}

interface ScreenInfo {
  key: string;
  file: string;
  line: number;
  kind: ScreenKind;
  evidence: Evidence[];
  entry: boolean;
  route?: string;
}

export const reactNativeAdapter: AnalysisAdapter = {
  id: 'react-native',
  name: 'React Native (JS / TS)',
  platform: 'react-native',
  capabilities: [
    { kind: 'modules', description: 'The JavaScript app from package.json; android/ and ios/ folders analyzed as native host modules', confidence: 'high' },
    { kind: 'dependencies', description: 'dependencies and devDependencies from package.json', confidence: 'high' },
    { kind: 'routes', description: 'React Navigation <X.Screen name component> declarations (JSX) and static `screens: {}` config', confidence: 'high' },
    { kind: 'screens', description: 'Components registered as navigator screens, resolved through imports to their definition', confidence: 'high' },
    { kind: 'entry-points', description: 'initialRouteName (or first screen) of the root navigator; app/index for Expo Router', confidence: 'high' },
    { kind: 'navigation-edges', description: 'navigation.navigate / push / replace / reset / jumpTo with literal or constant route names', confidence: 'medium' },
    { kind: 'navigation-edges', description: 'Tab navigator siblings (declared) and nested navigators resolved to their initial screen', confidence: 'high' },
    { kind: 'routes', description: 'Expo Router file-based routes (app/ directory, groups and [param] segments)', confidence: 'high' },
    { kind: 'navigation-edges', description: 'Expo Router router.push/replace/navigate and <Link href>', confidence: 'medium' },
    { kind: 'components', description: 'Components rendered by each screen (Pressable, Button, TextInput, FlatList, project components)', confidence: 'medium' },
    { kind: 'handlers', description: 'onPress-style JSX props and handle*/on* functions that navigate', confidence: 'medium' },
    { kind: 'assets', description: 'Image files referenced with require(...)', confidence: 'high' },
    { kind: 'modules', description: 'Native modules (ReactContextBaseJavaModule, RCT_EXPORT_MODULE, RCTBridgeModule)', confidence: 'medium' },
    { kind: 'ui-states', description: 'Loading, empty, error, data, authentication, dialog, bottom-sheet and tab states found in each screen\'s code', confidence: 'medium' },
  ],
  uiStateRules: REACT_NATIVE_UI_STATES,
  limitations: [
    { description: 'Route names built at runtime and navigation helpers defined outside components are reported as unresolved.' },
    { description: 'Wix React Native Navigation, React Router Native and router-flux are reported as unsupported.' },
    { description: 'Deep-link linking configs are not analyzed.' },
  ],

  async detect(ctx) {
    const out: DetectionMatch[] = [];
    for (const f of ctx.files.filter((x) => basename(x.path) === 'package.json')) {
      const text = await ctx.readText(f.path);
      if (!text) continue;
      let pkg: Record<string, any>;
      try {
        pkg = JSON.parse(text);
      } catch {
        continue;
      }
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) } as Record<string, string>;
      if (!deps['react-native'] && !deps.expo) continue;
      const dir = dirname(f.path);
      if (out.some((m) => dir.startsWith(`${m.root}/`))) continue;
      out.push({
        adapterId: 'react-native',
        platform: 'react-native',
        root: dir,
        role: 'primary',
        framework: { id: 'react-native', name: deps.expo ? 'React Native (Expo)' : 'React Native', version: deps['react-native'], evidence: [f.path] },
        data: { packageJson: f.path, name: pkg.name ?? (basename(dir) || 'app'), dependencies: Object.entries(deps).map(([name, version]) => ({ name, version })), expo: !!deps.expo } satisfies RnDetection,
      });
    }
    return out;
  },

  async analyze(ctx, match, out) {
    const det = match.data as RnDetection;
    const moduleId = `react-native:${match.root || '.'}`;
    const module = out.addModule({ id: moduleId, name: det.name, path: match.root, platform: 'react-native', kind: 'app', dependencies: det.dependencies });
    const depNames = new Set(det.dependencies.map((d) => d.name));
    for (const [pkg, label] of Object.entries(UNSUPPORTED_ROUTERS)) {
      if (depNames.has(pkg)) out.warn({ code: 'unsupported-router', severity: 'warning', message: `${label} (${pkg}) is not analyzed.`, location: loc(det.packageJson, 1) });
    }

    const nativeDirs = ['android', 'ios'].map((d) => joinPath(match.root, d));
    const jsFiles = filesUnder(ctx.files, match.root).filter(
      (f) => CODE_EXT.some((e) => f.path.endsWith(e)) && !nativeDirs.some((d) => f.path.startsWith(`${d}/`)) && !/(^|\/)(__tests__|__mocks__|e2e)\//.test(f.path) && !/\.(test|spec)\.[jt]sx?$/.test(f.path) && !/(babel|metro|jest|eslint|prettier|react-native)\.config\.js$/.test(f.path),
    );
    const index = new CodeIndex();
    index.aliases = await importAliases(ctx, match.root);
    for (let i = 0; i < jsFiles.length; i++) {
      ctx.signal?.throwIfAborted();
      if (i % 50 === 0) ctx.progress(`parsing JavaScript/TypeScript (${i}/${jsFiles.length})`);
      const facts = await ctx.facts(jsFiles[i]!.path);
      if (facts) index.add(jsFiles[i]!.path, facts);
    }
    const paths = new Set(ctx.files.map((f) => f.path));
    await analyzeJs(ctx, match, out, index, paths, depNames);
    module.exports = await nativeModules(ctx, nativeDirs);
  },
};

/** Import aliases from tsconfig/jsconfig `paths` and Babel `module-resolver` (`'@': './app'`). */
export async function importAliases(ctx: Pick<AnalysisContext, 'readText'>, root: string): Promise<ImportAlias[]> {
  const aliases: ImportAlias[] = [];
  const add = (prefix: string, target: string) => {
    const t = joinPath(root, ...target.split('/').filter((p) => p && p !== '.'));
    if (prefix && !aliases.some((a) => a.prefix === prefix)) aliases.push({ prefix, target: t });
  };
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const text = await ctx.readText(joinPath(root, name));
    if (!text) continue;
    try {
      const options = JSON.parse(stripJsonComments(text)).compilerOptions ?? {};
      const baseUrl = String(options.baseUrl ?? '.');
      for (const [key, targets] of Object.entries<string[]>(options.paths ?? {})) {
        if (targets[0]) add(key.replace(/\*$/, ''), joinPath(baseUrl, targets[0].replace(/\/?\*$/, '')));
      }
    } catch {
      // A config that does not parse adds no aliases.
    }
  }
  for (const name of ['babel.config.js', '.babelrc', '.babelrc.js', 'babel.config.json']) {
    const text = await ctx.readText(joinPath(root, name));
    const block = text && /alias\s*:\s*\{([^}]*)\}/.exec(text)?.[1];
    if (!block) continue;
    for (const m of block.matchAll(/['"]?([@~$#\w/-]+)['"]?\s*:\s*['"]([^'"]+)['"]/g)) add(m[1]!.startsWith('^') ? '' : m[1]!, m[2]!);
  }
  // Longest prefix first, so `@/components` wins over `@`.
  return aliases.sort((a, b) => b.prefix.length - a.prefix.length);
}

/** Removes comments and trailing commas from JSONC (tsconfig), leaving strings such as "@/*" intact. */
function stripJsonComments(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      const end = /"(?:[^"\\]|\\.)*"/y;
      end.lastIndex = i;
      const m = end.exec(text);
      const s = m ? m[0] : text.slice(i);
      out += s;
      i += s.length - 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      i = close < 0 ? text.length : close + 1;
    } else {
      out += c;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

async function analyzeJs(ctx: AnalysisContext, match: DetectionMatch, out: ProjectGraphBuilder, index: CodeIndex, paths: Set<string>, depNames: Set<string>): Promise<void> {
  // ---- Component definitions, resolved through imports --------------------------------------------------
  /** Finds where a component used in `file` under `name` is defined, following barrel re-exports. */
  const definition = (file: string, name: string): { name: string; file: string; line: number } | undefined => {
    const facts = index.files.get(file);
    if (!facts) return undefined;
    const local = facts.functions.find((f) => f.name === name);
    if (local) return { name, file, line: local.line };
    const imp = facts.imports.filter((i) => !i.isExport).flatMap((i) => i.names.map((n) => ({ ...n, source: i.source }))).find((n) => n.local === name);
    if (!imp) return undefined;
    const target = index.resolveImport(file, imp.source);
    return target ? exportedFrom(target, imp.imported, name) : undefined;
  };
  /** The component `target` exports as `imported` (`default` or a name). */
  const exportedFrom = (target: string, imported: string, hint: string, depth = 0): { name: string; file: string; line: number } | undefined => {
    const tf = index.files.get(target);
    if (!tf || depth > 4) return undefined;
    if (imported !== 'default') {
      const fn = tf.functions.find((f) => f.name === imported && !f.enclosingClass);
      if (fn) return { name: fn.name, file: target, line: fn.line };
    }
    // export { default as X } from './X' / export { X } from './X' / export * from './X'
    for (const re of tf.imports.filter((i) => i.isExport)) {
      const named = re.names.find((n) => n.local === imported);
      if (!named && (imported === 'default' || !re.names.some((n) => n.imported === '*'))) continue;
      const next = index.resolveImport(target, re.source);
      const found = next && exportedFrom(next, named ? named.imported : imported, hint, depth + 1);
      if (found) return found;
    }
    if (imported !== 'default') return undefined;
    const exported = tf.functions.filter((f) => f.exported && /^[A-Z]/.test(f.name));
    const fn = exported.find((f) => f.name === hint) ?? exported[0] ?? tf.functions.find((f) => /^[A-Z]/.test(f.name));
    return fn ? { name: fn.name, file: target, line: fn.line } : undefined;
  };

  // ---- Navigators -------------------------------------------------------------------------------------
  const navigators = new Map<string, Navigator>(); // `${file}#${local}`
  for (const [file, facts] of index.files) {
    for (const v of facts.variables) {
      const m = v.initCallee ? NAVIGATOR_FACTORY.exec(v.initCallee.split('.').pop()!) : null;
      if (m) navigators.set(`${file}#${v.name}`, { local: v.name, type: m[2] === 'Stack' ? 'stack' : m[2] === 'Drawer' ? 'drawer' : 'tab', file });
    }
  }
  const navigatorOf = (file: string, tag: string) => navigators.get(`${file}#${tag.split('.')[0]}`);

  interface RouteDecl {
    name: string;
    component?: { name: string; file: string; line: number };
    navigator: Navigator;
    navigatorJsx?: number;
    file: string;
    line: number;
    presentation?: string;
  }
  const routes: RouteDecl[] = [];
  /** Per navigator element: its initial route name. */
  const navigatorElements: Array<{ file: string; jsx: JsxFact; navigator: Navigator; initial?: string; enclosingFunction?: string }> = [];

  for (const { jsx, file, facts } of index.allJsx()) {
    const nav = navigatorOf(file, jsx.name);
    if (!nav) continue;
    if (jsx.name.endsWith('.Navigator')) {
      navigatorElements.push({ file, jsx, navigator: nav, initial: index.resolveString(jsx.attrs.find((a) => a.label === 'initialRouteName')).value, enclosingFunction: jsx.enclosingFunction });
      continue;
    }
    if (!jsx.name.endsWith('.Screen')) continue;
    const name = index.resolveString(jsx.attrs.find((a) => a.label === 'name')).value;
    if (!name) {
      out.warn({ code: 'unresolved-route-key', severity: 'warning', message: `Screen name \`${jsx.attrs.find((a) => a.label === 'name')?.text ?? '?'}\` could not be resolved.`, location: loc(file, jsx.line) });
      continue;
    }
    const compArg = jsx.attrs.find((a) => a.label === 'component') ?? jsx.attrs.find((a) => a.label === 'children');
    const compName = compArg?.typeRefs[0] ?? jsx.childComponents[0];
    const component = compName ? definition(file, compName) : undefined;
    if (!component) out.warn({ code: 'route-target-unknown', severity: compArg?.label === 'children' || jsx.attrs.some((a) => a.label === 'getComponent') ? 'info' : 'warning', message: `Screen "${name}" renders \`${compArg?.text ?? 'children'}\`, which could not be resolved to a component.`, location: loc(file, jsx.line) });
    // A <Group screenOptions={{ presentation: 'modal' }}> or options={{ presentation }} makes it modal.
    const options = [jsx.attrs.find((a) => a.label === 'options'), ...ancestors(facts, jsx).map((g) => g.attrs.find((a) => a.label === 'screenOptions'))];
    const presentation = options.flatMap((o) => o?.strings ?? []).find((s) => /^(modal|transparentModal|fullScreenModal|formSheet|containedModal)$/.test(s));
    routes.push({ name, component, navigator: nav, navigatorJsx: navigatorAncestor(facts, jsx), file, line: jsx.line, presentation });
  }
  // Static configuration: createNativeStackNavigator({ screens: { Home: HomeScreen } }).
  for (const { call, file, facts } of index.allCalls()) {
    const m = NAVIGATOR_FACTORY.exec(call.name);
    if (!m || !call.args.length) continue;
    const nav: Navigator = { local: facts.variables.find((v) => v.initCallee?.endsWith(call.name))?.name ?? call.name, type: m[2] === 'Stack' ? 'stack' : m[2] === 'Drawer' ? 'drawer' : 'tab', file };
    for (const pair of facts.pairs.filter((p) => p.parentCall === call.index && p.parentKeys.length === 1 && p.parentKeys[0] === 'screens')) {
      const name = pair.key.stringValue;
      const compName = pair.value.typeRefs[0] ?? (/^[A-Z]\w*$/.test(pair.value.text) ? pair.value.text : undefined);
      if (!name) continue;
      routes.push({ name, component: compName ? definition(file, compName) : undefined, navigator: nav, file, line: pair.line });
    }
    const initial = facts.pairs.find((p) => p.parentCall === call.index && p.key.stringValue === 'initialRouteName');
    navigatorElements.push({ file, jsx: { index: -1, name: `${nav.local}.Navigator`, attrs: [], childComponents: [], line: call.line, column: call.column }, navigator: nav, initial: initial?.value.stringValue });
  }

  // ---- Screens -------------------------------------------------------------------------------------------
  const screens = new Map<string, ScreenInfo>();
  const componentNavigator = new Map<string, (typeof navigatorElements)[number]>();
  for (const el of navigatorElements) if (el.enclosingFunction) componentNavigator.set(el.enclosingFunction, el);
  const routesOfNavigator = (el: (typeof navigatorElements)[number]) =>
    el.jsx.index >= 0
      ? routes.filter((r) => r.file === el.file && r.navigatorJsx === el.jsx.index)
      : routes.filter((r) => r.file === el.file && r.navigatorJsx === undefined && r.navigator.local === el.navigator.local);
  /** The screen a route lands on: its component, or the initial screen of the navigator it renders. */
  const landing = (r: RouteDecl, depth = 0): string | undefined => {
    if (!r.component || depth > 5) return undefined;
    const nested = componentNavigator.get(r.component.name);
    if (nested) {
      const children = routesOfNavigator(nested);
      const initial = children.find((c) => c.name === nested.initial) ?? children[0];
      return initial ? landing(initial, depth + 1) : undefined;
    }
    return r.component.name;
  };
  for (const r of routes) {
    if (!r.component || componentNavigator.has(r.component.name)) continue;
    let s = screens.get(r.component.name);
    if (!s) screens.set(r.component.name, (s = { key: r.component.name, file: r.component.file, line: r.component.line, kind: 'page', evidence: [], entry: false, route: r.name }));
    s.evidence.push(declaredEvidence(r.file, r.line, `${r.navigator.local}.Screen name="${r.name}"`));
    if (r.presentation) s.kind = r.presentation === 'formSheet' ? 'bottomSheet' : 'dialog';
  }
  const routeTarget = new Map<string, string>(); // route name → screen key
  for (const r of routes) {
    const target = landing(r);
    if (target) routeTarget.set(r.name, target);
    out.addRoute({ id: `react-navigation:${r.name}`, name: r.name, screenId: target ? `react-native:${target}` : null, router: 'react-navigation', location: loc(r.file, r.line), evidence: [declaredEvidence(r.file, r.line, `Screen "${r.name}" in ${r.navigator.local}`)] });
  }
  // Root navigator: the one not rendered by a screen component.
  const nestedFns = new Set(routes.map((r) => r.component?.name).filter((n): n is string => !!n && componentNavigator.has(n)));
  const roots = navigatorElements.filter((el) => !el.enclosingFunction || !nestedFns.has(el.enclosingFunction));
  for (const root of roots) {
    const children = routesOfNavigator(root);
    const initial = children.find((c) => c.name === root.initial) ?? children[0];
    const target = initial && landing(initial);
    if (target && screens.has(target)) screens.get(target)!.entry = true;
  }

  // ---- Expo Router -------------------------------------------------------------------------------------
  const expoRoutes: Array<{ path: string; key: string }> = [];
  if (depNames.has('expo-router')) {
    const appDir = [joinPath(match.root, 'app'), joinPath(match.root, 'src/app')].find((d) => [...index.files.keys()].some((f) => f.startsWith(`${d}/`)));
    for (const [file, facts] of index.files) {
      if (!appDir || !file.startsWith(`${appDir}/`)) continue;
      const rel = file.slice(appDir.length + 1).replace(/\.[jt]sx?$/, '');
      if (/(^|\/)(_layout|\+not-found|\+html)$/.test(rel) || rel.endsWith('+api')) continue;
      const path = '/' + rel.split('/').filter((s) => !/^\(.*\)$/.test(s) && s !== 'index').map((s) => s.replace(/^\[\.\.\.(\w+)\]$/, '*').replace(/^\[(\w+)\]$/, ':$1')).join('/');
      const fn = facts.functions.find((f) => f.exported && /^[A-Z]/.test(f.name)) ?? facts.functions.find((f) => /^[A-Z]/.test(f.name));
      if (!fn) {
        out.warn({ code: 'route-target-unknown', severity: 'info', message: `Expo Router file ${file} exports no component.`, location: loc(file, 1) });
        continue;
      }
      const s = screens.get(fn.name) ?? { key: fn.name, file, line: fn.line, kind: 'page' as ScreenKind, evidence: [], entry: path === '/', route: path };
      s.evidence.push(declaredEvidence(file, 1, `Expo Router file route ${path}`));
      screens.set(fn.name, s);
      expoRoutes.push({ path, key: fn.name });
      out.addRoute({ id: `expo-router:${path}`, path, screenId: `react-native:${fn.name}`, router: 'expo-router', location: loc(file, 1), evidence: [declaredEvidence(file, 1, `File route ${rel}`)] });
    }
  }

  // ---- Tabs (declared) ---------------------------------------------------------------------------------
  for (const el of navigatorElements.filter((e) => e.navigator.type === 'tab')) {
    const children = routesOfNavigator(el);
    const first = children.find((c) => c.name === el.initial) ?? children[0];
    const firstScreen = first && landing(first);
    for (const c of children) {
      const target = landing(c);
      if (!firstScreen || !target || target === firstScreen) continue;
      out.addEdge({ from: `react-native:${firstScreen}`, to: `react-native:${target}`, kind: 'tab', trigger: { label: `${c.name} tab`, description: `Tab "${c.name}" of ${el.navigator.local}`, location: loc(c.file, c.line) }, evidence: [declaredEvidence(c.file, c.line, `${el.navigator.local}.Screen name="${c.name}"`)] });
    }
  }

  // ---- Navigation calls ----------------------------------------------------------------------------------
  const screenKeys = new Set(screens.keys());
  const fromScreens = (fn: string | undefined, file: string): string[] => (fn && screenKeys.has(fn) ? [fn] : index.ownersUsing(fn ?? '', screenKeys, 3, file));
  const emit = (file: string, at: { line: number; column?: number }, fn: string | undefined, handler: CallFact['handler'], fallback: string, detail: string, kind: NavigationKind, to: string | null, confidence: 'high' | 'medium' | 'low', reason?: string, unresolvedKind?: 'dynamic' | 'missing-target' | 'unsupported') => {
    const froms = fromScreens(fn, file);
    if (!froms.length) {
      out.warn({ code: 'navigation-outside-screen', severity: 'info', message: `${detail} in ${fn ?? 'module scope'} could not be attributed to a screen.`, location: loc(file, at.line) });
      return;
    }
    for (const from of froms) {
      if (from === to) continue;
      out.addEdge({
        from: `react-native:${from}`,
        to: to ? `react-native:${to}` : null,
        kind,
        trigger: triggerFor(file, at, handler, fallback),
        evidence: [staticEvidence(file, at, detail, confidence)],
        ...(to ? {} : { unresolvedReason: reason, unresolvedKind }),
      });
    }
  };
  const routeNameOf = (call: CallFact, facts: FileFacts): { value?: string; arg?: ArgFact } => {
    const arg = call.args[0];
    const direct = index.resolveString(arg);
    if (direct.value !== undefined) return { value: direct.value, arg };
    // navigate({ name: 'X' }) / reset({ routes: [{ name: 'X' }] })
    const pair = facts.pairs.find((p) => p.parentCall === call.index && p.key.stringValue === 'name');
    return { value: pair ? index.resolveString(pair.value).value : undefined, arg };
  };

  for (const { call, file, facts } of index.allCalls()) {
    const receiver = call.callee.includes('.') ? call.callee.slice(0, call.callee.lastIndexOf('.')) : '';
    const fallback = call.enclosingFunction && !/^[A-Z]/.test(call.enclosingFunction) ? `${call.enclosingFunction}()` : call.name;
    if (NAV_METHODS[call.name] && NAV_RECEIVER.test(receiver)) {
      const { value, arg } = routeNameOf(call, facts);
      const kind = NAV_METHODS[call.name]!;
      if (value !== undefined) {
        const target = routeTarget.get(value);
        const isModal = target && screens.get(target)?.kind !== 'page';
        emit(file, call, call.enclosingFunction, call.handler, fallback, callText(call), isModal ? 'modal' : kind, target ?? null, 'high', target ? undefined : `No navigator declares a screen named "${value}".`, 'missing-target');
      } else {
        emit(file, call, call.enclosingFunction, call.handler, fallback, callText(call), kind, null, 'low', `Route name \`${truncate(arg?.text ?? '?', 60)}\` is computed at runtime.`, 'dynamic');
      }
    } else if (expoRoutes.length && ROUTER_METHODS[call.name] && /(^|\.)router$/i.test(receiver)) {
      const s = index.resolveString(call.args[0]);
      const probe = s.value ?? s.pattern ?? call.args[0]?.strings[0];
      const r = probe !== undefined ? expoRoutes.find((x) => routeMatcher(x.path)(probe)) : undefined;
      emit(file, call, call.enclosingFunction, call.handler, fallback, callText(call), ROUTER_METHODS[call.name]!, r?.key ?? null, s.value ? 'high' : 'medium', probe === undefined ? `Href \`${call.args[0]?.text ?? '?'}\` is computed at runtime.` : `No file route matches "${probe}".`, probe === undefined ? 'dynamic' : 'missing-target');
    }
  }
  for (const { jsx, file } of index.allJsx()) {
    if (jsx.name !== 'Link') continue;
    const href = jsx.attrs.find((a) => a.label === 'href');
    const screen = jsx.attrs.find((a) => a.label === 'screen' || a.label === 'to');
    const label = ownerLabel(jsx.attrs.filter((a) => a !== href && a !== screen));
    const handler = { name: 'Link', owner: 'Link', ownerLabel: label };
    if (href && expoRoutes.length) {
      const s = index.resolveString(href);
      const probe = s.value ?? s.pattern ?? href.strings[0];
      const r = probe !== undefined ? expoRoutes.find((x) => routeMatcher(x.path)(probe)) : undefined;
      emit(file, jsx, jsx.enclosingFunction, handler, 'Link', `<Link href=${href.text}>`, 'push', r?.key ?? null, 'medium', probe === undefined ? 'Href is computed at runtime.' : `No file route matches "${probe}".`, probe === undefined ? 'dynamic' : 'missing-target');
    } else if (screen) {
      const name = index.resolveString(screen).value ?? screen.strings[0];
      const target = name ? routeTarget.get(name) : undefined;
      emit(file, jsx, jsx.enclosingFunction, handler, 'Link', `<Link ${screen.label}=${screen.text}>`, 'push', target ?? null, 'medium', name ? `No navigator declares a screen named "${name}".` : 'Link target is computed at runtime.', name ? 'missing-target' : 'dynamic');
    }
  }

  // ---- Screens to the builder, with components -------------------------------------------------------
  const assetsByPath = await rnAssets(ctx, out, match, index, paths);
  for (const s of screens.values()) {
    out.addScreen({
      id: `react-native:${s.key}`,
      name: humanize(s.key),
      kind: s.kind,
      platformKind: 'component',
      route: s.route,
      widgetClass: s.key,
      location: loc(s.file, s.line),
      isEntryPoint: s.entry,
      keyWidgets: rnComponents(index, s.key, screenKeys, assetsByPath),
      states: [],
      evidence: s.evidence,
    });
  }
  if (!screens.size && !depNames.has('@react-navigation/native') && !depNames.has('expo-router')) {
    out.warn({ code: 'no-router', severity: 'info', message: 'No supported navigation library (React Navigation, Expo Router) was found; screens cannot be identified.' });
  }
}

function ancestors(facts: FileFacts, jsx: JsxFact): JsxFact[] {
  const out: JsxFact[] = [];
  for (let p = jsx.parentJsx; p !== undefined; p = facts.jsx[p]?.parentJsx) out.push(facts.jsx[p]!);
  return out;
}

function navigatorAncestor(facts: FileFacts, jsx: JsxFact): number | undefined {
  return ancestors(facts, jsx).find((a) => a.name.endsWith('.Navigator'))?.index;
}

function rnComponents(index: CodeIndex, fn: string, screens: Set<string>, assets: Map<string, string>): WidgetRef[] {
  const out: WidgetRef[] = [];
  for (const { jsx, file } of index.allJsx()) {
    if (jsx.enclosingFunction !== fn || !/^[A-Z]/.test(jsx.name)) continue;
    const projectComponent = index.functions.has(jsx.name) && !screens.has(jsx.name);
    const kind = projectComponent ? 'custom' : widgetKindOf(jsx.name);
    if (!kind || jsx.name.includes('.')) continue;
    const label = ownerLabel(jsx.attrs.filter((a) => !(a.label && HANDLER_LABEL.test(a.label)) && a.label !== 'source' && a.label !== 'style'));
    const name = label && (kind === 'button' || kind === 'input' || kind === 'custom') ? `${jsx.name} “${label}”` : jsx.name;
    if (out.some((w) => w.name === name)) continue;
    const handlers = jsx.attrs.filter((a) => a.label && HANDLER_LABEL.test(a.label)).map((a) => a.label!);
    const assetIds = jsx.attrs.flatMap((a) => a.strings).map((s) => assets.get(`${file}|${s}`)).filter((x): x is string => !!x);
    out.push({ name, kind, location: loc(file, jsx.line), ...(handlers.length ? { handlers } : {}), ...(assetIds.length ? { assetIds } : {}) });
    if (out.length >= 15) break;
  }
  return out;
}

/** Image files referenced with require('./x.png'); returns `${file}|${request}` → asset path. */
async function rnAssets(ctx: AnalysisContext, out: ProjectGraphBuilder, match: DetectionMatch, index: CodeIndex, paths: Set<string>): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  for (const f of filesUnder(ctx.files, match.root)) {
    if (/\.(png|jpe?g|gif|webp|svg|ttf|otf|json|lottie|mp3|mp4)$/i.test(f.path) && /(^|\/)(assets?|images|fonts)\//.test(f.path) && !/\/(android|ios)\//.test(`/${f.path}`)) {
      out.addAsset(f.path, assetKindOf(f.path));
    }
  }
  for (const { call, file } of index.allCalls()) {
    if (call.name !== 'require' || !call.args[0]?.stringValue) continue;
    const request = call.args[0].stringValue;
    if (!/\.\w{2,5}$/.test(request) || /\.[jt]sx?$/.test(request)) continue;
    const target = joinPath(...`${dirname(file)}/${request}`.split('/').reduce<string[]>((acc, p) => (p === '..' ? acc.slice(0, -1) : p && p !== '.' ? [...acc, p] : acc), []));
    if (paths.has(target)) {
      out.addAsset(target, assetKindOf(target));
      out.referenceAsset(target, loc(file, call.line));
      resolved.set(`${file}|${request}`, target);
    } else {
      out.warn({ code: 'missing-asset', severity: 'warning', message: `require('${request}') does not resolve to a file.`, location: loc(file, call.line) });
    }
  }
  return resolved;
}

/** Native modules exported to JavaScript from the android/ and ios/ folders. */
async function nativeModules(ctx: AnalysisContext, dirs: string[]): Promise<NonNullable<import('@appflow/model').Module['exports']>> {
  const exportsList: NonNullable<import('@appflow/model').Module['exports']> = [];
  for (const f of ctx.files.filter((x) => dirs.some((d) => x.path.startsWith(`${d}/`)) && /\.(kt|java|m|mm|swift)$/.test(x.path))) {
    const facts = await ctx.facts(f.path);
    for (const c of facts?.classes ?? []) {
      if (c.supertypes.some((s) => /^(ReactContextBaseJavaModule|BaseJavaModule|RCTEventEmitter|RCTBridgeModule)$/.test(s))) {
        exportsList.push({ name: c.name, kind: 'native-module', location: loc(f.path, c.line) });
      }
    }
    // RCT_EXPORT_MODULE is a preprocessor macro, so it is not part of the syntax tree.
    if (/\.(m|mm)$/.test(f.path)) {
      const text = (await ctx.readText(f.path)) ?? '';
      text.split('\n').forEach((line, i) => {
        if (/^\s*RCT_EXPORT_MODULE\(/.test(line)) {
          const owner = [...text.split('\n').slice(0, i)].reverse().find((l) => l.startsWith('@implementation'))?.split(/\s+/)[1];
          if (owner && !exportsList.some((e) => e.name === owner && e.location?.fileId === f.path)) exportsList.push({ name: owner, kind: 'native-module', location: loc(f.path, i + 1) });
        }
      });
    }
  }
  return exportsList;
}
