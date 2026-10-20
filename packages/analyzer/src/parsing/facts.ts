/**
 * Language-neutral facts extracted from one source file's syntax tree.
 *
 * Each language has an extractor that walks its tree-sitter grammar and
 * produces these facts; adapters reason about facts, never about raw syntax
 * nodes, so framework logic is shared across languages where it can be.
 */

export interface FactPos {
  line: number;
  column: number;
}

/** One argument of a call, or one attribute of a JSX element. */
export interface ArgFact {
  /** Named-argument label / attribute name. */
  label?: string;
  /** Source text of the value. */
  text: string;
  /** The literal value when the argument is a plain string literal (no interpolation). */
  stringValue?: string;
  /** Interpolated string with `${…}` parts replaced by `*`, e.g. `/product/*`. */
  stringPattern?: string;
  /** Capitalized type names referenced inside the value, in source order (constructor calls, class literals). */
  typeRefs: string[];
  /** Plain string literals found anywhere inside the value. */
  strings: string[];
  /** True when the value is a closure / lambda. */
  isLambda: boolean;
}

export interface HandlerContext {
  /** Handler name, e.g. `onPressed`, `setOnClickListener`, `@IBAction tap`. */
  name: string;
  /** Component the handler is attached to, e.g. `ElevatedButton`. */
  owner?: string;
  /** First string literal passed to the owner (often its visible label). */
  ownerLabel?: string;
}

export interface CallFact extends FactPos {
  /** Index in `FileFacts.calls`. */
  index: number;
  /** Dotted callee without arguments, e.g. `Navigator.of.pushNamed`, `findNavController.navigate`. */
  callee: string;
  /** Last callee segment, e.g. `pushNamed`. */
  name: string;
  args: ArgFact[];
  hasTrailingLambda: boolean;
  enclosingClass?: string;
  enclosingFunction?: string;
  handler?: HandlerContext;
  /** Index of the nearest enclosing call (whose arguments contain this call). */
  parentCall?: number;
  /** True for `new X()`, `const X()`, `[X alloc]` style instantiation. */
  isInstantiation: boolean;
}

export type ClassKind = 'class' | 'struct' | 'object' | 'interface' | 'enum' | 'protocol' | 'extension';

export interface ClassFact extends FactPos {
  name: string;
  kind: ClassKind;
  /** Direct supertypes without generic arguments, e.g. `State`, `AppCompatActivity`. */
  supertypes: string[];
  /** Generic arguments of supertypes, e.g. `HomeScreen` for `State<HomeScreen>`. */
  supertypeArgs: string[];
  annotations: string[];
  endLine: number;
}

export interface FunctionFact extends FactPos {
  name: string;
  annotations: string[];
  enclosingClass?: string;
  endLine: number;
  exported: boolean;
}

export interface JsxFact extends FactPos {
  index: number;
  /** Tag name, e.g. `Stack.Screen`, `Link`. */
  name: string;
  attrs: ArgFact[];
  enclosingFunction?: string;
  enclosingClass?: string;
  handler?: HandlerContext;
  /** Index of the enclosing JSX element. */
  parentJsx?: number;
  /** Capitalized component names used as children. */
  childComponents: string[];
}

export interface ImportFact {
  source: string;
  /** Dart `export '…'` (re-exports the file's declarations). */
  isExport?: boolean;
  /** Local names bound by the import (`default` import gets `imported: 'default'`). */
  names: Array<{ local: string; imported: string }>;
  line: number;
}

/** A string constant, e.g. Dart `static const home = '/home'` → `Routes.home`. */
export interface ConstantFact {
  /** Qualified name (`Owner.name`) or plain name for top-level constants. */
  name: string;
  value: string;
  line: number;
}

/** A local or top-level variable initialized from an expression. */
export interface VariableFact extends FactPos {
  name: string;
  value: ArgFact;
  enclosingClass?: string;
  enclosingFunction?: string;
  /** Callee name when the initializer is a call, e.g. `createNativeStackNavigator`. */
  initCallee?: string;
}

/** A key/value pair of a map or object literal. */
export interface PairFact {
  key: ArgFact;
  value: ArgFact;
  line: number;
  /** Variable the literal is assigned to, if any. */
  ownerVariable?: string;
  /** Call whose arguments contain the literal, if any. */
  parentCall?: number;
  /** Key path of enclosing pairs, e.g. `['screens']`. */
  parentKeys: string[];
}

export interface StringFact extends FactPos {
  value: string;
}

export interface FileFacts {
  classes: ClassFact[];
  functions: FunctionFact[];
  calls: CallFact[];
  jsx: JsxFact[];
  imports: ImportFact[];
  constants: ConstantFact[];
  variables: VariableFact[];
  pairs: PairFact[];
  strings: StringFact[];
  /** Number of syntax error nodes; > 0 means facts may be incomplete. */
  syntaxErrors: number;
}

export function emptyFacts(): FileFacts {
  return {
    classes: [],
    functions: [],
    calls: [],
    jsx: [],
    imports: [],
    constants: [],
    variables: [],
    pairs: [],
    strings: [],
    syntaxErrors: 0,
  };
}
