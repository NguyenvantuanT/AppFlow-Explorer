import 'package:flutter/material.dart';

import 'widgets/logout_dialog.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          SwitchListTile(value: true, onChanged: (_) {}, title: const Text('Notifications')),
          ListTile(
            title: const Text('Language'),
            onTap: () => showDialog<void>(
              context: context,
              builder: (_) => const AlertDialog(title: Text('Coming soon')),
            ),
          ),
          ListTile(
            title: const Text('Log out'),
            onTap: () => showDialog<void>(
              context: context,
              builder: (_) => const LogoutDialog(),
            ),
          ),
        ],
      ),
    );
  }
}
