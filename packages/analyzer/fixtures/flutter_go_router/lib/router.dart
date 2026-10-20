import 'package:go_router/go_router.dart';

import 'screens/home_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/trail_screen.dart';

final appRouter = GoRouter(
  initialLocation: '/',
  routes: [
    GoRoute(
      path: '/',
      builder: (context, state) => const HomeScreen(),
      routes: [
        GoRoute(
          path: 'trails/:id',
          name: 'trail',
          builder: (context, state) => TrailScreen(id: state.pathParameters['id']!),
        ),
      ],
    ),
    GoRoute(
      path: '/settings',
      pageBuilder: (context, state) => const MaterialPage(child: SettingsScreen()),
    ),
  ],
);
