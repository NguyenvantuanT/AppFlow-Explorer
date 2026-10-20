import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';

import '../../../router/app_router.gr.dart';

/// Same class name as home/widgets/body_content.dart, on purpose.
class BodyContent extends StatelessWidget {
  const BodyContent({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        const TextField(decoration: InputDecoration(labelText: 'Phone number')),
        FilledButton(
          onPressed: () => context.router.replaceAll([const MainRoute()]),
          child: const Text('Sign in'),
        ),
      ],
    );
  }
}
