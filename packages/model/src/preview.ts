import type { SourceLocation } from './types';

/**
 * A screen drawn from its source code instead of a screenshot: the element
 * tree a React Native component renders, with styles worked out statically.
 * It approximates the real screen — data, state and animations are not run.
 */
export interface ScreenPreview {
  screenId: string;
  /** Which device chrome to draw (status bar); iOS when omitted. */
  platform?: 'ios' | 'android';
  /** Logical size of the drawn device, in points. */
  width: number;
  height: number;
  root: PreviewNode;
  /** Font files of the project for the `fontFamily` names the screen uses. */
  fonts?: Array<{ family: string; path: string }>;
  /** Things that could not be drawn faithfully (unknown components, budget reached). */
  notes: string[];
}

export type PreviewNodeType =
  /** A flexbox container (`View`, touchables, safe areas, unknown wrappers). */
  | 'view'
  /** A scroll container; `contentStyle` applies to its content. */
  | 'scroll'
  /** `Text`: children are `raw` runs and nested `text` nodes. */
  | 'text'
  /** A run of text inside a `text` node. */
  | 'raw'
  | 'input'
  | 'image'
  | 'icon'
  | 'spinner'
  | 'switch'
  /** A react-native-svg element (`Svg`, `Circle`, `Path`…), drawn as the same SVG element. */
  | 'svg'
  /** A third-party or unresolved component drawn as a labelled box. */
  | 'placeholder';

/** A style value after static evaluation: React Native style keys, numbers in points. */
export type PreviewStyle = Record<string, string | number | PreviewStyleValue[]>;
export type PreviewStyleValue = string | number | Record<string, string | number>;

export interface PreviewNode {
  type: PreviewNodeType;
  /** The JSX tag that produced the node, e.g. `TouchableOpacity`. */
  component?: string;
  style?: PreviewStyle;
  /** `scroll`: style of the content container. */
  contentStyle?: PreviewStyle;
  /** `scroll`: lays out horizontally. */
  horizontal?: boolean;
  /** `raw`: the text; `placeholder`: the label. */
  text?: string;
  /** `raw`: text that comes from data at runtime; `text` holds the expression. */
  dynamic?: boolean;
  /** `input`: current value and placeholder. */
  value?: string;
  placeholder?: string;
  secure?: boolean;
  /** `image`: a project file (`assetPath`) or a remote address that is not fetched. */
  image?: {
    assetPath?: string;
    uri?: string;
    resizeMode?: string;
    /** Pixels per point of the file (`@2x`, `drawable-xxhdpi` = 3): sizes an image that has no width or height. */
    density?: number;
  };
  /** `view` drawn as a gradient (`LinearGradient`). */
  gradient?: { colors: string[]; start?: { x: number; y: number }; end?: { x: number; y: number } };
  /** `icon`: a vector-icons glyph. */
  icon?: { set: string; name: string; glyph?: number; size: number; color?: string };
  /** `svg`: the SVG tag (`svg`, `circle`, `linearGradient`…) and its attributes, React-style (`strokeWidth`, `viewBox`). */
  svg?: { tag: string; attrs: Record<string, string | number> };
  /** `switch`: on or off. */
  checked?: boolean;
  /**
   * A container whose children are placed by constraints (Android
   * ConstraintLayout, RelativeLayout). The drawing measures the children and
   * solves the constraints, since sizes depend on the text as drawn.
   */
  layout?: 'constraints';
  /** `constraints` container sized by its content (`wrap_content` height); otherwise it fills the space it is given. */
  wrapHeight?: boolean;
  /** Placement of a child of a `constraints` container. */
  constraint?: PreviewConstraint;
  location?: SourceLocation;
  children?: PreviewNode[];
}

/** One edge of a child tied to an edge of the parent or of a sibling (by `id`). */
export interface PreviewAnchor {
  to: string;
  edge: 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY';
}

export interface PreviewConstraint {
  /** Sibling id other children refer to. */
  id?: string;
  left?: PreviewAnchor;
  right?: PreviewAnchor;
  top?: PreviewAnchor;
  bottom?: PreviewAnchor;
  /** Position between two anchors (0 = start, 1 = end); 0.5 by default. */
  hBias?: number;
  vBias?: number;
  /**
   * Size on each axis: points, `wrap` (content), `match` (fill between the
   * anchors, ConstraintLayout `0dp`) or `parent` (fill the parent, minus margins).
   */
  width: number | 'wrap' | 'match' | 'parent';
  height: number | 'wrap' | 'match' | 'parent';
  /** A Guideline: a line at a fraction or a distance from an edge; it draws nothing. */
  guide?: { orientation: 'horizontal' | 'vertical'; percent?: number; begin?: number; end?: number };
}
