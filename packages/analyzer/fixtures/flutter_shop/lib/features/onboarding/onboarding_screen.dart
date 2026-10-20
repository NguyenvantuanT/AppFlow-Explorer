import 'package:flutter/material.dart';

import '../../app/routes.dart';

class OnboardingScreen extends StatelessWidget {
  const OnboardingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            const Expanded(child: _OnboardingCarousel()),
            Padding(
              padding: const EdgeInsets.all(24),
              child: FilledButton(
                onPressed: () => Navigator.pushNamed(context, Routes.login),
                child: const Text('Get started'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _OnboardingCarousel extends StatelessWidget {
  const _OnboardingCarousel();

  @override
  Widget build(BuildContext context) {
    return PageView(
      children: const [
        Center(child: Text('Discover products you love')),
        Center(child: Text('Fast checkout')),
      ],
    );
  }
}
