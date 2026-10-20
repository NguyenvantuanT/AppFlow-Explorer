import Flutter
import UIKit

class ScannerViewController: UIViewController {
  @objc func payTapped() {
    let flutter = FlutterViewController(project: nil, initialRoute: "/transfer", nibName: nil, bundle: nil)
    present(flutter, animated: true)
  }
}
