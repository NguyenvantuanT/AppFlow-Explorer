import 'package:flutter/material.dart';

import 'router.dart';

void main() => runApp(const NewsReaderApp());

class NewsReaderApp extends StatelessWidget {
  const NewsReaderApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(routerConfig: appRouter);
  }
}
