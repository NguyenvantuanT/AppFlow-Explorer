package com.recipebox;

import android.app.Activity;
import android.content.Intent;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

public class PaymentsModule extends ReactContextBaseJavaModule {
    public static final String NAME = "Payments";

    PaymentsModule(ReactApplicationContext context) {
        super(context);
    }

    @Override
    public String getName() {
        return NAME;
    }

    @ReactMethod
    public void openCheckout(String recipeId) {
        Activity activity = getCurrentActivity();
        Intent intent = new Intent(activity, CheckoutActivity.class);
        intent.putExtra("recipeId", recipeId);
        activity.startActivity(intent);
    }
}
