Fixture: the `flutter_native` app with its Android host written in Java instead of Kotlin (no iOS folder).

- `MainActivity.java` handles the `corebank/native` MethodChannel in a lambda with a `switch (call.method)`; `openKyc` goes through a helper method.
- `ScannerActivity.java` opens Flutter again at `/transfer`.
