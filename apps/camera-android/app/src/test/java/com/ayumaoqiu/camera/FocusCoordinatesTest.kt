package com.ayumaoqiu.camera

import org.junit.Assert.*
import org.junit.Test

class FocusCoordinatesTest {
  @Test fun reversesAllFourFrameRotations() {
    fun point(rotation: Int): Pair<Float, Float>? = FocusCoordinates.surfacePoint(25f, 75f, 100, 100, 100, 100, rotation)
    assertEquals(0.25f to 0.75f, point(0))
    assertEquals(0.75f to 0.75f, point(90))
    assertEquals(0.75f to 0.25f, point(180))
    assertEquals(0.25f to 0.25f, point(270))
  }
  @Test fun removesAspectFitBordersAndRejectsBlackAreas() {
    assertNull(FocusCoordinates.surfacePoint(100f, 200f, 2000, 1000, 1600, 1000, 0))
    assertEquals(0f to 0.5f, FocusCoordinates.surfacePoint(200f, 500f, 2000, 1000, 1600, 1000, 0))
    assertEquals(0.5f to 0.5f, FocusCoordinates.surfacePoint(1000f, 500f, 2000, 1000, 1000, 1600, 90))
  }
  @Test fun rejectsInvalidGeometry() {
    assertNull(FocusCoordinates.surfacePoint(1f, 1f, 0, 100, 100, 100, 0))
    assertNull(FocusCoordinates.surfacePoint(Float.NaN, 1f, 100, 100, 100, 100, 0))
  }
}
