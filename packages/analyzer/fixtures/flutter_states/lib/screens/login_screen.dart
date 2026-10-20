import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../services/auth_service.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  bool _isSubmitting = false;
  String? _error;

  Future<void> _submit() async {
    setState(() => _isSubmitting = true);
    try {
      await AuthService.instance.signIn('reader@example.com', 'secret');
      if (mounted) context.go('/');
    } catch (e) {
      setState(() => _error = 'Sign-in failed');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          if (_error != null) Text(_error!),
          ElevatedButton(onPressed: _submit, child: const Text('Sign in')),
        ],
      ),
    );
  }
}
