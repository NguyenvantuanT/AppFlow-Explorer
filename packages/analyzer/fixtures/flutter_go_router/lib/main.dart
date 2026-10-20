import 'package:flutter/material.dart';

import 'router.dart';

void main() => runApp(const TrailNotesApp());

class TrailNotesApp extends StatelessWidget {
  const TrailNotesApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(routerConfig: appRouter);
  }
}
