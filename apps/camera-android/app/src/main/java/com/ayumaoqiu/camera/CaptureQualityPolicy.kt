package com.ayumaoqiu.camera

data class CameraOutputMode(val width: Int, val height: Int, val minFrameDurationNs: Long)

/** Keep the UI's capability check and CameraX's actual output selection in sync. */
object CaptureQualityPolicy {
  fun outputSupports(mode: CameraOutputMode, quality: LocalQuality): Boolean {
    val width = maxOf(mode.width, mode.height)
    val height = minOf(mode.width, mode.height)
    return width >= quality.width && height >= quality.height && width.toLong() * 9 == height.toLong() * 16 &&
      (mode.minFrameDurationNs <= 0 || 1_000_000_000.0 / mode.minFrameDurationNs + 0.5 >= quality.fps)
  }

  fun frameRateRange(ranges: List<Pair<Int, Int>>, fps: Int): Pair<Int, Int>? =
    ranges.filter { fps in it.first..it.second }
      .minWithOrNull(compareBy<Pair<Int, Int>> { it.second - fps }.thenByDescending { it.first })

  fun auto(options: List<LocalQuality>): LocalQuality? =
    listOf(LocalQuality("1080p", 60), LocalQuality("1080p", 30), LocalQuality("720p", 60), LocalQuality("720p", 30))
      .firstOrNull { it in options } ?: LocalQuality.auto(options)

  fun unavailableReason(quality: LocalQuality, modes: List<CameraOutputMode>, ranges: List<Pair<Int, Int>>, encoderSupports: Boolean): String? = when {
    frameRateRange(ranges, quality.fps) == null -> "当前镜头未向此 App 开放 ${quality.fps} 帧"
    modes.none { outputSupports(it, quality) } -> "当前镜头未开放 ${quality.resolution} / ${quality.fps} 帧输出"
    !encoderSupports -> "当前编码器不支持 ${quality.resolution} / ${quality.fps} 帧"
    else -> null
  }
}

data class QualityAvailability(val quality: LocalQuality, val unavailableReason: String?)
