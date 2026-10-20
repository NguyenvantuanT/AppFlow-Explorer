import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Trails'),
        actions: [
          IconButton(icon: const Icon(Icons.settings), onPressed: () => context.go('/settings')),
        ],
      ),
      body: ListView(
        children: [
          ListTile(title: const Text('Ridge loop'), onTap: () => context.goNamed('trail', pathParameters: {'id': 'ridge'})),
          ListTile(title: const Text('Lake path'), onTap: () => context.push('/trails/${trailId()}')),
          ListTile(title: const Text('Archive'), onTap: () => context.go('/archive')),
        ],
      ),
    );
  }

  String trailId() => 'lake';
}
