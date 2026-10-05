package com.ayumaoqiu.camera

import android.content.Context
import android.view.SurfaceView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * The single owner of the broadcast session.
 *
 * Everything that used to be spread over the activity and the service - the
 * camera, the preview surface, the heartbeat, the reconnection - lives here, and
 * the whole session is exposed as one [SessionState] stream. The activity only
 * renders it and sends intents back, so the two can no longer disagree about
 * whether the stream is running.
 *
 * Every method must be called from the main thread.
 */
class SessionController(
  context: Context,
  private val prefs: Prefs,
  private val scope: CoroutineScope,
) {

  private val appContext = context.applicationContext
  private val api = ApiClient(prefs)
  private val engine = StreamEngine(appContext)

  private val mutableState = MutableStateFlow(SessionState())
  val state: StateFlow<SessionState> = mutableState.asStateFlow()

  private var surface: SurfaceView? = null
  private var heartbeatJob: Job? = null
  private var applyingVersion = -1
  private var autoQuality: LocalQuality? = null

  init {
    engine.setPreferredMicId(prefs.micDeviceId)
    engine.setListener { status -> onEngineStatus(status) }
    // The camera may not be open yet; whichever lens is available now gives a
    // usable baseline, and the tier is recomputed after every camera switch.
    refreshAutoQuality()
  }

  /**
   * Picks this phone's stream tier from its own camera and encoder.
   *
   * Called before every prepare and after every lens change: a different lens
   * can have a different set of output sizes, so the tier has to be re-derived
   * rather than copied from the back camera.
   */
  private fun refreshAutoQuality(): LocalQuality? {
    val options = qualityOptions()
    val chosen = prefs.manualQuality?.takeIf { it in options } ?: LocalQuality.auto(options)
    autoQuality = chosen
    return chosen
  }

  /** The config the encoder runs with: the site's, plus this phone's own tier. */
  private fun effective(config: CameraConfig): CameraConfig = config.withAuto(autoQuality ?: refreshAutoQuality())

  // ---------- Pairing ----------

  val isPaired: Boolean get() = prefs.pairingToken.isNotBlank()

  /**
   * Stores a scanned pairing code. The camera is released first: the scanner
   * needs it, and two camera clients cannot share the device.
   */
  fun applyPairing(payload: PairingPayload) {
    retryJob?.cancel()
    engine.stop()
    stopHeartbeat()
    prefs.baseUrl = payload.baseUrl
    prefs.pairingToken = payload.token
    closeCamera()
    update { it.copy(phase = SessionPhase.LOADING, message = "正在读取后台配置…", config = null, appliedVersion = -1) }
    loadConfig()
  }

  /** Tells the site to drop this phone, then forgets the token locally. */
  fun unpair() {
    retryJob?.cancel()
    scope.launch {
      engine.stop()
      stopHeartbeat()
      runCatching { api.unpair() }
      prefs.pairingToken = ""
      closeCamera()
      update { SessionState() }
    }
  }

  // ---------- Configuration ----------

  fun loadConfig(onResult: ((Boolean) -> Unit)? = null) {
    if (!isPaired) {
      update { it.copy(phase = SessionPhase.UNPAIRED, message = "未配对，请扫码配对") }
      onResult?.invoke(false)
      return
    }
    retryJob?.cancel()
    retryJob = null
    scope.launch {
      update { it.copy(phase = SessionPhase.LOADING, message = "正在读取后台配置…") }
      try {
        val fetched = api.fetchConfig()
        applyConfig(fetched, restartIfNeeded = false)
        update { it.copy(phase = SessionPhase.READY, message = "配置已就绪，点“开始推流”") }
        startPreviewIfPossible()
        // Report from now on, not only while live: the admin page shows the
        // phone online during setup, which is when the operator checks it.
        startHeartbeat()
        onResult?.invoke(true)
      } catch (error: ApiException) {
        if (error.status == 401) {
          // A rejected token will not start working by itself; do not retry.
          update { it.copy(phase = SessionPhase.ERROR, message = "配对已失效，请在后台重新生成配对码并重新扫码") }
        } else {
          update { it.copy(phase = SessionPhase.ERROR, message = "后台返回错误：${error.message ?: error.status}，${RETRY_HINT}") }
          scheduleConfigRetry()
        }
        onResult?.invoke(false)
      } catch (error: Exception) {
        val detail = error.message?.trim().orEmpty()
        update {
          it.copy(
            phase = SessionPhase.ERROR,
            message = buildString {
              append("连不上后台：${prefs.baseUrl}")
              if (detail.isNotBlank()) append("\n${error.javaClass.simpleName}: $detail")
              append("\n请确认手机和电脑在同一 Wi‑Fi，且手机浏览器能打开该地址")
            },
          )
        }
        scheduleConfigRetry()
        onResult?.invoke(false)
      }
    }
  }

  private var retryJob: Job? = null

  /** The site may come back (firewall opened, server restarted); keep trying. */
  private fun scheduleConfigRetry() {
    retryJob?.cancel()
    retryJob = scope.launch {
      delay(CONFIG_RETRY_MS)
      if (isPaired && mutableState.value.config == null) loadConfig()
    }
  }

  // ---------- Preview ----------

  /** Opens the camera onto the given surface. Safe to call repeatedly. */
  fun attachSurface(view: SurfaceView) {
    surface = view
    startPreviewIfPossible()
  }

  fun detachSurface() {
    surface = null
    // Publishing continues in the service; only the local preview goes away.
  }

  private fun startPreviewIfPossible() {
    val view = surface ?: return
    val config = mutableState.value.config ?: return
    if (engine.hasSession()) return
    prepare(view, config)
  }

  /**
   * Prepares the encoder for [config], stepping down one tier if the phone
   * refuses the chosen one.
   *
   * The capability probe and the encoder can disagree on unusual devices (an
   * encoder that advertises a size but will not open it on this surface). Rather
   * than leave the operator with an error and no picture, fall back once to the
   * tier every device in the field can do, and say so.
   */
  private fun prepare(view: SurfaceView, config: CameraConfig) {
    // Measure first: the lens may have changed since the last prepare, and the
    // tier has to come from the lens that is about to be used.
    autoQuality = null
    engine.prepare(view, effective(config), prefs.forceLandscape)
    refreshDeviceFacts()
    val refused = engine.current().state == "ERROR" && engine.currentQuality() != LocalQuality.FALLBACK
    if (!refused) return

    val attempted = engine.currentQuality()
    autoQuality = LocalQuality.FALLBACK
    engine.prepare(view, effective(config), prefs.forceLandscape)
    refreshDeviceFacts()
    if (engine.current().state != "ERROR") {
      update { it.copy(message = "这台手机打不开 ${attempted.width}×${attempted.height}，已改用 1080p · 30 帧") }
    }
  }

  /** Applies a config change that needs the camera reopened. */
  private fun reopenCamera(config: CameraConfig) {
    engine.release()
    update { it.copy(zoom = 1f) }
    surface?.let { prepare(it, config) }
  }

  /** Applies the freshly chosen tier to the running session, if it changed. */
  private fun applyAutoQuality() {
    val config = mutableState.value.config ?: return
    val previous = autoQuality
    if (refreshAutoQuality() == previous) return
    val wasPublishing = mutableState.value.isPublishing
    reopenCamera(config)
    if (wasPublishing) startPublishing()
  }

  fun closeCamera() {
    engine.release()
  }

  /** Reopens the preview after the camera was lent out, e.g. to the QR scanner. */
  fun resumePreview() = startPreviewIfPossible()

  /**
   * Re-prepares the camera with the current config, e.g. after the operator
   * flips landscape/portrait. Publishing resumes if it was running.
   */
  fun restartPreview() {
    val config = mutableState.value.config ?: return
    val wasPublishing = mutableState.value.isPublishing
    reopenCamera(config)
    if (wasPublishing) startPublishing()
  }

  val baseUrl: String get() = prefs.baseUrl

  // ---------- Publishing ----------

  fun startPublishing() {
    val current = mutableState.value
    if (current.config == null) {
      update { it.copy(phase = SessionPhase.ERROR, message = "还没有读到后台配置，请先重新扫码或刷新") }
      return
    }
    if (current.config.ingestUrl.isNullOrBlank()) {
      update { it.copy(phase = SessionPhase.ERROR, message = "后台还没有填写推流地址，请先在后台保存") }
      return
    }
    if (!engine.hasSession()) {
      // The camera was released (for example while scanning); reopen it. This
      // goes through prepare() so the tier is measured again rather than assumed.
      val view = surface
      if (view == null) {
        update { it.copy(phase = SessionPhase.ERROR, message = "摄像头还没准备好，请稍候重试") }
        return
      }
      prepare(view, current.config)
      if (!engine.hasSession()) {
        update { it.copy(phase = SessionPhase.ERROR, message = engine.current().detail) }
        return
      }
    }
    if (engine.start()) {
      startHeartbeat()
    } else {
      update { it.copy(phase = SessionPhase.ERROR, message = engine.current().detail) }
    }
  }

  /** Stops publishing but keeps the preview and the status reports running. */
  fun stopPublishing() {
    engine.stop()
    update { it.copy(phase = SessionPhase.READY, message = "已停止推流", bitrateKbps = 0, fps = 0) }
  }

  fun togglePublishing() {
    val current = mutableState.value
    when {
      current.isPublishing -> stopPublishing()
      // No config yet: the button doubles as "retry now".
      current.config == null && isPaired -> loadConfig()
      else -> startPublishing()
    }
  }

  // ---------- Camera controls ----------

  fun setZoom(level: Float, notify: Boolean = true) = engine.setZoom(level, notify)

  /** Publishes the settled zoom once a pinch or animation has finished. */
  fun commitZoom() = engine.commitZoom()

  fun zoomBy(factor: Float) = engine.zoomBy(factor)

  /** Straight to a fixed stop such as 1x or 2x. */
  fun goToPreset(preset: Float) = engine.setZoom(preset)

  fun readZoom(): Float = engine.readZoom()

  fun switchCamera() {
    engine.switchCamera()
    refreshDeviceFacts()
    // The other lens may offer a different set of output sizes: keep the tier in
    // step instead of encoding 4K through a front camera that tops out at 1080p.
    applyAutoQuality()
  }

  fun tapToFocus(view: android.view.View, event: android.view.MotionEvent): Boolean =
    engine.tapToFocus(view, event)

  fun setPreferredMicId(id: Int) {
    prefs.micDeviceId = id
    engine.setPreferredMicId(id)
    // The input device is chosen while opening the audio source, so applying it
    // means reopening the session; keep publishing and re-prepare underneath.
    if (!engine.hasSession()) return
    restartPreview()
  }

  fun microphoneOptions(): List<MicOption> = AudioDevices.inputs(appContext)

  /** Every 16:9 combination the open lens and the H.264 encoder can both deliver. */
  fun qualityOptions(): List<LocalQuality> = VideoCapabilities.options(appContext, engine.currentCameraId())

  /** The tier this phone picked for itself, for the settings screen. */
  fun currentQuality(): LocalQuality? = autoQuality ?: refreshAutoQuality()

  fun setManualQuality(quality: LocalQuality?) {
    if (quality != null && quality !in qualityOptions()) return
    prefs.manualQuality = quality
    reapplyAutoQuality()
  }

  /**
   * The bitrate the encoder will actually use, in kbps.
   *
   * Not the same as the tier's own recommendation: the site may have capped it.
   * The settings screen shows this one, because a rate that disagrees with what
   * is being pushed would send an operator hunting for a fault that is not there.
   */
  fun currentBitrateKbps(): Int? {
    val quality = currentQuality() ?: return null
    // Derived through CameraSettings so the cap is applied by exactly the same
    // rule the encoder uses, rather than a second copy of it that can drift.
    val site = mutableState.value.config?.settings ?: CameraSettings()
    return site.copy(quality = quality).videoBitrate / 1024
  }

  /**
   * Re-reads the device's capabilities and applies the result. Exposed for the
   * settings screen so the operator can force a re-measure after hot-plugging a
   * lens or returning from a screen that released the camera.
   */
  fun reapplyAutoQuality() {
    if (engine.hasSession()) applyAutoQuality() else refreshAutoQuality()
  }

  private fun refreshDeviceFacts() {
    update {
      it.copy(
        zoom = engine.readZoom(),
        zoomMin = engine.zoomRange().first,
        zoomMax = engine.zoomRange().second,
        cameras = engine.cameras(),
        cameraId = engine.currentCameraId(),
        micName = engine.current().audioSourceName,
      )
    }
  }

  // ---------- Heartbeat ----------

  private fun startHeartbeat() {
    if (heartbeatJob?.isActive == true) return
    heartbeatJob = scope.launch {
      while (isActive) {
        sendHeartbeat()
        delay(HEARTBEAT_MS)
      }
    }
  }

  private fun stopHeartbeat() {
    heartbeatJob?.cancel()
    heartbeatJob = null
  }

  private suspend fun sendHeartbeat() {
    engine.sample()
    val current = mutableState.value
    val payload = Heartbeat(
      state = current.heartbeatState(),
      bitrateKbps = current.bitrateKbps.takeIf { it > 0 },
      fps = current.fps.takeIf { it > 0 },
      width = if (engine.isStreaming()) engine.currentWidth() else null,
      height = if (engine.isStreaming()) engine.currentHeight() else null,
      zoom = current.zoom,
      audioSource = current.micName.takeIf { it.isNotBlank() },
      battery = batteryPercent(),
      message = current.message,
    )
    try {
      val latest = api.heartbeat(payload)
      update { it.copy(battery = payload.battery) }
      applyConfig(latest, restartIfNeeded = true)
    } catch (error: ApiException) {
      if (error.status == 401) {
        // The room was disabled or the pairing was reset server-side. Stop
        // reporting too, or the phone would keep knocking with a dead token.
        engine.stop()
        stopHeartbeat()
        update {
          it.copy(phase = SessionPhase.ERROR, message = "直播间已停用或配对已失效，已停止推流", bitrateKbps = 0, fps = 0)
        }
      }
    } catch (_: Exception) {
      // One missed report is not worth interrupting the broadcast for.
    }
  }

  // ---------- Operator changes from the site ----------

  /**
   * Applies a freshly fetched config.
   *
   * A bitrate change is applied live. A new push address or microphone
   * preference cannot be applied to an encoder that is already running, so the
   * session is reopened underneath and publishing resumes - the operator does
   * not have to touch the phone.
   *
   * Resolution and frame rate are the phone's own choice now, so a config change
   * can never alter them: [effective] keeps the tier that was measured locally.
   */
  private fun applyConfig(latest: CameraConfig, restartIfNeeded: Boolean) {
    val previous = mutableState.value.config
    val versionChanged = latest.configVersion != applyingVersion

    if (previous != null && versionChanged) {
      val urlChanged = latest.ingestUrl != previous.ingestUrl
      val next = effective(latest).settings
      val prev = effective(previous).settings
      // Still compared rather than assumed equal: a lens switch can move the
      // tier between two config polls, and that must not be mistaken for a
      // site-side change and force a pointless reconnect.
      val videoChanged = next.width != prev.width || next.height != prev.height || next.fps != prev.fps
      val micChanged = latest.settings.preferExternalMic != previous.settings.preferExternalMic

      if (latest.ingestUrl.isNullOrBlank() && mutableState.value.isPublishing) {
        stopPublishing()
        update { it.copy(config = latest, appliedVersion = latest.configVersion, phase = SessionPhase.ERROR, message = "后台清除了推流地址，已停止推流") }
        return
      }

      if (restartIfNeeded && (urlChanged || videoChanged || micChanged)) {
        val wasPublishing = mutableState.value.isPublishing
        reopenCamera(latest)
        if (wasPublishing) {
          startPublishing()
          update { it.copy(message = "已按后台的新参数重连") }
        }
      } else if (!urlChanged && !videoChanged) {
        // Safe to change on the fly.
        if (next.videoBitrate != prev.videoBitrate) {
          engine.applyBitrate(next.videoBitrate / 1024)
        }
      }
    }

    applyingVersion = latest.configVersion
    update { it.copy(config = latest, appliedVersion = latest.configVersion) }
  }

  private var lastEngineState = ""
  private var lastEngineDetail = ""

  private fun onEngineStatus(status: EngineStatus) {
    // The engine republishes on every zoom step and every bitrate sample. Only a
    // real change of state may set the phase and message; otherwise a pinch would
    // wipe out, say, "后台还没有填写推流地址".
    val transition = status.state != lastEngineState || status.detail != lastEngineDetail
    lastEngineState = status.state
    lastEngineDetail = status.detail
    val phase = if (!transition) null else when (status.state) {
      "PREVIEW" -> SessionPhase.READY
      "CONNECTING" -> SessionPhase.CONNECTING
      "STREAMING" -> SessionPhase.LIVE
      "RECONNECTING" -> SessionPhase.RECONNECTING
      "ERROR" -> SessionPhase.ERROR
      else -> null
    }
    update {
      it.copy(
        phase = phase ?: it.phase,
        message = if (phase != null) status.detail.ifBlank { it.message } else it.message,
        bitrateKbps = status.bitrateKbps,
        fps = status.fps,
        zoom = status.zoom,
        zoomMin = if (status.zoomMax > status.zoomMin) status.zoomMin else it.zoomMin,
        zoomMax = if (status.zoomMax > status.zoomMin) status.zoomMax else it.zoomMax,
        micName = status.audioSourceName.ifBlank { it.micName },
      )
    }
  }

  // ---------- Lifecycle ----------

  /** Releases the camera and stops reporting. Publishing is stopped first. */
  fun shutdown() {
    retryJob?.cancel()
    stopHeartbeat()
    engine.release()
  }

  private fun update(block: (SessionState) -> SessionState) {
    mutableState.value = block(mutableState.value)
  }

  private fun batteryPercent(): Int? {
    val manager = appContext.getSystemService(Context.BATTERY_SERVICE) as? android.os.BatteryManager ?: return null
    return manager.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY).takeIf { it in 0..100 }
  }

  companion object {
    private const val HEARTBEAT_MS = 5000L
    private const val CONFIG_RETRY_MS = 5000L
    private const val RETRY_HINT = "5 秒后自动重试，也可点红色按钮立即重试"
  }
}
