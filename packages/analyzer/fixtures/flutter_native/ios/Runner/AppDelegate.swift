import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    let controller = window?.rootViewController as! FlutterViewController
    let channel = FlutterMethodChannel(name: "corebank/native", binaryMessenger: controller.binaryMessenger)
    channel.setMethodCallHandler { call, result in
      switch call.method {
      case "openScanner":
        let scanner = ScannerViewController()
        controller.present(scanner, animated: true)
        result(nil)
      case "getDeviceId":
        result(UIDevice.current.identifierForVendor?.uuidString)
      default:
        result(FlutterMethodNotImplemented)
      }
    }
    registrar(forPlugin: "CardView")?.register(CardViewFactory(), withId: "corebank/card-view")
    GeneratedPluginRegistrant.register(with: self)
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
