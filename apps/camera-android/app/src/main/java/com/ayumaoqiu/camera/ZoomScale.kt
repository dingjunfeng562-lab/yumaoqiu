package com.ayumaoqiu.camera

import kotlin.math.abs
import kotlin.math.ln
import kotlin.math.max
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
   * How far towards [target] the applied zoom should move next, for paces that
   * need one camera request per displayed frame.
   *
   * The sensor only accepts a zoom step every frame or two, so a finger-paced
   * request stream (120-240 touch events a second, plus the finger jitter inside
   * them) would be dropped, and the picture would jump between the values that
   * did get through. Easing towards the gesture target instead keeps every
   * accepted request the same size, which is what reads as smooth motion.
   *
   * The step scales with the lens range rather than being a fixed multiple: a
   * phone with 0.5x-8x has sixteen times the ground to cover of a 1x-1.5x one.
   */
  fun stepTowards(zoom: Float, target: Float, step: Float = stepSize()): Float {
    if (!isAdjustable) return target
    val to = clamp(target)
    val from = clamp(zoom)
    if (to == from) return to
    val delta = to - from
    if (abs(delta) <= EPSILON) return to
    val distance = max(step, MIN_STEP)
    return if (abs(delta) <= distance) to else from + (if (delta > 0f) distance else -distance)
  }

  /** One frame's worth of travel for this range; see [stepTowards]. */
  fun stepSize(): Float = if (!isAdjustable) 0f else max((max - min) * STEP_RATIO, MIN_STEP)

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
    /** Fraction of the whole range to cover in one frame while easing. */
    private const val STEP_RATIO = 0.012f
    /** Floors the step so a narrow range still travels in a few frames. */
    private const val MIN_STEP = 0.01f
    private val CANDIDATES = listOf(0.5f, 1f, 2f, 3f, 5f, 10f)
  }
}
