/**
 * Normalized internal data model for an analyzed mobile application.
 *
 * Every producer (the Phase 1 mock fixture, the static analysis adapters and,
 * later, the runtime explorer) emits this shape; the UI only ever consumes it.
 */

/** Platforms with an analysis adapter. */
export type PlatformId = 'flutter' | 'android' | 'ios' | 'react-native';

/** @deprecated Use `PlatformId`; kept for the Phase 1 fixture. */
export type FrameworkId = PlatformId;

/** 1-based line/column position inside a project source file. */
export interface SourceLocation {
  /** Project-relative path using forward slashes. */
  fileId: string;
  line: number;
  column?: number;
  endLine?: number;
}

export type SourceLanguage =
  | 'dart'
  | 'kotlin'
  | 'java'
  | 'swift'
  | 'objc'
  | 'typescript'
  | 'javascript'
  | 'xml'
  | 'yaml'
  | 'json'
  | 'gradle'
  | 'plist'
  | 'markdown'
  | 'image'
  | 'text';

export type SourceFileKind = 'source' | 'config' | 'resource' | 'asset' | 'test' | 'other';

export interface SourceFile {
  /** Stable id; the project-relative path. */
  id: string;
  /** Project-relative path using forward slashes, e.g. `lib/main.dart`. */
  path: string;
  language: SourceLanguage;
  kind?: SourceFileKind;
  moduleId?: string;
  sizeBytes?: number;
  /**
   * Inline content. Analysis results omit it: the UI fetches a single file on
   * demand from the local agent instead of receiving the whole codebase.
   */
  content?: string;
}

/**
 * How much an observation can be trusted.
 * - `high`: explicit configuration or an unambiguous call.
 * - `medium`: a common pattern with a resolved target.
 * - `low`: a naming or structural heuristic.
 */
export type Confidence = 'high' | 'medium' | 'low';

export type EvidenceSource = 'runtime' | 'declared' | 'static' | 'manual';

/** A single observation supporting an entity or relationship. */
export interface Evidence {
  /**
   * - `runtime`: observed in the running app.
   * - `declared`: explicit configuration (route table, navigation graph, storyboard segue).
   * - `static`: inferred from source code.
   * - `manual`: asserted by the user as a graph correction.
   */
  source: EvidenceSource;
  detail: string;
  location?: SourceLocation;
  observedAt?: string;
  confidence?: Confidence;
  /** Adapter that produced the observation. */
  adapter?: string;
}

export type ModuleKind = 'app' | 'library' | 'feature' | 'package' | 'host';

export interface Dependency {
  name: string;
  version?: string;
}

export interface Module {
  id: string;
  name: string;
  /** Project-relative directory ('' for the project root). */
  path: string;
  platform: PlatformId;
  kind: ModuleKind;
  dependencies: Dependency[];
  /** Notable native exports, e.g. React Native native modules. */
  exports?: Array<{ name: string; kind: 'native-module'; location?: SourceLocation }>;
}

export type WidgetKind =
  | 'button'
  | 'input'
  | 'list'
  | 'tab'
  | 'image'
  | 'container'
  | 'navigation'
  | 'custom'
  | 'other';

/** A UI component, widget or view used by a screen. */
export interface WidgetRef {
  name: string;
  kind: WidgetKind;
  location?: SourceLocation;
  /** Event handlers attached to this component, e.g. `onPressed`. */
  handlers?: string[];
  /** Ids of assets the component references. */
  assetIds?: string[];
}

/** Alias matching the Phase 2 vocabulary. */
export type Component = WidgetRef;

export type ScreenKind = 'page' | 'dialog' | 'bottomSheet';

/** What a screen is in its own platform's terms. */
export type ScreenPlatformKind =
  | 'widget'
  | 'activity'
  | 'fragment'
  | 'composable'
  | 'view-controller'
  | 'swiftui-view'
  | 'storyboard-scene'
  | 'component';

export interface Screenshot {
  uri: string;
  /** Image size in physical pixels. */
  width: number;
  height: number;
  capturedAt?: string;
  device?: string;
  /** Physical pixels per logical pixel, when the device reports it. */
  pixelRatio?: number;
}

/** How the app was built for a runtime capture. */
export interface BuildConfig {
  mode: 'debug' | 'profile' | 'release';
  flavor?: string;
  /** Entry point, e.g. `lib/main.dart`. */
  target?: string;
  flutterVersion?: string;
  /** Command used, e.g. `.fvm/flutter_sdk/bin/flutter`. */
  flutterCommand?: string;
}

export interface CaptureDevice {
  id: string;
  name: string;
  platform: 'android' | 'ios';
  osVersion?: string;
  /** Physical resolution, e.g. `1080x2400`. */
  resolution?: string;
  density?: number;
}

/**
 * A screenshot taken from a running app. It may or may not be associated
 * with a discovered screen; unassigned captures are kept, never dropped.
 */
export interface RuntimeCapture {
  id: string;
  projectId: string;
  sessionId?: string;
  /** Screen this capture shows; null while unassigned. */
  screenId: string | null;
  association: {
    method: 'auto' | 'manual' | 'none';
    /** e.g. `LoginPage found on top of the widget tree`. */
    detail?: string;
  };
  width: number;
  height: number;
  pixelRatio?: number;
  device: CaptureDevice;
  build?: BuildConfig;
  capturedAt: string;
  /** What the app reported at capture time. */
  navigation: {
    /** Screen widget classes found in the live widget tree, bottom to top. */
    detectedScreens: string[];
    topScreen?: string;
    /** Android foreground activity, when available. */
    activity?: string;
  };
}

/** A transition seen while the app was running: `from` was replaced on screen by `to`. */
export interface RuntimeObservation {
  id: string;
  sessionId: string;
  fromScreenId: string;
  toScreenId: string;
  observedAt: string;
}

/**
 * Where a UI state's preview comes from.
 * - `runtime`: captured from the real running app.
 * - `mock`: illustrative placeholder, never presented as a real capture.
 */
export type StateProvenance = 'runtime' | 'mock';

export interface ScreenState {
  id: string;
  label: string;
  provenance: StateProvenance;
  screenshot?: Screenshot;
  /** Runtime capture this state comes from. */
  captureId?: string;
  build?: BuildConfig;
}

export interface Screen {
  id: string;
  name: string;
  kind: ScreenKind;
  platformKind?: ScreenPlatformKind;
  moduleId?: string;
  route?: string;
  widgetClass: string;
  location: SourceLocation;
  isEntryPoint: boolean;
  keyWidgets: WidgetRef[];
  states: ScreenState[];
  /** Why this was identified as a screen. */
  evidence?: Evidence[];
}

/** A route declared in configuration (route table, nav graph, storyboard, file system). */
export interface NavigationRoute {
  id: string;
  /** Route name or identifier, e.g. `home`, `action_home_to_detail`. */
  name?: string;
  /** Path or pattern, e.g. `/product/:id`. */
  path?: string;
  /** Destination screen; `null` when the target could not be resolved. */
  screenId: string | null;
  /** Routing system, e.g. `flutter-navigator`, `go-router`, `android-nav-graph`. */
  router: string;
  location?: SourceLocation;
  evidence: Evidence[];
}

export type NavigationKind = 'push' | 'replace' | 'reset' | 'pop' | 'modal' | 'tab';

export interface NavigationTrigger {
  /** Short label drawn on the canvas arrow, e.g. `Tap Sign in`. */
  label: string;
  /** Human readable summary, e.g. `onPressed: "Sign in"`. */
  description: string;
  widget?: string;
  handler?: string;
  location?: SourceLocation;
}

export type UnresolvedKind = 'dynamic' | 'missing-target' | 'unsupported';

export interface NavigationEdge {
  id: string;
  from: string;
  /** `null` when the destination could not be determined automatically. */
  to: string | null;
  kind: NavigationKind;
  trigger: NavigationTrigger;
  evidence: Evidence[];
  /** Route this navigation goes through, if any. */
  routeId?: string;
  /** Argument expressions passed with the navigation, as written in code. */
  arguments?: string[];
  /** Why the destination is unknown (only meaningful when `to` is null). */
  unresolvedReason?: string;
  unresolvedKind?: UnresolvedKind;
  /** Set when user corrections were applied (see `applyCorrections`). */
  correction?: EdgeCorrectionInfo;
}

export interface EdgeCorrectionInfo {
  /** Key that user corrections refer to; stable across re-analysis. */
  key: string;
  /** The user chose the destination of an edge that analysis could not resolve. */
  resolvedByUser?: boolean;
  /** The user added this edge; it does not come from analysis. */
  addedByUser?: boolean;
}

/**
 * Derived, never stored:
 * - `verified`: observed at runtime.
 * - `manual`: added or completed by the user; not verified.
 * - `declared`: explicit navigation configuration.
 * - `inferred`: only supported by static analysis of code.
 * - `unresolved`: destination or evidence could not be determined.
 */
export type EdgeStatus = 'verified' | 'manual' | 'declared' | 'inferred' | 'unresolved';

export type AssetKind = 'image' | 'font' | 'data' | 'other';

export interface Asset {
  id: string;
  path: string;
  kind: AssetKind;
  moduleId?: string;
  /** Code or configuration locations that reference this asset. */
  referencedFrom: SourceLocation[];
}

export type WarningSeverity = 'info' | 'warning' | 'error';

export interface AnalysisWarning {
  id: string;
  /** Stable machine-readable code, e.g. `unresolved-route`. */
  code: string;
  severity: WarningSeverity;
  message: string;
  adapter?: string;
  location?: SourceLocation;
}

export interface DetectedFramework {
  id: string;
  name: string;
  version?: string;
  /** Files the detection is based on. */
  evidence: string[];
}

export interface AdapterRun {
  id: string;
  name: string;
  status: 'complete' | 'partial' | 'failed' | 'skipped';
  /** Entity and relationship kinds this adapter can discover. */
  capabilities: string[];
  durationMs?: number;
}

export type ProjectSource = 'mock' | 'analysis';

export interface AppProject {
  id: string;
  name: string;
  /** Primary platform. */
  framework: PlatformId;
  platforms?: PlatformId[];
  frameworks?: DetectedFramework[];
  rootPath: string;
  source: ProjectSource;
  analyzedAt?: string;
  modules?: Module[];
  files: SourceFile[];
  screens: Screen[];
  routes?: NavigationRoute[];
  edges: NavigationEdge[];
  assets?: Asset[];
  warnings?: AnalysisWarning[];
  adapters?: AdapterRun[];
  /** Files skipped because they may hold secrets (never read). */
  excludedSensitiveFiles?: number;
}
