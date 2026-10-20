package com.example.corebank;

import android.os.Bundle;
import android.widget.Button;
import androidx.appcompat.app.AppCompatActivity;
import io.flutter.embedding.android.FlutterActivity;

public class ScannerActivity extends AppCompatActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Button pay = new Button(this);
        pay.setOnClickListener(v -> startActivity(FlutterActivity.withNewEngine().initialRoute("/transfer").build(this)));
        setContentView(pay);
    }
}
