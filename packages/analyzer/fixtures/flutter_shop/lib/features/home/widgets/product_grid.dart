import 'package:flutter/material.dart';

class Product {
  const Product(this.id, this.name);
  final String id;
  final String name;
}

class ProductGrid extends StatelessWidget {
  const ProductGrid({super.key, required this.onProductTap});

  final ValueChanged<Product> onProductTap;

  static const _products = [Product('p1', 'Sneakers'), Product('p2', 'Backpack')];

  @override
  Widget build(BuildContext context) {
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      children: [
        for (final p in _products)
          GestureDetector(onTap: () => onProductTap(p), child: Card(child: Text(p.name))),
      ],
    );
  }
}
