import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/native_bridge.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  static const _kyc = MethodChannel('corebank/native');

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('CoreBank')),
      body: Column(
        children: [
          SizedBox(
            height: 180,
            child: Platform.isAndroid
                ? const AndroidView(viewType: 'corebank/card-view')
                : const UiKitView(viewType: 'corebank/card-view'),
          ),
          ElevatedButton(
            onPressed: () => NativeBridge.openScanner(),
            child: const Text('Scan QR'),
          ),
          ElevatedButton(
            onPressed: () => _kyc.invokeMethod('openKyc'),
            child: const Text('Verify identity'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pushNamed(context, '/transfer'),
            child: const Text('Transfer'),
          ),
        ],
      ),
    );
  }
}
