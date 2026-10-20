package com.example.corebank

import android.os.Bundle
import android.widget.Button
import androidx.appcompat.app.AppCompatActivity
import io.flutter.embedding.android.FlutterActivity

class ScannerActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pay = Button(this)
        pay.setOnClickListener {
            startActivity(FlutterActivity.withNewEngine().initialRoute("/transfer").build(this))
        }
        setContentView(pay)
    }
}
