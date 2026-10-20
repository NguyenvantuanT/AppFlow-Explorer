import 'package:flutter/material.dart';

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
