package com.example.corebank

import android.content.Intent
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val CHANNEL = "corebank/native"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        flutterEngine.platformViewsController.registry.registerViewFactory("corebank/card-view", CardViewFactory())

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "openScanner" -> {
                    startActivity(Intent(this, ScannerActivity::class.java))
                    result.success(null)
                }
                "openKyc" -> {
                    openKyc()
                    result.success(null)
                }
                "getDeviceId" -> result.success("device-1")
                else -> result.notImplemented()
            }
        }
    }

    private fun openKyc() {
        val intent = Intent(this, KycActivity::class.java)
        startActivity(intent)
    }
}
