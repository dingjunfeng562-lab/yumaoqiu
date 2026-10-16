package com.ayumaoqiu.camera

import kotlin.math.exp
import kotlin.math.ln

/** Coalesces input per display frame; camera completion never gates the next target. */
class ZoomRequestState(min: Float, max: Float, current: Float) {
  private val minimum = min.takeIf { it.isFinite() && it > 0f } ?: 1f
  private val maximum = max.takeIf { it.isFinite() && it >= minimum } ?: minimum
  var submitted: Float = clamp(current.takeIf { it.isFinite() } ?: minimum)
    private set
  var target: Float = submitted
    private set
  var animating = false
    private set
  private var animationFrom = submitted
  private var animationStartNs = 0L

  private fun clamp(value: Float) = value.coerceIn(minimum, maximum)

  /** A finger target replaces any preset animation immediately, with no catch-up tail. */
  fun request(value: Float) {
    if (!value.isFinite()) return
    target = clamp(value)
    animating = false
  }

  /** Only preset buttons get a short, wall-clock-driven transition. */
  fun animateTo(value: Float, nowNs: Long) {
    if (!value.isFinite()) return
    target = clamp(value)
    animationFrom = submitted
    animationStartNs = nowNs
    animating = target != submitted
  }

  fun next(frameTimeNs: Long): Float? {
    val next = if (animating) {
      val progress = ((frameTimeNs - animationStartNs).toDouble() / DURATION_NS).coerceIn(0.0, 1.0)
      if (progress >= 1.0) { animating = false; target }
      else {
        val eased = progress * progress * (3.0 - 2.0 * progress)
        clamp((animationFrom * exp(ln(target.toDouble() / animationFrom) * eased)).toFloat())
      }
    } else target
    if (next == submitted) return null
    submitted = next
    return next
  }

  companion object { const val DURATION_NS = 240_000_000L }
}
