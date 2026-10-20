import 'package:go_router/go_router.dart';

import 'screens/article_screen.dart';
import 'screens/feed_screen.dart';
import 'screens/login_screen.dart';
import 'screens/settings_screen.dart';
import 'services/auth_service.dart';

final appRouter = GoRouter(
  initialLocation: '/',
  redirect: (context, state) => AuthService.instance.isLoggedIn ? null : '/login',
  routes: [
    GoRoute(
      path: '/',
      builder: (context, state) => const FeedScreen(),
      routes: [
        GoRoute(
          path: 'articles/:id',
          name: 'article',
          builder: (context, state) => ArticleScreen(id: state.pathParameters['id']!),
        ),
      ],
    ),
    GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
    GoRoute(path: '/settings', builder: (context, state) => const SettingsScreen()),
  ],
);
