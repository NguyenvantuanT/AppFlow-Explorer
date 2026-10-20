package com.example.corebank;

import android.content.Intent;
import androidx.annotation.NonNull;
import io.flutter.embedding.android.FlutterActivity;
import io.flutter.embedding.engine.FlutterEngine;
import io.flutter.plugin.common.MethodChannel;

public class MainActivity extends FlutterActivity {
    private static final String CHANNEL = "corebank/native";

    @Override
    public void configureFlutterEngine(@NonNull FlutterEngine flutterEngine) {
        super.configureFlutterEngine(flutterEngine);
        flutterEngine.getPlatformViewsController().getRegistry().registerViewFactory("corebank/card-view", new CardViewFactory());

        new MethodChannel(flutterEngine.getDartExecutor().getBinaryMessenger(), CHANNEL).setMethodCallHandler((call, result) -> {
            switch (call.method) {
                case "openScanner":
                    startActivity(new Intent(this, ScannerActivity.class));
                    result.success(null);
                    break;
                case "openKyc":
                    openKyc();
                    result.success(null);
                    break;
                case "getDeviceId":
                    result.success("device-1");
                    break;
                default:
                    result.notImplemented();
            }
        });
    }

    private void openKyc() {
        Intent intent = new Intent(this, KycActivity.class);
        startActivity(intent);
    }
}
