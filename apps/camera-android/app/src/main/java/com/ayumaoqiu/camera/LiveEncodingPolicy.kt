package com.ayumaoqiu.camera

/** Public-network bitrate budget with capability-checked, smooth local preview. */
object LiveEncodingPolicy {
  const val DEFAULT_MBPS = 4
  const val MAX_MBPS = 6
  const val PREVIEW_BITRATE = 400_000
  const val PREVIEW_FPS = 12
  fun bitrate(mbps: Int): Int = mbps.coerceIn(2, MAX_MBPS) * 1_000_000
  fun defaultQuality(options: List<LocalQuality>): LocalQuality? =
    CaptureQualityPolicy.auto(options)
}
