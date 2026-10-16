package com.ayumaoqiu.camera

/** Inverse of the renderer's aspect-fit and VideoFrame rotation (unmirrored). */
object FocusCoordinates {
  fun surfacePoint(x: Float, y: Float, viewWidth: Int, viewHeight: Int,
    surfaceWidth: Int, surfaceHeight: Int, rotation: Int): Pair<Float, Float>? {
    if (!x.isFinite() || !y.isFinite() || minOf(viewWidth, viewHeight, surfaceWidth, surfaceHeight) <= 0) return null
    val swapped = rotation == 90 || rotation == 270
    val displayWidth = if (swapped) surfaceHeight else surfaceWidth
    val displayHeight = if (swapped) surfaceWidth else surfaceHeight
    val scale = minOf(viewWidth.toFloat() / displayWidth, viewHeight.toFloat() / displayHeight)
    val left = (viewWidth - displayWidth * scale) / 2f
    val top = (viewHeight - displayHeight * scale) / 2f
    val u = (x - left) / (displayWidth * scale)
    val v = (y - top) / (displayHeight * scale)
    // Do not meter a black letterbox border as if it were part of the picture.
    if (u !in 0f..1f || v !in 0f..1f) return null
    return when (rotation) {
      90 -> v to (1f - u)
      180 -> (1f - u) to (1f - v)
      270 -> (1f - v) to u
      else -> u to v
    }
  }
}
