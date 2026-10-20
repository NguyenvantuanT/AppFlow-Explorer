import 'package:flutter/material.dart';

import '../../app/routes.dart';
import 'widgets/payment_failed_dialog.dart';

class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({super.key});

  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  Future<bool> _charge() async => true;

  Future<void> _placeOrder() async {
    final ok = await _charge();
    if (!mounted) return;
    if (ok) {
      Navigator.pushReplacementNamed(context, Routes.orderSuccess);
    } else {
      await showDialog<void>(
        context: context,
        builder: (_) => const PaymentFailedDialog(),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Checkout')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: const [
          TextField(decoration: InputDecoration(labelText: 'Shipping address')),
          TextField(decoration: InputDecoration(labelText: 'Card number')),
        ],
      ),
      bottomNavigationBar: Padding(
        padding: const EdgeInsets.all(16),
        child: FilledButton(onPressed: _placeOrder, child: const Text('Place order')),
      ),
    );
  }
}
