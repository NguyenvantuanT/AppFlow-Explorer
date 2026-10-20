import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface SampleProject {
  id: string;
  name: string;
  framework: 'flutter' | 'android' | 'ios' | 'react-native';
  detail: string;
  path: string;
}

/** Sample projects are the analyzer's fixtures, analyzed like any opened folder. */
export const SAMPLES: Array<Omit<SampleProject, 'path'>> = [
  { id: 'flutter_native', name: 'Corebank', framework: 'flutter', detail: 'Flutter + custom Kotlin and Swift screens via MethodChannel, platform view, native → Flutter' },
  { id: 'flutter_native_java', name: 'Corebank (Java)', framework: 'flutter', detail: 'The same app with its Android host in Java: switch (call.method) handler, Java activities' },
  { id: 'rn_recipebox', name: 'RecipeBox', framework: 'react-native', detail: 'React Navigation stacks and tabs, Kotlin, Java and Objective-C native modules that open native screens' },
  { id: 'flutter_shop', name: 'ShopLite', framework: 'flutter', detail: 'Routes table, dialogs and sheets, nested package, unresolved routes' },
  { id: 'flutter_go_router', name: 'go_router app', framework: 'flutter', detail: 'Nested GoRoutes, named routes, dynamic locations' },
  { id: 'flutter_auto_route', name: 'AutoRoute app', framework: 'flutter', detail: 'AutoRoute config with tabs, sheets and generated routes' },
  { id: 'flutter_states', name: 'States app', framework: 'flutter', detail: 'Loading, empty, error and auth states, deep links' },
  { id: 'android_tasky', name: 'Tasky', framework: 'android', detail: 'Activities, nav graphs, Safe Args, Compose NavHost' },
  { id: 'ios_bookshelf', name: 'Bookshelf', framework: 'ios', detail: 'Storyboards and segues, UIKit, SwiftUI, Objective-C' },
];

/** Samples whose folder exists under `dir`; none when the app ships without them. */
export function listSamples(dir: string): SampleProject[] {
  return SAMPLES.map((s) => ({ ...s, path: join(dir, s.id) })).filter((s) => existsSync(s.path));
}
