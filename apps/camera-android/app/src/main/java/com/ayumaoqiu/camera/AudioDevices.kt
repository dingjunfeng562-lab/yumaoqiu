package com.ayumaoqiu.camera

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build

/** One selectable microphone input. */
data class MicOption(val id: Int, val name: String, val external: Boolean)

/**
 * Microphone inputs available on this phone. The DJI Mic receiver appears as a
 * USB audio device, so it shows up here as an external input and can be pinned
 * explicitly instead of relying on the system to route to it.
 */
object AudioDevices {

  fun inputs(context: Context): List<MicOption> {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return emptyList()
    val manager = manager(context) ?: return emptyList()
    return manager.getDevices(AudioManager.GET_DEVICES_INPUTS)
      .filter { isInput(it.type) }
      .map { MicOption(it.id, label(it), external(it.type)) }
      .distinctBy { it.id }
  }

  fun find(context: Context, id: Int): AudioDeviceInfo? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return null
    if (id < 0) return null
    return manager(context)?.getDevices(AudioManager.GET_DEVICES_INPUTS)?.firstOrNull { it.id == id }
  }

  /** First external input, i.e. the DJI Mic receiver when it is plugged in. */
  fun preferredExternal(context: Context): MicOption? =
    inputs(context).firstOrNull { it.external }

  private fun manager(context: Context): AudioManager? =
    context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  private fun isInput(type: Int): Boolean = when (type) {
    AudioDeviceInfo.TYPE_BUILTIN_MIC,
    AudioDeviceInfo.TYPE_USB_DEVICE,
    AudioDeviceInfo.TYPE_USB_HEADSET,
    AudioDeviceInfo.TYPE_USB_ACCESSORY,
    AudioDeviceInfo.TYPE_WIRED_HEADSET,
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
    -> true
    else -> Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && type == AudioDeviceInfo.TYPE_BLE_HEADSET
  }

  private fun external(type: Int): Boolean = type != AudioDeviceInfo.TYPE_BUILTIN_MIC

  private fun label(device: AudioDeviceInfo): String {
    val name = device.productName?.toString()?.trim().orEmpty()
    val kind = when (device.type) {
      AudioDeviceInfo.TYPE_BUILTIN_MIC -> "手机自带"
      AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_HEADSET,
      AudioDeviceInfo.TYPE_USB_ACCESSORY -> "USB 外接"
      AudioDeviceInfo.TYPE_WIRED_HEADSET -> "有线耳麦"
      AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "蓝牙"
      else -> "外接"
    }
    return if (name.isNotEmpty()) "$kind · $name" else kind
  }
}
