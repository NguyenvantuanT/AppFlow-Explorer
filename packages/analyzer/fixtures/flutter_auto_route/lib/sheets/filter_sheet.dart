import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';

@RoutePage()
class FilterSheet extends StatelessWidget {
  const FilterSheet({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(children: [CheckboxListTile(value: true, onChanged: (_) {}, title: const Text('Open now'))]);
  }
}
