import 'package:flutter/material.dart';

import '../../app/routes.dart';

class OrderSuccessScreen extends StatelessWidget {
  const OrderSuccessScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.check_circle, size: 72),
            const Text('Order placed!'),
            FilledButton(
              onPressed: () => Navigator.pushNamedAndRemoveUntil(
                context,
                Routes.home,
                (_) => false,
              ),
              child: const Text('Continue shopping'),
            ),
          ],
        ),
      ),
    );
  }
}
