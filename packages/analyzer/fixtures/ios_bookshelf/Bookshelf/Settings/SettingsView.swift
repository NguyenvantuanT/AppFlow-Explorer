import SwiftUI

struct SettingsView: View {
    @State private var showSignOut = false

    var body: some View {
        List {
            SettingsRow(title: "Reading goal")
            NavigationLink(destination: AboutView()) {
                Text("About")
            }
            NavigationLink("Licenses") {
                LicensesView()
            }
            Toggle("Night mode", isOn: .constant(true))
            Button("Sign out") {
                showSignOut = true
            }
        }
        .navigationTitle("Settings")
        .sheet(isPresented: $showSignOut) {
            SignOutSheet()
        }
    }
}

struct SettingsRow: View {
    let title: String

    var body: some View {
        HStack {
            Image("BookCover")
            Text(title)
        }
    }
}

struct AboutView: View {
    var body: some View {
        Text("Bookshelf 2.0")
    }
}

struct LicensesView: View {
    var body: some View {
        Text("Licenses")
    }
}

struct SignOutSheet: View {
    var body: some View {
        Button("Confirm sign out") {}
    }
}
