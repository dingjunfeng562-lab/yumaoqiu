package com.ayumaoqiu.camera

import android.content.Context
import android.content.SharedPreferences

/**
 * Local settings. The pairing token identifies this phone to the site; the
 * server base URL points at the deployment that holds the stream address.
 */
class Prefs(context: Context) {
  private val store: SharedPreferences =
    context.getSharedPreferences("ayumaoqiu-camera", Context.MODE_PRIVATE)

  var baseUrl: String
    get() = store.getString(KEY_BASE_URL, DEFAULT_BASE_URL) ?: DEFAULT_BASE_URL
    set(value) = store.edit().putString(KEY_BASE_URL, value.trim().trimEnd('/')).apply()

  var pairingToken: String
    get() = store.getString(KEY_TOKEN, "") ?: ""
    set(value) = store.edit().putString(KEY_TOKEN, value.trim()).apply()

  /**
   * A specific input device pinned on this phone (-1 = automatic). Whether to
   * prefer an external mic in automatic mode is a site setting, not stored here.
   */
  var micDeviceId: Int
    get() = store.getInt(KEY_MIC_ID, -1)
    set(value) = store.edit().putInt(KEY_MIC_ID, value).apply()

  var forceLandscape: Boolean
    get() = store.getBoolean(KEY_LANDSCAPE, true)
    set(value) = store.edit().putBoolean(KEY_LANDSCAPE, value).apply()

  var manualQuality: LocalQuality?
    get() = LocalQuality.of(store.getString("qualityResolution", null), store.getInt("qualityFps", 0))
    set(value) = store.edit().putString("qualityResolution", value?.resolution).putInt("qualityFps", value?.fps ?: 0).apply()

  companion object {
    const val DEFAULT_BASE_URL = "http://192.168.1.10:4000"
    private const val KEY_BASE_URL = "baseUrl"
    private const val KEY_TOKEN = "pairingToken"
    private const val KEY_MIC_ID = "micDeviceId"
    private const val KEY_LANDSCAPE = "forceLandscape"
  }
}
