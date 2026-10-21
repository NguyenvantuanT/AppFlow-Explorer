import type { PreviewNode, PreviewStyle, PreviewStyleValue, ScreenPreview } from '@appflow/model';
import type { Node } from '../parsing/ast';
import { Asset, Builtin, Closure, ClassComponent, Host, Interpreter, isObj, Rendered, Unknown, type ElementRenderer, type Obj, type Val } from './interpreter';
import { ModuleGraph, type ModuleInfo, type PreviewSource } from './modules';

/** The drawn device: an iPhone-sized portrait screen, in points. */
export const PREVIEW_WIDTH = 375;
export const PREVIEW_HEIGHT = 812;
const INSETS = { top: 47, bottom: 34, left: 0, right: 0 };
/** react-native-size-matters guideline size. */
const BASE_WIDTH = 350;
const BASE_HEIGHT = 680;
/** Rows drawn for a list whose data is only known at runtime. */
const SAMPLE_ROWS = 3;

const scale = (x: number) => (PREVIEW_WIDTH / BASE_WIDTH) * x;
const vscale = (x: number) => (PREVIEW_HEIGHT / BASE_HEIGHT) * x;
const mscale = (x: number, f = 0.5) => x + (scale(x) - x) * f;
const mvscale = (x: number, f = 0.5) => x + (vscale(x) - x) * f;

const VIEW = new Set(['View', 'SafeAreaView', 'KeyboardAvoidingView', 'Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TouchableNativeFeedback', 'RectButton', 'BorderlessButton', 'BaseButton', 'GestureHandlerRootView', 'BlurView', 'Animated', 'AnimatedView', 'SafeAreaProvider', 'Surface', 'Card', 'Shadow', 'DropShadow']);
const SCROLL = new Set(['ScrollView', 'KeyboardAwareScrollView', 'KeyboardAvoidingScrollView', 'NestedScrollView']);
const LIST = new Set(['FlatList', 'FlashList', 'SectionList', 'VirtualizedList', 'KeyboardAwareFlatList', 'BottomSheetFlatList']);
const TEXT = new Set(['Text', 'NativeText', 'AnimatedText']);
const INPUT = new Set(['TextInput', 'BottomSheetTextInput']);
const IMAGE = new Set(['Image', 'FastImage', 'ImageBackground', 'AnimatedImage', 'CachedImage']);
/** Rendered by React Native but with nothing to draw. */
const INVISIBLE = new Set(['StatusBar', 'RefreshControl', 'AndroidRefreshControl', 'Toast', 'Portal', 'Modal', 'BottomSheetModal', 'Spinner']);
/** react-native-svg components → SVG tags. */
const SVG_TAGS: Record<string, string> = {
  Svg: 'svg',
  default: 'svg',
  G: 'g',
  Path: 'path',
  Circle: 'circle',
  Ellipse: 'ellipse',
  Rect: 'rect',
  Line: 'line',
  Polyline: 'polyline',
  Polygon: 'polygon',
  Text: 'text',
  TSpan: 'tspan',
  Defs: 'defs',
  LinearGradient: 'linearGradient',
  RadialGradient: 'radialGradient',
  Stop: 'stop',
  ClipPath: 'clipPath',
  Mask: 'mask',
  Use: 'use',
  Symbol: 'symbol',
  Pattern: 'pattern',
};
/** @rneui / react-native-elements `Icon type` → vector-icons set. */
const RNEUI_ICON_TYPES: Record<string, string> = {
  material: 'MaterialIcons',
  'material-community': 'MaterialCommunityIcons',
  'font-awesome': 'FontAwesome',
  'font-awesome-5': 'FontAwesome5',
  ionicon: 'Ionicons',
  octicon: 'Octicons',
  feather: 'Feather',
  entypo: 'Entypo',
  antdesign: 'AntDesign',
  'simple-line-icon': 'SimpleLineIcons',
  evilicon: 'EvilIcons',
  foundation: 'Foundation',
  zocial: 'Zocial',
};
/** Wrappers that only pass their children through. */
const PASS_THROUGH = new Set(['TouchableWithoutFeedback', 'NavigationContainer', 'Provider', 'ThemeProvider', 'PortalProvider', 'BottomSheetModalProvider', 'KeyboardProvider', 'DismissKeyboard', 'ErrorBoundary', 'Suspense', 'StrictMode']);
const ICON_MODULE = /^(react-native-vector-icons|@expo\/vector-icons|@react-native-vector-icons)(\/(\w+))?/;

export interface RnPreviewRequest {
  screenId: string;
  /** Project-relative file that defines the screen component. */
  file: string;
  /** Component name (`widgetClass`). */
  component: string;
}

/**
 * Draws React Native screens from their source. One instance per project
 * keeps the parsed modules for every screen; `dispose` frees them.
 */
export class ReactNativePreviewer {
  private constructor(
    private readonly graph: ModuleGraph,
    private readonly source: PreviewSource,
  ) {}

  static async open(source: PreviewSource, appRoot: string): Promise<ReactNativePreviewer> {
    return new ReactNativePreviewer(await ModuleGraph.open(source, appRoot), source);
  }

  dispose(): void {
    this.graph.dispose();
  }

  /** Previews run one at a time: they share the module graph that loading fills in. */
  private queue: Promise<unknown> = Promise.resolve();

  preview(req: RnPreviewRequest): Promise<ScreenPreview> {
    const run = this.queue.then(() => this.draw(req));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async draw(req: RnPreviewRequest): Promise<ScreenPreview> {
    await this.graph.load(req.file);
    const mod = this.graph.module(req.file);
    const notes = new Set<string>();
    let children: PreviewNode[] = [];
    if (!mod) {
      notes.add(`${req.file} could not be read.`);
    } else {
      const interp = new Interpreter(this.graph, renderer);
      const component = mod.locals.has(req.component) ? interp.moduleLocal(mod, req.component) : interp.exportOf(mod, 'default');
      if (!(component instanceof Closure || component instanceof ClassComponent)) {
        notes.add(`${req.component} is not a function component this preview can draw.`);
      } else {
        const route = { params: new Unknown('route.params'), name: req.component };
        children = interp.guard(() => interp.element(component, { navigation: new Unknown('navigation'), route }, [], req.component, rootNode(mod), mod), []);
      }
      for (const n of interp.notes) notes.add(n);
    }
    const root: PreviewNode = { type: 'view', component: req.component, style: { flex: 1, backgroundColor: '#F2F2F2' }, children };
    await this.resolveIcons(root, notes);
    const fonts = await this.fonts(root);
    return { screenId: req.screenId, width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, root, notes: [...notes], ...(fonts.length ? { fonts } : {}) };
  }

  private fontDirs?: Promise<string[]>;

  /** Font files for the families the tree uses, from the asset folders react-native.config.js links (or the usual ones). */
  private async fonts(root: PreviewNode): Promise<Array<{ family: string; path: string }>> {
    const families = new Set<string>();
    const visit = (n: PreviewNode) => {
      if (typeof n.style?.fontFamily === 'string') families.add(n.style.fontFamily);
      n.children?.forEach(visit);
    };
    visit(root);
    if (!families.size) return [];
    this.fontDirs ??= fontDirectories(this.source, this.graph.appRoot);
    const dirs = await this.fontDirs;
    const out: Array<{ family: string; path: string }> = [];
    for (const family of families) {
      if (!/^[\w .-]+$/.test(family)) continue;
      for (const dir of dirs) {
        const file = ['.ttf', '.otf'].map((e) => `${dir}/${family}${e}`);
        const found = (await this.source.exists(file[0]!)) ? file[0] : (await this.source.exists(file[1]!)) ? file[1] : undefined;
        if (found) {
          out.push({ family, path: found });
          break;
        }
      }
    }
    return out;
  }

  /** Looks up vector-icons glyph code points in the installed package's glyph maps. */
  private async resolveIcons(root: PreviewNode, notes: Set<string>): Promise<void> {
    const maps = new Map<string, Record<string, number> | null>();
    const visit = async (n: PreviewNode) => {
      if (n.icon) {
        if (!maps.has(n.icon.set)) maps.set(n.icon.set, await glyphMap(this.source, this.graph.appRoot, n.icon.set));
        const code = maps.get(n.icon.set)?.[n.icon.name];
        if (code !== undefined) n.icon.glyph = code;
        else notes.add(`Icon ${n.icon.set}/${n.icon.name} was not found in node_modules.`);
      }
      for (const c of n.children ?? []) await visit(c);
    };
    await visit(root);
  }
}

async function fontDirectories(source: PreviewSource, appRoot: string): Promise<string[]> {
  const join = (p: string) => [appRoot, p.replace(/^\.\//, '').replace(/\/$/, '')].filter(Boolean).join('/');
  const dirs: string[] = [];
  const config = (await source.readText(join('react-native.config.js'))) ?? '';
  const assets = /assets\s*:\s*\[([^\]]*)\]/.exec(config)?.[1] ?? '';
  for (const m of assets.matchAll(/['"]([^'"]+)['"]/g)) dirs.push(join(m[1]!));
  dirs.push(...['assets/fonts', 'src/assets/fonts', 'app/assets/fonts', 'android/app/src/main/assets/fonts'].map(join));
  return [...new Set(dirs)];
}

/** Location of the vector-icons font and glyph map for an icon set. */
export function iconFontPaths(appRoot: string, set: string): { font: string; glyphs: string } {
  const base = [appRoot, 'node_modules/react-native-vector-icons'].filter(Boolean).join('/');
  return { font: `${base}/Fonts/${set}.ttf`, glyphs: `${base}/glyphmaps/${set}.json` };
}

async function glyphMap(source: PreviewSource, appRoot: string, set: string): Promise<Record<string, number> | null> {
  const text = await source.readText(iconFontPaths(appRoot, set).glyphs);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function rootNode(mod: ModuleInfo): Node {
  // Any node of the module will do for the location of the screen's root.
  const first = [...mod.locals.values()].find((d) => d.kind !== 'import');
  return (first && 'node' in first ? first.node : undefined) as Node;
}

// ---- Library components and functions ------------------------------------------------------------------

const renderer: ElementRenderer = {
  location: (mod, at) => (at ? { fileId: mod.file, line: at.startPosition.row + 1, column: at.startPosition.column + 1 } : undefined),

  hostMember(host, key) {
    const m = host.module;
    const path = [...host.path, key].join('.');
    if (m === 'react-native') {
      switch (path) {
        case 'StyleSheet.hairlineWidth':
          return 0.5;
        case 'StyleSheet.absoluteFillObject':
        case 'StyleSheet.absoluteFill':
          return { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 };
        case 'Platform.OS':
          return 'ios';
        case 'Platform.Version':
          return 17;
        case 'Platform.isPad':
          return false;
      }
    }
    return undefined;
  },

  hostCall(interp, host, args) {
    const name = host.name;
    const m = host.module;
    const a0 = args[0];
    if (m === 'react-native') {
      switch (host.path.join('.')) {
        case 'StyleSheet.create':
          return a0;
        case 'StyleSheet.flatten':
          return flattenStyle(a0) as Obj;
        case 'StyleSheet.compose':
          return [a0, args[1]];
        case 'Dimensions.get':
        case 'useWindowDimensions':
          return { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, scale: 3, fontScale: 1 };
        case 'Platform.select':
          return isObj(a0) ? (a0.ios ?? a0.native ?? a0.default) : undefined;
        case 'PixelRatio.get':
          return 3;
        case 'PixelRatio.roundToNearestPixel':
          return a0;
        case 'useColorScheme':
          return 'light';
        case 'Animated.Value':
          return new Unknown('Animated.Value');
        case 'requireNativeComponent':
          return new Host('?', [typeof a0 === 'string' ? a0 : 'NativeComponent']);
      }
    }
    if (m === 'react-native-size-matters' || m === 'react-native-size-matters/extend') {
      const n = typeof a0 === 'number' ? a0 : undefined;
      const f = typeof args[1] === 'number' ? args[1] : undefined;
      if (host.path.join('.') === 'ScaledSheet.create') return scaledSheet(a0);
      if (n === undefined) return new Unknown(name);
      switch (name) {
        case 's':
        case 'scale':
          return scale(n);
        case 'vs':
        case 'verticalScale':
          return vscale(n);
        case 'ms':
        case 'moderateScale':
          return mscale(n, f);
        case 'mvs':
        case 'moderateVerticalScale':
          return mvscale(n, f);
      }
    }
    if (m === 'react-native-responsive-screen' || m === 'react-native-responsive-dimensions') {
      const pct = typeof a0 === 'number' ? a0 : typeof a0 === 'string' ? parseFloat(a0) : NaN;
      if (Number.isNaN(pct)) return new Unknown(name);
      return /^(wp|widthPercentageToDP|responsiveWidth)$/.test(name) ? (PREVIEW_WIDTH * pct) / 100 : (PREVIEW_HEIGHT * pct) / 100;
    }
    if (m === 'react-native-safe-area-context' && name === 'useSafeAreaInsets') return { ...INSETS };
    if (m === 'react-native-safe-area-context' && name === 'useSafeAreaFrame') return { x: 0, y: 0, width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT };
    if (m === 'react' || m === 'react-native-reanimated') {
      switch (name) {
        case 'memo':
        case 'forwardRef':
        case 'observer':
          return a0;
        case 'useState':
          return [a0 instanceof Closure ? interp.call(a0, []) : a0, new Builtin(() => undefined)];
        case 'useReducer':
          return [args[1], new Builtin(() => undefined)];
        case 'useRef':
        case 'createRef':
          return { current: a0 };
        case 'useMemo':
          return a0 instanceof Closure ? interp.call(a0, []) : new Unknown('useMemo');
        case 'useCallback':
          return a0;
        case 'useEffect':
        case 'useLayoutEffect':
        case 'useImperativeHandle':
        case 'useFocusEffect':
          return undefined;
        case 'useSharedValue':
          return { value: a0 };
        case 'useAnimatedStyle':
          return a0 instanceof Closure ? interp.call(a0, []) : {};
        case 'createElement':
          return new Rendered(interp.element(a0, isObj(args[1]) ? args[1] : {}, args.slice(2), 'createElement'));
      }
    }
    if (m === 'mobx-react' || m === 'mobx-react-lite') return name === 'observer' ? a0 : new Unknown(name);
    if (m === '@react-navigation/native' && name === 'useIsFocused') return true;
    if (/^(react-redux)$/.test(m) && name === 'connect') return new Builtin(([c]) => c);
    return new Unknown(`${name}()`);
  },

  host(interp, host, props, children, at, mod, tagText) {
    const name = hostName(host, tagText);
    const location = at && mod ? renderer.location(mod, at) : undefined;
    const iconSet = iconSetOf(host);
    interp.nodeCount++;
    const style = flattenStyle(props.style);
    const kids = () => interp.flatten(children);

    if (host.module === 'react-native-svg' && SVG_TAGS[name]) {
      const attrs: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(props)) {
        if (k === 'children' || k === 'style' || /^on[A-Z]/.test(k)) continue;
        if (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) attrs[k] = v;
      }
      // Svg sizes like a View; the drawing inside keeps SVG semantics.
      const inner = interp.flatten(children).filter((c) => c.type === 'svg' || ((name === 'Text' || name === 'TSpan') && c.type === 'raw'));
      return [{ type: 'svg', component: name, style, svg: { tag: SVG_TAGS[name]!, attrs }, children: inner, location }];
    }
    // react-hook-form's Controller draws what its render prop returns.
    if (name === 'Controller' && props.render instanceof Closure) {
      const field = { value: new Unknown('field.value'), onChange: new Builtin(() => undefined), onBlur: new Builtin(() => undefined), name: props.name };
      return interp.toNodes(interp.call(props.render, [{ field, fieldState: {}, formState: {} }]));
    }
    // Overlays (image viewers, pickers, sheets) are shown only when they are known to be visible.
    if ((('visible' in props && props.visible !== true) || ('isVisible' in props && props.isVisible !== true)) && host.module !== 'react-native') return [];
    if (/^(@rneui|react-native-elements)/.test(host.module) && name === 'Icon') {
      const size = typeof props.size === 'number' ? props.size : 24;
      const set = RNEUI_ICON_TYPES[typeof props.type === 'string' ? props.type : 'material'] ?? 'MaterialIcons';
      return typeof props.name === 'string' ? [{ type: 'icon', component: name, style, icon: { set, name: props.name, size, color: typeof props.color === 'string' ? props.color : undefined }, location }] : [];
    }
    // React Native's Button: a tinted label (iOS style).
    if (name === 'Button' && host.module === 'react-native') {
      const color = typeof props.color === 'string' ? props.color : '#007AFF';
      return [{ type: 'view', component: name, style: { alignItems: 'center', padding: 8 }, location, children: [{ type: 'text', component: 'Text', style: { color, fontSize: 18 }, children: textChildren([props.title]) }] }];
    }
    if (name === 'ToggleSwitch') return [{ type: 'switch', component: name, style, checked: props.isOn === true, location }];
    if (iconSet) {
      const size = typeof props.size === 'number' ? props.size : 12;
      const color = typeof props.color === 'string' ? props.color : undefined;
      return typeof props.name === 'string' ? [{ type: 'icon', component: name, style, icon: { set: iconSet, name: props.name, size, color }, location }] : [{ type: 'placeholder', component: name, text: 'icon', style: { width: size, height: size, ...style }, location }];
    }
    if (INVISIBLE.has(name)) {
      // Modals draw only when they are known to be visible.
      if ((name === 'Modal' || name === 'BottomSheetModal') && props.visible === true) return [{ type: 'view', component: name, style: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 10, ...style }, children: kids(), location }];
      return [];
    }
    if (PASS_THROUGH.has(name)) return kids();
    if (name === 'Pressable' && children.length === 1 && children[0] instanceof Closure) {
      return [{ type: 'view', component: name, style: flattenStyle(props.style instanceof Closure ? interp.call(props.style, [{ pressed: false }]) : props.style), children: interp.toNodes(interp.call(children[0], [{ pressed: false }])), location }];
    }
    if (TEXT.has(name) || (host.module === 'react-native-reanimated' && name === 'Text')) {
      const text: PreviewNode = { type: 'text', component: name, style, children: textChildren(children), location };
      if (typeof props.numberOfLines === 'number') text.style = { ...style, numberOfLines: props.numberOfLines };
      return [text];
    }
    if (INPUT.has(name)) {
      return [{
        type: 'input',
        component: name,
        style: { ...style, ...(typeof props.placeholderTextColor === 'string' ? { placeholderColor: props.placeholderTextColor } : {}) },
        value: typeof props.value === 'string' ? props.value : typeof props.defaultValue === 'string' ? props.defaultValue : undefined,
        placeholder: typeof props.placeholder === 'string' ? props.placeholder : undefined,
        secure: props.secureTextEntry === true,
        location,
      }];
    }
    if (IMAGE.has(name)) {
      const node: PreviewNode = { type: 'image', component: name, style, image: { ...imageSource(props.source), resizeMode: typeof props.resizeMode === 'string' ? props.resizeMode : undefined }, location };
      if (name === 'ImageBackground') node.children = kids();
      return [node];
    }
    if (SCROLL.has(name)) {
      return [{ type: 'scroll', component: name, style, contentStyle: flattenStyle(props.contentContainerStyle), horizontal: props.horizontal === true, children: kids(), location }];
    }
    if (LIST.has(name)) return [list(interp, name, props, style, location)];
    if (name === 'ActivityIndicator') return [{ type: 'spinner', component: name, style: { ...style, ...(typeof props.color === 'string' ? { color: props.color } : {}), ...(props.size === 'large' ? { width: 36, height: 36 } : {}) }, location }];
    if (name === 'Switch') return [{ type: 'switch', component: name, style, checked: props.value === true, location }];
    if (name === 'LinearGradient') {
      const colors = Array.isArray(props.colors) ? props.colors.filter((c): c is string => typeof c === 'string') : [];
      const point = (p: Val) => (isObj(p) && typeof p.x === 'number' && typeof p.y === 'number' ? { x: p.x, y: p.y } : undefined);
      return [{ type: 'view', component: name, style, gradient: { colors, start: point(props.start), end: point(props.end) }, children: kids(), location }];
    }
    if (name === 'SafeAreaView') {
      const edges = Array.isArray(props.edges) ? props.edges : ['top', 'bottom'];
      return [{ type: 'view', component: name, style: { ...(edges.includes('top') ? { paddingTop: INSETS.top } : {}), ...(edges.includes('bottom') ? { paddingBottom: INSETS.bottom } : {}), ...style }, children: kids(), location }];
    }
    if (VIEW.has(name) || host.module === 'react-native' || /^(Animated)$/.test(host.path[0] ?? '')) {
      return [{ type: 'view', component: name, style, children: kids(), location }];
    }
    if (/^(Svg|Lottie|LottieView|Video|WebView|MapView|Camera|QRCode)/.test(name) || host.module === 'react-native-svg') {
      const w = typeof props.width === 'number' ? props.width : (style.width as number | undefined);
      const h = typeof props.height === 'number' ? props.height : (style.height as number | undefined);
      return [{ type: 'placeholder', component: name, text: name, style: { ...style, ...(w ? { width: w } : {}), ...(h ? { height: h } : {}) }, location }];
    }
    // Any other component: keep its layout and children; label it when it has nothing to show.
    const inner = kids();
    if (inner.length) return [{ type: 'view', component: name, style, children: inner, location }];
    interp.notes.add(`${name} (${host.module === '?' ? 'unresolved' : host.module}) is drawn as a box.`);
    return [{ type: 'placeholder', component: name, text: name, style, location }];
  },
};

/** The component a library value stands for: `Animated.View` → View, `require('…/ViewNativeComponent').default` → View, a default import → its local name. */
function hostName(host: Host, tagText?: string): string {
  const path = host.path.filter((p) => p !== 'default');
  if (path.length) return path[path.length - 1]!;
  if (host.module.includes('/') && !ICON_MODULE.test(host.module) && !host.module.startsWith('@')) return host.module.split('/').pop()!.replace(/NativeComponent$/, '');
  return tagText?.split('.').pop() ?? host.module;
}

function iconSetOf(host: Host): string | undefined {
  const m = ICON_MODULE.exec(host.module);
  if (!m) return undefined;
  // import Icon from 'react-native-vector-icons/Ionicons' / import { Ionicons } from '@expo/vector-icons'
  return m[3] ?? host.path[0];
}

/** Children of a Text: strings become runs, nested Texts stay nodes, unknown data is shown as its expression. */
function textChildren(children: Val[]): PreviewNode[] {
  const out: PreviewNode[] = [];
  const add = (v: Val) => {
    if (Array.isArray(v)) return v.forEach(add);
    if (typeof v === 'string' || typeof v === 'number') out.push({ type: 'raw', text: String(v) });
    else if (v instanceof Unknown) {
      for (const p of v.parts ?? [{ expr: v.text ?? '…' }]) out.push(typeof p === 'string' ? { type: 'raw', text: p } : { type: 'raw', text: p.expr, dynamic: true });
    }
    else if (v instanceof Rendered) out.push(...v.nodes);
  };
  children.forEach(add);
  return out;
}

function list(interp: Interpreter, name: string, props: Obj, style: PreviewStyle, location: PreviewNode['location']): PreviewNode {
  const data = props.data ?? props.sections;
  const items: Val[] = Array.isArray(data) && data.length ? data.slice(0, 8) : Array.from({ length: SAMPLE_ROWS }, (_, i) => new Unknown(`item${i ? ` ${i + 1}` : ''}`));
  const renderItem = props.renderItem;
  const children: PreviewNode[] = [];
  const asElement = (v: Val): PreviewNode[] => (v instanceof Closure || v instanceof ClassComponent || v instanceof Host ? interp.element(v, {}, [], 'ListComponent') : interp.toNodes(v));
  children.push(...asElement(props.ListHeaderComponent));
  const columns = typeof props.numColumns === 'number' && props.numColumns > 1 ? props.numColumns : 1;
  items.forEach((item, index) => {
    if (index > 0 && props.ItemSeparatorComponent) children.push(...asElement(props.ItemSeparatorComponent));
    const row = renderItem ? interp.toNodes(interp.call(renderItem, [{ item, index, separators: new Unknown('separators') }])) : [];
    if (columns > 1) children.push({ type: 'view', component: 'Cell', style: { width: `${100 / columns}%` }, children: row });
    else children.push(...row);
  });
  children.push(...asElement(props.ListFooterComponent));
  const contentStyle = flattenStyle(props.contentContainerStyle);
  if (columns > 1) Object.assign(contentStyle, { flexDirection: 'row', flexWrap: 'wrap' });
  return { type: 'scroll', component: name, style, contentStyle, horizontal: props.horizontal === true, children, location };
}

function imageSource(source: Val): { assetPath?: string; uri?: string; density?: number } {
  // React Native picks `@2x` / `@3x` files; their pixel size divided by the scale is the image's size.
  if (source instanceof Asset) return { assetPath: source.path, density: Number(/@(\d)x\.\w+$/.exec(source.path)?.[1] ?? 1) };
  if (Array.isArray(source)) return imageSource(source[0]);
  if (isObj(source)) {
    if (typeof source.uri === 'string') return source.uri.startsWith('data:') || /^https?:/.test(source.uri) ? { uri: source.uri } : { uri: source.uri };
    if (source.uri instanceof Asset) return { assetPath: source.uri.path };
  }
  return {};
}

/** A `style` prop (object, array, nested arrays, falsy entries) merged into one object of known values. */
export function flattenStyle(v: Val): PreviewStyle {
  const out: PreviewStyle = {};
  const visit = (x: Val) => {
    if (Array.isArray(x)) return x.forEach(visit);
    if (!isObj(x)) return;
    for (const [k, value] of Object.entries(x)) {
      if (typeof value === 'number' && Number.isFinite(value)) out[k] = value;
      else if (typeof value === 'string') out[k] = value;
      else if (value === undefined || value === null) delete out[k];
      else if (k === 'transform' && Array.isArray(value)) out[k] = value.filter(isObj).map((t) => plain(t)) as PreviewStyleValue[];
      else if (k === 'shadowOffset' && isObj(value)) out[k] = [plain(value)];
    }
  };
  visit(v);
  return out;
}

function plain(o: Obj): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(o)) if (typeof v === 'number' || typeof v === 'string') out[k] = v;
  return out;
}

/** `ScaledSheet.create`: '10@s', '12@vs', '14@ms0.3' become numbers. */
function scaledSheet(v: Val): Val {
  const convert = (x: Val): Val => {
    if (typeof x === 'string') {
      const m = /^(-?\d*\.?\d+)@(mv|m|v)?s(\d*\.?\d+)?(r?)$/.exec(x.trim());
      if (!m) return x;
      const n = parseFloat(m[1]!);
      const f = m[3] ? parseFloat(m[3]) : undefined;
      const r = m[2] === 'mv' ? mvscale(n, f) : m[2] === 'm' ? mscale(n, f) : m[2] === 'v' ? vscale(n) : scale(n);
      return m[4] ? Math.round(r) : r;
    }
    if (Array.isArray(x)) return x.map(convert);
    if (isObj(x)) return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, convert(y)]));
    return x;
  };
  return convert(v);
}

