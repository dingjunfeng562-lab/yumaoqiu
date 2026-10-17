package com.ayumaoqiu.camera

import android.Manifest
import android.app.AlertDialog
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
import android.net.Uri
import android.os.Bundle
import android.os.IBinder
import android.provider.Settings
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
import java.util.Locale
import kotlin.math.roundToInt

class LiveCameraActivity : AppCompatActivity() {
  private lateinit var preview: SurfaceViewRenderer
  private lateinit var focusRing: View
  private lateinit var status: TextView
  private lateinit var metrics: TextView
  private lateinit var audio: TextView
  private lateinit var warning: TextView
  private lateinit var programBadge: TextView
  private lateinit var zoom: TextView
  private lateinit var zoomSlider: SeekBar
  private lateinit var presets: LinearLayout
  private lateinit var shutter: Button
  private lateinit var exposure: SeekBar
  private var service: LiveCameraService? = null
  private var bound = false
  private var observer: Job? = null
  private var drawnRange: Pair<Float, Float>? = null
  private var lastZoom = 1f
  private var pendingZoom = 1f
  private var zoomSliderDragging = false
  private var multiTouchGesture = false
  private var audioPermissionPrompted = false
  private var audioPermissionRequestInFlight = false
  private val displayListener = object : DisplayManager.DisplayListener {
    override fun onDisplayAdded(displayId: Int) = Unit
    override fun onDisplayRemoved(displayId: Int) = Unit
    override fun onDisplayChanged(displayId: Int) { updateRotation() }
  }
  @Suppress("DEPRECATION")
  private fun updateRotation() { service?.capturer?.rotation = windowManager.defaultDisplay.rotation }
  private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    if (granted) startServiceSession() else warning.text = "需要摄像头权限才能预览和接入，请在系统设置中允许后重试"
  }
  private val audioPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    audioPermissionRequestInFlight = false
    audioPermissionPrompted = true
    if (granted) {
      service?.onAudioPermissionChanged()
    } else {
      service?.onAudioPermissionDenied()
      AlertDialog.Builder(this)
        .setTitle("主音频需要麦克风权限")
        .setMessage("只有后台把本机设为主音频机位时才需要此权限。授权后才会发布 DJI Mic 或手机麦克风声音。")
        .setPositiveButton("去系统设置") { _, _ ->
          startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
        }
        .setNegativeButton("稍后", null)
        .show()
    }
  }
  private val connection = object : ServiceConnection {
    override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
      val connected = (binder as? LiveCameraService.LocalBinder)?.service ?: return
      service = connected; bound = true
      connected.attach(preview)
      connected.setUiVisible(lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))
      updateRotation()
      observer?.cancel()
      observer = lifecycleScope.launch {
        repeatOnLifecycle(Lifecycle.State.STARTED) {
          launch { connected.state.collect { render(it) } }
          launch { connected.zoomState.collect { showZoom(it) } }
        }
      }
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
    val zoomRow = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
    val row = LinearLayout(this).apply { gravity = Gravity.CENTER }
    zoom = label(14f).apply { text = "1.0×"; setPadding(dp(8), 0, dp(8), 0) }
    zoomSlider = SeekBar(this).apply {
      max = ZOOM_SLIDER_STEPS
      progress = 0
      contentDescription = "变焦倍率"
      setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
        override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
          if (!fromUser) return
          val range = service?.capturer?.zoomRange() ?: return
          val target = ZoomScale(range.first, range.second, ZOOM_SLIDER_STEPS).zoomAt(progress)
          pendingZoom = target
          service?.capturer?.setZoom(target)
        }
        override fun onStartTrackingTouch(seekBar: SeekBar?) {
          zoomSliderDragging = true
          lastZoom = service?.capturer?.zoom() ?: lastZoom
          service?.capturer?.setZoom(lastZoom)
        }
        override fun onStopTrackingTouch(seekBar: SeekBar?) {
          zoomSliderDragging = false
        }
      })
    }
    zoomRow.addView(label(12f).apply { text = "变焦" })
    zoomRow.addView(zoom)
    zoomRow.addView(zoomSlider, LinearLayout.LayoutParams(0, dp(48), 1f))
    presets = LinearLayout(this).apply { gravity = Gravity.CENTER }
    shutter = controlButton("开始接入").apply { setOnClickListener {
      if (!cameraPermissionGranted()) cameraPermission.launch(Manifest.permission.CAMERA) else service?.toggle()
    } }
    row.addView(presets); row.addView(shutter)
    row.addView(controlButton("画质设置").apply { setOnClickListener { showQualitySettings() } })
    row.addView(controlButton("码率上限").apply { setOnClickListener { showBitrateSettings() } })
    row.addView(controlButton("低清预览").apply { setOnClickListener { showSimulcastSettings() } })
    row.addView(controlButton("音频设置").apply { setOnClickListener { showAudioSettings() } })
    row.addView(controlButton("前后镜头").apply { setOnClickListener { service?.switchLens(); drawnRange = null } })
    row.addView(controlButton("恢复自动").apply { setOnClickListener {
      service?.capturer?.resetFocusAndExposure()
      val range = service?.capturer?.exposureRange() ?: (0..0)
      exposure.progress = if (range.last > range.first) (-range.first * 100 / (range.last - range.first)) else 50
      zoom.text = "自动对焦/曝光"
      zoom.postDelayed({ showZoom(service?.capturer?.zoom() ?: 1f) }, 900)
    } })
    row.addView(controlButton("重新配对").apply { setOnClickListener {
      // Keep the credential until a new scan succeeds; cancelling or a failed
      // scan must not strand an already-bound phone without a usable token.
      service?.stopPublishing(keepPreview = false); stopService(Intent(this@LiveCameraActivity, LiveCameraService::class.java))
      startActivity(Intent(this@LiveCameraActivity, MainActivity::class.java).putExtra("forceLegacy", true)); finish()
    } })
    bottom.addView(zoomRow, LinearLayout.LayoutParams(-1, -2))
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
    programBadge = label(12f).apply {
      setText(R.string.camera_program_badge)
      setPadding(dp(12), dp(8), dp(12), dp(8))
      isSingleLine = true
      isClickable = false
      isFocusable = false
      visibility = View.INVISIBLE
      accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
      background = GradientDrawable().apply {
        setColor(0xDDAC2430.toInt())
        cornerRadius = dp(8).toFloat()
        setStroke(dp(1), 0x66FFFFFF)
      }
    }
    // A persistent in-app tally; it neither steals focus nor becomes a video overlay.
    frame.addView(programBadge, FrameLayout.LayoutParams(-2, -2, Gravity.START or Gravity.BOTTOM).apply {
      marginStart = dp(12)
      bottomMargin = dp(8)
    })
    bottom.addOnLayoutChangeListener { view, _, _, _, _, _, _, _, _ ->
      val params = programBadge.layoutParams as FrameLayout.LayoutParams
      val margin = view.height + dp(8)
      if (params.bottomMargin != margin) {
        params.bottomMargin = margin
        programBadge.layoutParams = params
      }
    }
    setContentView(root)
    cameraFullscreen()
    ViewCompat.requestApplyInsets(root)
    val scale = ScaleGestureDetector(this, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
      override fun onScaleBegin(detector: ScaleGestureDetector): Boolean {
        val capture = service?.capturer ?: return false
        pendingZoom = capture.zoom()
        capture.setZoom(pendingZoom) // A finger takes over any preset transition.
        return true
      }
      override fun onScale(detector: ScaleGestureDetector): Boolean {
        val range = service?.capturer?.zoomRange() ?: return true
        // Follow the fingers directly; clamp each event so reversing at the
        // lens limit responds immediately instead of sticking at the endpoint.
        pendingZoom = (pendingZoom * detector.scaleFactor).coerceIn(range.first, range.second)
        service?.capturer?.setZoom(pendingZoom)
        return true
      }
    })
    val gestures = GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
      override fun onDown(e: MotionEvent) = true
      override fun onSingleTapConfirmed(e: MotionEvent): Boolean { focus(e, false); return true }
      override fun onLongPress(e: MotionEvent) { focus(e, true) }
      override fun onDoubleTap(e: MotionEvent): Boolean { requestZoom(if (lastZoom > 1.5f) 1f else 2f); return true }
    })
    preview.setOnTouchListener { _, event ->
      if (event.actionMasked == MotionEvent.ACTION_DOWN) multiTouchGesture = false
      if (event.pointerCount > 1 && !multiTouchGesture) {
        multiTouchGesture = true
        val cancel = MotionEvent.obtain(event)
        cancel.action = MotionEvent.ACTION_CANCEL
        gestures.onTouchEvent(cancel)
        cancel.recycle()
      }
      scale.onTouchEvent(event)
      // Lifting one finger after a pinch must not trigger AF/AE and a focus hunt.
      if (!multiTouchGesture) gestures.onTouchEvent(event)
      true
    }
    audio.setOnClickListener {
      if (service?.state?.value?.requiresAudioPermission == true) requestAudioPermission(force = true)
      else showAudioSettings()
    }
    if (cameraPermissionGranted()) startServiceSession() else cameraPermission.launch(Manifest.permission.CAMERA)
  }
  private fun cameraPermissionGranted() = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
  private fun audioPermissionGranted() = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
  private fun requestAudioPermission(force: Boolean = false) {
    if (audioPermissionGranted()) {
      service?.onAudioPermissionChanged()
      return
    }
    if (audioPermissionRequestInFlight || (!force && audioPermissionPrompted)) return
    audioPermissionRequestInFlight = true
    audioPermission.launch(Manifest.permission.RECORD_AUDIO)
  }
  private fun showQualitySettings() {
    val connected = service ?: return
    // Keep 60 fps discoverable even when the camera or encoder does not expose it.
    val choices = connected.qualityAvailability().filter { it.unavailableReason == null || it.quality.fps == 60 }
    val labels = listOf("自动（优先 1080p · 60 帧）") + choices.map {
      if (it.unavailableReason != null) "${it.quality.label} · 暂不可用"
      else it.quality.label
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
  private fun showBitrateSettings() {
    val connected = service ?: return
    val choices = listOf(2, 3, 4, 5, 6)
    var selected = choices.indexOf(connected.bitrateMbps)
    AlertDialog.Builder(this).setTitle("主视频码率上限（低清预览另计约 0.4 Mbps）")
      .setSingleChoiceItems(choices.map { "$it Mbps" }.toTypedArray(), selected) { _, index -> selected = index }
      .setPositiveButton("应用并重新接入") { _, _ -> connected.setBitrate(choices[selected]) }
      .setNegativeButton("取消", null).show()
  }
  private fun showAudioSettings() {
    val connected = service ?: return
    var allow = connected.allowInternalFallback
    AlertDialog.Builder(this).setTitle("主音频输入")
      .setMessage("默认：主音频被指定到本机后，若 10 秒内仍没有 USB 麦克风，会自动启用内置麦克风并在界面提示；插入 USB 麦克风后自动切回。")
      .setSingleChoiceItems(arrayOf("只允许 USB 麦克风（拔出暂停声音）", "USB 优先，明确允许内置麦克风备用"), if (allow) 1 else 0) { _, index -> allow = index == 1 }
      .setPositiveButton("保存") { _, _ -> connected.setInternalFallback(allow) }
      .setNegativeButton("取消", null).show()
  }
  private fun showSimulcastSettings() {
    val connected = service ?: return
    var enabled = connected.simulcastEnabled
    AlertDialog.Builder(this).setTitle("低清预览兼容性")
      .setSingleChoiceItems(arrayOf("开启 360p / 12 FPS / 0.4 Mbps", "关闭辅助层（编码不兼容时使用）"), if (enabled) 0 else 1) { _, index -> enabled = index == 0 }
      .setPositiveButton("应用并重新接入") { _, _ ->
        if (enabled) connected.setSimulcast(true)
        else AlertDialog.Builder(this).setTitle("关闭后预览会使用主视频")
          .setMessage("仅在手机 H.264 双层编码不兼容时关闭。导播应减少同时播放的预览数，并重新测量网络带宽；这不是低带宽模式。")
          .setPositiveButton("确认关闭") { _, _ -> connected.setSimulcast(false) }
          .setNegativeButton("取消", null).show()
      }
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
  override fun onResume() {
    super.onResume()
    if (cameraPermissionGranted() && !bound) startServiceSession()
    service?.setUiVisible(true)
    if (audioPermissionGranted() && service?.state?.value?.requiresAudioPermission == true) {
      service?.onAudioPermissionChanged()
    }
  }
  override fun onStop() {
    service?.setUiVisible(false)
    getSystemService(DisplayManager::class.java).unregisterDisplayListener(displayListener)
    super.onStop()
  }
  private fun startServiceSession() {
    val target = Intent(this, LiveCameraService::class.java)
    intent.getStringExtra("url")?.let { target.putExtra("url", it) }
    intent.getStringExtra("code")?.let { target.putExtra("code", it) }
    intent.removeExtra("code"); intent.removeExtra("url")
    ContextCompat.startForegroundService(this, target)
    if (!bound) bound = bindService(Intent(this, LiveCameraService::class.java), connection, Context.BIND_AUTO_CREATE)
  }
  private fun dp(value: Int) = (value * resources.displayMetrics.density).roundToInt()
  private fun label(size: Float) = TextView(this).apply { textSize = size; setTextColor(Color.WHITE); includeFontPadding = false }
  private fun controlButton(title: String) = Button(this).apply {
    text = title; textSize = 12f; isAllCaps = false; isSingleLine = true
    minWidth = dp(48); minimumWidth = dp(48); minHeight = dp(48); minimumHeight = dp(48)
    setPadding(dp(10), 0, dp(10), 0)
  }
  private fun render(state: LiveCameraUi) {
    val badgeVisibility = if (state.isProgramCamera && state.publishing) View.VISIBLE else View.INVISIBLE
    if (programBadge.visibility != badgeVisibility) programBadge.visibility = badgeVisibility
    status.text = "${state.cameraCode}  ● ${state.label}"; status.setTextColor(if (state.onAir) Color.RED else Color.WHITE)
    metrics.text = state.metrics; metrics.visibility = if (state.metrics.isBlank()) View.GONE else View.VISIBLE
    audio.text = state.audio + " · " + (service?.capturer?.stabilization ?: "")
    val warnings = listOf(state.warning, state.audioWarning).filter { it.isNotBlank() }.joinToString(" · ")
    warning.text = warnings; warning.visibility = if (warnings.isBlank()) View.GONE else View.VISIBLE
    shutter.text = if (state.connecting || state.publishing) "停止接入" else "开始接入"
    val range = service?.capturer?.zoomRange() ?: (1f to 1f)
    if (state.requiresAudioPermission) requestAudioPermission()
    else audioPermissionPrompted = false
    if (range != drawnRange) {
      drawnRange = range; presets.removeAllViews()
      listOf(0.6f, 1f, 2f, 3f).filter { it >= range.first && it <= range.second }.forEach { value ->
        presets.addView(controlButton("${value}×").apply { setOnClickListener { requestZoom(value) } })
      }
      zoomSlider.isEnabled = range.second > range.first
    }
    exposure.isEnabled = (service?.capturer?.exposureRange()?.let { it.first != it.last } == true)
  }
  private fun showZoom(value: Float) {
    lastZoom = value
    val text = String.format(Locale.US, "%.1f×", value)
    if (zoom.text.toString() != text) zoom.text = text
    if (!zoomSliderDragging) {
      val range = service?.capturer?.zoomRange() ?: return
      val progress = ZoomScale(range.first, range.second, ZOOM_SLIDER_STEPS).progressOf(value)
      if (zoomSlider.progress != progress) zoomSlider.progress = progress
    }
  }
  private fun requestZoom(target: Float) {
    val capture = service?.capturer ?: return
    val range = capture.zoomRange()
    capture.animateZoom(target.coerceIn(range.first, range.second))
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
  override fun onDestroy() { observer?.cancel(); service?.setUiVisible(false); service?.detach(preview); preview.release(); if (bound) unbindService(connection); super.onDestroy() }
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    updateRotation()
  }
  companion object { private const val ZOOM_SLIDER_STEPS = 1000 }
}
