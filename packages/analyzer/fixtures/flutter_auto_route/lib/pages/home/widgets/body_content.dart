import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';

import '../../../router/app_router.gr.dart';
import 'offer_card.dart';

/// Same class name as login/widgets/body_content.dart, on purpose.
class BodyContent extends StatelessWidget {
  const BodyContent({super.key});

  @override
  Widget build(BuildContext context) {
    final points = 1250;
    return ListView(
      children: [
        Text('${(points ~/ 100).toString().padLeft(2, '0')} points'),
        IconButton(icon: const Icon(Icons.tune), onPressed: () => context.router.push(const FilterSheetRoute())),
        const OfferCard(),
      ],
    );
  }
}
