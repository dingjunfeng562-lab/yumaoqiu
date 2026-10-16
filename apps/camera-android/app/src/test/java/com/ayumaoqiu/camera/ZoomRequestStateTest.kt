package com.ayumaoqiu.camera

import org.junit.Assert.*
import org.junit.Test

class ZoomRequestStateTest {
  @Test fun coalescesFastInputWithoutReplayingIntermediatePositions() {
    val state = ZoomRequestState(0.5f, 10f, 1f)
    repeat(200) { state.request(if (it % 2 == 0) 9f else 2f) }
    assertEquals(2f, state.next(16_000_000)!!, 0f)
    assertNull(state.next(32_000_000))
  }

  @Test fun everyGestureFrameGetsItsFullTargetWithoutWaitingForCameraAcknowledgement() {
    val state = ZoomRequestState(0.5f, 10f, 1f)
    listOf(1.2f, 1.8f, 3f, 2.2f, 0.6f).forEachIndexed { index, zoom ->
      state.request(zoom)
      assertEquals(zoom, state.next((index + 1) * 16_000_000L)!!, 0f)
    }
    assertFalse(state.animating)
    assertNull(state.next(1_000_000_000)) // No movement after the fingers stop.
  }

  @Test fun presetDurationDoesNotDependOnDisplayFrameRate() {
    for (frameStep in listOf(8_333_333L, 16_666_666L, 33_333_333L)) {
      val state = ZoomRequestState(0.5f, 10f, 1f)
      state.animateTo(3f, 0)
      var time = frameStep
      var previous = 1f
      while (time < ZoomRequestState.DURATION_NS) {
        state.next(time)?.let { assertTrue(it in previous..3f); previous = it }
        time += frameStep
      }
      assertEquals(3f, state.next(ZoomRequestState.DURATION_NS)!!, 0f)
      assertFalse(state.animating)
    }
  }

  @Test fun aDelayedFrameDoesNotReplayASlowTail() {
    val state = ZoomRequestState(1f, 10f, 1f)
    state.animateTo(5f, 0)
    state.next(16_000_000)
    assertEquals(5f, state.next(400_000_000)!!, 0f)
    assertNull(state.next(416_000_000))
  }

  @Test fun fingersImmediatelyInterruptPresetAnimation() {
    val state = ZoomRequestState(0.5f, 10f, 1f)
    state.animateTo(5f, 0)
    state.next(80_000_000)
    state.request(1.3f)
    assertEquals(1.3f, state.next(96_000_000)!!, 0f)
    assertNull(state.next(300_000_000))
    assertFalse(state.animating)
  }

  @Test fun reversingAtTheLensLimitRespondsOnTheNextFrame() {
    val state = ZoomRequestState(1f, 3f, 1f)
    state.request(99f); assertEquals(3f, state.next(16_000_000)!!, 0f)
    state.request(2.9f); assertEquals(2.9f, state.next(32_000_000)!!, 0f)
  }

  @Test fun ignoresNonFiniteInputAndHonoursFixedNativeRange() {
    val state = ZoomRequestState(1f, 3f, 1f)
    state.request(Float.NaN); state.request(Float.POSITIVE_INFINITY)
    assertNull(state.next(0))
    val fixed = ZoomRequestState(2f, 2f, 2f)
    fixed.request(0.5f)
    assertEquals(2f, fixed.target, 0f)
    assertNull(fixed.next(0))
  }
}
