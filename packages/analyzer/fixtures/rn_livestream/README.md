# rn_livestream

React Native app whose live-stream screens are native code in an Android library module and an iOS folder, reached through several calls:

- Screens imported through the `@/` alias (tsconfig `paths`) and barrel files (`export { default as X } from`, `export *`).
- A hook imported through a Babel `module-resolver` alias calls the native module, destructured from `NativeModules` inside a function.
- Android: `@ReactMethod` → callback → field of an abstract class (`mRoom.createRoom`) → its implementation in `:liveroom` → `Intent` in a callback. Both callbacks name their variable `intent`.
- iOS: Swift module (`RCT_EXTERN_MODULE`) → helpers inside closures → `LiveRoomKit.shared.createRoom` → creates a view controller and presents it.
