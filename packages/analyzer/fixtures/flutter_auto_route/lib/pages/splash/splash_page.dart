import 'package:flutter/material.dart';

class SplashPage extends StatelessWidget {
  const SplashPage({super.key, required this.onToLogin, required this.onToHome});

  final VoidCallback onToLogin;
  final VoidCallback onToHome;

  @override
  Widget build(BuildContext context) {
    return const Scaffold(body: Center(child: CircularProgressIndicator()));
  }
}
