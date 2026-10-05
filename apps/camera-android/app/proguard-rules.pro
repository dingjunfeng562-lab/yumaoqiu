# RootEncoder keeps names reachable by reflection in a few places; nothing in
# this app is obfuscation-sensitive beyond that, and minification is off.
-dontwarn com.pedro.**
-keep class com.pedro.** { *; }
