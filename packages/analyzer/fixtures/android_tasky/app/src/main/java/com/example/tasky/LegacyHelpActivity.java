package com.example.tasky;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Button;
import androidx.appcompat.app.AppCompatActivity;

public class LegacyHelpActivity extends AppCompatActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_legacy_help);
        Button home = findViewById(R.id.btn_home);
        home.setOnClickListener(v -> startActivity(new Intent(this, MainActivity.class)));
        Button web = findViewById(R.id.btn_web);
        web.setOnClickListener(v -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com/help"))));
    }
}
