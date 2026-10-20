/**
 * Source files of the fictional "ShopLite" Flutter app used as Phase 1 mock data.
 * Screen and navigation locations in `project.ts` are resolved against this text,
 * so code navigation can be exercised end-to-end before real analysis exists.
 */
export const shopliteSources: Record<string, string> = {
  'pubspec.yaml': `name: shoplite
description: A small demo storefront.
version: 1.4.0+21

environment:
  sdk: ">=3.4.0 <4.0.0"

dependencies:
  flutter:
    sdk: flutter
  provider: ^6.1.2
  http: ^1.2.1

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^4.0.0

flutter:
  uses-material-design: true
  assets:
    - assets/images/
`,

  'analysis_options.yaml': `include: package:flutter_lints/flutter.yaml
`,

  'README.md': `# ShopLite

Demo storefront used to showcase AppFlow Explorer.
`,

  'lib/main.dart': `import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'app/routes.dart';
import 'services/auth_service.dart';

void main() {
  runApp(
    ChangeNotifierProvider(
      create: (_) => AuthService(),
      child: const ShopLiteApp(),
    ),
  );
}

class ShopLiteApp extends StatelessWidget {
  const ShopLiteApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'ShopLite',
      theme: ThemeData(colorSchemeSeed: Colors.deepOrange, useMaterial3: true),
      initialRoute: Routes.splash,
      routes: appRoutes,
    );
  }
}
`,

  'lib/app/routes.dart': `import 'package:flutter/material.dart';

import '../features/auth/login_screen.dart';
import '../features/auth/register_screen.dart';
import '../features/cart/cart_screen.dart';
import '../features/checkout/checkout_screen.dart';
import '../features/checkout/order_success_screen.dart';
import '../features/home/home_screen.dart';
import '../features/onboarding/onboarding_screen.dart';
import '../features/product/product_detail_screen.dart';
import '../features/profile/profile_screen.dart';
import '../features/search/search_screen.dart';
import '../features/settings/settings_screen.dart';
import '../features/splash/splash_screen.dart';

abstract final class Routes {
  static const splash = '/splash';
  static const onboarding = '/onboarding';
  static const login = '/login';
  static const register = '/register';
  static const home = '/home';
  static const search = '/search';
  static const product = '/product';
  static const cart = '/cart';
  static const checkout = '/checkout';
  static const orderSuccess = '/order-success';
  static const profile = '/profile';
  static const settings = '/settings';
}

final Map<String, WidgetBuilder> appRoutes = {
  Routes.splash: (_) => const SplashScreen(),
  Routes.onboarding: (_) => const OnboardingScreen(),
  Routes.login: (_) => const LoginScreen(),
  Routes.register: (_) => const RegisterScreen(),
  Routes.home: (_) => const HomeScreen(),
  Routes.search: (_) => const SearchScreen(),
  Routes.product: (_) => const ProductDetailScreen(),
  Routes.cart: (_) => const CartScreen(),
  Routes.checkout: (_) => const CheckoutScreen(),
  Routes.orderSuccess: (_) => const OrderSuccessScreen(),
  Routes.profile: (_) => const ProfileScreen(),
  Routes.settings: (_) => const SettingsScreen(),
};
`,

  'lib/services/auth_service.dart': `import 'package:flutter/foundation.dart';

class AuthService extends ChangeNotifier {
  bool _signedIn = false;
  bool get isSignedIn => _signedIn;

  Future<void> signIn(String email, String password) async {
    await Future<void>.delayed(const Duration(milliseconds: 400));
    _signedIn = true;
    notifyListeners();
  }

  void signOut() {
    _signedIn = false;
    notifyListeners();
  }
}
`,

  'lib/features/splash/splash_screen.dart': `import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/routes.dart';
import '../../services/auth_service.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  @override
  void initState() {
    super.initState();
    Future.delayed(const Duration(seconds: 1), _route);
  }

  void _route() {
    final auth = context.read<AuthService>();
    if (auth.isSignedIn) {
      Navigator.pushReplacementNamed(context, Routes.home);
    } else {
      Navigator.pushReplacementNamed(context, Routes.onboarding);
    }
  }

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(child: FlutterLogo(size: 96)),
    );
  }
}
`,

  'lib/features/onboarding/onboarding_screen.dart': `import 'package:flutter/material.dart';

import '../../app/routes.dart';

class OnboardingScreen extends StatelessWidget {
  const OnboardingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            const Expanded(child: _OnboardingCarousel()),
            Padding(
              padding: const EdgeInsets.all(24),
              child: FilledButton(
                onPressed: () => Navigator.pushNamed(context, Routes.login),
                child: const Text('Get started'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _OnboardingCarousel extends StatelessWidget {
  const _OnboardingCarousel();

  @override
  Widget build(BuildContext context) {
    return PageView(
      children: const [
        Center(child: Text('Discover products you love')),
        Center(child: Text('Fast checkout')),
      ],
    );
  }
}
`,

  'lib/features/auth/login_screen.dart': `import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/routes.dart';
import '../../services/auth_service.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();

  Future<void> _submit() async {
    await context.read<AuthService>().signIn(_email.text, _password.text);
    if (!mounted) return;
    Navigator.pushReplacementNamed(context, Routes.home);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sign in')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          TextField(controller: _email, decoration: const InputDecoration(labelText: 'Email')),
          TextField(
            controller: _password,
            obscureText: true,
            decoration: const InputDecoration(labelText: 'Password'),
          ),
          const SizedBox(height: 24),
          FilledButton(onPressed: _submit, child: const Text('Sign in')),
          TextButton(
            onPressed: () => Navigator.pushNamed(context, Routes.register),
            child: const Text('Create an account'),
          ),
        ],
      ),
    );
  }
}
`,

  'lib/features/auth/register_screen.dart': `import 'package:flutter/material.dart';

import '../../app/routes.dart';

class RegisterScreen extends StatelessWidget {
  const RegisterScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Create account')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const TextField(decoration: InputDecoration(labelText: 'Name')),
          const TextField(decoration: InputDecoration(labelText: 'Email')),
          const TextField(decoration: InputDecoration(labelText: 'Password')),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: () => Navigator.pushNamedAndRemoveUntil(
              context,
              Routes.home,
              (_) => false,
            ),
            child: const Text('Create account'),
          ),
        ],
      ),
    );
  }
}
`,

  'lib/features/home/home_screen.dart': `import 'package:flutter/material.dart';

import '../../app/routes.dart';
import 'widgets/product_grid.dart';
import 'widgets/promo_banner.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  void _onTabSelected(int index) {
    if (index == 2) Navigator.pushNamed(context, Routes.profile);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('ShopLite'),
        actions: [
          IconButton(
            icon: const Icon(Icons.search),
            onPressed: () => Navigator.pushNamed(context, Routes.search),
          ),
          IconButton(
            icon: const Icon(Icons.shopping_cart_outlined),
            onPressed: () => Navigator.pushNamed(context, Routes.cart),
          ),
        ],
      ),
      body: ListView(
        children: [
          const PromoBanner(),
          ProductGrid(
            onProductTap: (product) => Navigator.pushNamed(
              context,
              Routes.product,
              arguments: product.id,
            ),
          ),
        ],
      ),
      bottomNavigationBar: BottomNavigationBar(
        onTap: _onTabSelected,
        items: const [
          BottomNavigationBarItem(icon: Icon(Icons.home), label: 'Home'),
          BottomNavigationBarItem(icon: Icon(Icons.favorite_border), label: 'Saved'),
          BottomNavigationBarItem(icon: Icon(Icons.person_outline), label: 'Profile'),
        ],
      ),
    );
  }
}
`,

  'lib/features/home/widgets/promo_banner.dart': `import 'package:flutter/material.dart';

class Promo {
  const Promo(this.title, this.route);
  final String title;

  /// Provided by the marketing backend at runtime.
  final String route;
}

class PromoBanner extends StatelessWidget {
  const PromoBanner({super.key, this.promo = const Promo('Summer sale', '')});

  final Promo promo;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => Navigator.pushNamed(context, promo.route),
      child: Card(child: ListTile(title: Text(promo.title))),
    );
  }
}
`,

  'lib/features/home/widgets/product_grid.dart': `import 'package:flutter/material.dart';

class Product {
  const Product(this.id, this.name);
  final String id;
  final String name;
}

class ProductGrid extends StatelessWidget {
  const ProductGrid({super.key, required this.onProductTap});

  final ValueChanged<Product> onProductTap;

  static const _products = [Product('p1', 'Sneakers'), Product('p2', 'Backpack')];

  @override
  Widget build(BuildContext context) {
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      children: [
        for (final p in _products)
          GestureDetector(onTap: () => onProductTap(p), child: Card(child: Text(p.name))),
      ],
    );
  }
}
`,

  'lib/features/search/search_screen.dart': `import 'package:flutter/material.dart';

import '../../app/routes.dart';

class SearchScreen extends StatelessWidget {
  const SearchScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const TextField(decoration: InputDecoration(hintText: 'Search'))),
      body: ListView.builder(
        itemCount: 8,
        itemBuilder: (context, i) => ListTile(
          title: Text('Result #$i'),
          onTap: () => Navigator.pushNamed(context, Routes.product, arguments: 'p$i'),
        ),
      ),
    );
  }
}
`,

  'lib/features/product/product_detail_screen.dart': `import 'package:flutter/material.dart';

import '../../app/routes.dart';
import 'widgets/reviews_sheet.dart';

class ProductDetailScreen extends StatelessWidget {
  const ProductDetailScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final productId = ModalRoute.of(context)!.settings.arguments as String?;
    return Scaffold(
      appBar: AppBar(title: Text('Product $productId')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const AspectRatio(aspectRatio: 1, child: Placeholder()),
          TextButton(
            onPressed: () => showModalBottomSheet<void>(
              context: context,
              builder: (_) => const ReviewsSheet(),
            ),
            child: const Text('See reviews'),
          ),
          FilledButton(
            onPressed: () => Navigator.pushNamed(context, Routes.cart),
            child: const Text('Add to cart'),
          ),
        ],
      ),
    );
  }
}
`,

  'lib/features/product/widgets/reviews_sheet.dart': `import 'package:flutter/material.dart';

class ReviewsSheet extends StatelessWidget {
  const ReviewsSheet({super.key});

  @override
  Widget build(BuildContext context) {
    return ListView(
      shrinkWrap: true,
      children: const [
        ListTile(title: Text('Great quality'), subtitle: Text('★★★★★')),
        ListTile(title: Text('Runs small'), subtitle: Text('★★★★☆')),
      ],
    );
  }
}
`,

  'lib/features/cart/cart_screen.dart': `import 'package:flutter/material.dart';

import '../../app/routes.dart';

class CartScreen extends StatelessWidget {
  const CartScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Your cart')),
      body: ListView(
        children: const [
          ListTile(title: Text('Sneakers'), trailing: Text('\\$89')),
          ListTile(title: Text('Backpack'), trailing: Text('\\$45')),
        ],
      ),
      bottomNavigationBar: Padding(
        padding: const EdgeInsets.all(16),
        child: FilledButton(
          onPressed: () => Navigator.pushNamed(context, Routes.checkout),
          child: const Text('Checkout'),
        ),
      ),
    );
  }
}
`,

  'lib/features/checkout/checkout_screen.dart': `import 'package:flutter/material.dart';

import '../../app/routes.dart';
import 'widgets/payment_failed_dialog.dart';

class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({super.key});

  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  Future<bool> _charge() async => true;

  Future<void> _placeOrder() async {
    final ok = await _charge();
    if (!mounted) return;
    if (ok) {
      Navigator.pushReplacementNamed(context, Routes.orderSuccess);
    } else {
      await showDialog<void>(
        context: context,
        builder: (_) => const PaymentFailedDialog(),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Checkout')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: const [
          TextField(decoration: InputDecoration(labelText: 'Shipping address')),
          TextField(decoration: InputDecoration(labelText: 'Card number')),
        ],
      ),
      bottomNavigationBar: Padding(
        padding: const EdgeInsets.all(16),
        child: FilledButton(onPressed: _placeOrder, child: const Text('Place order')),
      ),
    );
  }
}
`,

  'lib/features/checkout/widgets/payment_failed_dialog.dart': `import 'package:flutter/material.dart';

class PaymentFailedDialog extends StatelessWidget {
  const PaymentFailedDialog({super.key});

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Payment failed'),
      content: const Text('Your card was declined. Please try another card.'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('OK')),
      ],
    );
  }
}
`,

  'lib/features/checkout/order_success_screen.dart': `import 'package:flutter/material.dart';

import '../../app/routes.dart';

class OrderSuccessScreen extends StatelessWidget {
  const OrderSuccessScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.check_circle, size: 72),
            const Text('Order placed!'),
            FilledButton(
              onPressed: () => Navigator.pushNamedAndRemoveUntil(
                context,
                Routes.home,
                (_) => false,
              ),
              child: const Text('Continue shopping'),
            ),
          ],
        ),
      ),
    );
  }
}
`,

  'lib/features/profile/profile_screen.dart': `import 'package:flutter/material.dart';

import '../../app/routes.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(
        children: [
          const ListTile(leading: CircleAvatar(), title: Text('Alex Morgan')),
          const ListTile(title: Text('Order history')),
          ListTile(
            title: const Text('Settings'),
            onTap: () => Navigator.pushNamed(context, Routes.settings),
          ),
        ],
      ),
    );
  }
}
`,

  'lib/features/settings/settings_screen.dart': `import 'package:flutter/material.dart';

import 'widgets/logout_dialog.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          SwitchListTile(value: true, onChanged: (_) {}, title: const Text('Notifications')),
          const ListTile(title: Text('Language')),
          ListTile(
            title: const Text('Log out'),
            onTap: () => showDialog<void>(
              context: context,
              builder: (_) => const LogoutDialog(),
            ),
          ),
        ],
      ),
    );
  }
}
`,

  'lib/features/settings/widgets/logout_dialog.dart': `import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/routes.dart';
import '../../../services/auth_service.dart';

class LogoutDialog extends StatelessWidget {
  const LogoutDialog({super.key});

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Log out?'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        FilledButton(
          onPressed: () {
            context.read<AuthService>().signOut();
            Navigator.pushNamedAndRemoveUntil(context, Routes.login, (_) => false);
          },
          child: const Text('Log out'),
        ),
      ],
    );
  }
}
`,

  'test/widget_test.dart': `import 'package:flutter_test/flutter_test.dart';
import 'package:shoplite/main.dart';

void main() {
  testWidgets('app boots', (tester) async {
    await tester.pumpWidget(const ShopLiteApp());
  });
}
`,
};

/** Binary assets listed in the tree without content. */
export const shopliteAssets = ['assets/images/logo.png', 'assets/images/hero.png'];
