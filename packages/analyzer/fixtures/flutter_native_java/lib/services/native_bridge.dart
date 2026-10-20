import 'package:flutter/services.dart';

/// Calls into the native host (MainActivity / AppDelegate).
class NativeBridge {
  static const _channel = MethodChannel('corebank/native');

  static Future<void> openScanner() => _channel.invokeMethod('openScanner');

  static Future<String?> deviceId() => _channel.invokeMethod<String>('getDeviceId');
}
