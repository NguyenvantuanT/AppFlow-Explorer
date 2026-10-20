import { descendants, documentElement, parseXml, type XmlElement } from '../../parsing/xml';

export interface ManifestActivity {
  /** Fully qualified class name. */
  className: string;
  simpleName: string;
  launcher: boolean;
  exported?: boolean;
  line: number;
}

export interface Manifest {
  packageName?: string;
  activities: ManifestActivity[];
}

export function resolveClassName(name: string, namespace?: string): string {
  if (name.startsWith('.')) return `${namespace ?? ''}${name}`;
  if (!name.includes('.') && namespace) return `${namespace}.${name}`;
  return name;
}

export const simpleName = (qualified: string) => qualified.slice(qualified.lastIndexOf('.') + 1);

export function parseManifest(text: string, namespace?: string): Manifest {
  const root = documentElement(parseXml(text));
  if (!root || root.name !== 'manifest') return { activities: [] };
  const pkg = root.attrs.package ?? namespace;
  const activities: ManifestActivity[] = [];
  for (const el of descendants(root)) {
    if (el.name !== 'activity' && el.name !== 'activity-alias') continue;
    const name = el.attrs['android:targetActivity'] ?? el.attrs['android:name'];
    if (!name) continue;
    const className = resolveClassName(name, pkg);
    const launcher = descendants(el).some((f) => f.name === 'category' && f.attrs['android:name'] === 'android.intent.category.LAUNCHER') &&
      descendants(el).some((f) => f.name === 'action' && f.attrs['android:name'] === 'android.intent.action.MAIN');
    activities.push({ className, simpleName: simpleName(className), launcher, exported: el.attrs['android:exported'] === undefined ? undefined : el.attrs['android:exported'] === 'true', line: el.line });
  }
  return { packageName: pkg, activities };
}

export interface NavDestination {
  /** Resource id without prefix, e.g. `taskList`. */
  id: string;
  type: 'fragment' | 'activity' | 'dialog' | 'navigation' | 'include' | string;
  className?: string;
  label?: string;
  /** For nested `<navigation>` destinations. */
  startDestination?: string;
  line: number;
}

export interface NavAction {
  id: string;
  /** Owning destination id; undefined for a global action. */
  from?: string;
  destination?: string;
  popUpTo?: string;
  popUpToInclusive: boolean;
  line: number;
}

export interface NavGraph {
  file: string;
  id?: string;
  startDestination?: string;
  destinations: NavDestination[];
  actions: NavAction[];
  /** Graphs included with `<include app:graph="@navigation/x">`. */
  includes: string[];
}

const stripId = (ref?: string) => ref?.replace(/^@\+?id\//, '');

/** Parses a Navigation component graph (`res/navigation/*.xml`), including nested `<navigation>` elements. */
export function parseNavGraph(text: string, file: string): NavGraph {
  const root = documentElement(parseXml(text));
  const graph: NavGraph = { file, destinations: [], actions: [], includes: [] };
  if (!root || root.name !== 'navigation') return graph;
  graph.id = stripId(root.attrs['android:id']);
  graph.startDestination = stripId(root.attrs['app:startDestination']);
  const visit = (el: XmlElement, owner?: string) => {
    for (const child of el.children) {
      if (child.name === 'action') {
        graph.actions.push({
          id: stripId(child.attrs['android:id']) ?? `action@${child.line}`,
          from: owner,
          destination: stripId(child.attrs['app:destination']),
          popUpTo: stripId(child.attrs['app:popUpTo']),
          popUpToInclusive: child.attrs['app:popUpToInclusive'] === 'true',
          line: child.line,
        });
        continue;
      }
      if (child.name === 'include') {
        const g = child.attrs['app:graph']?.replace(/^@navigation\//, '');
        if (g) graph.includes.push(g);
        continue;
      }
      if (['argument', 'deepLink', 'arguments'].includes(child.name)) continue;
      const id = stripId(child.attrs['android:id']);
      if (!id) continue;
      graph.destinations.push({
        id,
        type: child.name,
        className: child.attrs['android:name'],
        label: child.attrs['android:label'],
        startDestination: stripId(child.attrs['app:startDestination']),
        line: child.line,
      });
      // Nested graphs keep their own start destination; their children are destinations too.
      visit(child, child.name === 'navigation' ? undefined : id);
    }
  };
  visit(root);
  return graph;
}

export interface LayoutView {
  tag: string;
  id?: string;
  text?: string;
  line: number;
  attrs: Record<string, string>;
}

/** Parses a layout file into its views (with ids, literal text and line numbers). */
export function parseLayout(text: string): LayoutView[] {
  const root = parseXml(text);
  return descendants(root).map((el) => ({
    tag: el.name.slice(el.name.lastIndexOf('.') + 1),
    id: stripId(el.attrs['android:id']),
    text: el.attrs['android:text'] && !el.attrs['android:text'].startsWith('@') ? el.attrs['android:text'] : undefined,
    line: el.line,
    attrs: el.attrs,
  }));
}
