package com.ayumaoqiu.camera

import android.content.Context
import android.util.AttributeSet
import android.widget.FrameLayout

/**
 * Fits the complete 16:9 viewfinder inside the available window.
 * The preview and stream show the same framing on wide and portrait displays.
 */
class AspectFrameLayout @JvmOverloads constructor(
  context: Context,
  attrs: AttributeSet? = null,
  defStyleAttr: Int = 0,
) : FrameLayout(context, attrs, defStyleAttr) {

  /** Width divided by height. */
  var aspectRatio: Float = DEFAULT_RATIO
    set(value) {
      if (value.isFinite() && value > 0f && field != value) {
        field = value
        requestLayout()
      }
    }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val width = MeasureSpec.getSize(widthMeasureSpec)
    val height = MeasureSpec.getSize(heightMeasureSpec)
    if (width <= 0 || height <= 0 || aspectRatio <= 0f) {
      super.onMeasure(widthMeasureSpec, heightMeasureSpec)
      return
    }

    // Fit inside both bounds. A wider phone must not crop the top and bottom.
    val byWidth = width / aspectRatio
    val boxWidth: Int
    val boxHeight: Int
    if (byWidth <= height) {
      boxWidth = width
      boxHeight = byWidth.toInt().coerceAtLeast(1)
    } else {
      boxWidth = (height * aspectRatio).toInt().coerceAtLeast(1)
      boxHeight = height
    }

    // The children (the preview surface) fill the box exactly.
    super.onMeasure(
      MeasureSpec.makeMeasureSpec(boxWidth, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(boxHeight, MeasureSpec.EXACTLY),
    )
  }

  companion object {
    /** Landscape 16:9, the only ratio the stream contract allows. */
    const val DEFAULT_RATIO = 16f / 9f
  }
}
