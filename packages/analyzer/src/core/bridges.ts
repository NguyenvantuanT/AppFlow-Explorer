import type { NativeBridge, NavigationKind, Screen, WidgetRef } from '@appflow/model';
import { callText, staticEvidence, triggerFor, truncate } from '../adapters/shared';
import type { CallFact, FileFacts, FunctionFact } from '../parsing/facts';
import type { ScannedFile } from '../fs/projectFs';
import type { ProjectGraphBuilder } from './builder';
import { CodeIndex, loc, routeMatcher, type Located } from './codeIndex';
import { filesUnder, joinPath, type DetectionMatch } from './types';

export interface BridgeContext {
  files: ScannedFile[];
  matches: DetectionMatch[];
  facts(path: string): Promise<FileFacts | null>;
  readText(path: string): Promise<string | null>;
  signal?: AbortSignal;
}

type NativePlatform = 'android' | 'ios';
interface CallRef { call: CallFact; file: string; facts: FileFacts }
/** A native code path that opens one of the app's native screens. */
interface NativeOpen { platform: NativePlatform; screen: Screen; kind: NavigationKind; file: string; line: number; detail: string; created: boolean }
/** Native code that answers a channel or module method; `method` is unknown when it could not be told apart. */
interface NativeHandler { name: string; method?: string; opens: NativeOpen[] }

const CHANNEL_CLASSES = new Set(['MethodChannel', 'OptionalMethodChannel', 'FlutterMethodChannel']);
const INVOKE_METHODS = new Set(['invokeMethod', 'invokeMapMethod', 'invokeListMethod']);
const PLATFORM_VIEWS = new Set(['AndroidView', 'AndroidViewSurface', 'UiKitView', 'AppKitView', 'PlatformViewLink']);
const RN_MODULE_BASES = new Set(['ReactContextBaseJavaModule', 'BaseJavaModule']);
const MODAL_CALLS = /^(present|presentViewController|show)$/;

/**
 * Connects a Flutter or React Native app to the screens its own native code
 * adds in the android/ and ios/ hosts:
 * - Flutter → native: `MethodChannel('x').invokeMethod('m')` matched to the
 *   native `setMethodCallHandler` branch for "m" that opens an Activity or
 *   view controller.
 * - React Native → native: `NativeModules.X.m()` matched to the native
 *   module's exported method `m`.
 * - Native → Flutter: `FlutterActivity.withNewEngine().initialRoute("/r")`,
 *   `FlutterViewController(…, initialRoute: "/r")`.
 * - Platform views: `AndroidView` / `UiKitView(viewType: 'v')` are listed as
 *   components of the Flutter screen with the native factory registered for "v".
 * Runs after the adapters, because it needs the screens of several of them.
 */
export async function connectNativeBridges(ctx: BridgeContext, out: ProjectGraphBuilder): Promise<void> {
  for (const app of ctx.matches.filter((m) => m.role === 'primary' && (m.platform === 'flutter' || m.platform === 'react-native'))) {
    const hosts = ctx.matches.filter((m) => m.role === 'host' && (m.platform === 'android' || m.platform === 'ios') && m.root === joinPath(app.root, m.platform));
    if (!hosts.length) continue;
    const natives = new Map<NativePlatform, CodeIndex>();
    const nativeText = new Map<string, string>();
    for (const host of hosts) {
      const platform = host.platform as NativePlatform;
      const files = filesUnder(ctx.files, host.root).filter((f) => (platform === 'android' ? /\.(kt|java)$/ : /\.(swift|m|mm)$/).test(f.path) && !/(\/src\/(test|androidTest)\w*\/|Tests\/)/.test(f.path));
      natives.set(platform, await indexFiles(ctx, files));
      for (const f of files) nativeText.set(f.path, (await ctx.readText(f.path)) ?? '');
    }
    const hostRoots = hosts.map((h) => `${h.root}/`);
    const appFiles = filesUnder(ctx.files, app.root).filter((f) => !hostRoots.some((r) => f.path.startsWith(r)));
    if (app.platform === 'flutter') {
      const index = await indexFiles(ctx, appFiles.filter((f) => f.path.endsWith('.dart') && /(^|\/)lib\//.test(f.path)));
      flutterBridges(index, natives, nativeText, out);
    } else {
      const index = await indexFiles(ctx, appFiles.filter((f) => /\.(js|jsx|ts|tsx)$/.test(f.path) && !/(\.test\.|\.spec\.|__tests__\/|\.d\.ts$)/.test(f.path)));
      const texts = new Map<string, string>();
      for (const file of index.files.keys()) texts.set(file, (await ctx.readText(file)) ?? '');
      reactNativeBridges(index, texts, natives, nativeText, out);
    }
  }
}

async function indexFiles(ctx: BridgeContext, files: ScannedFile[]): Promise<CodeIndex> {
  const index = new CodeIndex();
  for (const f of files) {
    ctx.signal?.throwIfAborted();
    const facts = await ctx.facts(f.path);
    if (facts) index.add(f.path, facts);
  }
  return index;
}

// ---- Flutter -------------------------------------------------------------------------------------------

function flutterBridges(dart: CodeIndex, natives: Map<NativePlatform, CodeIndex>, nativeText: Map<string, string>, out: ProjectGraphBuilder): void {
  // Native side: channel handlers and platform view factories.
  const handlers: NativeHandler[] = [];
  const viewFactories = new Map<string, Array<{ platform: NativePlatform; factory: string }>>();
  for (const [platform, index] of natives) {
    for (const ref of index.allCalls()) {
      const { call } = ref;
      if (call.name === 'setMethodCallHandler') {
        const name = channelOf(index, ref);
        if (name) handlers.push(...handlerBranches(index, nativeText, platform, ref, name, out));
      } else if (call.name === 'registerViewFactory' || (call.name === 'register' && call.args.some((a) => a.label === 'withId'))) {
        const idArg = call.args.find((a) => a.label === 'withId') ?? call.args[0];
        const viewType = index.resolveString(idArg).value;
        const factory = call.args.find((a) => a !== idArg)?.typeRefs[0];
        if (viewType && factory) viewFactories.set(viewType, [...(viewFactories.get(viewType) ?? []), { platform, factory }]);
      }
    }
  }

  // Dart side: State classes belong to their widget's screen.
  const stateOwner = new Map<string, string>();
  for (const [name, list] of dart.classes) {
    const c = list[0]!.fact;
    if (c.supertypes.some((s) => /^(Consumer)?State$/.test(s)) && c.supertypeArgs[0]) stateOwner.set(name, c.supertypeArgs[0]);
  }
  const screenOf = (call: CallFact) => {
    const cls = call.enclosingClass ?? '';
    return out.screens.get(`flutter:${stateOwner.get(cls) ?? cls}`);
  };

  const dartChannels = new Map<string, string>(); // `${file}#${variable}` → channel name
  for (const [file, facts] of dart.files) {
    for (const v of facts.variables) {
      if (!v.initCallee || !CHANNEL_CLASSES.has(v.initCallee)) continue;
      const ctor = facts.calls.find((c) => c.isInstantiation && CHANNEL_CLASSES.has(c.name) && c.line === v.line);
      const name = dart.resolveString(ctor?.args[0]).value ?? v.value.strings[0];
      if (name) dartChannels.set(`${file}#${v.name}`, name);
    }
  }
  for (const { call, file, facts } of dart.allCalls()) {
    if (INVOKE_METHODS.has(call.name)) {
      const receiver = call.callee.slice(0, call.callee.lastIndexOf('.'));
      const inline = facts.calls.find((c) => c.isInstantiation && CHANNEL_CLASSES.has(c.name) && c.line === call.line);
      const channel = inline ? dart.resolveString(inline.args[0]).value : dartChannels.get(`${file}#${receiver.replace(/^(this|widget)\./, '')}`);
      const method = dart.resolveString(call.args[0]).value;
      if (!channel || !method) continue;
      const branches = handlers.filter((h) => h.name === channel && (h.method === method || h.method === undefined));
      const opens = branches.flatMap((h) => h.opens.map((o) => ({ ...o, exact: h.method === method })));
      if (!opens.length) continue;
      const bridge: NativeBridge = { kind: 'method-channel', name: channel, method };
      for (const site of callSites(dart, { call, file, facts }, (c) => screenOf(c))) {
        for (const o of opens) {
          out.addEdge({
            from: site.screen.id,
            to: o.screen.id,
            kind: o.kind,
            trigger: triggerFor(site.file, site.call, site.call.handler, `${method}()`),
            evidence: [
              staticEvidence(file, call, `${callText(call)} on MethodChannel '${channel}'`, o.exact ? 'medium' : 'low'),
              staticEvidence(o.file, o, `${o.platform === 'android' ? 'Android' : 'iOS'} handler for "${method}": ${o.detail}`, o.exact ? 'medium' : 'low'),
            ],
            bridge,
          });
        }
      }
    } else if (PLATFORM_VIEWS.has(call.name) && call.isInstantiation) {
      const viewType = dart.resolveString(call.args.find((a) => a.label === 'viewType')).value;
      const screen = screenOf(call);
      if (!viewType || !screen) continue;
      const factories = viewFactories.get(viewType) ?? [];
      const name = `Native view “${truncate(viewType, 40)}”${factories.length ? ` · ${[...new Set(factories.map((f) => f.factory))].join(', ')}` : ''}`;
      if (screen.keyWidgets.some((w) => w.name === name)) continue; // AndroidView and UiKitView of the same view
      const widget: WidgetRef = { name, kind: 'custom', location: loc(file, call.line) };
      screen.keyWidgets = [widget, ...screen.keyWidgets.filter((w) => !PLATFORM_VIEWS.has(w.name))].slice(0, 15);
    }
  }

  // Native screens that open Flutter again.
  for (const [platform, index] of natives) {
    for (const ref of index.allCalls()) {
      const { call } = ref;
      let route: string | undefined;
      if (platform === 'android' && /\bFlutter(Activity|Fragment)\b/.test(call.callee) && /^(initialRoute|createDefaultIntent|withCachedEngine)$/.test(call.name)) {
        route = call.name === 'initialRoute' ? index.resolveString(call.args[0]).value : '';
      } else if (platform === 'ios' && call.isInstantiation && /^Flutter\w*ViewController$/.test(call.name)) {
        route = index.resolveString(call.args.find((a) => a.label === 'initialRoute')).value ?? '';
      } else if (platform === 'ios' && /^(setInitialRoute|pushRoute)$/.test(call.name)) {
        route = index.resolveString(call.args[0]).value;
      }
      if (route === undefined) continue;
      const from = out.screens.get(`${platform}:${call.enclosingClass ?? ''}`);
      const to = route ? flutterRouteScreen(out, route) : [...out.screens.values()].find((s) => s.id.startsWith('flutter:') && s.isEntryPoint);
      if (!from || !to) continue;
      out.addEdge({
        from: from.id,
        to: to.id,
        kind: platform === 'ios' ? 'modal' : 'push',
        trigger: triggerFor(ref.file, call, call.handler, call.enclosingFunction ? `${call.enclosingFunction}()` : 'Open Flutter'),
        evidence: [staticEvidence(ref.file, call, `${callText(call)} opens Flutter${route ? ` at "${route}"` : ''}`, route ? 'medium' : 'low')],
        bridge: { kind: 'flutter-engine', ...(route ? { name: route } : {}) },
      });
    }
  }
}

/** Channel name of a `setMethodCallHandler` call: the nearest channel created before it in the same file. */
function channelOf(index: CodeIndex, { call, facts }: CallRef): string | undefined {
  const ctor = facts.calls.filter((c) => c.isInstantiation && CHANNEL_CLASSES.has(c.name) && c.line <= call.line).sort((a, b) => b.line - a.line)[0];
  if (!ctor) return undefined;
  for (const arg of [ctor.args.find((a) => a.label === 'name'), ...ctor.args]) {
    const value = index.resolveString(arg).value;
    if (value) return value;
  }
  return undefined;
}

/**
 * Splits a channel handler into the branches that open native screens. A
 * branch belongs to the method name written last before it inside the handler
 * (`when (call.method) { "m" -> … }`, `case "m":`, `if call.method == "m"`).
 */
function handlerBranches(index: CodeIndex, text: Map<string, string>, platform: NativePlatform, handler: CallRef, name: string, out: ProjectGraphBuilder): NativeHandler[] {
  const { facts } = handler;
  const handlerIndex = facts.calls.indexOf(handler.call);
  const lastLine = Math.max(handler.call.line, ...facts.calls.filter((c) => hasAncestor(facts, c, handlerIndex)).map((c) => c.line));
  const strings = facts.strings.filter((s) => s.line >= handler.call.line && s.line <= lastLine && /^\w+$/.test(s.value));
  const byMethod = new Map<string | undefined, NativeOpen[]>();
  for (const call of facts.calls.filter((c) => hasAncestor(facts, c, handlerIndex))) {
    const opens = opensFrom(index, text, platform, { call, file: handler.file, facts }, out);
    if (!opens.length) continue;
    const method = strings.filter((s) => s.line <= call.line).at(-1)?.value;
    byMethod.set(method, [...(byMethod.get(method) ?? []), ...opens]);
  }
  return [...byMethod].map(([method, opens]) => ({ name, method, opens: dedupe(opens) }));
}

/** One entry per screen, preferring the call that shows it over the one that creates it. */
function dedupe(opens: NativeOpen[]): NativeOpen[] {
  const seen = new Map<string, NativeOpen>();
  for (const o of opens) {
    const prev = seen.get(o.screen.id);
    if (!prev || (prev.created && !o.created)) seen.set(o.screen.id, o);
  }
  return [...seen.values()];
}

/**
 * Native screens a call opens: directly (`Intent(this, X::class.java)`, `X()`),
 * or through the functions it calls, up to `depth` calls away: helpers of the
 * same class, and methods of other classes reached through a class name
 * (`TUILiveRoom.sharedInstance.createRoom()`) or a typed field
 * (`mLiveVideo.createRoom()`), including the subclasses of an abstract class.
 * Calls inside callbacks and closures count for the function that contains them.
 */
function opensFrom(index: CodeIndex, text: Map<string, string>, platform: NativePlatform, ref: CallRef, out: ProjectGraphBuilder, depth = 4, seen = new Set<string>()): NativeOpen[] {
  const { call, facts } = ref;
  // Callbacks passed as arguments are scanned as calls of their own, so the evidence is the line that opens the screen.
  const refs = new Set(call.args.filter((a) => !a.isLambda && !a.text.includes('{')).flatMap((a) => a.typeRefs));
  if (call.isInstantiation) refs.add(call.name);
  for (const a of call.args) {
    if (!/^\w+$/.test(a.text)) continue;
    // The nearest declaration above the call: callbacks often reuse the same function and variable names (`onCallback`, `intent`).
    facts.variables
      .filter((v) => v.name === a.text && v.enclosingFunction === call.enclosingFunction && v.line <= call.line)
      .at(-1)
      ?.value.typeRefs.forEach((t) => refs.add(t));
  }
  const kind: NavigationKind = MODAL_CALLS.test(call.name) ? 'modal' : 'push';
  const opens: NativeOpen[] = [];
  for (const t of refs) {
    const screen = out.screens.get(`${platform}:${t}`);
    if (screen) opens.push({ platform, screen, kind, file: ref.file, line: call.line, detail: callText(call), created: call.isInstantiation });
  }
  if (!opens.length && depth > 0 && !call.isInstantiation) {
    for (const target of callTargets(index, text, ref)) opens.push(...functionOpens(index, text, platform, target, out, depth - 1, seen));
  }
  return dedupe(opens);
}

/** Native screens a function opens, through the calls in its body (see `opensFrom`). */
function functionOpens(index: CodeIndex, text: Map<string, string>, platform: NativePlatform, fn: Located<FunctionFact>, out: ProjectGraphBuilder, depth = 4, seen = new Set<string>()): NativeOpen[] {
  const key = `${fn.file}#${fn.fact.enclosingClass}.${fn.fact.name}@${fn.fact.line}`;
  if (seen.has(key)) return [];
  seen.add(key);
  const body = bodyCalls(index, fn);
  // A screen created in a function that presents it (`present(vc)`, `presentRoomController(vc:)`) is shown modally.
  const presents = platform === 'ios' && body.some((r) => /^present/.test(r.call.name));
  const opens = body.flatMap((inner) => opensFrom(index, text, platform, inner, out, depth, seen));
  return dedupe(opens.map((o) => (presents ? { ...o, kind: 'modal' as const } : o)));
}

/** Calls written inside a function, including those in its callbacks, closures and anonymous classes. */
function bodyCalls(index: CodeIndex, fn: Located<FunctionFact>): CallRef[] {
  const facts = index.files.get(fn.file);
  if (!facts) return [];
  return facts.calls.filter((c) => c.line >= fn.fact.line && c.line <= fn.fact.endLine && (c.line > fn.fact.line || c.column >= fn.fact.column)).map((call) => ({ call, file: fn.file, facts }));
}

/** The functions a call may run: a helper of the same class, or a method of the receiver's class and its subclasses. */
function callTargets(index: CodeIndex, text: Map<string, string>, { call, file }: CallRef): Array<Located<FunctionFact>> {
  const methods = (cls: string) => (index.functions.get(call.name) ?? []).filter((f) => f.fact.enclosingClass === cls);
  const callee = call.callee.replace(/^(this|self)\??\./, '');
  if (!callee.includes('.')) return call.enclosingClass ? methods(call.enclosingClass) : [];
  const receiver = callee.split('.').slice(0, -1);
  const type = receiver.find((s) => index.classes.has(s)) ?? fieldType(index, text.get(file) ?? '', receiver[0]!);
  if (!type) return [];
  // Calls on an interface or protocol reach listeners and delegates, not the code that opens screens.
  const decl = index.classNamed(type)?.fact;
  if (decl && (decl.kind === 'interface' || decl.kind === 'protocol')) return [];
  const classes = [type, ...[...index.classes.keys()].filter((c) => c !== type && index.extendsAny(c, new Set([type])))];
  return classes.flatMap(methods);
}

/** The declared or assigned class of a field or variable: `private TUILiveRoom mLiveVideo;`, `var room: TUILiveRoom`, `mLiveVideo = TUILiveRoom.sharedInstance(…)`. */
function fieldType(index: CodeIndex, source: string, name: string): string | undefined {
  if (!/^[a-z_]\w*$/i.test(name)) return undefined;
  const patterns = [
    new RegExp(`\\b([A-Z]\\w*)(?:<[^;=()]*>)?\\s+${name}\\s*[;=]`),
    new RegExp(`\\b(?:var|val|let)\\s+${name}\\s*:\\s*([A-Z]\\w*)`),
    new RegExp(`\\b${name}\\s*=\\s*(?:new\\s+)?([A-Z]\\w*)\\s*[.(]`),
  ];
  for (const p of patterns) {
    const type = p.exec(source)?.[1];
    if (type && index.classes.has(type)) return type;
  }
  return undefined;
}

function flutterRouteScreen(out: ProjectGraphBuilder, route: string): Screen | undefined {
  const r = [...out.routes.values()].find((x) => x.screenId?.startsWith('flutter:') && x.path !== undefined && (x.path === route || routeMatcher(x.path)(route)));
  return r?.screenId ? out.screens.get(r.screenId) : undefined;
}

/**
 * The screens a bridge call is made from: the screen whose code contains it,
 * or, for a helper (`NativeBridge.openScanner()`), the screens that call the
 * helper, up to two levels away. The site is the call a user triggers.
 */
function callSites(index: CodeIndex, ref: CallRef, screenOf: (call: CallFact) => Screen | undefined, depth = 2): Array<{ screen: Screen; call: CallFact; file: string }> {
  const screen = screenOf(ref.call);
  if (screen) return [{ screen, call: ref.call, file: ref.file }];
  const fn = ref.call.enclosingFunction;
  if (!fn || depth === 0) return [];
  const owner = ref.call.enclosingClass;
  const sites: Array<{ screen: Screen; call: CallFact; file: string }> = [];
  for (const c of index.allCalls()) {
    if (c.call.name !== fn || c.call === ref.call) continue;
    const callee = c.call.callee;
    const matches = callee === fn ? c.call.enclosingClass === owner : !owner || callee.endsWith(`${owner}.${fn}`) || callee.split('.').length === 2;
    if (matches) sites.push(...callSites(index, c, screenOf, depth - 1));
  }
  return sites;
}

function hasAncestor(facts: FileFacts, call: CallFact, ancestor: number): boolean {
  for (let p = call.parentCall; p !== undefined; p = facts.calls[p]?.parentCall) if (p === ancestor) return true;
  return false;
}

// ---- React Native --------------------------------------------------------------------------------------

function reactNativeBridges(js: CodeIndex, texts: Map<string, string>, natives: Map<NativePlatform, CodeIndex>, nativeText: Map<string, string>, out: ProjectGraphBuilder): void {
  const handlers: NativeHandler[] = [];

  // Android: ReactContextBaseJavaModule subclasses, getName() and @ReactMethod functions.
  const android = natives.get('android');
  if (android) {
    for (const [cls, list] of android.classes) {
      if (!android.extendsAny(cls, RN_MODULE_BASES) && !list[0]!.fact.supertypes.some((s) => /^Native\w+Spec$/.test(s))) continue;
      const { file } = list[0]!;
      const facts = android.files.get(file)!;
      const getName = facts.functions.find((f) => f.name === 'getName' && f.enclosingClass === cls);
      const literal = getName ? facts.strings.find((s) => s.line >= getName.line && s.line <= getName.endLine)?.value : undefined;
      const name = literal ?? facts.constants.find((c) => /(^|\.)NAME$/.test(c.name))?.value ?? cls;
      for (const fn of facts.functions.filter((f) => f.enclosingClass === cls && f.annotations.includes('ReactMethod'))) {
        const opens = functionOpens(android, nativeText, 'android', { fact: fn, file }, out);
        if (opens.length) handlers.push({ name, method: fn.name, opens });
      }
    }
  }

  // iOS: RCT_EXPORT_MODULE / RCT_EXPORT_METHOD in Objective-C, RCT_EXTERN_MODULE for Swift modules.
  const ios = natives.get('ios');
  for (const [file, text] of nativeText) {
    if (!/\.(m|mm)$/.test(file)) continue;
    const lineAt = (offset: number) => text.slice(0, offset).split('\n').length;
    const exported = /RCT_EXPORT_MODULE\(\s*(\w*)\s*\)/.exec(text);
    if (exported) {
      const name = exported[1] || /@implementation\s+(\w+)/.exec(text)?.[1];
      const methods = [...text.matchAll(/RCT_EXPORT_METHOD\(\s*(\w+)/g)];
      methods.forEach((m, i) => {
        const endOfClass = text.indexOf('@end', m.index);
        const body = text.slice(m.index, methods[i + 1]?.index ?? (endOfClass < 0 ? text.length : endOfClass));
        const opens: NativeOpen[] = [];
        for (const id of new Set(body.match(/\b[A-Z]\w+\b/g) ?? [])) {
          const screen = out.screens.get(`ios:${id}`);
          if (!screen) continue;
          const line = lineAt(m.index! + body.search(new RegExp(`\\b${id}\\b`)));
          opens.push({ platform: 'ios', screen, kind: /presentViewController/.test(body) ? 'modal' : 'push', file, line, detail: text.split('\n')[line - 1]!.trim(), created: false });
        }
        if (name && opens.length) handlers.push({ name, method: m[1]!, opens });
      });
    }
    if (ios) {
      for (const m of text.matchAll(/RCT_EXTERN_MODULE\(\s*(\w+)/g)) {
        const cls = m[1]!;
        for (const em of text.matchAll(/RCT_EXTERN_METHOD\(\s*(\w+)/g)) {
          const fns = (ios.functions.get(em[1]!) ?? []).filter((f) => f.fact.enclosingClass === cls);
          const opens = dedupe(fns.flatMap((fn) => functionOpens(ios, nativeText, 'ios', fn, out)));
          if (opens.length) handlers.push({ name: cls, method: em[1]!, opens });
        }
      }
    }
  }
  if (!handlers.length) return;

  // JS side: NativeModules.X.m(), const { X } = NativeModules, const X = NativeModules.X.
  for (const { call, file, facts } of js.allCalls()) {
    const parts = call.callee.split('.');
    let module: string | undefined;
    if (parts[0] === 'NativeModules' && parts.length === 3) module = parts[1];
    else if (parts.length === 2) module = moduleAlias(texts.get(file) ?? '', facts, parts[0]!);
    if (!module) continue;
    const method = parts.at(-1)!;
    const opens = handlers.filter((h) => h.name === module && h.method === method).flatMap((h) => h.opens);
    if (!opens.length) continue;
    const bridge: NativeBridge = { kind: 'native-module', name: module, method };
    const screenOf = (c: CallFact) => out.screens.get(`react-native:${c.enclosingFunction ?? ''}`);
    for (const site of callSites(js, { call, file, facts }, screenOf)) {
      for (const o of dedupe(opens)) {
        out.addEdge({
          from: site.screen.id,
          to: o.screen.id,
          kind: o.kind,
          trigger: triggerFor(site.file, site.call, site.call.handler, `${method}()`),
          evidence: [
            staticEvidence(file, call, `${callText(call)} on native module ${module}`, 'medium'),
            staticEvidence(o.file, o, `${o.platform === 'android' ? 'Android' : 'iOS'} ${module}.${method}: ${o.detail}`, 'medium'),
          ],
          bridge,
        });
      }
    }
  }
}

/** The native module a local name refers to, if it was taken from `NativeModules`. */
function moduleAlias(text: string, facts: FileFacts, local: string): string | undefined {
  const v = facts.variables.find((x) => x.name === local);
  const direct = v && /^NativeModules\.(\w+)$/.exec(v.value.text.trim())?.[1];
  if (direct) return direct;
  const turbo = v && /TurboModuleRegistry\.(getEnforcing|get)\b/.test(v.value.text) ? v.value.strings[0] : undefined;
  if (turbo) return turbo;
  for (const m of text.matchAll(/\{([^{}]*)\}\s*=\s*NativeModules\b/g)) {
    for (const part of m[1]!.split(',')) {
      const [name, alias] = part.split(':').map((s) => s.trim());
      if ((alias ?? name) === local) return name;
    }
  }
  return undefined;
}
