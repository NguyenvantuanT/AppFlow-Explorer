import 'package:flutter/material.dart';

import '../../app/routes.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(
        children: [
          const ListTile(leading: CircleAvatar(), title: Text('Alex Morgan')),
          ListTile(
            title: const Text('Order history'),
            // Not declared in appRoutes: reported as a missing target.
            onTap: () => Navigator.pushNamed(context, '/orders'),
          ),
          ListTile(
            title: const Text('Settings'),
            onTap: () => Navigator.pushNamed(context, Routes.settings),
          ),
        ],
      ),
    );
  }
}
