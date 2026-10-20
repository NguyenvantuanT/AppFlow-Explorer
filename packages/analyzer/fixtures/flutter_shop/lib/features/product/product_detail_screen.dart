import 'package:flutter/material.dart';

import '../../app/routes.dart';
import 'widgets/reviews_sheet.dart';

class ProductDetailScreen extends StatelessWidget {
  const ProductDetailScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final productId = ModalRoute.of(context)!.settings.arguments as String?;
    return Scaffold(
      appBar: AppBar(title: Text('Product $productId')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const AspectRatio(aspectRatio: 1, child: Placeholder()),
          TextButton(
            onPressed: () => showModalBottomSheet<void>(
              context: context,
              builder: (_) => const ReviewsSheet(),
            ),
            child: const Text('See reviews'),
          ),
          FilledButton(
            onPressed: () => Navigator.pushNamed(context, Routes.cart),
            child: const Text('Add to cart'),
          ),
        ],
      ),
    );
  }
}
