import Foundation

@objc(LiveManager)
class LiveManager: NSObject {
  @objc func startStream(_ roomId: Int, name: String) {
    requestRoom(roomId: roomId, name: name)
  }

  @objc func joinStream(_ roomId: Int) {
    DispatchQueue.main.async {
      LiveRoomKit.shared.joinRoom(roomId: roomId)
    }
  }

  private func requestRoom(roomId: Int, name: String) {
    ProfileStore.shared.load { [weak self] success in
      if success {
        self?.openRoom(roomId: roomId, name: name)
      }
    }
  }

  private func openRoom(roomId: Int, name: String) {
    LiveRoomKit.shared.createRoom(roomId: roomId, name: name)
  }
}
