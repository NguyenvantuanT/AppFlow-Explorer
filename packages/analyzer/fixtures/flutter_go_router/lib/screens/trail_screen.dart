import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

class TrailScreen extends StatelessWidget {
  const TrailScreen({super.key, required this.id});

  final String id;

  @override
  Widget build(BuildContext context) {
    final next = id == 'ridge' ? '/settings' : '/';
    return Scaffold(
      appBar: AppBar(title: Text('Trail $id')),
      body: TextButton(onPressed: () => context.go(next), child: const Text('Continue')),
    );
  }
}
