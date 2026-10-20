import Flutter
import UIKit

class CardViewFactory: NSObject, FlutterPlatformViewFactory {
  func create(withFrame frame: CGRect, viewIdentifier viewId: Int64, arguments args: Any?) -> FlutterPlatformView {
    return CardPlatformView(frame: frame)
  }
}
