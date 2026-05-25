#include <jni.h>
#include <oboe/Oboe.h>
#include <android/log.h>
#include <atomic>
#include <memory>
#include <cmath>
#include <cstring>
#include <algorithm>
#include <limits>
#include <thread>
#include <chrono>

#define LOG_TAG "Harp2Tab"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  LOG_TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN,  LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

static constexpr int RING_SIZE = 8192;
static constexpr int RING_MASK = RING_SIZE - 1;

// ── Lock-free SPSC ring buffer ────────────────────────────────────────────────
// Single producer (audio callback thread) / single consumer (processing thread).
// No mutex — the Oboe FullGuide explicitly forbids mutexes inside onAudioReady
// because they can cause priority inversion on the high-priority callback thread.

class LockFreeRingBuffer {
public:
    void reset() {
        mWritePos.store(0, std::memory_order_relaxed);
        mReadPos.store(0,  std::memory_order_relaxed);
    }

    // Called from audio callback thread only.
    void write(const float* src, int count) {
        int wp = mWritePos.load(std::memory_order_relaxed);
        int rp = mReadPos.load(std::memory_order_acquire);
        for (int i = 0; i < count; i++) {
            int nextWp = (wp + 1) & RING_MASK;
            if (nextWp == rp) break; // full — drop remaining rather than blocking
            mBuf[wp] = src[i];
            wp = nextWp;
        }
        mWritePos.store(wp, std::memory_order_release);
    }

    // Called from processing thread only.
    bool read(float* dst, int count) {
        int rp = mReadPos.load(std::memory_order_relaxed);
        int wp = mWritePos.load(std::memory_order_acquire);
        int available = (wp - rp + RING_SIZE) & RING_MASK;
        if (available < count) return false;
        for (int i = 0; i < count; i++) {
            dst[i] = mBuf[rp];
            rp = (rp + 1) & RING_MASK;
        }
        mReadPos.store(rp, std::memory_order_release);
        return true;
    }

private:
    float            mBuf[RING_SIZE] = {};
    std::atomic<int> mWritePos{0};
    std::atomic<int> mReadPos{0};
};

// ── MPM Pitch Detector ────────────────────────────────────────────────────────

class MPMPitchDetector {
public:
    static constexpr int   WINDOW_SIZE = 2048;
    static constexpr int   W           = WINDOW_SIZE / 2;
    static constexpr int   MAX_MAXIMA  = 32;
    static constexpr float FREQ_MIN    = 180.0f;
    static constexpr float FREQ_MAX    = 3200.0f;

    float lastGlobalNsdfMax = 0.0f;

    float estimate(float* samples, int sampleRate, float clarity, float nsdfFloor) {
        for (int i = 0; i < WINDOW_SIZE; i++) _buf[i] = samples[i];

        // Pass 1: NSDF n'(τ) for τ = 0..W
        float mRunning = 0.0f;
        for (int j = 0; j < WINDOW_SIZE; j++) mRunning += _buf[j] * _buf[j];
        mRunning *= 2.0f;

        for (int tau = 0; tau <= W; tau++) {
            if (tau > 0) {
                float dL = _buf[tau - 1];
                float dR = _buf[WINDOW_SIZE - tau];
                mRunning -= dL * dL + dR * dR;
            }
            if (mRunning <= 0.0f) { _nsdf[tau] = 0.0f; continue; }
            float r = 0.0f;
            int   len = WINDOW_SIZE - tau;
            for (int j = 0; j < len; j++) r += _buf[j] * _buf[j + tau];
            _nsdf[tau] = 2.0f * r / mRunning;
        }

        // Pass 2: Key maxima inside positive-NSDF regions
        int tauMin = std::max(1,     (int)std::round((float)sampleRate / FREQ_MAX));
        int tauMax = std::min(W - 1, (int)std::round((float)sampleRate / FREQ_MIN));

        int   kmCount  = 0;
        float globalMax = -std::numeric_limits<float>::infinity();
        bool  inPositiveRegion = false;
        float regionMax = -std::numeric_limits<float>::infinity();
        int   regionMaxTau = -1;

        for (int tau = tauMin; tau <= tauMax && kmCount < MAX_MAXIMA; tau++) {
            float val = _nsdf[tau];
            if (!inPositiveRegion) {
                if (val > 0.0f) {
                    inPositiveRegion = true;
                    regionMax = val; regionMaxTau = tau;
                }
            } else {
                if (val > regionMax) { regionMax = val; regionMaxTau = tau; }
                bool end = (val <= 0.0f) || (tau == tauMax);
                if (end) {
                    if (regionMaxTau > tauMin && regionMaxTau < tauMax) {
                        _kmTau[kmCount] = regionMaxTau;
                        _kmVal[kmCount] = regionMax;
                        kmCount++;
                    }
                    if (regionMax > globalMax) globalMax = regionMax;
                    inPositiveRegion = false;
                    regionMax = -std::numeric_limits<float>::infinity();
                    regionMaxTau = -1;
                }
            }
        }

        lastGlobalNsdfMax = (globalMax > 0.0f) ? globalMax : 0.0f;
        if (kmCount == 0 || globalMax <= 0.0f) return NAN;
        if (globalMax < nsdfFloor) return NAN;

        // Select best key maximum (first ≥ clarity × globalMax)
        float threshold = clarity * globalMax;
        int bestTau = -1;
        for (int k = 0; k < kmCount; k++) {
            if (_kmVal[k] >= threshold) { bestTau = _kmTau[k]; break; }
        }
        if (bestTau < 0) return NAN;

        // Half-period correction (octave-down guard)
        int halfTau = (int)std::round(bestTau / 2.0f);
        if (halfTau >= tauMin && halfTau <= tauMax && _nsdf[halfTau] > nsdfFloor)
            bestTau = halfTau;

        // Parabolic interpolation
        float tInterp = (float)bestTau;
        if (bestTau > 0 && bestTau < W) {
            float s0    = _nsdf[bestTau - 1];
            float s1    = _nsdf[bestTau];
            float s2    = _nsdf[bestTau + 1];
            float denom = 2.0f * (2.0f * s1 - s0 - s2);
            if (std::abs(denom) > 1e-9f)
                tInterp = (float)bestTau + (s2 - s0) / denom;
        }

        if (tInterp <= 0.0f) return NAN;
        float freq = (float)sampleRate / tInterp;
        if (freq < FREQ_MIN || freq > FREQ_MAX) return NAN;
        return freq;
    }

private:
    float _buf[WINDOW_SIZE]  = {};
    float _nsdf[W + 1]       = {};
    int   _kmTau[MAX_MAXIMA] = {};
    float _kmVal[MAX_MAXIMA] = {};
};

// ── Audio engine ──────────────────────────────────────────────────────────────

class HarpHeroEngine
    : public oboe::AudioStreamDataCallback
    , public oboe::AudioStreamErrorCallback {
public:
    bool start() {
        if (mRecording.load()) {
            LOGW("start() called while already recording — ignored");
            return true;
        }
        mRing.reset();
        if (!openAndStartStream()) return false;
        mProcessingActive.store(true);
        mProcessingThread = std::thread(&HarpHeroEngine::processingLoop, this);
        return true;
    }

    void stop() {
        mProcessingActive.store(false);
        if (mProcessingThread.joinable()) mProcessingThread.join();
        if (mStream) {
            mStream->stop();
            mStream->close();
            mStream.reset();
        }
        mRecording.store(false);
        mCurrentFrequency.store(std::numeric_limits<float>::quiet_NaN());
        mCurrentNsdf.store(0.0f);
        mCurrentRms.store(0.0f);
        LOGI("Recording stopped");
    }

    float getCurrentFrequency() const { return mCurrentFrequency.load(std::memory_order_relaxed); }
    float getCurrentRms()       const { return mCurrentRms.load(std::memory_order_relaxed); }

    void setDetectionThreshold(float v) { mDetectionThreshold.store(v, std::memory_order_relaxed); }
    void setClarity(float v)            { mClarity.store(v, std::memory_order_relaxed); }

    oboe::DataCallbackResult onAudioReady(
            oboe::AudioStream* /*stream*/,
            void* audioData,
            int32_t numFrames) override {
        mRing.write(static_cast<float*>(audioData), numFrames);
        return oboe::DataCallbackResult::Continue;
    }

    void onErrorAfterClose(oboe::AudioStream* /*stream*/,
                            oboe::Result error) override {
        LOGE("Stream error after close: %s — restarting", oboe::convertToText(error));
        mRecording.store(false);
        mRing.reset();
        openAndStartStream();
    }

private:
    std::shared_ptr<oboe::AudioStream> mStream;
    LockFreeRingBuffer                 mRing;
    MPMPitchDetector                   mMpm;
    std::thread                        mProcessingThread;
    std::atomic<bool>                  mRecording{false};
    std::atomic<bool>                  mProcessingActive{false};
    int                                mSampleRate{48000};

    std::atomic<float> mCurrentFrequency{std::numeric_limits<float>::quiet_NaN()};
    std::atomic<float> mCurrentNsdf{0.0f};
    std::atomic<float> mCurrentRms{0.0f};

    std::atomic<float> mDetectionThreshold{0.0f};
    std::atomic<float> mClarity{0.93f};
    std::atomic<float> mNsdfFloor{0.75f};

    void processingLoop() {
        float window[MPMPitchDetector::WINDOW_SIZE];
        static constexpr int DIAG_INTERVAL = 47; // log every ~2 seconds at 48kHz
        int diagCount = 0;

        while (mProcessingActive.load(std::memory_order_relaxed)) {
            if (!mRing.read(window, MPMPitchDetector::WINDOW_SIZE)) {
                std::this_thread::sleep_for(std::chrono::milliseconds(5));
                continue;
            }

            float sumSq = 0.0f;
            for (int i = 0; i < MPMPitchDetector::WINDOW_SIZE; i++)
                sumSq += window[i] * window[i];
            float rms = std::sqrt(sumSq / MPMPitchDetector::WINDOW_SIZE);
            mCurrentRms.store(rms, std::memory_order_relaxed);

            float threshold = mDetectionThreshold.load(std::memory_order_relaxed);
            if (rms < threshold) {
                mCurrentFrequency.store(std::numeric_limits<float>::quiet_NaN(),
                                        std::memory_order_relaxed);
                mCurrentNsdf.store(0.0f, std::memory_order_relaxed);
                continue;
            }

            float clarity   = mClarity.load(std::memory_order_relaxed);
            float nsdfFloor = mNsdfFloor.load(std::memory_order_relaxed);
            float freq      = mMpm.estimate(window, mSampleRate, clarity, nsdfFloor);

            mCurrentFrequency.store(freq, std::memory_order_relaxed);
            mCurrentNsdf.store(mMpm.lastGlobalNsdfMax, std::memory_order_relaxed);

            if (++diagCount >= DIAG_INTERVAL) {
                diagCount = 0;
                float dBFS = (rms > 0.0f) ? (20.0f * std::log10(rms)) : -999.0f;
                LOGI("[Diag] freq=%.2f rms=%.5f (%.1f dBFS) nsdf=%.3f",
                     freq, rms, dBFS, mMpm.lastGlobalNsdfMax);
            }
        }
    }

    bool openAndStartStream() {
        oboe::Result result = tryOpen(oboe::InputPreset::Unprocessed);
        if (result != oboe::Result::OK) {
            LOGW("Unprocessed preset failed (%s) — falling back to VoiceRecognition",
                 oboe::convertToText(result));
            result = tryOpen(oboe::InputPreset::VoiceRecognition);
        }
        if (result != oboe::Result::OK) {
            LOGE("Failed to open audio stream: %s", oboe::convertToText(result));
            return false;
        }

        result = mStream->start();
        if (result != oboe::Result::OK) {
            LOGE("Failed to start audio stream: %s", oboe::convertToText(result));
            mStream->close();
            mStream.reset();
            return false;
        }

        mSampleRate = mStream->getSampleRate();
        LOGI("[Diag] Recording started | preset=%s | sampleRate=%d | framesPerBurst=%d | isMMAP=%s",
             (mStream->getInputPreset() == oboe::InputPreset::Unprocessed) ? "Unprocessed" : "VoiceRecognition",
             mSampleRate,
             mStream->getFramesPerBurst(),
             mStream->usesAAudio() ? "AAudio" : "OpenSLES");

        mRecording.store(true);
        return true;
    }

    oboe::Result tryOpen(oboe::InputPreset preset) {
        oboe::AudioStreamBuilder builder;
        builder.setDirection(oboe::Direction::Input)
               ->setPerformanceMode(oboe::PerformanceMode::None)
               ->setSharingMode(oboe::SharingMode::Exclusive)
               ->setFormat(oboe::AudioFormat::Float)
               ->setFormatConversionAllowed(true)
               ->setChannelCount(oboe::ChannelCount::Mono)
               ->setSampleRateConversionQuality(oboe::SampleRateConversionQuality::None)
               ->setInputPreset(preset)
               ->setDataCallback(this)
               ->setErrorCallback(this);
        return builder.openStream(mStream);
    }
};

// ── Singleton ─────────────────────────────────────────────────────────────────

static HarpHeroEngine gEngine;

// ── JNI exports ───────────────────────────────────────────────────────────────

extern "C" {

JNIEXPORT jboolean JNICALL
Java_com_chewpacastudios_harp2tab_AudioCaptureModule_nativeStart(JNIEnv*, jobject) {
    return gEngine.start() ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT void JNICALL
Java_com_chewpacastudios_harp2tab_AudioCaptureModule_nativeStop(JNIEnv*, jobject) {
    gEngine.stop();
}

JNIEXPORT jfloat JNICALL
Java_com_chewpacastudios_harp2tab_AudioCaptureModule_nativeGetFrequency(JNIEnv*, jobject) {
    return gEngine.getCurrentFrequency();
}

JNIEXPORT jfloat JNICALL
Java_com_chewpacastudios_harp2tab_AudioCaptureModule_nativeGetRms(JNIEnv*, jobject) {
    return gEngine.getCurrentRms();
}

JNIEXPORT void JNICALL
Java_com_chewpacastudios_harp2tab_AudioCaptureModule_nativeSetThreshold(JNIEnv*, jobject, jfloat v) {
    gEngine.setDetectionThreshold(v);
}

JNIEXPORT void JNICALL
Java_com_chewpacastudios_harp2tab_AudioCaptureModule_nativeSetClarity(JNIEnv*, jobject, jfloat v) {
    gEngine.setClarity(v);
}

JNIEXPORT void JNICALL
Java_com_chewpacastudios_harp2tab_AudioCaptureModule_nativeSetDefaultStreamValues(JNIEnv*, jobject, jint sampleRate, jint framesPerBurst) {
    oboe::DefaultStreamValues::SampleRate     = (int32_t) sampleRate;
    oboe::DefaultStreamValues::FramesPerBurst = (int32_t) framesPerBurst;
}

} // extern "C"
