package com.ayumaoqiu.camera

import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * Converts between a zoom multiple and a 0..[steps] slider position.
 *
 * The mapping is logarithmic, not linear. On a linear slider most of the travel
 * would sit between 6x and 10x, where the picture barely changes, while the
 * useful 1x-2x framing range would be a couple of pixels wide.
 *
 * Kept free of Android types so the arithmetic can be unit tested off-device.
 */
class ZoomScale(val min: Float, val max: Float, val steps: Int = 100) {

  init {
    require(steps > 0) { "steps must be positive" }
  }

  /** False when the phone exposes no usable range (or a single fixed zoom). */
  val isAdjustable: Boolean get() = max > min && min > 0f && max.isFinite() && min.isFinite()

  fun zoomAt(progress: Int): Float {
    if (!isAdjustable) return FALLBACK
    val fraction = progress.coerceIn(0, steps).toDouble() / steps
    return (min * (max / min).toDouble().pow(fraction)).toFloat()
  }

  fun progressOf(zoom: Float): Int {
    if (!isAdjustable || zoom <= 0f) return 0
    val span = (max / min).toDouble()
    if (span <= 1.0) return 0
    val fraction = ln((zoom / min).toDouble()) / ln(span)
    return (fraction * steps).roundToInt().coerceIn(0, steps)
  }

  fun clamp(zoom: Float): Float = if (!isAdjustable) FALLBACK else zoom.coerceIn(min, max)

  /**
   * The fixed stops shown as camera-style pills. Covers the common phone lenses
   * (ultra-wide, wide, telephoto) and is filtered by what this phone reports.
   */
  fun presets(): List<Float> = CANDIDATES
    .filter { it >= min - EPSILON && it <= max + EPSILON }
    .distinct()
    .sorted()

  companion object {
    const val FALLBACK = 1f
    private const val EPSILON = 0.001f
    private val CANDIDATES = listOf(0.5f, 1f, 2f, 3f, 5f, 10f)
  }
}
