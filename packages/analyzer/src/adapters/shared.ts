import type { AssetKind, Confidence, Evidence, NavigationTrigger, WidgetKind } from '@appflow/model';
import { loc } from '../core/codeIndex';
import type { CallFact, HandlerContext } from '../parsing/facts';

/** Builds the canvas label and description of what triggers a navigation. */
export function triggerFor(file: string, at: { line: number; column?: number }, handler: HandlerContext | undefined, fallback: string): NavigationTrigger {
  const location = loc(file, at.line, at.column);
  if (!handler) return { label: fallback, description: fallback, location };
  const visible = handler.ownerLabel ? `“${handler.ownerLabel}”` : undefined;
  const label = visible ? `Tap ${visible}` : handler.owner && !handler.name.startsWith('@') ? `${handler.name} · ${handler.owner}` : handler.name;
  const description = [handler.name, handler.owner, visible].filter(Boolean).join(' · ');
  return { label: truncate(label, 40), description, widget: handler.owner, handler: handler.name, location };
}

export function staticEvidence(file: string, call: { line: number; column?: number }, detail: string, confidence: Confidence): Evidence {
  return { source: 'static', detail: truncate(detail, 160), location: loc(file, call.line, call.column), confidence };
}

export function declaredEvidence(file: string, line: number, detail: string, confidence: Confidence = 'high'): Evidence {
  return { source: 'declared', detail: truncate(detail, 160), location: loc(file, line), confidence };
}

export function callText(call: CallFact): string {
  return `${call.callee}(${call.args.map((a) => (a.label ? `${a.label}: ${a.text}` : a.text)).join(', ')})`;
}

export function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const KIND_PATTERNS: Array<[RegExp, WidgetKind]> = [
  [/(Button|GestureDetector|InkWell|Clickable|NavigationLink|Link|Touchable\w*|Pressable)$/, 'button'],
  [/(TextField|TextFormField|EditText|TextInput|SecureField|Checkbox|Switch|Toggle|Slider|Picker|Dropdown\w*|Radio\w*|Stepper|DatePicker)$/, 'input'],
  [/(ListView|GridView|RecyclerView|LazyColumn|LazyRow|LazyVerticalGrid|List|ForEach|FlatList|SectionList|ScrollView|TableView|CollectionView|PageView|CustomScrollView)$/, 'list'],
  [/(BottomNavigationBar|NavigationBar|TabBar|TabView|TabLayout|BottomNavigationView|Drawer|NavigationRail|TabBarView)$/, 'tab'],
  [/(Image|AsyncImage|ImageView|Icon|SvgPicture|CircleAvatar|FastImage)$/, 'image'],
  [/(AppBar|TopAppBar|Toolbar|NavigationStack|NavigationView|NavigationSplitView|SliverAppBar|CupertinoNavigationBar)$/, 'navigation'],
];

export function widgetKindOf(name: string): WidgetKind | null {
  const base = name.split('.').pop() ?? name;
  for (const [re, kind] of KIND_PATTERNS) if (re.test(base)) return kind;
  return null;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|heic)$/i;
const FONT_EXT = /\.(ttf|otf|woff2?)$/i;
const DATA_EXT = /\.(json|lottie|csv|txt|xml)$/i;

export function assetKindOf(path: string): AssetKind {
  if (IMAGE_EXT.test(path)) return 'image';
  if (FONT_EXT.test(path)) return 'font';
  if (DATA_EXT.test(path)) return 'data';
  return 'other';
}

/**
 * A lookup table without a prototype, so a call named `toString` or
 * `constructor` is never mistaken for an entry.
 */
export function lookup<T>(entries: Record<string, T>): Record<string, T> {
  return Object.assign(Object.create(null) as Record<string, T>, entries);
}
