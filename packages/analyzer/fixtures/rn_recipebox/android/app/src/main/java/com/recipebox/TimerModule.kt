package com.recipebox

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class TimerModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "CookingTimer"

    @ReactMethod
    fun start(seconds: Int) {}
}
