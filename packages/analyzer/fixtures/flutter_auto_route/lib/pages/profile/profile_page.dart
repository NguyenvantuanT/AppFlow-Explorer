import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';

import '../../router/app_router.gr.dart';

@RoutePage()
class ProfilePage extends StatelessWidget {
  const ProfilePage({super.key, this.next});

  final PageRouteInfo? next;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          TextButton(onPressed: () => context.router.push(const LogoutDialogRoute()), child: const Text('Log out')),
          // Destination decided at runtime.
          TextButton(onPressed: () => context.router.push(next!), child: const Text('Continue')),
          // Not declared in the router config.
          TextButton(onPressed: () => context.router.push(const SettingsRoute()), child: const Text('Settings')),
        ],
      ),
    );
  }
}

class LogoutDialogPage extends StatelessWidget {
  const LogoutDialogPage({super.key});

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Log out?'),
      actions: [TextButton(onPressed: () => context.router.replaceAll([const LoginRoute()]), child: const Text('Log out'))],
    );
  }
}
