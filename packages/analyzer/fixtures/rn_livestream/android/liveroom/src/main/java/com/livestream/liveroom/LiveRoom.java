package com.livestream.liveroom;

import android.content.Context;

public abstract class LiveRoom {
    public static LiveRoom sharedInstance(Context context) {
        return LiveRoomImpl.sharedInstance(context);
    }

    public abstract void createRoom(int roomId, String name);

    public abstract void joinRoom(int roomId);

    public abstract void setName(String name);
}
