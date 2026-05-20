#include <jni.h>

extern "C" JNIEXPORT jboolean JNICALL
Java_com_chewpacastudios_harp2tab_AudioCaptureModule_nativeStart(JNIEnv*, jobject) {
    return JNI_FALSE;
}

extern "C" JNIEXPORT void JNICALL
Java_com_chewpacastudios_harp2tab_AudioCaptureModule_nativeStop(JNIEnv*, jobject) {}

extern "C" JNIEXPORT jfloat JNICALL
Java_com_chewpacastudios_harp2tab_AudioCaptureModule_nativeGetFrequency(JNIEnv*, jobject) {
    return 0.0f;
}

extern "C" JNIEXPORT jfloat JNICALL
Java_com_chewpacastudios_harp2tab_AudioCaptureModule_nativeGetRms(JNIEnv*, jobject) {
    return 0.0f;
}

extern "C" JNIEXPORT void JNICALL
Java_com_chewpacastudios_harp2tab_AudioCaptureModule_nativeSetThreshold(JNIEnv*, jobject, jfloat) {}

extern "C" JNIEXPORT void JNICALL
Java_com_chewpacastudios_harp2tab_AudioCaptureModule_nativeSetClarity(JNIEnv*, jobject, jfloat) {}

extern "C" JNIEXPORT void JNICALL
Java_com_chewpacastudios_harp2tab_AudioCaptureModule_nativeSetDefaultStreamValues(JNIEnv*, jobject, jint, jint) {}
