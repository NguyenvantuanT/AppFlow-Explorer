import type { Dependency, ModuleKind } from '@appflow/model';
import type { FileFacts } from '../../parsing/facts';

export interface GradleInfo {
  kind: ModuleKind;
  namespace?: string;
  dependencies: Dependency[];
  /** Project dependencies, e.g. `:feature:profile`. */
  projectDependencies: string[];
  compileSdk?: string;
}

const DEP_CONFIGS = /^(implementation|api|compileOnly|runtimeOnly|kapt|ksp|testImplementation|androidTestImplementation|debugImplementation|releaseImplementation)$/;

function kindFromPlugins(plugins: string[], path: string): ModuleKind {
  if (plugins.some((p) => p.includes('com.android.application') || p.includes('android.application'))) return 'app';
  if (plugins.some((p) => p.includes('com.android.dynamic-feature'))) return 'feature';
  return /(^|\/)features?(\/|-|_)/.test(path) ? 'feature' : 'library';
}

function splitCoordinate(coord: string): Dependency {
  const parts = coord.split(':');
  return parts.length >= 3 ? { name: `${parts[0]}:${parts[1]}`, version: parts.slice(2).join(':') } : { name: coord };
}

/** Kotlin DSL (`build.gradle.kts`): read from the parsed syntax tree. */
export function gradleFromKotlinFacts(facts: FileFacts, path: string): GradleInfo {
  const plugins: string[] = [];
  const dependencies: Dependency[] = [];
  const projectDependencies: string[] = [];
  let namespace: string | undefined;
  let compileSdk: string | undefined;
  for (const call of facts.calls) {
    if (call.name === 'id' || call.name === 'alias') plugins.push(call.args[0]?.stringValue ?? call.args[0]?.text ?? '');
    if (DEP_CONFIGS.test(call.name)) {
      const arg = call.args[0];
      if (!arg) continue;
      if (arg.stringValue) dependencies.push(splitCoordinate(arg.stringValue));
      else if (arg.text.startsWith('project(')) projectDependencies.push(arg.strings[0] ?? arg.text);
      else dependencies.push({ name: arg.text });
    }
  }
  for (const v of facts.variables) {
    if (v.name === 'namespace' && v.value.stringValue) namespace = v.value.stringValue;
    if (v.name === 'compileSdk') compileSdk = v.value.text;
  }
  return { kind: kindFromPlugins(plugins, path), namespace, dependencies, projectDependencies, compileSdk };
}

/**
 * Groovy DSL (`build.gradle`) has no bundled grammar: plugin ids, namespace
 * and dependency coordinates are read line by line. This is best-effort
 * metadata and is documented as such.
 */
export function gradleFromGroovyText(text: string, path: string): GradleInfo {
  const plugins: string[] = [];
  const dependencies: Dependency[] = [];
  const projectDependencies: string[] = [];
  let namespace: string | undefined;
  let compileSdk: string | undefined;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const plugin = /^(?:id|apply plugin:)\s*\(?\s*['"]([^'"]+)['"]/.exec(line);
    if (plugin) plugins.push(plugin[1]!);
    const ns = /^namespace\s*=?\s*['"]([^'"]+)['"]/.exec(line);
    if (ns) namespace = ns[1];
    const sdk = /^compileSdk(?:Version)?\s*=?\s*(\S+)/.exec(line);
    if (sdk) compileSdk = sdk[1];
    const dep = /^(\w+)\s*\(?\s*(?:project\(\s*)?['"]([^'"]+)['"]/.exec(line);
    if (dep && DEP_CONFIGS.test(dep[1]!)) {
      if (line.includes('project(')) projectDependencies.push(dep[2]!);
      else dependencies.push(splitCoordinate(dep[2]!));
    }
  }
  return { kind: kindFromPlugins(plugins, path), namespace, dependencies, projectDependencies, compileSdk };
}

/** Assignment `namespace = "x"` in Kotlin DSL is not a variable fact; read it from the source text of the call tree. */
export function kotlinNamespace(text: string): string | undefined {
  return /\bnamespace\s*=\s*"([^"]+)"/.exec(text)?.[1];
}
