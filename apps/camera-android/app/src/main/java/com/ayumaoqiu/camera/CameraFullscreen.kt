package com.ayumaoqiu.camera

import android.app.Activity
import android.os.Build
import android.view.WindowManager
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/** Hide both system bars and allow the viewfinder to use the display cutout area. */
fun Activity.cameraFullscreen() {
  WindowCompat.setDecorFitsSystemWindows(window, false)
  if (Build.VERSION.SDK_INT >= 28) window.attributes = window.attributes.apply {
    layoutInDisplayCutoutMode = if (Build.VERSION.SDK_INT >= 30)
      WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
    else WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
  }
  WindowInsetsControllerCompat(window, window.decorView).apply {
    systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    hide(WindowInsetsCompat.Type.systemBars())
  }
}
