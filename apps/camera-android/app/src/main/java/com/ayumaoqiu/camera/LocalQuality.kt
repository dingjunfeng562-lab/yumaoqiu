package com.ayumaoqiu.camera

/**
 * One resolution/frame-rate the phone can actually capture and encode.
 *
 * Nothing outside the phone decides this: every camera app tier here is a fixed
 * 16:9 landscape output, and which of them are usable depends on the sensor and
 * the H.264 encoder of the device in hand. See [auto].
 *
 * Kept free of Android types so the arithmetic can be unit tested off-device.
 */
data class LocalQuality(val resolution: String, val fps: Int) {

  val width: Int get() = widthOf(resolution)
  val height: Int get() = heightOf(resolution)

  /** Shown in the settings list, e.g. "1080p · 60 帧". */
  val label: String get() = "$resolution · $fps 帧"

  companion object {
    /**
     * Landscape 16:9 outputs, lowest first. 1440p is included because a phone
     * whose sensor tops out at 2560x1440 gets a better picture there than at
     * 1080p, and the site accepts whatever the app reports.
     */
    val RESOLUTIONS = listOf("720p", "1080p", "1440p", "2160p")

    /** Frame rates tried in order of preference when picking automatically. */
    val FRAME_RATES = listOf(60, 30, 25, 24)

    /**
     * The tiers a default phone should land on, best first. A device that can do
     * none of them (rare, and usually an old or unusual encoder) falls back to
     * the highest tier left rather than failing to start.
     *
     * 30 fps rather than 60 by design: badminton is shot from a fixed position,
     * and the extra bitrate a 60 fps stream needs costs more sharpness than the
     * smoother motion buys. A 4K-only-at-24 phone also lands here instead of on
     * a stuttery 4K, which is what a "pick the biggest number" rule would do.
     */
    private val PREFERRED = listOf(LocalQuality("2160p", 30), LocalQuality("1440p", 30), LocalQuality("1080p", 30))

    fun widthOf(resolution: String): Int = when (resolution) {
      "720p" -> 1280
      "1440p" -> 2560
      "2160p" -> 3840
      else -> 1920
    }

    fun heightOf(resolution: String): Int = when (resolution) {
      "720p" -> 720
      "1440p" -> 1440
      "2160p" -> 2160
      else -> 1080
    }

    /** Parses a stored value; anything unknown is treated as "not chosen yet". */
    fun of(resolution: String?, fps: Int): LocalQuality? =
      if (resolution in RESOLUTIONS && fps in FRAME_RATES) LocalQuality(resolution!!, fps) else null

    /**
     * Landing bitrate per resolution, in kbps, at [BASE_FPS]. Roughly the
     * YouTube Live recommendations for H.264 of a moving sports subject - about
     * 0.09 bit per pixel per frame - rounded to numbers an operator can sanity
     * check on the admin page.
     */
    private val BASE_BITRATE_KBPS = mapOf(
      "720p" to 2_600,
      "1080p" to 6_000,
      "1440p" to 12_000,
      "2160p" to 24_000,
    )

    /**
     * Bitrate for a tier: the resolution's landing rate scaled by the frame rate
     * and clamped, so no tier can ask for more uplink than a phone hot-spot can
     * carry, and none drops below what moving pictures actually need.
     *
     * Scaling rather than a single pixels×fps formula keeps the familiar round
     * numbers exact (1080p30 is 6000, not 6019), which matters because these
     * values are what the operator compares against their uplink budget.
     */
    fun recommendedBitrateKbps(resolution: String, fps: Int): Int {
      val base = BASE_BITRATE_KBPS[resolution] ?: BASE_BITRATE_KBPS.getValue("1080p")
      val kbps = (base.toLong() * fps) / BASE_FPS
      return kbps.coerceIn(MIN_BITRATE_KBPS, MAX_BITRATE_KBPS).toInt()
    }

    /**
     * Every combination this phone can actually capture and encode.
     *
     * @param cameraSizes output sizes the open lens offers (width to height);
     * @param fpsRanges the lens's auto-exposure target ranges (lower to upper);
     * @param encoderSupports whether the H.264 encoder accepts width×height@fps.
     */
    fun supported(
      cameraSizes: List<Pair<Int, Int>>,
      fpsRanges: List<Pair<Int, Int>>,
      encoderSupports: (width: Int, height: Int, fps: Int) -> Boolean,
    ): List<LocalQuality> = RESOLUTIONS.flatMap { resolution ->
      val w = widthOf(resolution)
      val h = heightOf(resolution)
      // The camera must deliver at least this many pixels in 16:9 (either
      // orientation); the encoder scales from there.
      val cameraHas = cameraSizes.any { (cw, ch) ->
        val long = maxOf(cw, ch)
        val short = minOf(cw, ch)
        long >= w && short >= h && long * 9 == short * 16
      }
      if (!cameraHas) return@flatMap emptyList()
      FRAME_RATES
        // A fixed rate needs an exposure range that reaches it.
        .filter { fps -> fpsRanges.any { (lower, upper) -> fps in lower..upper } }
        .filter { fps -> encoderSupports(w, h, fps) }
        .map { fps -> LocalQuality(resolution, fps) }
    }

    /**
     * The tier this phone should stream at, chosen with no input from the
     * operator or the site.
     *
     * @param supported every legal combination, as returned by [supported].
     *   Empty means the capabilities could not be read, and the caller keeps its
     *   own fallback rather than being handed a tier that may not open.
     */
    fun auto(supported: List<LocalQuality>): LocalQuality? {
      if (supported.isEmpty()) return null
      PREFERRED.firstOrNull { it in supported }?.let { return it }
      // Nothing familiar is available. Take the best of what is, preferring a
      // rate that will not look choppy in a highlights clip.
      return supported.filter { it.fps >= PREFERRED_FPS_FLOOR }.maxByOrNull { it.width * it.height }
        ?: supported.maxByOrNull { it.width * it.height * it.fps }
    }

    /**
     * Last resort, used only until the real capabilities have been read and if
     * the measured tier turns out not to open. 1080p30 is the one combination
     * every device in the field has been able to encode.
     */
    val FALLBACK = LocalQuality("1080p", 30)
  }
}

/**
 * The manual capture targets the app cannot measure by itself. The site no
 * longer sends a resolution or frame rate: see [CameraSettings.quality].
 */
data class CameraSettings(
  val videoBitrateKbps: Int = 0,
  val audioBitrateKbps: Int = 128,
  val facing: String = "back",
  val preferExternalMic: Boolean = true,
  /** Chosen from this phone's capabilities; never null once the camera is open. */
  val quality: LocalQuality? = null,
) {
  /**
   * What the encoder will actually be prepared with. [quality] is set by
   * [SessionController] as soon as the camera is open; the fallback here only
   * covers the moment before that, so nothing depends on it.
   */
  val effectiveQuality: LocalQuality get() = quality ?: LocalQuality.FALLBACK

  val width: Int get() = effectiveQuality.width
  val height: Int get() = effectiveQuality.height
  val fps: Int get() = effectiveQuality.fps

  /**
   * The tier's own recommendation, capped by whatever the site allows.
   *
   * Zero means the site set no limit, which is the normal case: the phone sizes
   * the bitrate for the tier it measured. An operator lowers the site value when
   * the venue's uplink cannot carry that tier's rate, and the cap is then applied
   * rather than the recommendation - a smaller, stable picture beats a sharp one
   * that keeps dropping frames.
   */
  val videoBitrate: Int
    get() {
      val recommended = LocalQuality.recommendedBitrateKbps(effectiveQuality.resolution, effectiveQuality.fps)
      val kbps = if (videoBitrateKbps > 0) minOf(videoBitrateKbps, recommended) else recommended
      return kbps * 1024
    }

  val audioBitrate: Int get() = audioBitrateKbps * 1024
}

/** Attaches the automatically chosen tier to a config. */
fun CameraConfig.withAuto(quality: LocalQuality?): CameraConfig =
  if (quality == null || quality == settings.quality) this else copy(settings = settings.copy(quality = quality))

private const val MIN_BITRATE_KBPS = 2_000L
private const val MAX_BITRATE_KBPS = 24_000L
private const val PREFERRED_FPS_FLOOR = 30

/** Frame rate the per-resolution base bitrates are quoted at. */
private const val BASE_FPS = 30
