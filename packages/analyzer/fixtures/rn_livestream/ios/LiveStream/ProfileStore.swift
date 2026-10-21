import Foundation

class ProfileStore {
  static let shared = ProfileStore()

  func load(completion: @escaping (Bool) -> Void) {
    completion(true)
  }
}
