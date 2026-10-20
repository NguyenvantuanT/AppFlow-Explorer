import 'package:flutter/material.dart';

import 'screens/home_screen.dart';
import 'screens/transfer_screen.dart';

void main() => runApp(const CoreBankApp());

class CoreBankApp extends StatelessWidget {
  const CoreBankApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'CoreBank',
      initialRoute: '/',
      routes: {
        '/': (context) => const HomeScreen(),
        '/transfer': (context) => const TransferScreen(),
      },
    );
  }
}
