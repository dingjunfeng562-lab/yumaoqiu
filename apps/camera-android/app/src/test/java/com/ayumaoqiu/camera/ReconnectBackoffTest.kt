package com.ayumaoqiu.camera

import org.junit.Assert.assertEquals
import org.junit.Test

class ReconnectBackoffTest {
  @Test fun growsExponentiallyAndStopsAtTheCeiling() {
    val backoff = ReconnectBackoff(initialDelayMillis = 1_000, maxDelayMillis = 5_000)
    assertEquals(listOf(1_000L, 2_000L, 4_000L, 5_000L, 5_000L), List(5) { backoff.nextDelayMillis() })
  }

  @Test fun aSuccessfulCycleResetsTheNextRetry() {
    val backoff = ReconnectBackoff()
    backoff.nextDelayMillis()
    backoff.nextDelayMillis()
    backoff.reset()
    assertEquals(1_000L, backoff.nextDelayMillis())
  }
}
