package com.ayumaoqiu.camera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ZoomScaleTest {

  @Test
  fun endsOfTheSliderAreTheEndsOfTheRange() {
    val scale = ZoomScale(1f, 10f)
    assertEquals(1f, scale.zoomAt(0), 0.0001f)
    assertEquals(10f, scale.zoomAt(100), 0.0001f)
  }

  @Test
  fun scaleIsLogarithmicSoTheMiddleIsTheGeometricMean() {
    // Linear would put 5.5x in the middle; a camera puts sqrt(1*10) ~ 3.16x there.
    val scale = ZoomScale(1f, 10f)
    assertEquals(3.1623f, scale.zoomAt(50), 0.001f)
  }

  @Test
  fun progressAndZoomRoundTrip() {
    val scale = ZoomScale(0.5f, 8f)
    for (progress in 0..100) {
      assertEquals(progress, scale.progressOf(scale.zoomAt(progress)))
    }
  }

  @Test
  fun outOfRangeValuesAreClamped() {
    val scale = ZoomScale(1f, 8f)
    assertEquals(1f, scale.clamp(0.2f), 0f)
    assertEquals(8f, scale.clamp(30f), 0f)
    assertEquals(0, scale.progressOf(0.1f))
    assertEquals(100, scale.progressOf(99f))
    assertEquals(8f, scale.zoomAt(500), 0.0001f)
  }

  @Test
  fun phoneWithoutZoomIsNotAdjustable() {
    val fixed = ZoomScale(1f, 1f)
    assertFalse(fixed.isAdjustable)
    assertEquals(1f, fixed.clamp(4f), 0f)
    assertEquals(0, fixed.progressOf(2f))
    assertEquals(listOf(1f), fixed.presets())
  }

  @Test
  fun brokenRangeFromTheCameraDoesNotCrash() {
    assertFalse(ZoomScale(0f, 10f).isAdjustable)
    assertFalse(ZoomScale(5f, 2f).isAdjustable)
    assertFalse(ZoomScale(1f, Float.POSITIVE_INFINITY).isAdjustable)
    assertEquals(ZoomScale.FALLBACK, ZoomScale(0f, 10f).zoomAt(50), 0f)
  }

  @Test
  fun presetsFollowWhatThePhoneSupports() {
    // A phone with an ultra-wide lens and a long digital range.
    assertEquals(listOf(0.5f, 1f, 2f, 3f, 5f, 10f), ZoomScale(0.5f, 10f).presets())
    // A typical single-lens phone with 8x digital zoom.
    assertEquals(listOf(1f, 2f, 3f, 5f), ZoomScale(1f, 8f).presets())
    // Ultra-wide reported as 0.6x: 0.5 is not reachable, so it is not offered.
    assertEquals(listOf(1f, 2f), ZoomScale(0.6f, 2f).presets())
  }

  @Test
  fun presetAtTheExactLimitIsKept() {
    // Ranges come back as floats such as 9.9999995; the 10x stop must survive.
    assertTrue(ZoomScale(1f, 9.9999995f).presets().contains(10f))
  }
}
