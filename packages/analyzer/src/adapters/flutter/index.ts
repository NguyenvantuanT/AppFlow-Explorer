import { lookup } from '../shared';
import { FLUTTER_UI_STATES } from '../uiStateRules';
import type { Dependency, Evidence, NavigationKind, ScreenKind } from '@appflow/model';
import { parse as parseYaml } from 'yaml';
import type { ProjectGraphBuilder } from '../../core/builder';
import { CodeIndex, loc, routeMatcher, type Located } from '../../core/codeIndex';
import { basename, dirname, filesUnder, humanize, joinPath, type AnalysisAdapter, type AnalysisContext, type DetectionMatch } from '../../core/types';
import { isSensitiveFile } from '../../fs/sensitive';
import { HANDLER_LABEL, ownerLabel } from '../../parsing/ast';
import type { ArgFact, CallFact, ClassFact, FileFacts } from '../../parsing/facts';
import { assetKindOf, callText, declaredEvidence, staticEvidence, triggerFor, widgetKindOf } from '../shared';
import { AUTO_NAV, collectAutoRoutes, type AutoRouteDecl } from './autoRoute';
import { collectGoRoutes } from './goRouter';

const PAGE_ROUTE_CLASSES = new Set(['MaterialPageRoute', 'CupertinoPageRoute', 'PageRouteBuilder', 'DialogRoute', 'ModalBottomSheetRoute', 'RawDialogRoute']);

/** AutoRoute calls: `context.router.push(XRoute())`, `context.pushRoute(…)`, `AutoRouter.of(context).replace(…)`, or a router's own `replace(XRoute())`. */
function isAutoRouteCall(call: CallFact): boolean {
  const receiver = call.callee.includes('.') ? call.callee.slice(0, call.callee.lastIndexOf('.')) : '';
  if (/(^|\.)(router|Router|AutoRouter\.of|context|_router|appRouter|innerRouter|tabsRouter|parent)$/.test(receiver)) return true;
  return call.args.some((a) => a.typeRefs.some((t) => /Route$/.test(t) && !PAGE_ROUTE_CLASSES.has(t)));
}

interface Pubspec {
  path: string;
  dir: string;
  name: string;
  isFlutter: boolean;
  dependencies: Dependency[];
  assets: string[];
  fonts: string[];
  sdk?: string;
}

interface FlutterDetection {
  pubspecs: Pubspec[];
}

const WIDGET_BASES = new Set([
  'StatelessWidget', 'StatefulWidget', 'ConsumerWidget', 'ConsumerStatefulWidget', 'HookWidget', 'HookConsumerWidget',
  'StatefulHookWidget', 'StatefulHookConsumerWidget', 'GetView', 'GetWidget',
]);
const STATE_BASES = new Set(['State', 'ConsumerState']);
const PAGE_ROOTS = new Set(['Scaffold', 'CupertinoPageScaffold', 'CupertinoTabScaffold']);
const DIALOG_ROOTS = new Set(['AlertDialog', 'Dialog', 'SimpleDialog', 'CupertinoAlertDialog', 'AboutDialog']);
const APP_WIDGETS = /^(MaterialApp|CupertinoApp|WidgetsApp)(\.router)?$/;
const LAYOUT_NOISE = new Set(['Scaffold', 'Padding', 'Column', 'Row', 'SizedBox', 'Container', 'Center', 'Text', 'Expanded', 'Flexible', 'Stack', 'Align', 'SafeArea', 'Card', 'Divider', 'Spacer', 'Wrap', 'Builder', 'Consumer', 'MaterialPageRoute', 'CupertinoPageRoute', 'EdgeInsets', 'BoxDecoration', 'TextStyle', 'Theme', 'MediaQuery', 'Navigator', 'Icon', 'IconData']);

const NAMED_NAV: Record<string, NavigationKind> = lookup({
  pushNamed: 'push', restorablePushNamed: 'push', pushReplacementNamed: 'replace', restorablePushReplacementNamed: 'replace',
  popAndPushNamed: 'replace', pushNamedAndRemoveUntil: 'reset', restorablePushNamedAndRemoveUntil: 'reset',
});
const TYPED_NAV: Record<string, NavigationKind> = lookup({ push: 'push', pushReplacement: 'replace', pushAndRemoveUntil: 'reset', restorablePush: 'push' });
const MODALS: Record<string, ScreenKind> = lookup({
  showDialog: 'dialog', showCupertinoDialog: 'dialog', showGeneralDialog: 'dialog', showAdaptiveDialog: 'dialog',
  showModalBottomSheet: 'bottomSheet', showCupertinoModalPopup: 'bottomSheet', showBottomSheet: 'bottomSheet',
  showMaterialModalBottomSheet: 'bottomSheet', showBarModalBottomSheet: 'bottomSheet', showCupertinoModalBottomSheet: 'bottomSheet',
});
const GO_NAV: Record<string, { kind: NavigationKind; named: boolean }> = lookup({
  go: { kind: 'replace', named: false }, push: { kind: 'push', named: false }, pushReplacement: { kind: 'replace', named: false },
  replace: { kind: 'replace', named: false }, goNamed: { kind: 'replace', named: true }, pushNamed: { kind: 'push', named: true },
  pushReplacementNamed: { kind: 'replace', named: true }, replaceNamed: { kind: 'replace', named: true },
});
const UNSUPPORTED_ROUTERS: Record<string, string> = {
  get: 'GetX', beamer: 'Beamer', fluro: 'Fluro', routemaster: 'Routemaster', qlevar_router: 'QRouter',
};

function toDependencies(section: unknown): Dependency[] {
  if (!section || typeof section !== 'object') return [];
  return Object.entries(section as Record<string, unknown>).map(([name, v]) => ({
    name,
    version: typeof v === 'string' ? v : v && typeof v === 'object' && 'sdk' in v ? `sdk: ${String((v as { sdk: unknown }).sdk)}` : v && typeof v === 'object' && 'path' in v ? `path: ${String((v as { path: unknown }).path)}` : undefined,
  }));
}

async function readPubspec(ctx: { readText(p: string): Promise<string | null> }, path: string): Promise<Pubspec | null> {
  const text = await ctx.readText(path);
  if (text === null) return null;
  let doc: Record<string, any>;
  try {
    doc = (parseYaml(text) ?? {}) as Record<string, any>;
  } catch {
    return null;
  }
  const deps = toDependencies(doc.dependencies);
  const flutter = doc.flutter && typeof doc.flutter === 'object' ? doc.flutter : {};
  const fonts: string[] = Array.isArray(flutter.fonts)
    ? flutter.fonts.flatMap((f: any) => (Array.isArray(f?.fonts) ? f.fonts.map((x: any) => String(x?.asset ?? '')).filter(Boolean) : []))
    : [];
  return {
    path,
    dir: dirname(path),
    name: typeof doc.name === 'string' ? doc.name : basename(dirname(path)) || 'app',
    isFlutter: deps.some((d) => d.name === 'flutter'),
    dependencies: [...deps, ...toDependencies(doc.dev_dependencies)],
    assets: Array.isArray(flutter.assets) ? flutter.assets.map((a: unknown) => String(typeof a === 'object' && a && 'path' in a ? (a as { path: unknown }).path : a)) : [],
    fonts,
    sdk: doc.environment?.flutter ?? doc.environment?.sdk,
  };
}

export const flutterAdapter: AnalysisAdapter = {
  id: 'flutter',
  name: 'Flutter / Dart',
  platform: 'flutter',
  capabilities: [
    { kind: 'modules', description: 'Dart packages from pubspec.yaml files, including nested packages', confidence: 'high' },
    { kind: 'dependencies', description: 'Dependencies and versions declared in pubspec.yaml', confidence: 'high' },
    { kind: 'routes', description: 'Named routes in MaterialApp/CupertinoApp `routes` tables (inline or via a top-level map)', confidence: 'high' },
    { kind: 'routes', description: 'go_router GoRoute declarations, including nested paths and route names', confidence: 'high' },
    { kind: 'screens', description: 'Widgets used as route targets, navigation targets or dialog/sheet builders', confidence: 'high' },
    { kind: 'screens', description: 'Other widgets whose build method creates a Scaffold / CupertinoPageScaffold', confidence: 'medium' },
    { kind: 'navigation-edges', description: 'Navigator push/pushNamed/replacement/remove-until calls and go_router context.go/push/goNamed', confidence: 'medium' },
    { kind: 'navigation-edges', description: 'showDialog / showModalBottomSheet (and Cupertino variants) with a widget class builder', confidence: 'medium' },
    { kind: 'handlers', description: 'onPressed/onTap-style callbacks that trigger navigation, with the owning widget and its label', confidence: 'medium' },
    { kind: 'components', description: 'Buttons, inputs, lists, tabs, images and project widgets used by each screen', confidence: 'medium' },
    { kind: 'assets', description: 'Assets and fonts declared in pubspec.yaml and string references to them', confidence: 'high' },
    { kind: 'entry-points', description: 'MaterialApp home / initialRoute and GoRouter initialLocation', confidence: 'high' },
    { kind: 'ui-states', description: 'Loading, empty, error, data, authentication, dialog, bottom-sheet and tab states found in each screen\'s code', confidence: 'medium' },
  ],
  uiStateRules: FLUTTER_UI_STATES,
  limitations: [
    { description: 'Routes produced by onGenerateRoute / onUnknownRoute functions are not evaluated.' },
    { description: 'Route names or paths built at runtime (variables, string interpolation) cannot be resolved and are reported as unresolved.' },
    { description: 'AutoRoute, GetX, Beamer, Fluro and similar routers are reported as unsupported.' },
    { description: 'Inline dialogs (an AlertDialog built directly in the builder) are not shown as separate screens; they are listed as dialog UI states of the screen instead.' },
    { description: 'UI states are found by code patterns inside each screen (and its State class); states built in other widgets or decided by a router redirect are not attributed to the screen.' },
  ],

  async detect(ctx) {
    const pubspecs: Pubspec[] = [];
    for (const f of ctx.files.filter((x) => basename(x.path) === 'pubspec.yaml')) {
      const p = await readPubspec(ctx, f.path);
      if (p) pubspecs.push(p);
    }
    if (!pubspecs.length) return [];
    const depth = (p: Pubspec) => (p.dir ? p.dir.split('/').length : 0);
    const minDepth = Math.min(...pubspecs.map(depth));
    const roots = pubspecs.filter((p) => depth(p) === minDepth);
    return roots.map((root): DetectionMatch => {
      const members = pubspecs.filter((p) => p === root || !root.dir || p.dir.startsWith(`${root.dir}/`));
      return {
        adapterId: 'flutter',
        platform: 'flutter',
        root: root.dir,
        role: 'primary',
        framework: {
          id: root.isFlutter ? 'flutter' : 'dart',
          name: root.isFlutter ? 'Flutter' : 'Dart',
          version: typeof root.sdk === 'string' ? root.sdk : undefined,
          evidence: members.map((m) => m.path),
        },
        data: { pubspecs: members } satisfies FlutterDetection,
      };
    });
  },

  async analyze(ctx, match, out) {
    const { pubspecs } = match.data as FlutterDetection;
    for (const p of pubspecs) {
      const hasMain = ctx.files.some((f) => f.path === joinPath(p.dir, 'lib/main.dart'));
      out.addModule({ id: `flutter:${p.dir || '.'}`, name: p.name, path: p.dir, platform: 'flutter', kind: p.dir === match.root || hasMain ? 'app' : 'package', dependencies: p.dependencies });
    }
    const depNames = new Set(pubspecs.flatMap((p) => p.dependencies.map((d) => d.name)));
    for (const [pkg, label] of Object.entries(UNSUPPORTED_ROUTERS)) {
      if (depNames.has(pkg)) {
        out.warn({ code: 'unsupported-router', severity: 'warning', message: `${label} (${pkg}) routing is not analyzed. Recognized calls appear as unsupported navigation.`, location: loc(pubspecs[0]!.path, 1) });
      }
    }
    const usesGoRouter = depNames.has('go_router');
    const usesAutoRoute = depNames.has('auto_route');

    // Generated AutoRoute files (*.gr.dart) map route classes to pages, so they are read too.
    const dartFiles = filesUnder(ctx.files, match.root).filter(
      (f) => f.path.endsWith('.dart') && !/\.(g|freezed|mocks|config)\.dart$/.test(f.path) && !/(^|\/)(test|integration_test|test_driver)\//.test(f.path),
    );
    const index = new CodeIndex();
    for (let i = 0; i < dartFiles.length; i++) {
      ctx.signal?.throwIfAborted();
      if (i % 50 === 0) ctx.progress(`parsing Dart files (${i}/${dartFiles.length})`);
      const facts = await ctx.facts(dartFiles[i]!.path);
      if (facts) index.add(dartFiles[i]!.path, facts);
    }
    await analyzeDart(ctx, index, out, { usesGoRouter, usesAutoRoute });
    await analyzeAssets(ctx, index, out, pubspecs);
  },
};

interface FlutterOptions {
  usesGoRouter: boolean;
  usesAutoRoute: boolean;
}

interface NavIntent {
  call: CallFact;
  file: string;
  kind: NavigationKind;
  target: string | null;
  routeId?: string;
  unresolvedReason?: string;
  unresolvedKind?: 'dynamic' | 'missing-target' | 'unsupported';
  confidence: 'high' | 'medium' | 'low';
  arguments?: string[];
}

async function analyzeDart(ctx: AnalysisContext, index: CodeIndex, out: ProjectGraphBuilder, opts: FlutterOptions): Promise<void> {
  // ---- Widget classes and their State classes ------------------------------------------------
  const widgets = new Map<string, Located<ClassFact>>();
  for (const [name, list] of index.classes) if (index.extendsAny(name, WIDGET_BASES)) widgets.set(name, list[0]!);
  const stateOwner = new Map<string, string>();
  for (const [name, list] of index.classes) {
    const c = list[0]!.fact;
    if (c.supertypes.some((s) => STATE_BASES.has(s)) && c.supertypeArgs[0] && widgets.has(c.supertypeArgs[0])) stateOwner.set(name, c.supertypeArgs[0]);
  }
  const ownerWidget = (cls?: string) => (cls ? (widgets.has(cls) ? cls : stateOwner.get(cls)) : undefined);
  const callsOf = new Map<string, Array<{ call: CallFact; file: string }>>();
  for (const { call, file } of index.allCalls()) {
    const w = ownerWidget(call.enclosingClass);
    if (!w) continue;
    let list = callsOf.get(w);
    if (!list) callsOf.set(w, (list = []));
    list.push({ call, file });
  }
  const builds = (w: string, roots: Set<string>) => (callsOf.get(w) ?? []).some(({ call }) => call.isInstantiation && roots.has(call.name));

  // ---- Screen candidates ------------------------------------------------------------------------
  const candidates = new Map<string, { evidence: Evidence[]; kind: ScreenKind; entry: boolean }>();
  const candidate = (name: string | undefined, evidence: Evidence, kind?: ScreenKind) => {
    if (!name || !widgets.has(name)) return;
    let c = candidates.get(name);
    if (!c) candidates.set(name, (c = { evidence: [], kind: 'page', entry: false }));
    c.evidence.push(evidence);
    if (kind && kind !== 'page') c.kind = kind;
  };
  const widgetIn = (arg: ArgFact | undefined) => arg?.typeRefs.find((t) => widgets.has(t));

  // ---- Declared routes: MaterialApp.routes ------------------------------------------------------
  const routePaths = new Map<string, { routeId: string; target: string | null }>();
  let entryRoute: string | undefined;
  let entryWidget: string | undefined;
  for (const { call, file, facts } of index.allCalls()) {
    if (!APP_WIDGETS.test(call.callee)) continue;
    const routesArg = call.args.find((a) => a.label === 'routes');
    const pairs: Array<{ pair: FileFacts['pairs'][number]; file: string }> = [];
    if (routesArg) {
      for (const pair of facts.pairs) if (pair.parentCall === call.index && pair.parentKeys.length === 0) pairs.push({ pair, file });
      if (!pairs.length && /^[\w.]+$/.test(routesArg.text)) {
        for (const [f, ff] of index.files) for (const pair of ff.pairs) if (pair.ownerVariable === routesArg.text && pair.parentKeys.length === 0) pairs.push({ pair, file: f });
      }
      if (!pairs.length) {
        out.warn({ code: 'unresolved-route-table', severity: 'warning', message: `Could not read the routes table passed to ${call.callee} (${routesArg.text}).`, location: loc(file, call.line) });
      }
    }
    for (const { pair, file: pf } of pairs) {
      const path = index.resolveString(pair.key).value;
      const target = widgetIn(pair.value) ?? null;
      if (!path) {
        out.warn({ code: 'unresolved-route-key', severity: 'warning', message: `Route key \`${pair.key.text}\` could not be resolved to a string.`, location: loc(pf, pair.line) });
        continue;
      }
      const routeId = `flutter-navigator:${path}`;
      out.addRoute({ id: routeId, path, screenId: null, router: 'flutter-navigator', location: loc(pf, pair.line), evidence: [declaredEvidence(pf, pair.line, `Route "${path}" in ${call.callee}.routes`)] });
      if (target) candidate(target, declaredEvidence(pf, pair.line, `Target of route "${path}"`));
      else out.warn({ code: 'route-target-unknown', severity: 'info', message: `Route "${path}" builds \`${pair.value.text}\`, which is not a widget class in this project.`, location: loc(pf, pair.line) });
      routePaths.set(path, { routeId, target });
    }
    const initial = index.resolveString(call.args.find((a) => a.label === 'initialRoute'));
    if (initial.value) entryRoute = initial.value;
    const home = widgetIn(call.args.find((a) => a.label === 'home'));
    if (home) {
      entryWidget = home;
      candidate(home, declaredEvidence(file, call.line, `${call.callee}.home`));
    }
    for (const label of ['onGenerateRoute', 'onUnknownRoute']) {
      if (call.args.some((a) => a.label === label)) {
        out.warn({ code: 'unsupported-route-generator', severity: 'warning', message: `Routes created by ${label} are not analyzed; navigations to them appear as unresolved.`, location: loc(file, call.line) });
      }
    }
  }

  // ---- Declared routes: go_router ---------------------------------------------------------------
  const goRoutes = opts.usesGoRouter ? collectGoRoutes(index, widgets) : { routes: [], initialLocation: undefined };
  for (const r of goRoutes.routes) {
    const routeId = `go-router:${r.path}`;
    out.addRoute({ id: routeId, name: r.name, path: r.path, screenId: null, router: 'go-router', location: loc(r.file, r.line), evidence: [declaredEvidence(r.file, r.line, `GoRoute(path: '${r.path}'${r.name ? `, name: '${r.name}'` : ''})`)] });
    if (r.target) candidate(r.target, declaredEvidence(r.file, r.line, `Builder of GoRoute "${r.path}"`));
    else out.warn({ code: 'route-target-unknown', severity: 'info', message: `GoRoute "${r.path}" has no widget class builder that could be resolved.`, location: loc(r.file, r.line) });
  }

  // ---- Declared routes: AutoRoute -----------------------------------------------------------------
  const autoRoutes = opts.usesAutoRoute ? collectAutoRoutes(index, widgets) : { routes: [] as AutoRouteDecl[], resolveRoute: () => null };
  for (const r of autoRoutes.routes) {
    out.addRoute({
      id: `auto-route:${r.routeName}`,
      name: r.routeName,
      path: r.path,
      screenId: null,
      router: 'auto-route',
      location: loc(r.file, r.line),
      evidence: [declaredEvidence(r.file, r.line, `${r.routeName}${r.path ? ` at "${r.path}"` : ''} in the AutoRoute config`)],
    });
    if (r.target) candidate(r.target, declaredEvidence(r.file, r.line, `Page of ${r.routeName}`), r.kind);
    else out.warn({ code: 'route-target-unknown', severity: 'info', message: `${r.routeName} could not be mapped to a page widget.`, location: loc(r.file, r.line) });
  }
  const autoEntry = autoRoutes.routes.find((r) => r.initial && !r.parent)?.target ?? undefined;

  // ---- Navigation intents ---------------------------------------------------------------------
  const intents: NavIntent[] = [];
  let unsupportedCalls = 0;
  const resolveNamed = (arg: ArgFact | undefined): Pick<NavIntent, 'target' | 'routeId' | 'unresolvedReason' | 'unresolvedKind' | 'confidence'> => {
    const s = index.resolveString(arg);
    if (s.value !== undefined) {
      const r = routePaths.get(s.value);
      if (r) return { target: r.target, routeId: r.routeId, confidence: 'high', ...(r.target ? {} : { unresolvedReason: `Route "${s.value}" has no resolvable widget.`, unresolvedKind: 'missing-target' as const }) };
      return { target: null, confidence: 'medium', unresolvedReason: `Route "${s.value}" is not declared in any routes table.`, unresolvedKind: 'missing-target' };
    }
    return { target: null, confidence: 'low', unresolvedReason: `Route name \`${arg?.text ?? '?'}\` is computed at runtime.`, unresolvedKind: 'dynamic' };
  };
  const resolveGo = (arg: ArgFact | undefined, named: boolean): Pick<NavIntent, 'target' | 'routeId' | 'unresolvedReason' | 'unresolvedKind' | 'confidence'> => {
    const s = index.resolveString(arg);
    const probe = s.value ?? s.pattern;
    if (probe === undefined) return { target: null, confidence: 'low', unresolvedReason: `Location \`${arg?.text ?? '?'}\` is computed at runtime.`, unresolvedKind: 'dynamic' };
    const route = named ? goRoutes.routes.find((r) => r.name === probe) : goRoutes.routes.find((r) => routeMatcher(r.path)(probe));
    if (!route) return { target: null, confidence: 'medium', unresolvedReason: `No GoRoute ${named ? 'named' : 'matches'} "${probe}".`, unresolvedKind: 'missing-target' };
    return { target: route.target, routeId: `go-router:${route.path}`, confidence: s.value !== undefined ? 'high' : 'medium' };
  };

  for (const { call, file, facts } of index.allCalls()) {
    const { name, callee } = call;
    const receiverIsNavigator = callee.startsWith('Navigator.') || /navigator/i.test(callee.slice(0, Math.max(0, callee.lastIndexOf('.'))));
    const routeArgIndex = callee === `Navigator.${name}` ? 1 : 0;
    const navArgs = call.args.filter((a) => !a.label);
    const argumentsOf = () => call.args.filter((a) => a.label === 'arguments' || a.label === 'extra' || a.label === 'pathParameters' || a.label === 'queryParameters').map((a) => `${a.label}: ${a.text}`);

    if (NAMED_NAV[name] && receiverIsNavigator) {
      intents.push({ call, file, kind: NAMED_NAV[name]!, ...resolveNamed(navArgs[routeArgIndex]), arguments: argumentsOf() });
    } else if (TYPED_NAV[name] && receiverIsNavigator) {
      const routeArg = navArgs[routeArgIndex];
      let target = widgetIn(routeArg);
      if (!target && routeArg && /^\w+$/.test(routeArg.text)) {
        const v = facts.variables.find((x) => x.name === routeArg.text && x.enclosingFunction === call.enclosingFunction);
        target = widgetIn(v?.value);
      }
      intents.push(
        target
          ? { call, file, kind: TYPED_NAV[name]!, target, confidence: 'medium' }
          : { call, file, kind: TYPED_NAV[name]!, target: null, confidence: 'low', unresolvedReason: `The pushed route \`${routeArg?.text ?? '?'}\` does not build a known widget class.`, unresolvedKind: 'dynamic' },
      );
    } else if (MODALS[name] && !callee.includes('.')) {
      const builder = call.args.find((a) => a.label === 'builder' || a.label === 'pageBuilder') ?? call.args.find((a) => a.isLambda);
      const target = widgetIn(builder);
      if (target) {
        candidate(target, staticEvidence(file, call, `${name}(builder: … ${target}(…))`, 'medium'), MODALS[name]);
        intents.push({ call, file, kind: 'modal', target, confidence: 'medium' });
      } else if (builder?.typeRefs.some((t) => DIALOG_ROOTS.has(t))) {
        out.warn({ code: 'inline-dialog', severity: 'info', message: `${name} builds an inline ${builder.typeRefs.find((t) => DIALOG_ROOTS.has(t))}; it is not shown as a separate screen.`, location: loc(file, call.line) });
      } else {
        intents.push({ call, file, kind: 'modal', target: null, confidence: 'low', unresolvedReason: `${name} builder \`${builder?.text.slice(0, 60) ?? '?'}\` does not build a known widget class.`, unresolvedKind: 'dynamic' });
      }
    } else if (opts.usesGoRouter && GO_NAV[name] && !callee.startsWith('Navigator') && /(^|\.)(context|GoRouter\.of|router|_router|goRouter|appRouter)$/.test(callee.slice(0, callee.lastIndexOf('.')))) {
      const go = GO_NAV[name]!;
      intents.push({ call, file, kind: go.kind, ...resolveGo(navArgs[0], go.named), arguments: argumentsOf() });
    } else if (opts.usesAutoRoute && AUTO_NAV[name] && !callee.startsWith('Navigator') && isAutoRouteCall(call)) {
      const routeRef = call.args.flatMap((a) => a.typeRefs).find((t) => /Route$/.test(t) && !PAGE_ROUTE_CLASSES.has(t));
      if (routeRef) {
        const decl = autoRoutes.routes.find((r) => r.routeName === routeRef);
        const target = decl?.target ?? autoRoutes.resolveRoute(routeRef);
        intents.push(
          target
            ? { call, file, kind: AUTO_NAV[name]!, target, routeId: decl ? `auto-route:${routeRef}` : undefined, confidence: decl ? 'high' : 'medium' }
            : { call, file, kind: AUTO_NAV[name]!, target: null, confidence: 'medium', unresolvedReason: `${routeRef} is not declared in the AutoRoute config and no matching page was found.`, unresolvedKind: 'missing-target' },
        );
      } else {
        const s = index.resolveString(navArgs[0]);
        const probe = s.value ?? s.pattern;
        const decl = probe !== undefined ? autoRoutes.routes.find((r) => r.path && routeMatcher(r.path)(probe)) : undefined;
        intents.push(
          decl?.target
            ? { call, file, kind: AUTO_NAV[name]!, target: decl.target, routeId: `auto-route:${decl.routeName}`, confidence: 'medium' }
            : { call, file, kind: AUTO_NAV[name]!, target: null, confidence: 'low', unresolvedReason: probe !== undefined ? `No AutoRoute path matches "${probe}".` : `Route \`${navArgs[0]?.text ?? '?'}\` is computed at runtime.`, unresolvedKind: probe !== undefined ? 'missing-target' : 'dynamic' },
        );
      }
    } else if (/^Get\.(to|toNamed|off|offNamed|offAll|offAllNamed|offUntil|offNamedUntil)$/.test(callee)) {
      unsupportedCalls++;
      intents.push({ call, file, kind: 'push', target: null, confidence: 'low', unresolvedReason: `${callee} uses a routing package that is not supported.`, unresolvedKind: 'unsupported' });
    }
  }
  for (const intent of intents) if (intent.target) candidate(intent.target, staticEvidence(intent.file, intent.call, `Navigation target of ${intent.call.callee}`, intent.confidence));
  if (unsupportedCalls) out.warn({ code: 'unsupported-navigation', severity: 'warning', message: `${unsupportedCalls} navigation call(s) use an unsupported routing package and are shown as unresolved.` });

  // Widgets that build a page scaffold are screens even when nothing navigates to them yet.
  const SCAFFOLD_ONLY = ' builds a Scaffold';
  for (const [name, w] of widgets) {
    if (!candidates.has(name) && builds(name, PAGE_ROOTS)) {
      candidate(name, { source: 'static', detail: `${name}${SCAFFOLD_ONLY}`, location: loc(w.file, w.fact.line), confidence: /(Screen|Page|View)$/.test(name) ? 'medium' : 'low' });
    }
  }
  // A Scaffold widget rendered by another screen is part of it, not a screen of its own: e.g. a
  // route page `LoginPage` that wraps a private `_LoginPage` in providers, or a shared layout widget.
  const folded = new Map<string, string>(); // inner widget → owning screen
  const statesOf = (names: Iterable<string>) => [...stateOwner].filter(([, w]) => [...names].includes(w)).map(([s]) => s);
  for (const [name, c] of [...candidates]) {
    if (!c.evidence.every((e) => e.detail.endsWith(SCAFFOLD_ONLY))) continue;
    const others = [...candidates.keys()].filter((n) => n !== name);
    const owners = [...new Set(index.ownersUsing(name, new Set([...others, ...statesOf(others)]), 1, widgets.get(name)!.file).map((o) => ownerWidget(o) ?? o))];
    if (!owners.length) continue;
    candidates.delete(name);
    if (owners.length === 1) folded.set(name, owners[0]!);
  }

  // ---- Entry point --------------------------------------------------------------------------
  const entryPath = entryRoute ?? goRoutes.initialLocation ?? (routePaths.has('/') ? '/' : undefined);
  if (entryPath !== undefined) {
    const r = routePaths.get(entryPath) ?? (() => {
      const g = goRoutes.routes.find((x) => routeMatcher(x.path)(entryPath));
      return g ? { target: g.target } : undefined;
    })();
    if (r?.target) entryWidget = r.target;
  }
  entryWidget ??= autoEntry;
  if (entryWidget && candidates.has(entryWidget)) candidates.get(entryWidget)!.entry = true;
  else if (candidates.size) out.warn({ code: 'no-entry-point', severity: 'info', message: 'No start screen could be determined (no MaterialApp home/initialRoute, GoRouter initialLocation or AutoRoute initial route).' });

  // ---- Screens --------------------------------------------------------------------------------
  const screenId = (name: string) => `flutter:${name}`;
  for (const [name, c] of candidates) {
    const w = widgets.get(name)!;
    const kind: ScreenKind = c.kind !== 'page' ? c.kind : builds(name, DIALOG_ROOTS) && !builds(name, PAGE_ROOTS) ? 'dialog' : 'page';
    out.addScreen({
      id: screenId(name),
      name: humanize(name),
      kind,
      platformKind: 'widget',
      widgetClass: name,
      location: loc(w.file, w.fact.line),
      isEntryPoint: c.entry,
      keyWidgets: componentsOf(
        name,
        [...(callsOf.get(name) ?? []), ...[...folded].filter(([, owner]) => owner === name).flatMap(([inner]) => callsOf.get(inner) ?? [])],
        widgets,
        candidates,
      ).filter((w) => !folded.has(w.name)),
      states: [],
      evidence: c.evidence,
    });
  }
  for (const r of out.routes.values()) {
    if (r.screenId !== null) continue;
    const target =
      r.router === 'go-router'
        ? goRoutes.routes.find((g) => `go-router:${g.path}` === r.id)?.target
        : r.router === 'auto-route'
          ? autoRoutes.routes.find((g) => `auto-route:${g.routeName}` === r.id)?.target
          : routePaths.get(r.path ?? '')?.target;
    if (target && candidates.has(target)) {
      r.screenId = screenId(target);
      const screen = out.screens.get(r.screenId);
      if (screen && !screen.route) screen.route = r.path;
    }
  }

  // ---- Edges ----------------------------------------------------------------------------------
  const screenNames = new Set(candidates.keys());
  // Usage is recorded per class, so a screen's State class stands in for the screen.
  const screenOwners = new Set([...screenNames, ...[...stateOwner].filter(([, w]) => screenNames.has(w)).map(([s]) => s)]);
  // Nested AutoRoute routes (`children:`) are shown inside their parent: tabs when the parent uses AutoTabsRouter.
  for (const r of autoRoutes.routes) {
    const parent = r.parent ? autoRoutes.routes.find((p) => p.routeName === r.parent) : undefined;
    if (!parent?.target || !r.target || !screenNames.has(parent.target) || !screenNames.has(r.target)) continue;
    const tabs = (callsOf.get(parent.target) ?? []).concat([...folded].filter(([, o]) => o === parent.target).flatMap(([inner]) => callsOf.get(inner) ?? [])).some(({ call }) => /^AutoTabs/.test(call.name));
    out.addEdge({
      from: screenId(parent.target),
      to: screenId(r.target),
      kind: tabs ? 'tab' : 'push',
      trigger: { label: tabs ? `${humanize(r.target)} tab` : 'Nested route', description: `${r.routeName} is a child route of ${parent.routeName}`, location: loc(r.file, r.line) },
      evidence: [declaredEvidence(r.file, r.line, `children: [${r.routeName}] of ${parent.routeName}`)],
      routeId: `auto-route:${r.routeName}`,
    });
  }

  for (const intent of intents) {
    const { call, file } = intent;
    const owner = ownerWidget(call.enclosingClass);
    // A callback passed to a screen widget (`SplashPage(onToLogin: () => replace(LoginRoute()))`) is triggered by that screen.
    const facts = index.files.get(file)!;
    let callSite: string | undefined;
    for (let p = call.parentCall; p !== undefined && !callSite; p = facts.calls[p]?.parentCall) {
      const pc = facts.calls[p]!;
      if (pc.isInstantiation && screenNames.has(pc.name)) callSite = pc.name;
    }
    const fromNames =
      owner && screenNames.has(owner)
        ? [owner]
        : callSite
          ? [callSite]
          : [...new Set(index.ownersUsing(owner ?? call.enclosingFunction ?? '', screenOwners, 5, file).map((o) => ownerWidget(o) ?? o))];
    if (!fromNames.length) {
      out.warn({ code: 'navigation-outside-screen', severity: 'info', message: `${call.callee} in ${call.enclosingClass ?? call.enclosingFunction ?? 'top-level code'} could not be attributed to a screen.`, location: loc(file, call.line) });
      continue;
    }
    const via = owner && !screenNames.has(owner) ? owner : call.enclosingClass ? undefined : call.enclosingFunction;
    const fallback = call.enclosingFunction && call.enclosingFunction !== 'build' ? `${call.enclosingFunction}()` : call.name;
    for (const from of fromNames) {
      out.addEdge({
        from: screenId(from),
        to: intent.target && screenNames.has(intent.target) ? screenId(intent.target) : null,
        kind: intent.kind,
        trigger: triggerFor(file, call, call.handler, via ? `${fallback} · ${via}` : fallback),
        evidence: [staticEvidence(file, call, via ? `${callText(call)} (in ${via})` : callText(call), intent.confidence)],
        routeId: intent.routeId,
        arguments: intent.arguments?.length ? intent.arguments : undefined,
        ...(intent.target && screenNames.has(intent.target)
          ? {}
          : { unresolvedReason: intent.unresolvedReason ?? `\`${intent.target}\` is not a screen.`, unresolvedKind: intent.unresolvedKind ?? 'missing-target' }),
      });
    }
  }
  void ctx;
}

function componentsOf(
  name: string,
  calls: Array<{ call: CallFact; file: string }>,
  widgets: Map<string, Located<ClassFact>>,
  screens: Map<string, unknown>,
) {
  const out: import('@appflow/model').WidgetRef[] = [];
  const seen = new Set<string>();
  for (const { call, file } of calls) {
    const isImage = /^Image\.(asset|network|file|memory)$/.test(call.callee) || call.callee === 'AssetImage';
    if (!call.isInstantiation && !isImage) continue;
    const typeName = isImage ? call.callee : call.name;
    if (LAYOUT_NOISE.has(typeName) || typeName === name) continue;
    const kind = isImage ? 'image' : widgets.has(typeName) ? (screens.has(typeName) ? null : 'custom') : widgetKindOf(typeName);
    if (!kind) continue;
    const label = ownerLabel(call.args.filter((a) => !(a.label && HANDLER_LABEL.test(a.label)) && !a.isLambda));
    // Only controls carry their own visible label; a list's first string belongs to a child.
    const display = label && (kind === 'button' || kind === 'input' || kind === 'custom') ? `${typeName} “${label}”` : typeName;
    const key = `${display}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const handlers = call.args.filter((a) => a.label && HANDLER_LABEL.test(a.label)).map((a) => a.label!);
    out.push({ name: display, kind, location: loc(file, call.line), ...(handlers.length ? { handlers } : {}), ...(isImage && label ? { assetIds: [label] } : {}) });
    if (out.length >= 15) break;
  }
  return out;
}

async function analyzeAssets(ctx: AnalysisContext, index: CodeIndex, out: ProjectGraphBuilder, pubspecs: Pubspec[]): Promise<void> {
  for (const p of pubspecs) {
    const moduleId = `flutter:${p.dir || '.'}`;
    for (const entry of [...p.assets, ...p.fonts]) {
      const full = joinPath(p.dir, entry.replace(/^\.\//, ''));
      if (entry.endsWith('/')) {
        const dir = full.replace(/\/$/, '');
        const inDir = ctx.files.filter((f) => dirname(f.path) === dir);
        if (!inDir.length) out.warn({ code: 'missing-asset', severity: 'warning', message: `Asset folder "${entry}" declared in ${p.path} does not exist or is empty.`, location: loc(p.path, 1) });
        for (const f of inDir) out.addAsset(f.path, assetKindOf(f.path), moduleId);
      } else if (ctx.files.some((f) => f.path === full)) {
        out.addAsset(full, assetKindOf(full), moduleId);
      } else if (isSensitiveFile(basename(full))) {
        // Declared but deliberately not scanned (e.g. `.env.production`): not missing.
        continue;
      } else {
        out.warn({ code: 'missing-asset', severity: 'warning', message: `Asset "${entry}" declared in ${p.path} does not exist.`, location: loc(p.path, 1) });
      }
    }
  }
  const resolveAssetPath = (file: string, value: string) => {
    const pubspec = pubspecs.filter((p) => !p.dir || file.startsWith(`${p.dir}/`)).sort((a, b) => b.dir.length - a.dir.length)[0];
    return joinPath(pubspec?.dir ?? '', value);
  };
  for (const [file, facts] of index.files) {
    for (const s of facts.strings) {
      if (!/^(assets?|images|fonts|res)\/.+\.\w{2,5}$/.test(s.value)) continue;
      const path = resolveAssetPath(file, s.value);
      if (!out.referenceAsset(path, loc(file, s.line))) {
        out.warn({ code: 'undeclared-asset', severity: 'warning', message: `"${s.value}" is referenced but not declared as an asset in pubspec.yaml.`, location: loc(file, s.line) });
      }
    }
  }
  // Link screen components to the asset ids they show.
  for (const screen of out.screens.values()) {
    for (const w of screen.keyWidgets) {
      if (w.assetIds) w.assetIds = w.assetIds.map((a) => resolveAssetPath(screen.location.fileId, a)).filter((a) => out.assets.has(a));
    }
  }
}
