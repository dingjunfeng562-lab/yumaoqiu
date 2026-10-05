package com.ayumaoqiu.camera

import android.content.Context
import android.media.AudioDeviceInfo
import android.view.SurfaceView
import com.pedro.common.ConnectChecker
import com.pedro.encoder.input.sources.audio.MicrophoneSource
import com.pedro.encoder.input.sources.video.Camera2Source
import com.pedro.library.generic.GenericStream
import kotlin.math.abs
import kotlin.math.roundToInt

/** What the service shows on screen and reports to the site. */
data class EngineStatus(
  val state: String,
  val detail: String,
  val bitrateKbps: Int = 0,
  val fps: Int = 0,
  val zoom: Float = 1f,
  val zoomMin: Float = 1f,
  val zoomMax: Float = 1f,
  val audioSourceName: String = "",
  val configVersion: Int = 0,
  val broadcastTitle: String = "",
)

/**
 * Camera + microphone publishing.
 *
 * Zoom is applied at the sensor: on Android 11+ via CONTROL_ZOOM_RATIO, and
 * below that by cropping the sensor's active array (SCALER_CROP_REGION). Both
 * keep the encoder at full output resolution, so zooming in does not soften the
 * picture the way scaling an already-encoded frame would.
 *
 * The microphone is pinned to a specific input device when one is chosen, which
 * is how the DJI Mic receiver (a USB audio device) is selected instead of the
 * phone's own mic.
 */
class StreamEngine(context: Context) {

  private val appContext = context.applicationContext
  private val cameraSource = Camera2Source(appContext)
  private val micSource = MicrophoneSource()

  private var stream: GenericStream? = null
  private var surfaceView: SurfaceView? = null
  private var settings = CameraSettings()
  private var rotation = 0
  private var ingestUrl: String? = null
  private var selectedMicName = ""
  private var prefsMicId: Int = -1

  private var lastBytes = 0L
  private var lastBytesAt = 0L
  private var measuredKbps = 0
  private var measuredFps = 0
  private var status = EngineStatus("IDLE", "未推流")
  private var listener: ((EngineStatus) -> Unit)? = null
  private var retriesLeft = 0

  fun current(): EngineStatus = status

  fun setListener(block: ((EngineStatus) -> Unit)?) {
    listener = block
  }

  private fun publish(next: EngineStatus) {
    status = next
    listener?.invoke(next)
  }

  private fun publish(message: String, state: String = status.state) {
    publish(status.copy(state = state, detail = message))
  }

  private val connectChecker = object : ConnectChecker {
    override fun onConnectionStarted(url: String) {
      publish("连接中…", "CONNECTING")
    }

    override fun onConnectionSuccess() {
      retriesLeft = MAX_RETRIES
      publish("推流中", "STREAMING")
    }

    override fun onConnectionFailed(reason: String) {
      // First let the library retry the same connection, then fall back to a
      // full restart; a dropped mobile link usually needs the second path.
      val client = stream?.getStreamClient()
      if (client != null && retriesLeft > 0) {
        retriesLeft -= 1
        if (client.reTry(RETRY_DELAY_MS, reason)) {
          publish("连接中断，正在重试…（剩 $retriesLeft 次）", "RECONNECTING")
          return
        }
      }
      publish("连接失败：$reason", "ERROR")
    }

    override fun onDisconnect() {
      publish("已断开")
    }

    override fun onAuthError() {
      publish("推流地址被拒绝，请在后台核对推流地址与串流密钥", "ERROR")
    }

    override fun onAuthSuccess() {
      publish("地址校验通过", "CONNECTING")
    }
  }

  /** Prepares encoders and opens the camera preview without publishing. */
  fun prepare(surface: SurfaceView, config: CameraConfig, forceLandscape: Boolean) {
    release()
    settings = config.settings
    surfaceView = surface
    // The site contract is always a landscape 16:9 canvas. Keep the encoded
    // orientation stable even if the phone sensor is physically rotated.
    rotation = 0
    ingestUrl = config.ingestUrl
    retriesLeft = MAX_RETRIES

    val created = GenericStream(appContext, connectChecker, cameraSource, micSource)
    stream = created
    created.setFpsListener { fps -> measuredFps = fps }

    val preparedVideo = created.prepareVideo(
      settings.width, settings.height, settings.videoBitrate, settings.fps, 2, rotation,
    )
    if (!preparedVideo) {
      // Drop the half-built session so hasSession() stays truthful.
      runCatching { created.release() }
      stream = null
      publish("这台手机打不开 ${settings.width}×${settings.height}@${settings.fps}", "ERROR")
      return
    }
    val preparedAudio = runCatching {
      created.prepareAudio(AUDIO_SAMPLE_RATE, true, settings.audioBitrate, false, false)
    }.getOrDefault(false)
    if (!preparedAudio) {
      runCatching { created.release() }
      stream = null
      publish("音频初始化失败，请检查麦克风权限或换一个输入设备", "ERROR")
      return
    }

    applyMicrophone(config.settings.preferExternalMic)
    created.startPreview(surface, true)
    // The admin page chooses which lens to start on; the operator can still
    // switch at any time with the on-screen button. Done after the preview is
    // live because switching a closed camera is a no-op.
    applyFacing(config.settings.facing)
    resetZoomCache()

    publish(
      status.copy(
        state = "PREVIEW", detail = "预览中", configVersion = config.configVersion,
        broadcastTitle = config.title, audioSourceName = selectedMicName,
        zoom = readZoom(), zoomMin = zoomRange().first, zoomMax = zoomRange().second,
      ),
    )
  }

  /** Aligns the active lens with the configured facing, ignoring no-ops. */
  private fun applyFacing(facing: String) {
    val wantFront = facing.equals("front", ignoreCase = true)
    val isFront = runCatching { cameraSource.getCameraFacing() }.getOrNull()?.name
      ?.equals("FRONT", ignoreCase = true) == true
    if (wantFront != isFront) {
      runCatching { cameraSource.switchCamera() }
    }
  }

  /** Chooses the input device: a pinned one, else the first external, else built-in. */
  private fun applyMicrophone(preferExternal: Boolean) {
    var device: AudioDeviceInfo? = null
    var name = "手机自带麦克风"

    val pinned = AudioDevices.find(appContext, prefsMicId)
    if (pinned != null) {
      device = pinned
      name = pinned.productName?.toString()?.trim().orEmpty().ifEmpty { "外接麦克风" }
    } else if (preferExternal) {
      val external = AudioDevices.preferredExternal(appContext)
      if (external != null) {
        device = AudioDevices.find(appContext, external.id)
        name = external.name.substringAfter("· ").trim().ifEmpty { "外接麦克风" }
      }
    }

    if (device != null) {
      val applied = runCatching { micSource.setPreferredDevice(device) }.getOrDefault(false)
      if (!applied) name = "手机自带麦克风"
    } else {
      runCatching { micSource.setPreferredDevice(null) }
    }
    selectedMicName = name
  }

  fun setPreferredMicId(id: Int) {
    prefsMicId = id
  }

  /** Starts publishing. Returns false when no push address is configured. */
  fun start(): Boolean {
    val created = stream ?: return false
    val url = ingestUrl
    if (url.isNullOrBlank()) {
      publish("后台还没有填写推流地址", "ERROR")
      return false
    }
    return runCatching {
      created.startStream(url)
      lastBytes = 0
      lastBytesAt = System.currentTimeMillis()
      publish(status.copy(state = "CONNECTING", detail = "连接中…"))
      true
    }.getOrElse { error ->
      publish("无法开始推流：${error.message}", "ERROR")
      false
    }
  }

  fun stop() {
    val created = stream
    if (created != null && created.isStreaming) {
      runCatching { created.stopStream() }
    }
    publish(status.copy(state = "PREVIEW", detail = "已停止推流", bitrateKbps = 0, fps = 0))
  }

  fun release() {
    val created = stream ?: return
    stream = null
    runCatching { created.release() }
    measuredKbps = 0
    measuredFps = 0
  }

  // ---------- Zoom and lens ----------

  /** Range of the open lens, cached: querying camera characteristics per pinch frame is wasteful. */
  private var cachedRange: Pair<Float, Float>? = null
  /** Last value actually sent to the camera, so identical requests are skipped. */
  private var appliedZoom = 1f

  fun zoomRange(): Pair<Float, Float> {
    cachedRange?.let { return it }
    val range = runCatching { cameraSource.getZoomRange() }.getOrNull() ?: return 1f to 1f
    return (range.lower to range.upper).also { if (it.second > it.first) cachedRange = it }
  }

  /** Call after the lens changes so the next zoom uses its own range. */
  private fun resetZoomCache() {
    cachedRange = null
    appliedZoom = runCatching { cameraSource.getZoom() }.getOrDefault(1f)
  }

  fun readZoom(): Float = runCatching { cameraSource.getZoom() }.getOrDefault(1f)

  /**
   * Sets zoom as a multiple of the main lens; clamped to what the phone allows.
   *
   * With [notify] false (pinching, animating) only the camera request is sent:
   * re-rendering the whole screen on every gesture frame competes with the
   * encoder and made zooming stutter. Call [commitZoom] when the gesture ends.
   */
  fun setZoom(level: Float, notify: Boolean = true) {
    val (min, max) = zoomRange()
    val clamped = ZoomScale(min, max).clamp(level)
    if (abs(clamped - appliedZoom) >= MIN_ZOOM_STEP) {
      runCatching { cameraSource.setZoom(clamped) }
      appliedZoom = clamped
    }
    if (notify) publish(status.copy(zoom = appliedZoom, zoomMin = min, zoomMax = max))
  }

  /** Reports the settled zoom once, after a pinch or animation. */
  fun commitZoom() {
    val (min, max) = zoomRange()
    publish(status.copy(zoom = appliedZoom, zoomMin = min, zoomMax = max))
  }

  fun zoomBy(factor: Float) = setZoom(appliedZoom * factor)

  /** Focuses (and meters exposure for) the area the operator tapped. */
  fun tapToFocus(view: android.view.View, event: android.view.MotionEvent): Boolean =
    runCatching { cameraSource.tapToFocus(view, event) }.getOrDefault(false)

  fun cameras(): List<String> = runCatching { cameraSource.camerasAvailable().toList() }.getOrDefault(emptyList())
  fun currentCameraId(): String = runCatching { cameraSource.getCurrentCameraId() }.getOrDefault("")

  fun switchCamera() {
    runCatching { cameraSource.switchCamera() }
    resetZoomCache()
    publish(status.copy(zoom = appliedZoom, zoomMin = zoomRange().first, zoomMax = zoomRange().second))
  }

  fun openCamera(id: String) {
    runCatching { cameraSource.openCameraId(id) }
    resetZoomCache()
    publish(status.copy(zoom = appliedZoom, zoomMin = zoomRange().first, zoomMax = zoomRange().second))
  }

  fun isStreaming(): Boolean = stream?.isStreaming == true

  /** True while encoders are prepared and the camera is open. */
  fun hasSession(): Boolean = stream != null

  /** Output dimensions the encoder was prepared with. */
  fun currentWidth(): Int = settings.width
  fun currentHeight(): Int = settings.height

  /** The tier currently being encoded, for the settings screen. */
  fun currentQuality(): LocalQuality = settings.effectiveQuality

  /** Samples the publisher counters so the operator sees a real bitrate. */
  fun sample(): EngineStatus {
    val created = stream
    if (created != null && created.isStreaming) {
      val client = created.getStreamClient()
      val bytes = runCatching { client.getBytesSend() }.getOrDefault(0L)
      val now = System.currentTimeMillis()
      if (lastBytesAt != 0L && now > lastBytesAt) {
        measuredKbps = (((bytes - lastBytes).coerceAtLeast(0L) * 8) / (now - lastBytesAt)).toInt()
      }
      lastBytes = bytes
      lastBytesAt = now
      if (measuredKbps > 0 || measuredFps > 0) {
        publish(status.copy(bitrateKbps = measuredKbps, fps = measuredFps, zoom = appliedZoom))
      }
    }
    return status
  }

  /** Changes the encoding bitrate without dropping the stream. */
  fun applyBitrate(kbps: Int) {
    val created = stream ?: return
    if (kbps <= 0) return
    val bits = kbps * 1024
    // The bitrate is derived from [settings], so the applied value is recorded
    // as a ceiling rather than as the whole setting: writing it back keeps the
    // next sample() report and the next reopen consistent with the encoder.
    settings = settings.copy(videoBitrateKbps = kbps)
    runCatching { created.setVideoBitrateOnFly(bits) }
  }

  companion object {
    /** 44.1 kHz stereo is what consumer capture devices such as DJI Mic deliver. */
    const val AUDIO_SAMPLE_RATE = 44100
    private const val MAX_RETRIES = 12
    private const val RETRY_DELAY_MS = 1500L
    /** Smaller steps are invisible on screen but each one is a new camera request. */
    private const val MIN_ZOOM_STEP = 0.01f
  }
}
