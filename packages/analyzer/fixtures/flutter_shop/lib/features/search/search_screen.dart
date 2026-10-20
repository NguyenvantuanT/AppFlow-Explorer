import 'package:flutter/material.dart';

import '../product/product_detail_screen.dart';

class SearchScreen extends StatelessWidget {
  const SearchScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const TextField(decoration: InputDecoration(hintText: 'Search'))),
      body: ListView.builder(
        itemCount: 8,
        itemBuilder: (context, i) => ListTile(
          title: Text('Result #$i'),
          onTap: () => Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => const ProductDetailScreen()),
          ),
        ),
      ),
    );
  }
}
