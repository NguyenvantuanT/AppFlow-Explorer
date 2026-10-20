import { describe, expect, it } from 'vitest';
import { extractFacts } from './index';
import { parseXml, XmlParseError } from './xml';

const facts = async (path: string, source: string) => (await extractFacts(path, source))!;

describe('Dart extractor', () => {
  it('finds widget classes, navigator calls, handlers and constants', async () => {
    const f = await facts(
      'a.dart',
      `abstract final class Routes { static const cart = '/cart'; }
class _HomeState extends State<HomeScreen> {
  @override
  Widget build(BuildContext context) {
    return ElevatedButton(
      onPressed: () => Navigator.of(context).pushNamed(Routes.cart, arguments: 1),
      child: const Text('Open cart'),
    );
  }
}`,
    );
    expect(f.classes.map((c) => [c.name, c.supertypes, c.supertypeArgs])).toEqual([
      ['Routes', [], []],
      ['_HomeState', ['State'], ['HomeScreen']],
    ]);
    expect(f.constants).toContainEqual({ name: 'Routes.cart', value: '/cart', line: 1 });
    const push = f.calls.find((c) => c.name === 'pushNamed')!;
    expect(push.callee).toBe('Navigator.of.pushNamed');
    expect(push.args.map((a) => a.text)).toEqual(['Routes.cart', '1']);
    expect(push.line).toBe(6);
    expect(push.enclosingClass).toBe('_HomeState');
    expect(push.enclosingFunction).toBe('build');
    expect(push.handler).toEqual({ name: 'onPressed', owner: 'ElevatedButton', ownerLabel: 'Open cart' });
  });

  it('captures route builders, interpolated strings and map literals', async () => {
    const f = await facts(
      'r.dart',
      `final appRoutes = {'/a': (_) => const AScreen()};
void go(BuildContext c, int id) {
  c.go('/product/\${id}');
  Navigator.push(c, MaterialPageRoute(builder: (_) => DetailScreen(id: id)));
}`,
    );
    expect(f.pairs[0]).toMatchObject({ ownerVariable: 'appRoutes', key: { stringValue: '/a' }, value: { typeRefs: ['AScreen'] } });
    expect(f.calls.find((c) => c.name === 'go')!.args[0]).toMatchObject({ stringValue: undefined, stringPattern: '/product/*' });
    const push = f.calls.find((c) => c.callee === 'Navigator.push')!;
    expect(push.args[1]!.typeRefs).toEqual(['MaterialPageRoute', 'DetailScreen']);
    expect(f.functions.map((fn) => fn.name)).toEqual(['go']);
  });
});

describe('Kotlin extractor', () => {
  it('finds activities, intents, nav calls and compose routes', async () => {
    const f = await facts(
      'A.kt',
      `class MainActivity : AppCompatActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    button.setOnClickListener { startActivity(Intent(this, DetailActivity::class.java)) }
    findNavController().navigate(R.id.action_home_to_detail)
  }
}
@Composable fun AppNav(nav: NavHostController) {
  NavHost(nav, startDestination = "home") {
    composable("home") { HomeScreen(onOpen = { nav.navigate("detail/1") }) }
  }
}`,
    );
    expect(f.classes[0]).toMatchObject({ name: 'MainActivity', supertypes: ['AppCompatActivity'] });
    const start = f.calls.find((c) => c.name === 'startActivity')!;
    expect(start.args[0]!.typeRefs).toEqual(['Intent', 'DetailActivity']);
    expect(start.handler).toEqual({ name: 'setOnClickListener', owner: 'button', ownerLabel: undefined });
    expect(f.calls.find((c) => c.name === 'navigate' && c.callee === 'findNavController.navigate')!.args[0]!.text).toBe('R.id.action_home_to_detail');
    const composable = f.calls.find((c) => c.name === 'composable')!;
    expect(composable.args[0]!.stringValue).toBe('home');
    expect(composable.hasTrailingLambda).toBe(true);
    const nav = f.calls.find((c) => c.callee === 'nav.navigate')!;
    expect(nav.handler).toMatchObject({ name: 'onOpen', owner: 'HomeScreen' });
    expect(f.calls[nav.parentCall!]!.name).toBe('HomeScreen');
    expect(f.functions.find((fn) => fn.name === 'AppNav')!.annotations).toEqual(['Composable']);
  });
});

describe('Java extractor', () => {
  it('finds class literals in intents and listener handlers', async () => {
    const f = await facts(
      'A.java',
      `public class LegacyActivity extends AppCompatActivity {
  static final String EXTRA = "id";
  @Override protected void onCreate(Bundle b) {
    btn.setOnClickListener(v -> startActivity(new Intent(this, DetailActivity.class)));
  }
}`,
    );
    expect(f.classes[0]).toMatchObject({ name: 'LegacyActivity', supertypes: ['AppCompatActivity'] });
    const start = f.calls.find((c) => c.name === 'startActivity')!;
    expect(start.args[0]!.typeRefs).toEqual(['Intent', 'DetailActivity']);
    expect(start.handler?.name).toBe('setOnClickListener');
    expect(f.constants).toContainEqual({ name: 'LegacyActivity.EXTRA', value: 'id', line: 2 });
  });
});

describe('Swift extractor', () => {
  it('finds UIKit pushes, segues, IBActions and SwiftUI links', async () => {
    const f = await facts(
      'A.swift',
      `class ListViewController: UIViewController {
  @IBAction func addTapped(_ sender: Any) {
    navigationController?.pushViewController(EditViewController(), animated: true)
    performSegue(withIdentifier: "showDetail", sender: self)
  }
}
struct SettingsView: View {
  @State var show = false
  var body: some View {
    NavigationLink(destination: AboutView()) { Text("About") }
    Button("Sign out") { show = true }.sheet(isPresented: $show) { ConfirmView() }
  }
}`,
    );
    expect(f.classes.map((c) => [c.name, c.kind, c.supertypes])).toEqual([
      ['ListViewController', 'class', ['UIViewController']],
      ['SettingsView', 'struct', ['View']],
    ]);
    const push = f.calls.find((c) => c.name === 'pushViewController')!;
    expect(push.args[0]!.typeRefs).toEqual(['EditViewController']);
    expect(push.handler?.name).toBe('@IBAction addTapped');
    expect(f.calls.find((c) => c.name === 'performSegue')!.args[0]).toMatchObject({ label: 'withIdentifier', stringValue: 'showDetail' });
    expect(f.calls.find((c) => c.name === 'NavigationLink')!.args[0]).toMatchObject({ label: 'destination', typeRefs: ['AboutView'] });
    const sheet = f.calls.find((c) => c.name === 'sheet')!;
    expect(sheet.args.some((a) => a.isLambda && a.typeRefs.includes('ConfirmView'))).toBe(true);
  });
});

describe('Objective-C extractor', () => {
  it('finds view controllers and alloc/init pushes', async () => {
    const f = await facts(
      'L.m',
      `@interface LegacyViewController : UIViewController
@end
@implementation LegacyViewController
- (void)openDetail {
  [self.navigationController pushViewController:[[DetailViewController alloc] init] animated:YES];
}
@end`,
    );
    expect(f.classes[0]).toMatchObject({ name: 'LegacyViewController', supertypes: ['UIViewController'] });
    const push = f.calls.find((c) => c.name === 'pushViewController')!;
    expect(push.args[0]).toMatchObject({ label: 'pushViewController', typeRefs: ['DetailViewController'] });
    expect(push.enclosingClass).toBe('LegacyViewController');
  });
});

describe('TypeScript extractor', () => {
  it('finds React Navigation screens, navigate calls and imports', async () => {
    const f = await facts(
      'App.tsx',
      `import HomeScreen from './screens/HomeScreen';
import { Details as DetailsScreen } from './screens';
const Stack = createNativeStackNavigator();
export default function App() {
  return (
    <Stack.Navigator initialRouteName="Home">
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen name="Details" component={DetailsScreen} options={{ title: 'Details' }} />
    </Stack.Navigator>
  );
}
export function Home({ navigation }) {
  return <Button title="Go" onPress={() => navigation.navigate('Details', { id: 1 })} />;
}`,
    );
    expect(f.imports).toEqual([
      { source: './screens/HomeScreen', names: [{ local: 'HomeScreen', imported: 'default' }], line: 1 },
      { source: './screens', names: [{ local: 'DetailsScreen', imported: 'Details' }], line: 2 },
    ]);
    expect(f.variables.find((v) => v.name === 'Stack')!.initCallee).toBe('createNativeStackNavigator');
    const screens = f.jsx.filter((j) => j.name === 'Stack.Screen');
    expect(screens.map((s) => [s.attrs.find((a) => a.label === 'name')!.stringValue, s.attrs.find((a) => a.label === 'component')!.typeRefs])).toEqual([
      ['Home', ['HomeScreen']],
      ['Details', ['DetailsScreen']],
    ]);
    expect(f.jsx[screens[0]!.parentJsx!]!.name).toBe('Stack.Navigator');
    const nav = f.calls.find((c) => c.callee === 'navigation.navigate')!;
    expect(nav.args[0]!.stringValue).toBe('Details');
    expect(nav.handler).toEqual({ name: 'onPress', owner: 'Button', ownerLabel: 'Go' });
    expect(nav.enclosingFunction).toBe('Home');
    expect(f.functions.map((fn) => [fn.name, fn.exported])).toEqual([
      ['App', true],
      ['Home', true],
    ]);
  });
});

describe('XML parser', () => {
  it('builds an element tree with line numbers', () => {
    const doc = parseXml(`<?xml version="1.0"?>
<!-- comment -->
<navigation app:startDestination="@id/home">
  <fragment android:id="@+id/home" android:name="a.HomeFragment">
    <action android:id="@+id/to_detail" app:destination="@id/detail" />
  </fragment>
</navigation>`);
    const nav = doc.children[0]!;
    expect(nav).toMatchObject({ name: 'navigation', line: 3, attrs: { 'app:startDestination': '@id/home' } });
    expect(nav.children[0]!.children[0]).toMatchObject({ name: 'action', line: 5 });
  });

  it('reports malformed documents with a line number', () => {
    expect(() => parseXml('<a>\n<b></a>')).toThrow(XmlParseError);
  });
});
