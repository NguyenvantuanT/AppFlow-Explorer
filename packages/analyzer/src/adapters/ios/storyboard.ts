import { descendants, documentElement, parseXml, type XmlElement } from '../../parsing/xml';

export type ControllerKind = 'controller' | 'navigation' | 'tabBar' | 'split';

export interface SbController {
  /** Storyboard object id. */
  id: string;
  tag: string;
  kind: ControllerKind;
  customClass?: string;
  storyboardIdentifier?: string;
  title?: string;
  line: number;
  /** Views inside the scene: buttons, fields, tables… */
  views: Array<{ tag: string; label?: string; image?: string; line: number }>;
}

export interface SbSegue {
  id?: string;
  identifier?: string;
  kind: string;
  relationship?: string;
  from: string;
  destination: string;
  line: number;
  /** Visible label of the element that triggers the segue (button title, bar item, cell). */
  triggerLabel?: string;
  triggerTag?: string;
}

export interface Storyboard {
  file: string;
  initialViewController?: string;
  controllers: SbController[];
  segues: SbSegue[];
}

const CONTROLLER_TAGS: Record<string, ControllerKind> = {
  viewController: 'controller',
  tableViewController: 'controller',
  collectionViewController: 'controller',
  pageViewController: 'controller',
  hostingController: 'controller',
  glkViewController: 'controller',
  avPlayerViewController: 'controller',
  navigationController: 'navigation',
  tabBarController: 'tabBar',
  splitViewController: 'split',
};

const VIEW_TAGS = new Set(['button', 'textField', 'textView', 'tableView', 'collectionView', 'imageView', 'switch', 'segmentedControl', 'slider', 'stepper', 'datePicker', 'pickerView', 'searchBar', 'tabBar', 'barButtonItem', 'tableViewCell', 'collectionViewCell', 'webView', 'wkWebView', 'mapView']);

function labelOf(el: XmlElement): string | undefined {
  if (el.attrs.title) return el.attrs.title;
  if (el.attrs.placeholder) return el.attrs.placeholder;
  const state = el.children.find((c) => c.name === 'state' && c.attrs.title);
  if (state) return state.attrs.title;
  return el.attrs.userLabel ?? el.attrs.reuseIdentifier;
}

/** Parses an Interface Builder storyboard: scenes, their custom classes, views and segues. */
export function parseStoryboard(text: string, file: string): Storyboard {
  const doc = documentElement(parseXml(text));
  const sb: Storyboard = { file, controllers: [], segues: [] };
  if (!doc || doc.name !== 'document') return sb;
  sb.initialViewController = doc.attrs.initialViewController;
  for (const el of descendants(doc)) {
    const kind = CONTROLLER_TAGS[el.name];
    if (!kind || !el.attrs.id) continue;
    const controller: SbController = {
      id: el.attrs.id,
      tag: el.name,
      kind,
      customClass: el.attrs.customClass,
      storyboardIdentifier: el.attrs.storyboardIdentifier,
      title: el.attrs.title ?? el.children.find((c) => c.name === 'navigationItem')?.attrs.title ?? el.attrs.userLabel,
      line: el.line,
      views: [],
    };
    for (const v of descendants(el)) {
      if (VIEW_TAGS.has(v.name)) controller.views.push({ tag: v.name, label: labelOf(v), image: v.attrs.image, line: v.line });
      if (v.name === 'imageView' && v.attrs.image) controller.views.push({ tag: 'imageView', image: v.attrs.image, line: v.line });
      if (v.name !== 'segue' || !v.attrs.destination) continue;
      // The trigger is the nearest element above the segue's <connections>.
      const owner = v.parent?.name === 'connections' ? v.parent.parent : undefined;
      const triggerIsController = !owner || owner === el;
      sb.segues.push({
        id: v.attrs.id,
        identifier: v.attrs.identifier,
        kind: v.attrs.kind ?? 'show',
        relationship: v.attrs.relationship,
        from: controller.id,
        destination: v.attrs.destination,
        line: v.line,
        triggerLabel: triggerIsController ? undefined : labelOf(owner!),
        triggerTag: triggerIsController ? undefined : owner!.name,
      });
    }
    sb.controllers.push(controller);
  }
  return sb;
}

/** Reads `UIMainStoryboardFile` (and the scene manifest's storyboard) from an Info.plist. */
export function mainStoryboardName(plist: string): string | undefined {
  const doc = parseXml(plist);
  const keys = descendants(doc);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    if (k.name === 'key' && /^(UIMainStoryboardFile|UISceneStoryboardFile)$/.test(k.text ?? '')) {
      const next = keys[i + 1];
      if (next?.name === 'string' && next.text) return next.text;
    }
  }
  return undefined;
}
