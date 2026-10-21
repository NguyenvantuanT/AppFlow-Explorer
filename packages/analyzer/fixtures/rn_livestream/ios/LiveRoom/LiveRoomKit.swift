import UIKit

public class LiveRoomKit: NSObject {
  public static let shared = LiveRoomKit()

  public func createRoom(roomId: Int, name: String) {
    let vc = AnchorViewController(roomId: roomId)
    presentRoom(vc: vc)
  }

  public func joinRoom(roomId: Int) {
    let vc = GuestViewController(roomId: roomId)
    presentRoom(vc: vc)
  }

  private func presentRoom(vc: UIViewController) {
    UIApplication.shared.keyWindow?.rootViewController?.present(vc, animated: true)
  }
}
