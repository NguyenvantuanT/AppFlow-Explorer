import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';

import 'widgets/body_content.dart';

/// Route page: wraps the real screen in its providers.
@RoutePage()
class LoginPage extends StatelessWidget {
  const LoginPage({super.key});

  @override
  Widget build(BuildContext context) {
    return const _LoginPage();
  }
}

class _LoginPage extends StatefulWidget {
  const _LoginPage();

  @override
  State<_LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<_LoginPage> {
  @override
  Widget build(BuildContext context) {
    return const Scaffold(body: BodyContent());
  }
}
