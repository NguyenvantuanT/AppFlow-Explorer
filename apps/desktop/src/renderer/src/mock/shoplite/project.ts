import type {
  AppProject,
  Evidence,
  NavigationEdge,
  NavigationKind,
  Screen,
  ScreenKind,
  SourceFile,
  SourceLanguage,
  SourceLocation,
  WidgetKind,
  WidgetRef,
} from '@appflow/model';
import {
  MOCK_SCREEN_HEIGHT,
  MOCK_SCREEN_WIDTH,
  renderMockScreen,
  type MockScreenSpec,
} from '../mockScreenshot';
import { shopliteAssets, shopliteSources } from './sources';

const OBSERVED_AT = '2026-10-18T09:30:00Z';

function languageOf(path: string): SourceLanguage {
  if (path.endsWith('.dart')) return 'dart';
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'yaml';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.md')) return 'markdown';
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(path)) return 'image';
  return 'text';
}

const files: SourceFile[] = [
  ...Object.entries(shopliteSources).map(([path, content]) => ({
    id: path,
    path,
    language: languageOf(path),
    content,
  })),
  ...shopliteAssets.map((path) => ({ id: path, path, language: languageOf(path) })),
];

/** Resolves the first line containing `needle`; throws so fixture drift is caught by tests. */
function at(fileId: string, needle: string): SourceLocation {
  const content = shopliteSources[fileId];
  if (content === undefined) throw new Error(`mock: unknown file ${fileId}`);
  const index = content.split('\n').findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`mock: "${needle}" not found in ${fileId}`);
  return { fileId, line: index + 1 };
}

interface ScreenDef {
  id: string;
  name: string;
  file: string;
  widgetClass: string;
  kind?: ScreenKind;
  route?: string;
  entry?: boolean;
  widgets: Array<[name: string, kind: WidgetKind, needle: string]>;
  /** Omit to model a screen that has not been captured yet. */
  preview?: MockScreenSpec;
}

const F = {
  splash: 'lib/features/splash/splash_screen.dart',
  onboarding: 'lib/features/onboarding/onboarding_screen.dart',
  login: 'lib/features/auth/login_screen.dart',
  register: 'lib/features/auth/register_screen.dart',
  home: 'lib/features/home/home_screen.dart',
  promo: 'lib/features/home/widgets/promo_banner.dart',
  grid: 'lib/features/home/widgets/product_grid.dart',
  search: 'lib/features/search/search_screen.dart',
  product: 'lib/features/product/product_detail_screen.dart',
  reviews: 'lib/features/product/widgets/reviews_sheet.dart',
  cart: 'lib/features/cart/cart_screen.dart',
  checkout: 'lib/features/checkout/checkout_screen.dart',
  paymentFailed: 'lib/features/checkout/widgets/payment_failed_dialog.dart',
  orderSuccess: 'lib/features/checkout/order_success_screen.dart',
  profile: 'lib/features/profile/profile_screen.dart',
  settings: 'lib/features/settings/settings_screen.dart',
  logout: 'lib/features/settings/widgets/logout_dialog.dart',
} as const;

const screenDefs: ScreenDef[] = [
  {
    id: 'splash',
    name: 'Splash',
    file: F.splash,
    widgetClass: 'SplashScreen',
    route: '/splash',
    entry: true,
    widgets: [['FlutterLogo', 'image', 'FlutterLogo(']],
    preview: { blocks: [{ type: 'spacer', height: 140 }, { type: 'logo', label: 'ShopLite' }] },
  },
  {
    id: 'onboarding',
    name: 'Onboarding',
    file: F.onboarding,
    widgetClass: 'OnboardingScreen',
    route: '/onboarding',
    widgets: [
      ['_OnboardingCarousel', 'container', 'class _OnboardingCarousel'],
      ['FilledButton "Get started"', 'button', 'FilledButton('],
    ],
    preview: {
      blocks: [
        { type: 'spacer', height: 40 },
        { type: 'hero', label: 'Discover products you love', height: 340 },
        { type: 'spacer', height: 12 },
        { type: 'text', lines: 3 },
        { type: 'dots', count: 3, active: 0 },
        { type: 'spacer', height: 60 },
        { type: 'button', label: 'Get started' },
      ],
    },
  },
  {
    id: 'login',
    name: 'Login',
    file: F.login,
    widgetClass: 'LoginScreen',
    route: '/login',
    widgets: [
      ['TextField "Email"', 'input', "labelText: 'Email'"],
      ['TextField "Password"', 'input', "labelText: 'Password'"],
      ['FilledButton "Sign in"', 'button', 'FilledButton(onPressed: _submit'],
      ['TextButton "Create an account"', 'button', 'TextButton('],
    ],
    preview: {
      blocks: [
        { type: 'appbar', title: 'Sign in', back: true },
        { type: 'spacer', height: 12 },
        { type: 'heading', text: 'Welcome back' },
        { type: 'text', lines: 2 },
        { type: 'input', label: 'Email' },
        { type: 'input', label: 'Password' },
        { type: 'spacer', height: 16 },
        { type: 'button', label: 'Sign in' },
        { type: 'button', label: 'Create an account', variant: 'ghost' },
      ],
    },
  },
  {
    id: 'register',
    name: 'Register',
    file: F.register,
    widgetClass: 'RegisterScreen',
    route: '/register',
    widgets: [
      ['TextField "Name"', 'input', "labelText: 'Name'"],
      ['TextField "Email"', 'input', "labelText: 'Email'"],
      ['FilledButton "Create account"', 'button', 'FilledButton('],
    ],
    preview: {
      blocks: [
        { type: 'appbar', title: 'Create account', back: true },
        { type: 'spacer', height: 12 },
        { type: 'input', label: 'Name' },
        { type: 'input', label: 'Email' },
        { type: 'input', label: 'Password' },
        { type: 'spacer', height: 16 },
        { type: 'button', label: 'Create account' },
      ],
    },
  },
  {
    id: 'home',
    name: 'Home',
    file: F.home,
    widgetClass: 'HomeScreen',
    route: '/home',
    widgets: [
      ['PromoBanner', 'container', 'const PromoBanner()'],
      ['ProductGrid', 'list', 'ProductGrid('],
      ['IconButton search', 'button', 'Icons.search'],
      ['IconButton cart', 'button', 'Icons.shopping_cart_outlined'],
      ['BottomNavigationBar', 'tab', 'BottomNavigationBar('],
    ],
    preview: {
      blocks: [
        { type: 'appbar', title: 'ShopLite', actions: 2 },
        { type: 'hero', label: 'Summer sale', height: 130 },
        { type: 'grid', count: 4 },
      ],
      tabbar: { active: 0 },
    },
  },
  {
    id: 'search',
    name: 'Search',
    file: F.search,
    widgetClass: 'SearchScreen',
    route: '/search',
    widgets: [
      ['TextField "Search"', 'input', "hintText: 'Search'"],
      ['ListView results', 'list', 'ListView.builder('],
    ],
    preview: {
      blocks: [
        { type: 'appbar', title: 'Search', back: true },
        { type: 'input', label: 'Search products' },
        { type: 'list', count: 7, avatar: true },
      ],
    },
  },
  {
    id: 'product',
    name: 'Product Detail',
    file: F.product,
    widgetClass: 'ProductDetailScreen',
    route: '/product',
    widgets: [
      ['TextButton "See reviews"', 'button', 'TextButton('],
      ['FilledButton "Add to cart"', 'button', 'FilledButton('],
    ],
    preview: {
      blocks: [
        { type: 'appbar', title: 'Sneakers', back: true, actions: 1 },
        { type: 'hero', label: '$89', height: 300 },
        { type: 'heading', text: 'Runner Pro' },
        { type: 'text', lines: 4 },
        { type: 'button', label: 'See reviews', variant: 'ghost' },
        { type: 'button', label: 'Add to cart' },
      ],
    },
  },
  {
    id: 'reviews',
    name: 'Reviews Sheet',
    file: F.reviews,
    widgetClass: 'ReviewsSheet',
    kind: 'bottomSheet',
    widgets: [['ListView reviews', 'list', 'ListView(']],
    preview: {
      blocks: [
        { type: 'appbar', title: 'Sneakers', back: true, actions: 1 },
        { type: 'hero', label: '$89', height: 300 },
        { type: 'text', lines: 4 },
      ],
      overlay: { type: 'sheet', title: 'Reviews', rows: 3 },
    },
  },
  {
    id: 'cart',
    name: 'Cart',
    file: F.cart,
    widgetClass: 'CartScreen',
    route: '/cart',
    widgets: [
      ['ListView items', 'list', 'ListView('],
      ['FilledButton "Checkout"', 'button', 'FilledButton('],
    ],
    preview: {
      blocks: [
        { type: 'appbar', title: 'Your cart', back: true },
        { type: 'list', count: 4, avatar: true },
        { type: 'spacer', height: 200 },
        { type: 'text', lines: 2 },
        { type: 'button', label: 'Checkout' },
      ],
    },
  },
  {
    id: 'checkout',
    name: 'Checkout',
    file: F.checkout,
    widgetClass: 'CheckoutScreen',
    route: '/checkout',
    widgets: [
      ['TextField "Shipping address"', 'input', 'Shipping address'],
      ['TextField "Card number"', 'input', 'Card number'],
      ['FilledButton "Place order"', 'button', 'FilledButton(onPressed: _placeOrder'],
    ],
    preview: {
      blocks: [
        { type: 'appbar', title: 'Checkout', back: true },
        { type: 'input', label: 'Shipping address' },
        { type: 'input', label: 'Card number' },
        { type: 'text', lines: 3 },
        { type: 'spacer', height: 210 },
        { type: 'button', label: 'Place order' },
      ],
    },
  },
  {
    id: 'paymentFailed',
    name: 'Payment Failed',
    file: F.paymentFailed,
    widgetClass: 'PaymentFailedDialog',
    kind: 'dialog',
    widgets: [['AlertDialog', 'container', 'AlertDialog(']],
    // Intentionally not captured: shows how uncaptured screens are presented.
  },
  {
    id: 'orderSuccess',
    name: 'Order Success',
    file: F.orderSuccess,
    widgetClass: 'OrderSuccessScreen',
    route: '/order-success',
    widgets: [['FilledButton "Continue shopping"', 'button', 'FilledButton(']],
    preview: {
      blocks: [
        { type: 'spacer', height: 120 },
        { type: 'logo', label: 'Order placed!' },
        { type: 'text', lines: 2 },
        { type: 'spacer', height: 40 },
        { type: 'button', label: 'Continue shopping' },
      ],
    },
  },
  {
    id: 'profile',
    name: 'Profile',
    file: F.profile,
    widgetClass: 'ProfileScreen',
    route: '/profile',
    widgets: [
      ['ListTile "Order history"', 'button', 'Order history'],
      ['ListTile "Settings"', 'button', "Text('Settings')"],
    ],
    preview: {
      blocks: [
        { type: 'appbar', title: 'Profile' },
        { type: 'list', count: 1, avatar: true },
        { type: 'spacer', height: 12 },
        { type: 'list', count: 4 },
      ],
      tabbar: { active: 2 },
    },
  },
  {
    id: 'settings',
    name: 'Settings',
    file: F.settings,
    widgetClass: 'SettingsScreen',
    route: '/settings',
    widgets: [
      ['SwitchListTile "Notifications"', 'input', 'SwitchListTile('],
      ['ListTile "Log out"', 'button', "Text('Log out')"],
    ],
    preview: {
      blocks: [
        { type: 'appbar', title: 'Settings', back: true },
        { type: 'list', count: 6 },
      ],
    },
  },
  {
    id: 'logoutDialog',
    name: 'Logout Dialog',
    file: F.logout,
    widgetClass: 'LogoutDialog',
    kind: 'dialog',
    widgets: [
      ['TextButton "Cancel"', 'button', 'TextButton('],
      ['FilledButton "Log out"', 'button', 'FilledButton('],
    ],
    preview: {
      blocks: [
        { type: 'appbar', title: 'Settings', back: true },
        { type: 'list', count: 6 },
      ],
      overlay: { type: 'dialog', title: 'Log out?', body: 'You can sign in again anytime.', actions: ['Cancel', 'Log out'] },
    },
  },
];

const screens: Screen[] = screenDefs.map((def) => {
  const keyWidgets: WidgetRef[] = def.widgets.map(([name, kind, needle]) => ({
    name,
    kind,
    location: at(def.file, needle),
  }));
  return {
    id: def.id,
    name: def.name,
    kind: def.kind ?? 'page',
    route: def.route,
    widgetClass: def.widgetClass,
    location: at(def.file, `class ${def.widgetClass} `),
    isEntryPoint: def.entry ?? false,
    keyWidgets,
    states: def.preview
      ? [
          {
            id: `${def.id}:default`,
            label: 'Default',
            provenance: 'mock',
            screenshot: {
              uri: renderMockScreen(def.preview),
              width: MOCK_SCREEN_WIDTH,
              height: MOCK_SCREEN_HEIGHT,
            },
          },
        ]
      : [],
  };
});

interface EdgeDef {
  from: string;
  to: string | null;
  kind: NavigationKind;
  /** Short arrow label. */
  label: string;
  trigger: string;
  widget?: string;
  handler?: string;
  file: string;
  needle: string;
  call: string;
  /** Mock runtime observation; omit for static-only edges. */
  observed?: string;
  unresolvedReason?: string;
}

const edgeDefs: EdgeDef[] = [
  { from: 'splash', to: 'onboarding', kind: 'replace', label: 'Auto (signed out)', trigger: 'initState → _route() when signed out', handler: '_route', file: F.splash, needle: 'Routes.onboarding)', call: 'Navigator.pushReplacementNamed(Routes.onboarding)', observed: 'Cold start with a fresh install' },
  { from: 'splash', to: 'home', kind: 'replace', label: 'Auto (signed in)', trigger: 'initState → _route() when AuthService.isSignedIn', handler: '_route', file: F.splash, needle: 'Routes.home)', call: 'Navigator.pushReplacementNamed(Routes.home)' },
  { from: 'onboarding', to: 'login', kind: 'push', label: 'Get started', trigger: 'onPressed: "Get started"', widget: 'FilledButton', file: F.onboarding, needle: 'Routes.login)', call: 'Navigator.pushNamed(Routes.login)', observed: 'Tapped "Get started"' },
  { from: 'login', to: 'home', kind: 'replace', label: 'Sign in', trigger: 'onPressed: "Sign in" → _submit()', widget: 'FilledButton', handler: '_submit', file: F.login, needle: 'Routes.home)', call: 'Navigator.pushReplacementNamed(Routes.home)', observed: 'Signed in with demo account' },
  { from: 'login', to: 'register', kind: 'push', label: 'Create account', trigger: 'onPressed: "Create an account"', widget: 'TextButton', file: F.login, needle: 'Routes.register)', call: 'Navigator.pushNamed(Routes.register)' },
  { from: 'register', to: 'home', kind: 'reset', label: 'Register', trigger: 'onPressed: "Create account"', widget: 'FilledButton', file: F.register, needle: 'Routes.home,', call: 'Navigator.pushNamedAndRemoveUntil(Routes.home)' },
  { from: 'home', to: 'search', kind: 'push', label: 'Tap Search', trigger: 'onPressed: search icon', widget: 'IconButton', file: F.home, needle: 'Routes.search)', call: 'Navigator.pushNamed(Routes.search)', observed: 'Tapped search icon' },
  { from: 'home', to: 'cart', kind: 'push', label: 'Tap Cart', trigger: 'onPressed: cart icon', widget: 'IconButton', file: F.home, needle: 'Routes.cart)', call: 'Navigator.pushNamed(Routes.cart)', observed: 'Tapped cart icon' },
  { from: 'home', to: 'product', kind: 'push', label: 'Tap Product', trigger: 'ProductGrid.onProductTap', widget: 'ProductGrid', file: F.home, needle: 'Routes.product,', call: 'Navigator.pushNamed(Routes.product, arguments: product.id)', observed: 'Tapped first product card' },
  { from: 'home', to: 'profile', kind: 'tab', label: 'Profile tab', trigger: 'BottomNavigationBar.onTap (index 2)', widget: 'BottomNavigationBar', handler: '_onTabSelected', file: F.home, needle: 'Routes.profile)', call: 'Navigator.pushNamed(Routes.profile)', observed: 'Tapped Profile tab' },
  { from: 'home', to: null, kind: 'push', label: 'Tap Promo', trigger: 'PromoBanner.onTap', widget: 'InkWell', file: F.promo, needle: 'promo.route)', call: 'Navigator.pushNamed(promo.route)', unresolvedReason: 'Route name comes from Promo.route, which is provided by the backend at runtime.' },
  { from: 'search', to: 'product', kind: 'push', label: 'Tap Result', trigger: 'ListTile.onTap (search result)', widget: 'ListTile', file: F.search, needle: 'Routes.product', call: 'Navigator.pushNamed(Routes.product)' },
  { from: 'product', to: 'reviews', kind: 'modal', label: 'See reviews', trigger: 'onPressed: "See reviews"', widget: 'TextButton', file: F.product, needle: 'showModalBottomSheet', call: 'showModalBottomSheet(ReviewsSheet)' },
  { from: 'product', to: 'cart', kind: 'push', label: 'Add to cart', trigger: 'onPressed: "Add to cart"', widget: 'FilledButton', file: F.product, needle: 'Routes.cart)', call: 'Navigator.pushNamed(Routes.cart)', observed: 'Tapped "Add to cart"' },
  { from: 'cart', to: 'checkout', kind: 'push', label: 'Checkout', trigger: 'onPressed: "Checkout"', widget: 'FilledButton', file: F.cart, needle: 'Routes.checkout)', call: 'Navigator.pushNamed(Routes.checkout)', observed: 'Tapped "Checkout"' },
  { from: 'checkout', to: 'orderSuccess', kind: 'replace', label: 'Payment success', trigger: '_placeOrder() when charge succeeds', widget: 'FilledButton', handler: '_placeOrder', file: F.checkout, needle: 'Routes.orderSuccess)', call: 'Navigator.pushReplacementNamed(Routes.orderSuccess)' },
  { from: 'checkout', to: 'paymentFailed', kind: 'modal', label: 'Payment failed', trigger: '_placeOrder() when charge fails', handler: '_placeOrder', file: F.checkout, needle: 'showDialog', call: 'showDialog(PaymentFailedDialog)' },
  { from: 'orderSuccess', to: 'home', kind: 'reset', label: 'Continue', trigger: 'onPressed: "Continue shopping"', widget: 'FilledButton', file: F.orderSuccess, needle: 'Routes.home,', call: 'Navigator.pushNamedAndRemoveUntil(Routes.home)' },
  { from: 'profile', to: 'settings', kind: 'push', label: 'Tap Settings', trigger: 'ListTile.onTap "Settings"', widget: 'ListTile', file: F.profile, needle: 'Routes.settings)', call: 'Navigator.pushNamed(Routes.settings)', observed: 'Tapped "Settings"' },
  { from: 'settings', to: 'logoutDialog', kind: 'modal', label: 'Log out', trigger: 'ListTile.onTap "Log out"', widget: 'ListTile', file: F.settings, needle: 'showDialog', call: 'showDialog(LogoutDialog)' },
  { from: 'logoutDialog', to: 'login', kind: 'reset', label: 'Confirm', trigger: 'onPressed: "Log out"', widget: 'FilledButton', file: F.logout, needle: 'Routes.login,', call: 'Navigator.pushNamedAndRemoveUntil(Routes.login)' },
];

const edges: NavigationEdge[] = edgeDefs.map((def) => {
  const location = at(def.file, def.needle);
  const evidence: Evidence[] = [{ source: 'static', detail: def.call, location }];
  if (def.observed) {
    evidence.push({ source: 'runtime', detail: def.observed, observedAt: OBSERVED_AT });
  }
  return {
    id: `${def.from}->${def.to ?? 'unresolved'}:${location.line}`,
    from: def.from,
    to: def.to,
    kind: def.kind,
    trigger: { label: def.label, description: def.trigger, widget: def.widget, handler: def.handler, location },
    evidence,
    unresolvedReason: def.unresolvedReason,
  };
});

export const shopliteProject: AppProject = {
  id: 'mock-shoplite',
  name: 'ShopLite',
  framework: 'flutter',
  rootPath: '~/projects/shoplite',
  source: 'mock',
  files,
  screens,
  edges,
};
