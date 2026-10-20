import SwiftUI

final class SettingsHostingController: UIHostingController<SettingsView> {
    init() {
        super.init(rootView: SettingsView())
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}
