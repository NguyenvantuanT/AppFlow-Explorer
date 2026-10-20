package com.example.tasky.profile

import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.dialog
import androidx.navigation.compose.rememberNavController

object ProfileRoutes {
    const val OVERVIEW = "profile/overview"
    const val EDIT = "profile/edit"
}

@Composable
fun ProfileNavHost() {
    val nav = rememberNavController()
    NavHost(nav, startDestination = ProfileRoutes.OVERVIEW) {
        composable(ProfileRoutes.OVERVIEW) {
            ProfileOverviewScreen(
                onEdit = { nav.navigate(ProfileRoutes.EDIT) },
                onBadge = { badgeId -> nav.navigate("profile/badge/$badgeId") },
                onSignOut = { nav.navigate("profile/sign-out") },
                onHelp = { nav.navigate(helpRoute()) },
            )
        }
        composable(ProfileRoutes.EDIT) { EditProfileScreen(onDone = { nav.popBackStack() }) }
        composable("profile/badge/{badgeId}") { BadgeScreen() }
        dialog("profile/sign-out") { SignOutDialog() }
    }
}

private fun helpRoute(): String = "profile/help"
