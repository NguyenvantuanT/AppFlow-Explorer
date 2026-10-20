package com.example.corebank;

import android.content.Context;
import io.flutter.plugin.common.StandardMessageCodec;
import io.flutter.plugin.platform.PlatformView;
import io.flutter.plugin.platform.PlatformViewFactory;

public class CardViewFactory extends PlatformViewFactory {
    public CardViewFactory() {
        super(StandardMessageCodec.INSTANCE);
    }

    @Override
    public PlatformView create(Context context, int viewId, Object args) {
        return new CardView(context);
    }
}
