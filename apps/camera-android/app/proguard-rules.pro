# R8 收缩规则（release 包）。
#
# 体积大头在 dex（28MB）和四种 ABI 的 .so（51MB）。.so 靠 build.gradle 里的
# abiFilters 解决；dex 靠这里的裁剪。LiveKit / WebRTC / RootEncoder / ZXing
# 都用反射和 JNI，因此整包保留，只让 R8 裁掉没被引用的 AndroidX、OkHttp 内部类。

# --- LiveKit / WebRTC（含重打包后的 livekit.org.webrtc） ---
-keep class io.livekit.** { *; }
-keep class livekit.** { *; }
-dontwarn io.livekit.**
-dontwarn livekit.**
-keepclasseswithmembernames class * {
    native <methods>;
}

# --- RootEncoder（推流 / 编码） ---
-keep class com.pedro.** { *; }
-dontwarn com.pedro.**

# --- 扫码 ---
-keep class com.journeyapps.** { *; }
-keep class com.google.zxing.** { *; }
-dontwarn com.google.zxing.**

# --- OkHttp / TLS ---
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# --- protobuf-lite（信令消息） ---
-keep class com.google.protobuf.** { *; }
-keepclassmembers class * extends com.google.protobuf.GeneratedMessageLite { *; }

# --- Kotlin 协程 / 注解 ---
-keepclassmembers class kotlinx.coroutines.** { volatile <fields>; }
-dontwarn kotlinx.coroutines.**

-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

# 不做混淆：体积收益主要在「删掉没用到的类」，重命名只省一点，却容易踩反射的坑。
-dontobfuscate
