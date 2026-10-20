import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';

import '../pages/pages.dart';
import 'app_router.gr.dart';
import 'dialog_modal_route.dart';

@AutoRouterConfig(replaceInRouteName: 'Screen|Page,Route')
class AppRouter extends RootStackRouter {
  @override
  List<AutoRoute> get routes => [
        AutoRoute(path: '/splash', page: splashRoutePage, initial: true),
        AutoRoute(path: '/login', page: LoginRoute.page),
        AutoRoute(
          path: '/main',
          page: MainRoute.page,
          children: [
            AutoRoute(path: 'home', page: HomeRoute.page),
            AutoRoute(path: 'profile', page: ProfileRoute.page),
          ],
        ),
        AutoRoute(path: '/detail', page: DetailRoute.page),
        CustomRoute(page: FilterSheetRoute.page, customRouteBuilder: modalSheetBuilder),
        DialogModalRoute(page: LogoutDialogRoute.page),
      ];

  PageInfo get splashRoutePage => PageInfo(
        SplashRoute.name,
        builder: (data) => SplashPage(
          onToLogin: () {
            replace(LoginRoute());
          },
          onToHome: () {
            pushAndPopUntil(MainRoute(), predicate: (_) => false);
          },
        ),
      );
}

Route<T> modalSheetBuilder<T>(BuildContext context, Widget child, AutoRoutePage<T> page) {
  return ModalBottomSheetRoute(builder: (_) => child, settings: page, isScrollControlled: true);
}
