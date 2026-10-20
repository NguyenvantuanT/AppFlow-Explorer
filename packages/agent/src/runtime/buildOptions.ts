import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ProjectFs } from '@appflow/analyzer';

export interface BuildOptions {
  modes: Array<'debug' | 'profile' | 'release'>;
  /** Android product flavors (also used as iOS schemes by Flutter). */
  flavors: string[];
  /** Entry points under lib/, e.g. `lib/main.dart`, `lib/main_dev.dart`. */
  targets: string[];
  defaultTarget?: string;
  /** Files the build needs that AppFlow never reads (e.g. `.env.development` assets). */
  sensitiveBuildInputs: string[];
  notes: string[];
}

/** Body of the first `name { … }` block, matched by braces. */
function bracedBlock(text: string, name: string): string {
  const start = new RegExp(`\\b${name}\\s*\\{`).exec(text);
  if (!start) return '';
  let depth = 0;
  for (let i = start.index + start[0].length - 1; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(start.index + start[0].length, i);
  }
  return '';
}

/** Names of `identifier {` blocks at the top level of a block body. */
function topLevelBlockNames(body: string): string[] {
  const names: string[] = [];
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '{') {
      if (depth === 0) {
        const m = /([a-zA-Z]\w*)\s*$/.exec(body.slice(Math.max(0, i - 80), i));
        if (m && !/\)\s*$/.test(body.slice(0, i))) names.push(m[1]!);
      }
      depth++;
    } else if (body[i] === '}') depth--;
  }
  return names;
}

/**
 * Reads what can be chosen for `flutter run`: build modes, Android product
 * flavors and `lib/main*.dart` targets. Only these detected values are ever
 * passed to the build, so the command line cannot be steered elsewhere.
 */
export async function detectBuildOptions(fs_: ProjectFs): Promise<BuildOptions> {
  const notes: string[] = [];
  const scan = await fs_.scan();
  const targets = scan.files.map((f) => f.path).filter((p) => /^lib\/main[\w-]*\.dart$/.test(p)).sort();
  const flavors = new Set<string>();
  for (const gradle of ['android/app/build.gradle.kts', 'android/app/build.gradle']) {
    let text: string;
    try {
      text = await fs_.readText(gradle);
    } catch {
      continue;
    }
    const block = bracedBlock(text, 'productFlavors');
    for (const m of block.matchAll(/create\(\s*"([\w-]+)"\s*\)/g)) flavors.add(m[1]!);
    // Groovy: `development { … }` directly inside productFlavors.
    for (const name of topLevelBlockNames(block)) flavors.add(name);
  }
  if (flavors.size) notes.push('Flavors come from android/app/build.gradle; the matching iOS schemes must exist to run on iOS.');
  // Root-level env files are what flutter_dotenv assets and --dart-define-from-file use.
  const sensitiveBuildInputs = scan.excludedSensitive.filter((p) => /^\.env/.test(p));
  if (sensitiveBuildInputs.length) notes.push('The build bundles environment files that AppFlow does not read; their values end up in the app.');
  try {
    await fs.access(path.join(fs_.root, 'pubspec.lock'));
  } catch {
    notes.push('No pubspec.lock: the build will resolve and download dependencies.');
  }
  return {
    modes: ['debug', 'profile', 'release'],
    flavors: [...flavors].sort(),
    targets,
    defaultTarget: targets.includes('lib/main.dart') ? 'lib/main.dart' : targets[0],
    sensitiveBuildInputs,
    notes,
  };
}
