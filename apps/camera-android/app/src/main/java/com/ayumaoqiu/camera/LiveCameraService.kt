package com.ayumaoqiu.camera

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.AudioRecordingConfiguration
import android.media.MediaRecorder
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Network
import android.os.BatteryManager
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import android.view.Surface
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import io.livekit.android.AudioOptions
import io.livekit.android.ConnectOptions
import io.livekit.android.LiveKit
import io.livekit.android.LiveKitOverrides
import io.livekit.android.RoomOptions
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.renderer.SurfaceViewRenderer
import io.livekit.android.room.Room
import io.livekit.android.room.participant.VideoTrackPublishOptions
import io.livekit.android.room.track.LocalAudioTrack
import io.livekit.android.room.track.LocalAudioTrackOptions
import io.livekit.android.room.track.LocalVideoTrack
import io.livekit.android.room.track.LocalVideoTrackOptions
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.VideoEncoding
import io.livekit.android.room.track.VideoCaptureParameter
import io.livekit.android.room.track.VideoCodec
import io.livekit.android.room.track.VideoPreset
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import livekit.org.webrtc.PeerConnectionFactory
import livekit.org.webrtc.EglBase
import livekit.org.webrtc.SimulcastVideoEncoderFactory
import livekit.org.webrtc.RtpParameters
import livekit.org.webrtc.audio.JavaAudioDeviceModule
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import kotlin.math.log10
import kotlin.math.sqrt
import kotlin.math.abs

data class LiveCameraUi(val label: String = "摄像端已就绪", val cameraCode: String = "CAM", val onAir: Boolean = false, val capabilitiesVersion: Int = 0,
  val publishing: Boolean = false, val connecting: Boolean = false, val metrics: String = "", val audio: String = "AUDIO OFF", val warning: String = "",
  val requiresAudioPermission: Boolean = false, val audioWarning: String = "", val isProgramCamera: Boolean = false)

/** Owns the room and camera outside the Activity; returning to the app only reattaches a renderer. */
class LiveCameraService : LifecycleService() {
  inner class LocalBinder : Binder() { val service get() = this@LiveCameraService }
  private val binder = LocalBinder()
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private val mutableState = MutableStateFlow(LiveCameraUi())
  val state = mutableState.asStateFlow()
  private val mutableZoom = MutableStateFlow(1f)
  val zoomState = mutableZoom.asStateFlow()
  lateinit var capturer: LiveCameraCapturer
    private set
  private lateinit var api: LiveCameraApi
  private var room: Room? = null
  private var video: LocalVideoTrack? = null
  private var audio: LocalAudioTrack? = null
  private var renderer: SurfaceViewRenderer? = null
  private var module: JavaAudioDeviceModule? = null
  private var egl: EglBase? = null
  private var encoder: HardwareH264Factory? = null
  private var loop: Job? = null
  private var events: Job? = null
  private var pairing: Job? = null
  private var control = JSONObject()
  private var cameraId = ""
  private var wanted = false
  private var uiVisible = false
  private val audioMutex = Mutex()
  private var wakeLock: PowerManager.WakeLock? = null
  @Volatile private var audioDb = -100.0
  @Volatile private var clippingUntil = 0L
  private var externalAudioLost = false
  private var videoDiagnostics = ""
  private val networkChanges = Channel<Unit>(Channel.CONFLATED)
  private val connectivity by lazy { getSystemService(ConnectivityManager::class.java) }
  private val networkCallback = object : ConnectivityManager.NetworkCallback() {
    override fun onAvailable(network: Network) { networkChanges.trySend(Unit) }
    override fun onLost(network: Network) { networkChanges.trySend(Unit) }
  }
  private var previousBytes = 0.0
  private var previousStatsTime = 0L
  private var bitrate = 0
  private var rtt = 0
  private var loss = 0.0
  private var measuredFps = 0
  private var actualWidth = 1280
  private var actualHeight = 720
  private var selectedQuality = LocalQuality("1080p", 30)
  val requestedQuality: LocalQuality? get() = LocalQuality.of(api.prefs.getString("qualityResolution", null), api.prefs.getInt("qualityFps", 0))
  val bitrateMbps: Int get() = api.prefs.getInt("liveBitrateMbps", LiveEncodingPolicy.DEFAULT_MBPS).coerceIn(2, LiveEncodingPolicy.MAX_MBPS)
  val allowInternalFallback: Boolean get() = api.prefs.getBoolean("allowInternalFallback", false)
  val simulcastEnabled: Boolean get() = api.prefs.getBoolean("simulcastEnabled", true)
  fun setSimulcast(enabled: Boolean) {
    api.prefs.edit().putBoolean("simulcastEnabled", enabled).apply()
    restartCapture()
  }
  fun setUiVisible(visible: Boolean) {
    uiVisible = visible
    if (visible && wanted) scope.launch { applyControl(control) }
  }
  fun setBitrate(mbps: Int) {
    api.prefs.edit().putInt("liveBitrateMbps", mbps.coerceIn(2, LiveEncodingPolicy.MAX_MBPS)).apply()
    restartCapture()
  }
  fun setInternalFallback(allow: Boolean) {
    api.prefs.edit().putBoolean("allowInternalFallback", allow).apply()
    scope.launch { applyControl(control) }
  }
  fun qualityOptions(): List<LocalQuality> = VideoCapabilities.options(this, capturer.currentCameraId())
  fun qualityAvailability(): List<QualityAvailability> = VideoCapabilities.availability(this, capturer.currentCameraId())
  fun currentQuality(): LocalQuality = selectedQuality
  fun setQuality(quality: LocalQuality?) {
    if (quality != null && quality !in qualityOptions()) return
    api.prefs.edit().putString("qualityResolution", quality?.resolution).putInt("qualityFps", quality?.fps ?: 0).apply()
    restartCapture()
  }
  fun switchLens() {
    val wasWanted = wanted
    stopPublishing(keepPreview = false)
    capturer.selectOtherLens()
    prepareLocal()
    if (wasWanted) startPublishing()
  }
  private fun restartCapture() {
    val wasWanted = wanted
    stopPublishing(keepPreview = false)
    prepareLocal()
    if (wasWanted) startPublishing()
  }
  private val audioManager by lazy { getSystemService(AudioManager::class.java) }
  private val recording = object : AudioManager.AudioRecordingCallback() {
    override fun onRecordingConfigChanged(configs: MutableList<AudioRecordingConfiguration>) { enforceAudioRoute() }
  }
  private val devices = object : AudioDeviceCallback() {
    override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) {
      if (addedDevices.any { isUsb(it) }) {
        externalAudioLost = false
        mutableState.value = mutableState.value.copy(audioWarning = "")
      }
      preferUsb()
      scope.launch { applyControl(control) }
    }
    override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) {
      if (removedDevices.any { isUsb(it) } && isMainAudio() && usbInput() == null) {
        externalAudioLost = true
        // Stop audio immediately; switching to the phone mic requires opt-in.
        if (!allowInternalFallback) module?.setMicrophoneMute(true)
        updateAudioWarning()
      }
      scope.launch { applyControl(control) }
    }
  }

  override fun onCreate() {
    super.onCreate()
    api = LiveCameraApi(this)
    if (Build.VERSION.SDK_INT >= 26) getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel("multicamera", "多机位直播", NotificationManager.IMPORTANCE_LOW))
    notifyState("摄像端已就绪")
    audioManager.registerAudioDeviceCallback(devices, null)
    audioManager.registerAudioRecordingCallback(recording, null)
    connectivity.registerDefaultNetworkCallback(networkCallback)
    prepareLocal()
  }
  override fun onBind(intent: Intent): IBinder { super.onBind(intent); return binder }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    super.onStartCommand(intent, flags, startId)
    if (intent?.action == "STOP") {
      stopPublishing(keepPreview = false)
      ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
      stopSelf()
      return START_NOT_STICKY
    }
    val url = intent?.getStringExtra("url")
    val code = intent?.getStringExtra("code")
    if (url != null && code != null) {
      pairing?.cancel()
      mutableState.value = mutableState.value.copy(label = "正在配对…", warning = "")
      pairing = scope.launch {
        try {
          try { api.redeem(url, code) }
          catch (e: ApiException) {
            // Older servers reject re-scans of a bound phone. Only recover an
            // existing credential after the same server has validated it.
            if (e.status != 409 || !e.message.orEmpty().contains("该手机已绑定机位") || !api.restore(url)) throw e
          }
          mutableState.value = mutableState.value.copy(label = "已配对，点开始接入", cameraCode = api.prefs.getString("cameraCode", "CAM")!!, warning = "")
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { mutableState.value = mutableState.value.copy(label = "配对失败", warning = e.message.orEmpty()) }
      }
    } else if (api.paired && !wanted && pairing?.isActive != true) mutableState.value = mutableState.value.copy(label = "已配对，点开始接入", cameraCode = api.prefs.getString("cameraCode", "CAM")!!)
    return START_NOT_STICKY
  }
  fun toggle() {
    if (wanted) stopPublishing() else {
      ContextCompat.startForegroundService(this, Intent(this, LiveCameraService::class.java))
      startPublishing()
    }
  }
  fun onAudioPermissionChanged() {
    if (!hasAudioPermission()) return
    scope.launch { applyControl(control) }
  }
  fun onAudioPermissionDenied() {
    if (!isMainAudio()) return
    mutableState.value = mutableState.value.copy(
      requiresAudioPermission = true,
      audio = "AUDIO WAITING · 点击授权",
      warning = AUDIO_PERMISSION_WARNING,
    )
  }
  fun startPublishing() {
    if (wanted) return
    if (pairing?.isActive == true) { mutableState.value = mutableState.value.copy(warning = "正在配对，请稍候"); return }
    if (!api.paired) { mutableState.value = mutableState.value.copy(label = "尚未配对", warning = "请点重新配对，扫描后台当前的配对二维码"); return }
    notifyState("正在开始接入")
    wanted = true
    mutableState.value = mutableState.value.copy(connecting = true, warning = "")
    wakeLock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ayumaoqiu:multicamera").apply { acquire() }
    loop = scope.launch {
      val reconnectBackoff = ReconnectBackoff()
      while (isActive && wanted) {
        var nextDelayMs = HEARTBEAT_INTERVAL_MS
        try {
          if (room == null || room?.state == Room.State.DISCONNECTED) connect()
          sampleStats()
          val report = JSONObject().put("state", if (room?.state == Room.State.CONNECTED) "STREAMING" else "RECONNECTING")
            .put("bitrateKbps", bitrate).put("fps", measuredFps).put("width", actualWidth).put("height", actualHeight)
            .put("zoom", capturer.zoom().toDouble()).put("battery", getSystemService(BatteryManager::class.java).getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY).coerceIn(0, 100))
            .put("networkType", network()).put("rttMs", rtt).put("packetLoss", loss)
            .put("audioStatus", audioStatus()).put("audioSource", audioName().take(60)).put("audioLevelDb", audioDb.coerceIn(-160.0, 0.0))
            .put("thermal", thermal()).put("message", listOf(mutableState.value.warning, mutableState.value.audioWarning).filter { it.isNotBlank() }.joinToString(" · ").take(120))
          val config = api.call("heartbeat", report)
          applyControl(config)
          reconnectBackoff.reset()
          val waitingForAudio = mutableState.value.requiresAudioPermission
          val audioMessage = when {
            waitingForAudio -> "AUDIO WAITING · 点击授权"
            audio == null && isMainAudio() -> "AUDIO WAITING · 点击音频设置"
            audio == null -> "AUDIO OFF"
            else -> "${audioName()} · ${audioDb.toInt()} dB" + if (SystemClock.elapsedRealtime() < clippingUntil) " · 削波警告" else ""
          }
          enforceAudioRoute()
          mutableState.value = mutableState.value.copy(metrics = "目标 ${selectedQuality.label} · 采集 ${capturer.capturedFps} FPS · 发送 ${actualHeight}P / $measuredFps FPS · ↑ $bitrate kbps · RTT $rtt ms · 丢包 ${"%.1f".format(loss)}% · ${network()} · 电量 ${report.optInt("battery")}% · ${thermal()}",
            audio = audioMessage)
        } catch (e: CancellationException) { throw e }
        catch (e: ApiException) {
          if (e.status == 401) { api.forget(); stopPublishing(); mutableState.value = mutableState.value.copy(label = "直播已结束或配对失效", warning = e.message.orEmpty()); break }
          nextDelayMs = reconnectBackoff.nextDelayMillis()
          mutableState.value = mutableState.value.copy(warning = "后台暂时不可达，${nextDelayMs / 1000} 秒后重试")
        } catch (e: Exception) {
          Log.e("LiveCameraService", "Camera connection failed", e)
          nextDelayMs = reconnectBackoff.nextDelayMillis()
          mutableState.value = mutableState.value.copy(label = "RECONNECTING", publishing = false, connecting = true,
            warning = "连接异常，${nextDelayMs / 1000} 秒后恢复：${e.message?.takeIf { it.isNotBlank() }?.take(90) ?: e.javaClass.simpleName}")
        }
        withTimeoutOrNull(nextDelayMs) { networkChanges.receive() }
      }
    }
  }
  private fun prepareLocal(): Room {
    room?.let { return it }
    // LocalVideoTrack.dispose() owns and disposes its capturer. A reconnect
    // needs a new instance so queued shutdown callbacks cannot stop the new camera.
    val previous = if (::capturer.isInitialized) capturer else null
    capturer = LiveCameraCapturer(this, this, previous?.isFrontFacing ?: false).apply {
      rotation = previous?.rotation ?: Surface.ROTATION_90
      onError = { mutableState.value = mutableState.value.copy(warning = it) }
      onCapabilitiesChanged = { mutableState.value = mutableState.value.copy(capabilitiesVersion = mutableState.value.capabilitiesVersion + 1) }
      onZoomChanged = { mutableZoom.value = it }
    }
    val options = qualityOptions()
    selectedQuality = requestedQuality?.takeIf { it in options }
      ?: LiveEncodingPolicy.defaultQuality(options) ?: LocalQuality("720p", 30)
    actualWidth = selectedQuality.width; actualHeight = selectedQuality.height
    // Initialize native WebRTC before creating the caller-owned audio module.
    PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(this).createInitializationOptions())
    val adm = JavaAudioDeviceModule.builder(this).setAudioSource(MediaRecorder.AudioSource.MIC)
      .setUseHardwareAcousticEchoCanceler(false).setUseHardwareNoiseSuppressor(false)
      .setSamplesReadyCallback { samples ->
        val bytes = samples.data
        var sum = 0.0
        var clipped = 0
        for (i in 0 until bytes.size - 1 step 2) {
          val sample = ((bytes[i].toInt() and 255) or (bytes[i + 1].toInt() shl 8)).toShort().toDouble() / 32768.0
          sum += sample * sample
          if (abs(sample) >= 0.98) clipped++
        }
        audioDb = (20 * log10(sqrt(sum / (bytes.size / 2).coerceAtLeast(1)).coerceAtLeast(0.00000001))).coerceIn(-160.0, 0.0)
        if (clipped > (bytes.size / 2) / 100) clippingUntil = SystemClock.elapsedRealtime() + 5000L
      }.createAudioDeviceModule()
    module = adm
    // This caller-owned EGL context is shared by capture and hardware encoding.
    val sharedEgl = EglBase.create()
    val h264 = HardwareH264Factory(sharedEgl.eglBaseContext)
    egl = sharedEgl; encoder = h264
    val created = LiveKit.create(this, options = RoomOptions(dynacast = true), overrides = LiveKitOverrides(
      eglBase = sharedEgl, videoEncoderFactory = SimulcastVideoEncoderFactory(h264, h264),
      audioOptions = AudioOptions(audioDeviceModule = adm, disableAudioPrewarming = true)))
    room = created
    val local = created.localParticipant.createVideoTrack("camera", capturer, LocalVideoTrackOptions(captureParams =
      VideoCaptureParameter(selectedQuality.width, selectedQuality.height, selectedQuality.fps)))
    video = local
    renderer?.let { created.initVideoRenderer(it); local.addRenderer(it) }
    local.startCapture()
    return created
  }
  private suspend fun connect() {
    mutableState.value = mutableState.value.copy(label = "CONNECTING", connecting = true, warning = "")
    val config = api.call("join", JSONObject())
    cameraId = config.getString("cameraId")
    mutableState.value = mutableState.value.copy(cameraCode = config.getString("cameraCode"))
    val created = prepareLocal()
    try {
      check(encoder?.supportedCodecs?.isNotEmpty() == true) { "此设备未开放可用的 H.264 硬件编码，已停止接入；不会回退软件编码" }
      created.localParticipant.setTrackSubscriptionPermissions(false, emptyList())
      val media = config.getJSONObject("media")
      created.connect(media.getString("url"), media.getString("token"), ConnectOptions(autoSubscribe = false))
      // Deny subscriptions before publishing; only the server's room metadata can open specific tracks.
      created.localParticipant.setTrackSubscriptionPermissions(false, emptyList())
      val local = video ?: error("相机尚未就绪")
      check(created.localParticipant.publishVideoTrack(local, VideoTrackPublishOptions(source = Track.Source.CAMERA,
        videoCodec = VideoCodec.H264.codecName,
        videoEncoding = VideoEncoding(LiveEncodingPolicy.bitrate(bitrateMbps), selectedQuality.fps), simulcast = simulcastEnabled,
        simulcastLayers = listOf(object : VideoPreset {
          override val capture = VideoCaptureParameter(640, 360, LiveEncodingPolicy.PREVIEW_FPS)
          override val encoding = VideoEncoding(LiveEncodingPolicy.PREVIEW_BITRATE, LiveEncodingPolicy.PREVIEW_FPS)
        }),
        degradationPreference = RtpParameters.DegradationPreference.MAINTAIN_RESOLUTION))) { "视频发布失败" }
      preferUsb()
      applyControl(config)
      events = scope.launch {
        created.events.collect { event ->
          if (room !== created) return@collect
          if (event is RoomEvent.Disconnected) {
            mutableState.value = mutableState.value.copy(label = "RECONNECTING", publishing = false, connecting = true)
            // The SDK disposes published tracks before emitting Disconnected.
            video = null; audio = null
            disconnect()
            if (wanted) prepareLocal()
          } else {
            val metadata = runCatching { JSONObject(created.metadata ?: "{}") }.getOrDefault(JSONObject())
            if (metadata.has("sequence")) applyControl(metadata)
            permissions()
            if (event is RoomEvent.Reconnecting) mutableState.value = mutableState.value.copy(label = "RECONNECTING")
          }
        }
      }
      mutableState.value = mutableState.value.copy(publishing = true, connecting = false, label = if (mutableState.value.onAir) "ON AIR" else "STANDBY")
    } catch (e: CancellationException) {
      // Stop/quality/lens changes already release their old session. A cancelled
      // connect must never tear down the replacement session started meanwhile.
      throw e
    } catch (e: Exception) {
      if (room === created) { disconnect(); if (wanted) prepareLocal() }
      throw e
    }
  }

  private suspend fun applyControl(next: JSONObject) {
    if (next.optInt("sequence", -1) < control.optInt("sequence", -1)) return
    control = next
    val isProgramCamera = cameraId.isNotBlank() && next.optString("activeCameraId") == cameraId
    val onAir = next.optBoolean("live") && isProgramCamera
    mutableState.value = mutableState.value.copy(onAir = onAir, isProgramCamera = isProgramCamera, label = if (onAir) "ON AIR" else "STANDBY")
    val created = room ?: return
    audioMutex.withLock {
      if (room !== created || control !== next) return@withLock
      val enabled = isMainAudio()
      if (!enabled && audio != null) { audio?.let { created.localParticipant.unpublishTrack(it); it.dispose() }; audio = null }
      if (!enabled) {
        mutableState.value = mutableState.value.copy(
          requiresAudioPermission = false,
          audio = "AUDIO OFF",
          audioWarning = "",
          warning = mutableState.value.warning.takeUnless { it == AUDIO_PERMISSION_WARNING }.orEmpty(),
        )
      }
      if (enabled && !hasAudioPermission()) {
        audio?.let { created.localParticipant.unpublishTrack(it); it.dispose() }
        audio = null
        mutableState.value = mutableState.value.copy(
          requiresAudioPermission = true,
          audio = "AUDIO WAITING · 点击授权",
          warning = AUDIO_PERMISSION_WARNING,
        )
        notifyState("${mutableState.value.cameraCode} · 等待主音频授权")
        return@withLock
      }
      if (enabled && !LiveAudioPolicy.canUseInput(usbInput() != null, allowInternalFallback)) {
        audio?.let { created.localParticipant.unpublishTrack(it); it.dispose() }; audio = null
        mutableState.value = mutableState.value.copy(requiresAudioPermission = false, audio = "AUDIO WAITING · USB 麦克风",
          warning = mutableState.value.warning.takeUnless { it == AUDIO_PERMISSION_WARNING }.orEmpty())
        updateAudioWarning()
        notifyState("${mutableState.value.cameraCode} · 等待 USB 麦克风")
        return@withLock
      }
      if (enabled && audio == null && created.state == Room.State.CONNECTED) {
        if (!uiVisible) {
          mutableState.value = mutableState.value.copy(audioWarning = "后台已选择本机主音频；请返回 App 启用麦克风")
          return@withLock
        }
        mutableState.value = mutableState.value.copy(
          requiresAudioPermission = false,
          warning = mutableState.value.warning.takeUnless { it == AUDIO_PERMISSION_WARNING }.orEmpty(),
        )
        // Android 14 requires the microphone foreground-service type to be
        // active before audio capture begins. The Activity only grants this
        // permission after the server assigns this phone as the main audio CAM.
        try { notifyState("${mutableState.value.cameraCode} · 正在启用主音频") }
        catch (e: SecurityException) {
          mutableState.value = mutableState.value.copy(audioWarning = "系统暂不允许启用麦克风，请返回 App 重试")
          return@withLock
        }
        preferUsb()
        // Keep initial PCM silent until the actual input route has been observed.
        module?.setMicrophoneMute(true)
        var local: LocalAudioTrack? = null
        try {
          val track = created.localParticipant.createAudioTrack("master-audio", LocalAudioTrackOptions(echoCancellation = false, autoGainControl = false, noiseSuppression = false))
          local = track
          if (created.localParticipant.publishAudioTrack(track) && room === created && isMainAudio()) audio = track
          else {
            created.localParticipant.unpublishTrack(track); track.dispose()
            mutableState.value = mutableState.value.copy(audioWarning = "音频尚未发布成功，稍后重试；视频继续接入")
            return@withLock
          }
        } catch (e: CancellationException) { local?.dispose(); throw e }
        catch (e: Exception) {
          local?.dispose()
          Log.w("LiveCameraService", "Audio publish failed", e)
          mutableState.value = mutableState.value.copy(audioWarning = "音频发布失败，请检查权限或输入设备；视频继续接入")
          return@withLock
        }
      }
      if (enabled) { preferUsb(); updateAudioWarning(); enforceAudioRoute() }
    }
    permissions()
    notifyState("${mutableState.value.cameraCode} · ${mutableState.value.label}")
  }

  /** SFU-enforced per-track whitelist; viewers cannot subscribe to all camera feeds. */
  private fun permissions() {
    val created = room ?: return
    val live = control.optBoolean("live")
    val previousAllowed = control.optString("previousCameraId") == cameraId && runCatching {
      (SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        .parse(control.optString("transitionUntil"))?.time ?: 0L) > System.currentTimeMillis()
    }.getOrDefault(false)
    val videoAllowed = control.optString("activeCameraId") == cameraId || previousAllowed
    val audioAllowed = control.optString("audioCameraId") == cameraId
    val permitted = created.remoteParticipants.values.mapNotNull { participant ->
      val identity = participant.identity?.value ?: return@mapNotNull null
      cameraSubscriptionPermission(identity, participant.sid.value, live,
        if (videoAllowed) video?.sid else null, if (audioAllowed) audio?.sid else null)
    }
    created.localParticipant.setTrackSubscriptionPermissions(false, permitted)
  }
  fun attach(view: SurfaceViewRenderer) {
    if (renderer === view) return
    renderer?.let { video?.removeRenderer(it) }
    renderer = view
    room?.let { it.initVideoRenderer(view); video?.addRenderer(view) }
  }
  fun detach(view: SurfaceViewRenderer) { video?.removeRenderer(view); if (renderer === view) renderer = null }
  private fun isMainAudio(): Boolean = LiveAudioPolicy.isAssigned(cameraId, control.optString("audioCameraId"))
  private fun isUsb(device: AudioDeviceInfo) = device.type == AudioDeviceInfo.TYPE_USB_DEVICE ||
    device.type == AudioDeviceInfo.TYPE_USB_HEADSET || device.type == AudioDeviceInfo.TYPE_USB_ACCESSORY
  private fun usbInput(): AudioDeviceInfo? = audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS).firstOrNull { isUsb(it) }
  private fun preferUsb() {
    val inputs = audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS)
    val device = inputs.firstOrNull { isUsb(it) }
      ?: inputs.firstOrNull { allowInternalFallback && it.type == AudioDeviceInfo.TYPE_BUILTIN_MIC }
    if (device != null) module?.setPreferredInputDevice(device)
  }
  private fun updateAudioWarning() {
    mutableState.value = mutableState.value.copy(audioWarning = when {
      !isMainAudio() -> ""
      usbInput() == null && !allowInternalFallback -> if (externalAudioLost) "USB 麦克风已拔出，声音已暂停；重新插入或明确允许内置麦克风" else "请插入 USB 麦克风；如需手机收音，请在音频设置中明确允许"
      externalAudioLost -> "USB 麦克风已拔出，按你的设置使用内置麦克风；请检查收音"
      else -> ""
    })
  }
  private fun enforceAudioRoute() {
    if (audio == null || !isMainAudio()) return
    val input = routedInput()
    val allowed = (input != null && isUsb(input)) || (allowInternalFallback && input?.type == AudioDeviceInfo.TYPE_BUILTIN_MIC)
    module?.setMicrophoneMute(!allowed)
    if (!allowed) mutableState.value = mutableState.value.copy(audioWarning = "实际收音路由未通过确认，声音已静音；请检查 USB 麦克风或音频设置")
  }
  private fun routedInput(): AudioDeviceInfo? = audioManager.activeRecordingConfigurations.firstOrNull { it.clientAudioSource == MediaRecorder.AudioSource.MIC }?.audioDevice
  private fun hasAudioPermission(): Boolean = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
  private fun audioStatus(): String {
    val input = routedInput()
    return LiveAudioPolicy.status(audio != null, input != null && isUsb(input), input?.type == AudioDeviceInfo.TYPE_BUILTIN_MIC)
  }
  private fun audioName(): String = when (audioStatus()) {
    "USB_EXTERNAL" -> "USB · ${routedInput()?.productName ?: "外接麦克风"}"
    "INTERNAL_MIC" -> "手机内置麦克风"
    "DISABLED" -> "无音频"
    else -> "实际输入路由待确认"
  }
  private fun network(): String {
    val manager = getSystemService(ConnectivityManager::class.java)
    val caps = manager.getNetworkCapabilities(manager.activeNetwork) ?: return "OFFLINE"
    return when { caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "WIFI"; caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "CELLULAR"; caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ETHERNET"; else -> "OTHER" }
  }
  private fun thermal(): String = if (Build.VERSION.SDK_INT < 29) "NORMAL" else when (getSystemService(PowerManager::class.java).currentThermalStatus) {
    in PowerManager.THERMAL_STATUS_CRITICAL..PowerManager.THERMAL_STATUS_SHUTDOWN -> "CRITICAL"
    PowerManager.THERMAL_STATUS_SEVERE -> "HOT"
    PowerManager.THERMAL_STATUS_MODERATE, PowerManager.THERMAL_STATUS_LIGHT -> "WARM"
    else -> "NORMAL"
  }
  private suspend fun sampleStats() {
    val report = video?.getRTCStats() ?: return
    var totalBytes = 0.0
    var frames = 0.0
    var width = 0
    var height = 0
    val diagnostics = mutableListOf<String>()
    report.statsMap.values.forEach { stat ->
      val data = stat.members
      fun number(key: String) = (data[key] as? Number)?.toDouble() ?: 0.0
      if (stat.type == "outbound-rtp" && data["kind"] == "video") {
        totalBytes += number("bytesSent"); frames = maxOf(frames, number("framesPerSecond"))
        width = maxOf(width, number("frameWidth").toInt()); height = maxOf(height, number("frameHeight").toInt())
        diagnostics += "rid=${data["rid"] ?: "main"} ${number("frameWidth").toInt()}x${number("frameHeight").toInt()} ${number("framesPerSecond").toInt()}fps limitation=${data["qualityLimitationReason"] ?: "unknown"} encoder=${data["encoderImplementation"] ?: "unknown"}"
      }
      if (stat.type == "candidate-pair" && data["state"] == "succeeded") rtt = (number("currentRoundTripTime") * 1000).toInt().coerceIn(0, 60000)
      if (stat.type == "remote-inbound-rtp") loss = (number("fractionLost") * 100).coerceIn(0.0, 100.0)
    }
    val now = System.currentTimeMillis()
    if (previousStatsTime > 0 && now > previousStatsTime) bitrate = ((totalBytes - previousBytes).coerceAtLeast(0.0) * 8 / (now - previousStatsTime)).toInt().coerceIn(0, 100000)
    previousStatsTime = now; previousBytes = totalBytes; measuredFps = frames.toInt()
    actualWidth = width; actualHeight = height
    videoDiagnostics = diagnostics.joinToString(" | ")
    Log.d("LiveCameraStats", "target=${selectedQuality.label} zoom=${capturer.zoom()} sent=${actualWidth}x${actualHeight}/$measuredFps bitrate=$bitrate rtt=$rtt loss=$loss $videoDiagnostics")
  }
  fun stopPublishing(keepPreview: Boolean = true) {
    wanted = false; loop?.cancel(); loop = null; disconnect()
    wakeLock?.let { if (it.isHeld) it.release() }; wakeLock = null
    control = JSONObject(); cameraId = ""
    mutableState.value = mutableState.value.copy(publishing = false, connecting = false, onAir = false, isProgramCamera = false, label = "已停止接入", metrics = "", warning = "", audio = "AUDIO OFF", requiresAudioPermission = false, audioWarning = "")
    if (keepPreview) notifyState("已停止接入")
    if (keepPreview) prepareLocal()
  }
  private fun disconnect() {
    events?.cancel(); events = null
    renderer?.let { video?.removeRenderer(it) }
    video?.let { room?.localParticipant?.unpublishTrack(it); it.dispose() }
    renderer?.release()
    room?.disconnect(); room?.release(); room = null
    video = null; audio = null; module?.release(); module = null
    egl?.release(); egl = null; encoder = null
    previousBytes = 0.0; previousStatsTime = 0
    bitrate = 0; rtt = 0; loss = 0.0; measuredFps = 0; actualWidth = 0; actualHeight = 0
    audioDb = -100.0; clippingUntil = 0
  }
  private fun notifyState(text: String) {
    val open = PendingIntent.getActivity(this, 20, Intent(this, LiveCameraActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val stop = PendingIntent.getService(this, 21, Intent(this, LiveCameraService::class.java).setAction("STOP"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val notification = NotificationCompat.Builder(this, "multicamera").setSmallIcon(R.drawable.ic_stat_stream).setContentTitle("羽动云赛多机位摄像")
      .setContentText(text).setContentIntent(open).setOngoing(true).addAction(0, "停止摄像", stop).build()
    val type = if (Build.VERSION.SDK_INT >= 30) {
      ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or
        (if (hasAudioPermission() && isMainAudio() && (uiVisible || audio != null)) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0)
    } else 0
    ServiceCompat.startForeground(this, 42, notification, type)
  }
  override fun onDestroy() {
    stopPublishing(keepPreview = false)
    audioManager.unregisterAudioDeviceCallback(devices); audioManager.unregisterAudioRecordingCallback(recording)
    connectivity.unregisterNetworkCallback(networkCallback)
    networkChanges.close(); scope.cancel(); super.onDestroy()
  }

  companion object {
    private const val HEARTBEAT_INTERVAL_MS = 3_000L
    private const val AUDIO_PERMISSION_WARNING = "后台已把本机设为主音频机位；请授权麦克风后再发布声音"
  }
}
