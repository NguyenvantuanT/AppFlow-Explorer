import 'package:flutter/material.dart';
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
      onUnknownRoute: (settings) => MaterialPageRoute(builder: (_) => const NotFoundScreen()),
    );
  }
}

class NotFoundScreen extends StatelessWidget {
  const NotFoundScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(body: Center(child: Text('Page not found')));
  }
}
