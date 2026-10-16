package com.ayumaoqiu.camera

import kotlin.math.min

/** Bounded retry timing for public-network camera recovery. */
internal class ReconnectBackoff(
  private val initialDelayMillis: Long = 1_000L,
  private val maxDelayMillis: Long = 15_000L,
) {
  private var failures = 0

  fun nextDelayMillis(): Long {
    val exponent = min(failures, MAX_EXPONENT)
    failures += 1
    return (initialDelayMillis * (1L shl exponent)).coerceAtMost(maxDelayMillis)
  }

  fun reset() {
    failures = 0
  }

  companion object {
    private const val MAX_EXPONENT = 20
  }
}
