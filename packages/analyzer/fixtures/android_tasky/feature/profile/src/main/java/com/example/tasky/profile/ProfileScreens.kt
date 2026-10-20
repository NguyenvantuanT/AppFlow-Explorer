package com.example.tasky.profile

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable

@Composable
fun ProfileOverviewScreen(onEdit: () -> Unit, onBadge: (String) -> Unit, onSignOut: () -> Unit, onHelp: () -> Unit) {
    Column {
        Text("Profile")
        Button(onClick = onEdit) { Text("Edit profile") }
        Button(onClick = { onBadge("streak") }) { Text("Streak badge") }
        Button(onClick = onSignOut) { Text("Sign out") }
        Button(onClick = onHelp) { Text("Help") }
    }
}

@Composable
fun EditProfileScreen(onDone: () -> Unit) {
    Column {
        TextField(value = "", onValueChange = {}, label = { Text("Name") })
        Button(onClick = onDone) { Text("Save") }
    }
}

@Composable
fun BadgeScreen() {
    Text("Badge")
}

@Composable
fun SignOutDialog() {
    Text("Sign out?")
}
