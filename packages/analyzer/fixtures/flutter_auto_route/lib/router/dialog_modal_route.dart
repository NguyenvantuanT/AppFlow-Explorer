import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';

class DialogModalRoute extends CustomRoute {
  DialogModalRoute({required super.page})
      : super(customRouteBuilder: <T>(context, child, page) => DialogRoute<T>(context: context, builder: (_) => child, settings: page));
}
