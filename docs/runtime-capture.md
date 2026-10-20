# Runtime capture (Flutter)

AppFlow can build a Flutter project, launch it on an Android emulator or an iOS simulator, and attach real screenshots to the screens found by static analysis. Captured screens show the screenshot on the canvas. Every other screen keeps its wireframe placeholder.

Runtime capture is opt-in. Nothing is built or launched until you confirm the exact command.

## Host requirements

| Host | Android emulators / devices | iOS simulators |
| --- | --- | --- |
| Windows | Yes | **No** — iOS simulators exist only on macOS |
| Linux | Yes | **No** |
| macOS | Yes | Yes, with Xcode and its command line tools (`xcrun simctl`) |

You need:

- **Flutter.** AppFlow uses the SDK the project is configured for, in this order:
  1. The project's FVM link `.fvm/flutter_sdk`.
  2. `fvm flutter`, when `.fvmrc` pins a version and `fvm` is on `PATH`.
  3. `flutter` on `PATH`. In this case the confirmation dialog warns you if it differs from the pinned version.
- **Android SDK** with `platform-tools` (adb) and the `emulator` package. AppFlow looks in `ANDROID_HOME`, then `ANDROID_SDK_ROOT`, then the platform's default SDK location. Create emulators in Android Studio → Device Manager.
- **A JDK** compatible with the project's Android Gradle Plugin (usually JDK 17).
- **The project's own build prerequisites.** For example, env files declared as assets (`.env.development`), Firebase config files, and signing configs for release builds. AppFlow never reads these files. The build does.

The **Run & Capture** tab lists what is missing (no Android SDK, no adb, no emulator, no Flutter) instead of failing silently.

## What runs, and when you are asked

| Action | Runs | Confirmation |
| --- | --- | --- |
| Listing devices, reading build options, detecting the Flutter version | `adb devices`, `adb shell getprop`, `emulator -list-avds`, `flutter --version` (read-only) | No |
| Starting a stopped emulator or simulator | `emulator -avd <name>` or `xcrun simctl boot <udid>` | **Yes** |
| Build and launch | `flutter run --machine -d <device> --<mode> [--flavor <flavor>] [-t <target>]` in the project folder | **Yes**, showing the exact command, folder, Flutter version, warnings and env files the build reads |
| Capturing a screenshot | `adb exec-out screencap -p`, `adb shell wm density`, `adb shell dumpsys activity activities` (or `xcrun simctl io <udid> screenshot`) | No: it only reads the screen |
| Screen detection | Reads the live widget tree through the Dart VM service of a debug session started from AppFlow | No |

Confirmations are single-use. They expire after 2 minutes and are bound to that exact command. Changing the device, mode, flavor or entry point needs a new confirmation.

Only the build modes, flavors (read from `android/app/build.gradle(.kts)`) and `lib/main*.dart` entry points that AppFlow detected can be passed. Arguments are validated against a strict character set. Commands never go through a shell except on Windows, where `flutter.bat` requires `cmd`.

## Build risks

Building and launching **executes the project's code and build scripts**: Gradle/Kotlin scripts, CocoaPods `Podfile` Ruby, build_runner output already in the repo, and the app itself. Only build projects you trust.

- The first build can download dependencies (Gradle, pub packages) and take several minutes.
- The build reads the env files and secrets the project uses. Their values are compiled into the app on the emulator. AppFlow lists them in the confirmation dialog but never reads them.
- Release builds may need signing keys. Debug mode is recommended, and screen detection only works in debug.
- Running the app may call its real backends (APIs, analytics, push registration) with whatever configuration the chosen flavor uses. Prefer a development or staging flavor.

## Capturing screens

1. Open the **Run & Capture** tab on the right panel. It appears for analyzed Flutter projects.
2. Pick an online device, or start a stopped emulator.
3. Pick mode, flavor and entry point, then choose **Build & launch…** and confirm. Build and launch logs stream into the panel. On failure, the error and the failing lines are shown and **Retry build & launch** starts a new confirmed session.
4. Capture:
   - **Capture current screen** takes a screenshot of the device. In a debug session started from AppFlow, the screen on top of the live widget tree is detected and the capture is assigned to it automatically. Otherwise choose the screen in **Assign to**, or leave the capture unassigned.
   - **Auto-capture each new screen while I navigate**: navigate in the emulator yourself. Each time a different known screen comes to the top and stays for about 1.5 s, it is captured once per session.
5. Review captures in **Coverage**. Each capture can be reassigned to another screen, unassigned or deleted. **Not captured yet** lists the discovered screens that still have no screenshot.

AppFlow does not tap through the app on its own. Reaching screens behind login, specific data or device features is up to you.

### What is stored

Captures are stored in the app's data folder (`%APPDATA%/AppFlow Explorer`, `~/Library/Application Support/AppFlow Explorer`, …), never inside the project:

```
captures/<projectId>/index.json      captures + observed transitions
captures/<projectId>/<captureId>.png
```

Each capture records:

- **Image:** size in pixels.
- **Device:** pixel ratio (density ÷ 160), id, name, OS version, resolution.
- **Build:** mode, flavor, entry point, Flutter version and command.
- **Time:** capture time.
- **Navigation state:** screens detected in the widget tree, the top screen, and the Android foreground activity.
- **Association:** auto, manual or none, with a reason.

### How captures affect the map

- A screen counts as **captured** only when a screenshot is assigned to it. Launching the app captures nothing by itself, and coverage shows "N of M discovered screens captured".
- Auto-capture records each transition from one detected screen to another. If **exactly one** edge connects those two screens, that edge gains `runtime` evidence and becomes **verified**. Ambiguous transitions verify nothing, and no edge is ever created from an observation.
- Screens that exist at runtime but were not found by static analysis cannot be detected (the detector only knows analyzed screen classes). Capture them manually and leave them unassigned, or assign them to the closest screen.

## Verifying the setup

1. **Detection.** Open the tab. Your emulator should be listed as `online`. On Windows or Linux no iOS simulator is listed, and the panel says why.
2. **Toolchain.** The **Build** section shows the Flutter version and its source. For an FVM project it should say "project FVM SDK" and match `.fvmrc`.
3. **Consent.** Choose **Build & launch…**. Nothing runs until you confirm, and the dialog shows the exact command.
4. **Launch.** Logs show `Running Gradle task 'assemble…'`, then `✔ App started`, and the status turns `running`.
5. **Capture.** Choose **Capture current screen**. The capture appears in **Coverage**, marked *auto-detected* with the screen on top, and the canvas node shows the screenshot with a *Captured* badge.
6. **Auto-capture.** Turn on auto-capture and open another screen in the emulator. A new capture appears, and if a single edge links the two screens it turns solid blue (verified).
7. **Stop.** **Stop app** ends the session (status `stopped`).

## Known limitations

- There is no automated crawling: you navigate, AppFlow captures.
- Screen detection needs a debug build started from AppFlow. Profile and release builds, or apps started elsewhere, can be captured but must be assigned by hand.
- iOS flavors assume Xcode schemes named like the Android flavors (Flutter's convention).
- One running session per project at a time.
