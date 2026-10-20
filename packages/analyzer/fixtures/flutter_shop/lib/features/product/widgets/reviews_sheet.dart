import 'package:flutter/material.dart';

class ReviewsSheet extends StatelessWidget {
  const ReviewsSheet({super.key});

  @override
  Widget build(BuildContext context) {
    return ListView(
      shrinkWrap: true,
      children: const [
        ListTile(title: Text('Great quality'), subtitle: Text('★★★★★')),
        ListTile(title: Text('Runs small'), subtitle: Text('★★★★☆')),
      ],
    );
  }
}
