import 'package:flutter/material.dart';

class PaymentFailedDialog extends StatelessWidget {
  const PaymentFailedDialog({super.key});

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Payment failed'),
      content: const Text('Your card was declined. Please try another card.'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('OK')),
      ],
    );
  }
}
