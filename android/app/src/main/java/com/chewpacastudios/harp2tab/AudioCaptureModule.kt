package com.chewpacastudios.harp2tab

import android.content.Context
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class AudioCaptureModule(private val reactApplicationContext: ReactApplicationContext)
    : ReactContextBaseJavaModule(reactApplicationContext) {

    companion object {
        init {
            try {
                System.loadLibrary("harp2tab-audio")
            } catch (e: UnsatisfiedLinkError) {
                android.util.Log.e("Harp2Tab", "Native library failed to load: ${e.message}")
            }
        }
    }

    private val handler = Handler(Looper.getMainLooper())
    private val isPolling = java.util.concurrent.atomic.AtomicBoolean(false)
    private val pollRunnable = object : Runnable {
        override fun run() {
            if (!isPolling.get()) return
            val params = Arguments.createMap().apply {
                putDouble("frequency", nativeGetFrequency().toDouble())
                putDouble("rms", nativeGetRms().toDouble())
            }
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("onAudioFrame", params)
            if (isPolling.get()) handler.postDelayed(this, 43L)
        }
    }

    override fun getName() = "AudioCapture"

    @ReactMethod
    fun startCapture() {
        val am = reactApplicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val sr  = am.getProperty(AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE)?.toIntOrNull() ?: 44100
        val fpb = am.getProperty(AudioManager.PROPERTY_OUTPUT_FRAMES_PER_BUFFER)?.toIntOrNull() ?: 256
        nativeSetDefaultStreamValues(sr, fpb)
        nativeStart()
        if (isPolling.compareAndSet(false, true)) {
            handler.post(pollRunnable)
        }
    }

    @ReactMethod
    fun stopCapture() {
        isPolling.set(false)
        handler.removeCallbacks(pollRunnable)
        nativeStop()
    }

    @ReactMethod
    fun setThreshold(value: Float) {
        nativeSetThreshold(value)
    }

    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    external fun nativeStart(): Boolean
    external fun nativeStop()
    external fun nativeGetFrequency(): Float
    external fun nativeGetRms(): Float
    external fun nativeSetThreshold(v: Float)
    external fun nativeSetClarity(v: Float)
    external fun nativeSetDefaultStreamValues(sr: Int, fpb: Int)
}
