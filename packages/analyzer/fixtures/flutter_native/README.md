Fixture: a Flutter app whose Android (Kotlin) and iOS (Swift) hosts add their own native screens.

- `NativeBridge` (Dart) calls the `corebank/native` MethodChannel.
- `MainActivity` / `AppDelegate` handle `openScanner` and `openKyc` by opening native screens; `getDeviceId` returns data only.
- `ScannerActivity` / `ScannerViewController` open Flutter again at `/transfer`.
- `HomeScreen` embeds the `corebank/card-view` platform view.
