package com.ayumaoqiu.camera

import android.Manifest
import android.app.AlertDialog
import android.animation.ValueAnimator
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.hardware.display.DisplayManager
import android.os.Bundle
import android.os.IBinder
import android.text.TextUtils
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import io.livekit.android.renderer.SurfaceViewRenderer
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import livekit.org.webrtc.RendererCommon
import kotlin.math.roundToInt

class LiveCameraActivity : AppCompatActivity() {
  private lateinit var preview: SurfaceViewRenderer
  private lateinit var focusRing: View
  private lateinit var status: TextView
  private lateinit var metrics: TextView
  private lateinit var audio: TextView
  private lateinit var warning: TextView
  private lateinit var zoom: TextView
  private lateinit var presets: LinearLayout
  private lateinit var shutter: Button
  private lateinit var exposure: SeekBar
  private var service: LiveCameraService? = null
  private var bound = false
  private var animator: ValueAnimator? = null
  private var observer: Job? = null
  private var drawnRange: Pair<Float, Float>? = null
  private var lastZoom = 1f
  private var pendingZoom = 1f
  private var zoomScheduled = false
  private val displayListener = object : DisplayManager.DisplayListener {
    override fun onDisplayAdded(displayId: Int) = Unit
    override fun onDisplayRemoved(displayId: Int) = Unit
    override fun onDisplayChanged(displayId: Int) { updateRotation() }
  }
  @Suppress("DEPRECATION")
  private fun updateRotation() { service?.capturer?.rotation = windowManager.defaultDisplay.rotation }
  private val permission = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
    if (permissionsGranted()) startServiceSession() else warning.text = "摄像和麦克风权限用于多机位直播，请在系统设置中允许后重试"
  }
  private val connection = object : ServiceConnection {
    override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
      val connected = (binder as? LiveCameraService.LocalBinder)?.service ?: return
      service = connected; bound = true
      connected.attach(preview)
      updateRotation()
      observer?.cancel()
      observer = lifecycleScope.launch { repeatOnLifecycle(Lifecycle.State.STARTED) { connected.state.collect { render(it) } } }
    }
    override fun onServiceDisconnected(name: ComponentName?) { service = null; bound = false }
  }
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
    // Keep the viewfinder and controls clear of cutouts, privacy indicators and
    // navigation gestures, including when the phone turns to reverse landscape.
    ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
      val safe = insets.getInsetsIgnoringVisibility(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
      insets
    }
    val frame = AspectFrameLayout(this)
    root.addView(frame, FrameLayout.LayoutParams(-1, -1, Gravity.CENTER))
    preview = SurfaceViewRenderer(this).apply { setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FIT) }
    frame.addView(preview, FrameLayout.LayoutParams(-1, -1))
    focusRing = View(this).apply {
      visibility = View.INVISIBLE
      background = GradientDrawable().apply { setColor(Color.TRANSPARENT); setStroke(dp(1), Color.YELLOW); cornerRadius = dp(4).toFloat() }
    }
    frame.addView(focusRing, FrameLayout.LayoutParams(dp(48), dp(48)))
    val top = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12), dp(4), dp(12), dp(4)); setBackgroundColor(0x88000000.toInt()) }
    status = label(16f); metrics = label(11f).apply { maxLines = 2 }; audio = label(11f)
    warning = label(11f).apply { setTextColor(Color.YELLOW); maxLines = 2; ellipsize = TextUtils.TruncateAt.END }
    top.addView(status); top.addView(metrics); top.addView(audio); top.addView(warning)
    frame.addView(top, FrameLayout.LayoutParams(-1, -2, Gravity.TOP))
    val bottom = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setBackgroundColor(0x77000000); setPadding(dp(8), dp(2), dp(8), dp(4)) }
    val row = LinearLayout(this).apply { gravity = Gravity.CENTER }
    zoom = label(14f).apply { text = "1.0×"; setPadding(dp(8), 0, dp(8), 0) }
    presets = LinearLayout(this).apply { gravity = Gravity.CENTER }
    shutter = controlButton("开始接入").apply { setOnClickListener {
      if (!permissionsGranted()) permission.launch(arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)) else service?.toggle()
    } }
    row.addView(zoom); row.addView(presets); row.addView(shutter)
    row.addView(controlButton("画质设置").apply { setOnClickListener { showQualitySettings() } })
    row.addView(controlButton("前后镜头").apply { setOnClickListener { animator?.cancel(); service?.switchLens(); drawnRange = null } })
    row.addView(controlButton("重新配对").apply { setOnClickListener {
      // Keep the credential until a new scan succeeds; cancelling or a failed
      // scan must not strand an already-bound phone without a usable token.
      service?.stopPublishing(keepPreview = false); stopService(Intent(this@LiveCameraActivity, LiveCameraService::class.java))
      startActivity(Intent(this@LiveCameraActivity, MainActivity::class.java).putExtra("forceLegacy", true)); finish()
    } })
    bottom.addView(HorizontalScrollView(this).apply {
      isFillViewport = true; isHorizontalScrollBarEnabled = true
      addView(row, FrameLayout.LayoutParams(-2, -2))
    }, LinearLayout.LayoutParams(-1, -2))
    val exposureRow = LinearLayout(this).apply { gravity = Gravity.CENTER }
    exposureRow.addView(label(12f).apply { text = "曝光补偿" })
    exposure = SeekBar(this).apply {
      max = 100; progress = 50
      setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
        override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
          if (!fromUser) return
          val range = service?.capturer?.exposureRange() ?: return
          service?.capturer?.exposure(range.first + ((range.last - range.first) * progress / 100f).toInt())
        }
        override fun onStartTrackingTouch(seekBar: SeekBar?) = Unit
        override fun onStopTrackingTouch(seekBar: SeekBar?) = Unit
      })
    }
    exposure.contentDescription = "曝光补偿"
    exposureRow.addView(exposure, LinearLayout.LayoutParams(0, dp(48), 1f))
    bottom.addView(exposureRow, LinearLayout.LayoutParams(-1, -2))
    exposureRow.addOnLayoutChangeListener { view, left, _, right, _, _, _, _, _ ->
      val inset = ((right - left - dp(320)) / 2).coerceAtLeast(0)
      if (view.paddingLeft != inset) view.setPadding(inset, 0, inset, 0)
    }
    frame.addView(bottom, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
    setContentView(root)
    cameraFullscreen()
    ViewCompat.requestApplyInsets(root)
    val scale = ScaleGestureDetector(this, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
      override fun onScaleBegin(detector: ScaleGestureDetector): Boolean { animator?.cancel(); pendingZoom = service?.capturer?.zoom() ?: 1f; return true }
      override fun onScale(detector: ScaleGestureDetector): Boolean {
        val range = service?.capturer?.zoomRange() ?: return true
        pendingZoom = (pendingZoom * (1 + (detector.scaleFactor - 1) * 0.65f)).coerceIn(range.first, range.second)
        if (!zoomScheduled) { zoomScheduled = true; preview.postOnAnimation { zoomScheduled = false; service?.capturer?.setZoom(pendingZoom); showZoom(pendingZoom) } }
        return true
      }
    })
    val gestures = GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
      override fun onDown(e: MotionEvent) = true
      override fun onSingleTapConfirmed(e: MotionEvent): Boolean { focus(e, false); return true }
      override fun onLongPress(e: MotionEvent) { focus(e, true) }
      override fun onDoubleTap(e: MotionEvent): Boolean { animateZoom(if (lastZoom > 1.5f) 1f else 2f); return true }
    })
    preview.setOnTouchListener { _, event -> scale.onTouchEvent(event); if (!scale.isInProgress && event.pointerCount == 1) gestures.onTouchEvent(event); true }
    if (permissionsGranted()) startServiceSession() else permission.launch(arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO))
  }
  private fun permissionsGranted() = arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO).all { ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED }
  private fun showQualitySettings() {
    val connected = service ?: return
    // Keep 60 fps discoverable even when the camera or encoder does not expose it.
    val choices = connected.qualityAvailability().filter { it.unavailableReason == null || it.quality.fps == 60 }
    val labels = listOf("自动（优先 1080p · 60 帧）") + choices.map {
      if (it.unavailableReason != null) "${it.quality.label} · 暂不可用"
      else "${it.quality.label} · ${LocalQuality.recommendedBitrateKbps(it.quality.resolution, it.quality.fps) / 1000f} Mbps"
    }
    var selected = choices.indexOfFirst { it.quality == connected.requestedQuality } + 1
    AlertDialog.Builder(this).setTitle("画质设置 · 当前 ${connected.currentQuality().label}")
      .setSingleChoiceItems(labels.toTypedArray(), selected) { dialog, which ->
        val option = choices.getOrNull(which - 1)
        if (option?.unavailableReason != null) {
          (dialog as AlertDialog).listView.setItemChecked(selected, true)
          AlertDialog.Builder(this).setTitle(option.quality.label).setMessage(option.unavailableReason + "。系统相机可用的录像模式可能没有开放给其他 App；60 Hz 防频闪也不等于 60 FPS 录像。")
            .setPositiveButton("知道了", null).show()
        } else selected = which
      }
      .setPositiveButton("应用并重新接入") { _, _ -> connected.setQuality(choices.getOrNull(selected - 1)?.quality) }
      .setNegativeButton("取消", null).show()
  }
  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) cameraFullscreen()
  }
  override fun onStart() {
    super.onStart()
    getSystemService(DisplayManager::class.java).registerDisplayListener(displayListener, null)
    updateRotation()
  }
  override fun onStop() {
    getSystemService(DisplayManager::class.java).unregisterDisplayListener(displayListener)
    super.onStop()
  }
  private fun startServiceSession() {
    val target = Intent(this, LiveCameraService::class.java)
    intent.getStringExtra("url")?.let { target.putExtra("url", it) }
    intent.getStringExtra("code")?.let { target.putExtra("code", it) }
    intent.removeExtra("code"); intent.removeExtra("url")
    ContextCompat.startForegroundService(this, target)
    bindService(Intent(this, LiveCameraService::class.java), connection, Context.BIND_AUTO_CREATE)
  }
  private fun dp(value: Int) = (value * resources.displayMetrics.density).roundToInt()
  private fun label(size: Float) = TextView(this).apply { textSize = size; setTextColor(Color.WHITE); includeFontPadding = false }
  private fun controlButton(title: String) = Button(this).apply {
    text = title; textSize = 12f; isAllCaps = false; isSingleLine = true
    minWidth = dp(48); minimumWidth = dp(48); minHeight = dp(48); minimumHeight = dp(48)
    setPadding(dp(10), 0, dp(10), 0)
  }
  private fun render(state: LiveCameraUi) {
    status.text = "${state.cameraCode}  ● ${state.label}"; status.setTextColor(if (state.onAir) Color.RED else Color.WHITE)
    metrics.text = state.metrics; metrics.visibility = if (state.metrics.isBlank()) View.GONE else View.VISIBLE
    audio.text = state.audio + " · " + (service?.capturer?.stabilization ?: "")
    warning.text = state.warning; warning.visibility = if (state.warning.isBlank()) View.GONE else View.VISIBLE
    shutter.text = if (state.connecting || state.publishing) "停止接入" else "开始接入"
    val range = service?.capturer?.zoomRange() ?: (1f to 1f)
    if (range != drawnRange) {
      drawnRange = range; presets.removeAllViews()
      listOf(0.6f, 1f, 2f, 3f).filter { it >= range.first && it <= range.second }.forEach { value ->
        presets.addView(controlButton("${value}×").apply { setOnClickListener { animateZoom(value) } })
      }
    }
    exposure.isEnabled = (service?.capturer?.exposureRange()?.let { it.first != it.last } == true)
  }
  private fun showZoom(value: Float) { lastZoom = value; zoom.text = String.format("%.1f×", value) }
  private fun animateZoom(target: Float) {
    val capture = service?.capturer ?: return
    val range = capture.zoomRange()
    animator?.cancel()
    animator = ValueAnimator.ofFloat(capture.zoom(), target.coerceIn(range.first, range.second)).apply {
      duration = 240; addUpdateListener { val value = it.animatedValue as Float; capture.setZoom(value); showZoom(value) }; start()
    }
  }
  private fun focus(event: MotionEvent, lock: Boolean) {
    preview.performClick()
    service?.capturer?.focus(event.x, event.y, preview.width, preview.height, lock)
    focusRing.animate().cancel()
    focusRing.x = (event.x - focusRing.width / 2f).coerceIn(0f, (preview.width - focusRing.width).coerceAtLeast(0).toFloat())
    focusRing.y = (event.y - focusRing.height / 2f).coerceIn(0f, (preview.height - focusRing.height).coerceAtLeast(0).toFloat())
    focusRing.alpha = 1f; focusRing.visibility = View.VISIBLE
    focusRing.animate().alpha(0f).setStartDelay(900).setDuration(200).withEndAction { focusRing.visibility = View.INVISIBLE }.start()
    zoom.text = if (lock) "AF/AE 锁定" else "◎ 对焦"
    zoom.postDelayed({ showZoom(service?.capturer?.zoom() ?: 1f) }, 900)
  }
  override fun onDestroy() { animator?.cancel(); observer?.cancel(); service?.detach(preview); preview.release(); if (bound) unbindService(connection); super.onDestroy() }
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    updateRotation()
  }
}
