package com.livestream;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.livestream.liveroom.LiveRoom;

public class LiveModule extends ReactContextBaseJavaModule {
    private LiveRoom mRoom;

    public LiveModule(ReactApplicationContext context) {
        super(context);
        mRoom = LiveRoom.sharedInstance(context);
    }

    @Override
    public String getName() {
        return "LiveModule";
    }

    @ReactMethod
    public void startStream(int roomId, String name) {
        loginIfNeed(new Callback() {
            @Override
            public void onSuccess() {
                mRoom.createRoom(roomId, name);
            }
        });
    }

    @ReactMethod
    public void joinStream(int roomId) {
        loginIfNeed(new Callback() {
            @Override
            public void onSuccess() {
                mRoom.joinRoom(roomId);
            }
        });
    }

    @ReactMethod
    public void setProfile(String name) {
        mRoom.setName(name);
    }

    private void loginIfNeed(Callback callback) {
        callback.onSuccess();
    }

    interface Callback {
        void onSuccess();
    }
}
