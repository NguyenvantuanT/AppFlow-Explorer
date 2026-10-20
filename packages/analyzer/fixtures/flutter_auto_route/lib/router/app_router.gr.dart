// GENERATED CODE - DO NOT MODIFY BY HAND
// **************************************************************************
// AutoRouterGenerator
// **************************************************************************

import 'package:auto_route/auto_route.dart';

import '../pages/pages.dart';
import '../sheets/filter_sheet.dart';

class SplashRoute extends PageRouteInfo<void> {
  const SplashRoute({List<PageRouteInfo>? children}) : super(SplashRoute.name, initialChildren: children);

  static const String name = 'SplashRoute';
}

class LoginRoute extends PageRouteInfo<void> {
  const LoginRoute({List<PageRouteInfo>? children}) : super(LoginRoute.name, initialChildren: children);

  static const String name = 'LoginRoute';

  static PageInfo page = PageInfo(
    name,
    builder: (data) {
      return const LoginPage();
    },
  );
}

class MainRoute extends PageRouteInfo<void> {
  const MainRoute({List<PageRouteInfo>? children}) : super(MainRoute.name, initialChildren: children);

  static const String name = 'MainRoute';

  static PageInfo page = PageInfo(
    name,
    builder: (data) {
      return const MainPage();
    },
  );
}

class HomeRoute extends PageRouteInfo<void> {
  const HomeRoute({List<PageRouteInfo>? children}) : super(HomeRoute.name, initialChildren: children);

  static const String name = 'HomeRoute';

  static PageInfo page = PageInfo(
    name,
    builder: (data) {
      return const HomePage();
    },
  );
}

class ProfileRoute extends PageRouteInfo<void> {
  const ProfileRoute({List<PageRouteInfo>? children}) : super(ProfileRoute.name, initialChildren: children);

  static const String name = 'ProfileRoute';

  static PageInfo page = PageInfo(
    name,
    builder: (data) {
      return const ProfilePage();
    },
  );
}

class DetailRoute extends PageRouteInfo<void> {
  const DetailRoute({List<PageRouteInfo>? children}) : super(DetailRoute.name, initialChildren: children);

  static const String name = 'DetailRoute';

  static PageInfo page = PageInfo(
    name,
    builder: (data) {
      return const DetailPage();
    },
  );
}

class FilterSheetRoute extends PageRouteInfo<void> {
  const FilterSheetRoute({List<PageRouteInfo>? children}) : super(FilterSheetRoute.name, initialChildren: children);

  static const String name = 'FilterSheetRoute';

  static PageInfo page = PageInfo(
    name,
    builder: (data) {
      return const FilterSheet();
    },
  );
}

class LogoutDialogRoute extends PageRouteInfo<void> {
  const LogoutDialogRoute({List<PageRouteInfo>? children}) : super(LogoutDialogRoute.name, initialChildren: children);

  static const String name = 'LogoutDialogRoute';

  static PageInfo page = PageInfo(
    name,
    builder: (data) {
      return const LogoutDialogPage();
    },
  );
}
