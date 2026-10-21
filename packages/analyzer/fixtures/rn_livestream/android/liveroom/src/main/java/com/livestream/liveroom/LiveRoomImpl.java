package com.livestream.liveroom;

import android.content.Context;
import android.content.Intent;

public class LiveRoomImpl extends LiveRoom {
    private static LiveRoomImpl sInstance;
    private final Context mContext;

    private LiveRoomImpl(Context context) {
        mContext = context;
    }

    public static LiveRoomImpl sharedInstance(Context context) {
        if (sInstance == null) sInstance = new LiveRoomImpl(context);
        return sInstance;
    }

    @Override
    public void createRoom(int roomId, String name) {
        login(new LoginCallback() {
            @Override
            public void onCallback(int code) {
                Intent intent = new Intent(mContext, AnchorActivity.class);
                intent.putExtra("roomId", roomId);
                mContext.startActivity(intent);
            }
        });
    }

    @Override
    public void joinRoom(int roomId) {
        login(new LoginCallback() {
            @Override
            public void onCallback(int code) {
                Intent intent = new Intent(mContext, GuestActivity.class);
                intent.putExtra("roomId", roomId);
                mContext.startActivity(intent);
            }
        });
    }

    @Override
    public void setName(String name) {
    }

    private void login(LoginCallback callback) {
        callback.onCallback(0);
    }

    interface LoginCallback {
        void onCallback(int code);
    }
}
