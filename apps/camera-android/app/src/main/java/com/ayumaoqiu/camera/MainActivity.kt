package com.ayumaoqiu.camera

import android.Manifest
import android.animation.ValueAnimator
import android.app.AlertDialog
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.provider.Settings
import android.view.Choreographer
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.widget.ArrayAdapter
import android.widget.CheckBox
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlin.math.abs

/**
 * The camera screen. It holds no session state of its own: it renders
 * [SessionState] from the service's [SessionController] and forwards the
 * operator's gestures back to it.
 */
class MainActivity : AppCompatActivity() {

  private lateinit var preview: SurfaceView
  private lateinit var focusRing: View
  private lateinit var zoomBadge: TextView
  private lateinit var stateDot: View
  private lateinit var stateText: TextView
  private lateinit var metricsText: TextView
  private lateinit var titleText: TextView
  private lateinit var pairPanel: View
  private lateinit var presetRow: LinearLayout
  private lateinit var shutter: View
  private lateinit var shutterCore: View

  private lateinit var prefs: Prefs
  private var controller: SessionController? = null
  private var bound = false
  private var collectJob: Job? = null
  private var surfaceReady = false

  /** The preset list currently drawn, so the row is only rebuilt when it changes. */
  private var drawnPresets: List<Float> = emptyList()
  private var zoomAnimator: ValueAnimator? = null
  private var pinching = false
  /** Latest pinch target not yet sent to the camera; NaN when none. */
  private var pendingZoom = Float.NaN
  private var zoomFrameScheduled = false
  private var drawnPhase: SessionPhase? = null
  private val chipActiveBg by lazy { oval(Color.parseColor("#CC000000")) }
  private val chipIdleBg by lazy { oval(Color.parseColor("#55000000")) }

  // ---------- Activity results ----------

  private val permissionLauncher =
    registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
      if (hasCorePermissions()) startSession() else showPermissionRationale()
    }

  private val scanLauncher = registerForActivityResult(ScanContract()) { result ->
    val payload = PairingPayload.parse(result.contents)
    when {
      result.contents == null -> controller?.resumePreview() // cancelled
      payload == null -> {
        toast(getString(R.string.pair_invalid))
        controller?.resumePreview()
      }
      else -> applyPairing(payload)
    }
  }

  private val connection = object : ServiceConnection {
    override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
      val session = (binder as? StreamService.LocalBinder)?.controller ?: return
      controller = session
      bound = true
      if (surfaceReady) session.attachSurface(preview)
      observe(session)
    }

    override fun onServiceDisconnected(name: ComponentName?) {
      bound = false
      controller = null
    }
  }

  // ---------- Lifecycle ----------

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (!intent.getBooleanExtra("forceLegacy", false) && LiveCameraApi(this).paired) {
      startActivity(Intent(this, LiveCameraActivity::class.java))
      finish()
      return
    }
    prefs = Prefs(this)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    applyOrientation()
    setContentView(R.layout.activity_main)
    cameraFullscreen()
    bindViews()
    styleStaticViews()

    preview.holder.addCallback(object : SurfaceHolder.Callback {
      override fun surfaceCreated(holder: SurfaceHolder) {
        surfaceReady = true
        controller?.attachSurface(preview)
      }

      override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) = Unit

      override fun surfaceDestroyed(holder: SurfaceHolder) {
        surfaceReady = false
        controller?.detachSurface()
      }
    })

    shutter.setOnClickListener { controller?.togglePublishing() }
    findViewById<View>(R.id.switchButton).setOnClickListener { controller?.switchCamera() }
    findViewById<View>(R.id.settingsButton).setOnClickListener { showSettings() }
    findViewById<View>(R.id.scanButton).setOnClickListener { startScan() }
    findViewById<View>(R.id.manualButton).setOnClickListener { showManualPairing() }
    setUpGestures()

    // Android 14 refuses a camera-type foreground service started before the
    // camera permission is granted, so the service only starts once it is.
    if (hasCorePermissions()) startSession() else requestPermissions()
  }

  override fun onDestroy() {
    if (!::prefs.isInitialized) { super.onDestroy(); return }
    zoomAnimator?.cancel()
    Choreographer.getInstance().removeFrameCallback(zoomFrame)
    collectJob?.cancel()
    if (bound) {
      unbindService(connection)
      bound = false
    }
    super.onDestroy()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) cameraFullscreen()
  }

  private fun startSession() {
    StreamService.start(this)
    if (!bound) bindService(Intent(this, StreamService::class.java), connection, Context.BIND_AUTO_CREATE)
  }

  private fun bindViews() {
    preview = findViewById(R.id.preview)
    focusRing = findViewById(R.id.focusRing)
    zoomBadge = findViewById(R.id.zoomBadge)
    stateDot = findViewById(R.id.stateDot)
    stateText = findViewById(R.id.stateText)
    metricsText = findViewById(R.id.metricsText)
    titleText = findViewById(R.id.titleText)
    pairPanel = findViewById(R.id.pairPanel)
    presetRow = findViewById(R.id.presetRow)
    shutter = findViewById(R.id.shutter)
    shutterCore = findViewById(R.id.shutterCore)
  }

  private fun styleStaticViews() {
    focusRing.background = GradientDrawable().apply {
      shape = GradientDrawable.OVAL
      setStroke(dp(2), Color.parseColor("#FFD54F"))
    }
    zoomBadge.background = pill(Color.parseColor("#99000000"))
    presetRow.background = pill(Color.parseColor("#66000000"))
    shutter.background = GradientDrawable().apply {
      shape = GradientDrawable.OVAL
      setStroke(dp(4), Color.WHITE)
    }
  }

  // ---------- Rendering ----------

  private fun observe(session: SessionController) {
    collectJob?.cancel()
    collectJob = lifecycleScope.launch {
      repeatOnLifecycle(Lifecycle.State.STARTED) {
        session.state.collect { render(it) }
      }
    }
  }

  private fun render(state: SessionState) {
    pairPanel.visibility = if (state.phase == SessionPhase.UNPAIRED) View.VISIBLE else View.GONE

    stateText.text = state.message
    if (state.phase != drawnPhase) {
      drawnPhase = state.phase
      stateDot.background = oval(phaseColor(state.phase))
    }
    titleText.text = listOf(state.title, state.subtitle, state.resolutionLabel)
      .filter { it.isNotBlank() }
      .joinToString(" · ")

    metricsText.text = buildString {
      if (state.phase == SessionPhase.LIVE && state.bitrateKbps > 0) {
        append(String.format("%.1f Mbps", state.bitrateKbps / 1000f))
        if (state.fps > 0) append(" · ${state.fps}fps")
      }
      if (state.micName.isNotBlank()) {
        if (isNotEmpty()) append(" · ")
        append("🎙 ${state.micName}")
      }
    }

    renderShutter(state)
    renderPresets(state)
    if (!pinching && zoomAnimator?.isRunning != true) setBadgeText(state.zoom)
  }

  private fun renderShutter(state: SessionState) {
    // Without a config the button retries the connection, so it stays usable
    // whenever the phone is paired.
    val canStart = state.phase != SessionPhase.UNPAIRED && !state.isBusy
    shutter.isEnabled = canStart || state.isPublishing
    shutter.alpha = if (shutter.isEnabled) 1f else 0.4f
    shutter.contentDescription = getString(if (state.isPublishing) R.string.action_stop else R.string.action_start)

    // Round red dot to start; a smaller rounded square while live, as on a camera.
    val live = state.isPublishing
    val size = if (live) dp(30) else dp(58)
    shutterCore.layoutParams = (shutterCore.layoutParams as FrameLayout.LayoutParams).apply {
      width = size
      height = size
      gravity = Gravity.CENTER
    }
    shutterCore.background = GradientDrawable().apply {
      setColor(Color.parseColor("#F44336"))
      cornerRadius = if (live) dp(6).toFloat() else dp(29).toFloat()
    }
  }

  /** Camera-style lens stops: 0.5 / 1 / 2 / 5 ..., limited to what this phone allows. */
  private fun renderPresets(state: SessionState) {
    val presets = state.zoomScale.presets()
    if (presets != drawnPresets) {
      drawnPresets = presets
      presetRow.removeAllViews()
      presets.forEach { preset ->
        presetRow.addView(TextView(this).apply {
          tag = preset
          gravity = Gravity.CENTER
          textSize = 12f
          minWidth = dp(40)
          minHeight = dp(40)
          setOnClickListener { animateZoomTo(preset) }
        }, LinearLayout.LayoutParams(dp(40), dp(40)).apply { setMargins(dp(3), 0, dp(3), 0) })
      }
    }
    presetRow.visibility = if (presets.size > 1) View.VISIBLE else View.GONE

    // Highlight the stop nearest to the current zoom, and show the live value on it.
    val active = presets.minByOrNull { abs(it - state.zoom) }
    for (index in 0 until presetRow.childCount) {
      val chip = presetRow.getChildAt(index) as TextView
      val preset = chip.tag as Float
      val selected = preset == active && abs(preset - state.zoom) / preset < ACTIVE_TOLERANCE
      val text = if (preset == active) formatZoom(state.zoom) else formatPreset(preset)
      if (chip.text != text) chip.text = text
      chip.setTextColor(if (selected) COLOR_SELECTED else Color.WHITE)
      val bg = if (preset == active) chipActiveBg else chipIdleBg
      if (chip.background !== bg) chip.background = bg
    }
  }

  private fun oval(color: Int) = GradientDrawable().apply {
    shape = GradientDrawable.OVAL
    setColor(color)
  }

  // ---------- Gestures ----------

  /**
   * Camera gestures on the picture:
   * - two fingers: pinch to zoom, continuously, with a big read-out;
   * - one tap: focus there, with a ring;
   * - double tap: jump between 1x and 2x.
   */
  private fun setUpGestures() {
    val scaleDetector = ScaleGestureDetector(this, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
      /** Target zoom accumulated over the gesture; see [onScale]. */
      private var target = 1f

      override fun onScaleBegin(detector: ScaleGestureDetector): Boolean {
        val session = controller ?: return false
        zoomAnimator?.cancel()
        pinching = true
        target = session.readZoom()
        showZoomBadge()
        return true
      }

      override fun onScale(detector: ScaleGestureDetector): Boolean {
        val session = controller ?: return false
        // scaleFactor is relative to the *previous* event, not to the start of
        // the gesture, so it has to be accumulated. Clamping as we go keeps
        // the zoom from "sticking" after pinching past the phone's limit.
        target = session.state.value.zoomScale.clamp(target * detector.scaleFactor)
        // Touch events can arrive at 120-240 Hz; the camera only needs one
        // request per displayed frame.
        pendingZoom = target
        if (!zoomFrameScheduled) {
          zoomFrameScheduled = true
          Choreographer.getInstance().postFrameCallback(zoomFrame)
        }
        return true
      }

      override fun onScaleEnd(detector: ScaleGestureDetector) {
        pinching = false
        flushPendingZoom()
        controller?.commitZoom()
        hideZoomBadge()
      }
    })

    val tapDetector = GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
      override fun onDown(event: MotionEvent): Boolean = true

      override fun onSingleTapConfirmed(event: MotionEvent): Boolean {
        val session = controller ?: return false
        if (session.state.value.config == null) return false
        session.tapToFocus(preview, event)
        showFocusRing(event.x, event.y)
        return true
      }

      override fun onDoubleTap(event: MotionEvent): Boolean {
        val session = controller ?: return false
        val scale = session.state.value.zoomScale
        if (!scale.isAdjustable) return false
        val next = if (session.readZoom() < 1.5f) scale.clamp(2f) else scale.clamp(1f)
        animateZoomTo(next)
        return true
      }
    })

    preview.setOnTouchListener { view, event ->
      scaleDetector.onTouchEvent(event)
      // A pinch must not also count as a tap when the fingers lift.
      if (!scaleDetector.isInProgress && event.pointerCount == 1) tapDetector.onTouchEvent(event)
      if (event.actionMasked == MotionEvent.ACTION_UP) view.performClick()
      true
    }
  }

  /** Smoothly zooms to a lens stop, as a camera app does. */
  private fun animateZoomTo(target: Float) {
    val session = controller ?: return
    val scale = session.state.value.zoomScale
    if (!scale.isAdjustable) return
    zoomAnimator?.cancel()
    val from = session.readZoom()
    val to = scale.clamp(target)
    showZoomBadge()
    zoomAnimator = ValueAnimator.ofFloat(from, to).apply {
      duration = ZOOM_ANIMATION_MS
      interpolator = DecelerateInterpolator()
      addUpdateListener {
        val value = it.animatedValue as Float
        session.setZoom(value, notify = false)
        setBadgeText(value)
      }
      addListener(object : android.animation.AnimatorListenerAdapter() {
        override fun onAnimationEnd(animation: android.animation.Animator) {
          session.commitZoom()
          hideZoomBadge()
        }
      })
      start()
    }
  }

  /** Applies the latest pinch value once per frame. */
  private val zoomFrame = Choreographer.FrameCallback {
    zoomFrameScheduled = false
    flushPendingZoom()
  }

  private fun flushPendingZoom() {
    val value = pendingZoom
    if (value.isNaN()) return
    pendingZoom = Float.NaN
    controller?.setZoom(value, notify = false)
    setBadgeText(value)
  }

  /** Only touches the TextView when the shown digits change, to avoid relayouts. */
  private fun setBadgeText(zoom: Float) {
    val text = formatZoom(zoom)
    if (zoomBadge.text != text) zoomBadge.text = text
  }

  private fun showZoomBadge() {
    zoomBadge.animate().cancel()
    zoomBadge.animate().alpha(1f).setDuration(120).start()
  }

  private fun hideZoomBadge() {
    zoomBadge.animate().alpha(0f).setStartDelay(700).setDuration(300).start()
  }

  private fun showFocusRing(x: Float, y: Float) {
    focusRing.animate().cancel()
    focusRing.visibility = View.VISIBLE
    val position = IntArray(2); preview.getLocationInWindow(position)
    focusRing.x = x + position[0] - focusRing.width / 2f
    focusRing.y = y + position[1] - focusRing.height / 2f
    focusRing.scaleX = 1.4f
    focusRing.scaleY = 1.4f
    focusRing.alpha = 1f
    focusRing.animate()
      .scaleX(1f).scaleY(1f).setDuration(200)
      .withEndAction {
        focusRing.animate().alpha(0f).setStartDelay(800).setDuration(300)
          .withEndAction { focusRing.visibility = View.INVISIBLE }
          .start()
      }
      .start()
  }

  // ---------- Pairing ----------

  private fun applyPairing(payload: PairingPayload) {
    if (payload.isMulticamera) {
      controller?.shutdown()
      stopService(Intent(this, StreamService::class.java))
      startActivity(Intent(this, LiveCameraActivity::class.java).putExtra("url", payload.baseUrl).putExtra("code", payload.token))
      finish()
    } else controller?.applyPairing(payload)
  }

  private fun startScan() {
    val session = controller ?: return
    if (session.state.value.isPublishing) {
      toast("正在推流，请先停止推流再重新配对")
      return
    }
    // The scanner needs the camera; two clients cannot hold it at once.
    session.closeCamera()
    scanLauncher.launch(
      ScanOptions()
        .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
        .setPrompt(getString(R.string.pair_prompt))
        .setBeepEnabled(false)
        .setOrientationLocked(false),
    )
  }

  private fun showManualPairing() {
    val view = layoutInflater.inflate(R.layout.dialog_pair_manual, null)
    val baseUrl = view.findViewById<EditText>(R.id.baseUrl)
    val token = view.findViewById<EditText>(R.id.token)
    baseUrl.setText(prefs.baseUrl)

    AlertDialog.Builder(this)
      .setTitle(R.string.pair_manual)
      .setView(view)
      .setPositiveButton("连接") { _, _ ->
        val payload = PairingPayload.parse(
          PairingPayload(baseUrl.text.toString(), token.text.toString()).toJson(),
        )
        if (payload == null) toast("后台地址需以 http:// 或 https:// 开头，配对码要完整粘贴")
        else applyPairing(payload)
      }
      .setNegativeButton("取消", null)
      .show()
  }

  // ---------- Settings ----------

  private fun showSettings() {
    val session = controller ?: return
    val view = layoutInflater.inflate(R.layout.dialog_settings, null)
    val serverInfo = view.findViewById<TextView>(R.id.serverInfo)
    val micSpinner = view.findViewById<Spinner>(R.id.micSpinner)
    val forceLandscape = view.findViewById<CheckBox>(R.id.forceLandscape)
    val deviceInfo = view.findViewById<TextView>(R.id.deviceInfo)
    val qualityInfo = view.findViewById<TextView>(R.id.qualityInfo)
    val qualityHint = view.findViewById<TextView>(R.id.qualityHint)
    val qualitySpinner = view.findViewById<Spinner>(R.id.qualitySpinner)
    val qualities = session.qualityOptions()
    qualitySpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item,
      listOf("自动（按设备能力）") + qualities.map { it.label })
    qualitySpinner.setSelection(qualities.indexOf(prefs.manualQuality) + 1)

    val state = session.state.value

    // Quality is read-only: it is whatever this phone's camera and encoder can
    // actually do in 16:9, so there is nothing for the operator to choose.
    val chosen = session.currentQuality()
    val bitrateKbps = session.currentBitrateKbps()
    qualityInfo.text = if (chosen == null) {
      "正在读取摄像头能力…"
    } else {
      buildString {
        append("${chosen.width}×${chosen.height} · ${chosen.fps} 帧")
        if (bitrateKbps != null) append(" · 约 ${bitrateKbps / 1000f} Mbps")
        // Say so when the rate is not the tier's own: the operator set that cap
        // and needs to see it taking effect, not wonder why the picture is soft.
        val tierKbps = LocalQuality.recommendedBitrateKbps(chosen.resolution, chosen.fps)
        if (bitrateKbps != null && bitrateKbps < tierKbps) append("（后台限速）")
      }
    }
    qualityHint.text = if (session.qualityOptions().isEmpty()) {
      "没能读取到这台手机支持的画质，将按 1080p · 30 帧 兜底推流。"
    } else {
      "只列出当前镜头与编码器支持的组合；保存画质会重新接入直播。"
    }
    serverInfo.text = buildString {
      append("后台：${session.baseUrl}")
      if (state.title.isNotBlank()) append("\n直播间：${state.title}")
      append("\n状态：${if (session.isPaired) "已配对" else "未配对"}")
    }

    val options = listOf(MicOption(-1, "自动（按后台设置，优先外接）", false)) + session.microphoneOptions()
    micSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, options.map { it.name })
    micSpinner.setSelection(options.indexOfFirst { it.id == prefs.micDeviceId }.coerceAtLeast(0))
    forceLandscape.isChecked = prefs.forceLandscape

    deviceInfo.text = buildString {
      append("Android ${Build.VERSION.RELEASE}（API ${Build.VERSION.SDK_INT}）")
      if (state.cameras.isNotEmpty()) append(" · 镜头 ${state.cameras.size} 个")
      append(String.format(" · 变焦 %.1f×–%.1f×", state.zoomMin, state.zoomMax))
      if (options.size <= 1) append("\n只找到手机自带麦克风")
    }

    AlertDialog.Builder(this)
      .setTitle(R.string.action_settings)
      .setView(view)
      .setPositiveButton("保存") { _, _ ->
        val micId = options.getOrNull(micSpinner.selectedItemPosition)?.id ?: -1
        val orientationChanged = forceLandscape.isChecked != prefs.forceLandscape
        prefs.forceLandscape = forceLandscape.isChecked
        session.setManualQuality(qualities.getOrNull(qualitySpinner.selectedItemPosition - 1))
        if (micId != prefs.micDeviceId) session.setPreferredMicId(micId)
        // Setting requestedOrientation recreates the activity, so only do it when
        // it actually changed; otherwise just re-measure the quality.
        if (orientationChanged) {
          applyOrientation()
        } else {
          // The operator may have just switched lenses; the tier follows the lens.
          session.reapplyAutoQuality()
        }
      }
      .setNeutralButton("重新扫码") { _, _ -> startScan() }
      .setNegativeButton("解除配对") { _, _ -> confirmUnpair() }
      .show()
  }

  private fun confirmUnpair() {
    AlertDialog.Builder(this)
      .setTitle("解除配对？")
      .setMessage("会停止推流，后台的这个直播间会显示摄像端未配对。之后需要重新扫码。")
      .setPositiveButton("解除") { _, _ -> controller?.unpair() }
      .setNegativeButton("取消", null)
      .show()
  }

  private fun applyOrientation() {
    requestedOrientation = if (prefs.forceLandscape) {
      ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    } else {
      ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
    }
  }

  // ---------- Permissions ----------

  private fun corePermissions(): Array<String> =
    arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)

  private fun hasCorePermissions(): Boolean = corePermissions().all {
    ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
  }

  private fun requestPermissions() {
    val wanted = corePermissions().toMutableList()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      // Optional: without it the "推流中" notification is hidden, nothing breaks.
      wanted += Manifest.permission.POST_NOTIFICATIONS
    }
    permissionLauncher.launch(wanted.toTypedArray())
  }

  private fun showPermissionRationale() {
    AlertDialog.Builder(this)
      .setMessage(R.string.permission_needed)
      .setCancelable(false)
      .setPositiveButton(R.string.permission_settings) { _, _ ->
        startActivity(
          Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)),
        )
      }
      .setNegativeButton("重试") { _, _ -> requestPermissions() }
      .show()
  }

  override fun onResume() {
    super.onResume()
    if (!::prefs.isInitialized || isFinishing) return
    // Returning from system settings with the permissions now granted.
    if (!bound && hasCorePermissions()) startSession()
  }

  // ---------- Helpers ----------

  private fun phaseColor(phase: SessionPhase): Int = Color.parseColor(
    when (phase) {
      SessionPhase.LIVE -> "#F44336"
      SessionPhase.CONNECTING, SessionPhase.RECONNECTING, SessionPhase.LOADING -> "#FFB300"
      SessionPhase.READY -> "#4CAF50"
      SessionPhase.ERROR -> "#E91E63"
      SessionPhase.UNPAIRED -> "#9E9E9E"
    },
  )

  private fun formatZoom(zoom: Float): String =
    if (zoom >= 10f) String.format("%.0f×", zoom) else String.format("%.1f×", zoom)

  private fun formatPreset(preset: Float): String =
    if (preset < 1f) String.format("%.1f", preset) else String.format("%.0f", preset)

  private fun pill(color: Int) = GradientDrawable().apply {
    setColor(color)
    cornerRadius = dp(24).toFloat()
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

  private fun toast(message: String) {
    Toast.makeText(this, message, Toast.LENGTH_LONG).show()
  }

  companion object {
    private const val ZOOM_ANIMATION_MS = 260L
    /** How close the zoom must be to a stop for that stop to light up. */
    private const val ACTIVE_TOLERANCE = 0.04f
    private val COLOR_SELECTED = Color.parseColor("#FFD54F")
  }
}
