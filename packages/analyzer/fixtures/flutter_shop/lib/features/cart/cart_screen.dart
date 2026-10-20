import 'package:flutter/material.dart';
import 'package:ui_kit/widgets/primary_button.dart';

import '../../app/routes.dart';

class CartScreen extends StatelessWidget {
  const CartScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Your cart')),
      body: ListView(
        children: const [
          ListTile(title: Text('Sneakers'), trailing: Text('\$89')),
          ListTile(title: Text('Backpack'), trailing: Text('\$45')),
        ],
      ),
      bottomNavigationBar: Padding(
        padding: const EdgeInsets.all(16),
        child: PrimaryButton(
          label: 'Checkout',
          onPressed: () => Navigator.pushNamed(context, Routes.checkout),
        ),
      ),
    );
  }
}
