package com.ayumaoqiu.camera

/** Wire values match LiveHeartbeatDto; an unknown route must not be called a phone mic. */
object LiveAudioPolicy {
  fun isAssigned(cameraId: String, audioCameraId: String) = cameraId.isNotBlank() && cameraId == audioCameraId
  fun canUseInput(hasUsb: Boolean, allowInternalFallback: Boolean) = hasUsb || allowInternalFallback
  fun status(published: Boolean, usb: Boolean, internal: Boolean): String = when {
    !published -> "DISABLED"
    usb -> "USB_EXTERNAL"
    internal -> "INTERNAL_MIC"
    else -> "ERROR"
  }
}
