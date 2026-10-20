import 'package:flutter/material.dart';

import '../../app/routes.dart';

class RegisterScreen extends StatelessWidget {
  const RegisterScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Create account')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const TextField(decoration: InputDecoration(labelText: 'Name')),
          const TextField(decoration: InputDecoration(labelText: 'Email')),
          const TextField(decoration: InputDecoration(labelText: 'Password')),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: () => Navigator.pushNamedAndRemoveUntil(
              context,
              Routes.home,
              (_) => false,
            ),
            child: const Text('Create account'),
          ),
        ],
      ),
    );
  }
}
