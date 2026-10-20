import 'package:flutter/material.dart';

class Promo {
  const Promo(this.title, this.route);
  final String title;

  /// Provided by the marketing backend at runtime.
  final String route;
}

class PromoBanner extends StatelessWidget {
  const PromoBanner({super.key, this.promo = const Promo('Summer sale', '')});

  final Promo promo;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => Navigator.pushNamed(context, promo.route),
      child: Card(child: ListTile(title: Text(promo.title))),
    );
  }
}
