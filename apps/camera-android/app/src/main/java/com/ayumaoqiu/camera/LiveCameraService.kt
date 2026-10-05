package com.ayumaoqiu.camera

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaRecorder
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import android.view.Surface
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
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
import io.livekit.android.room.track.VideoPreset169
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import livekit.org.webrtc.PeerConnectionFactory
import livekit.org.webrtc.RtpParameters
import livekit.org.webrtc.audio.JavaAudioDeviceModule
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import kotlin.math.log10
import kotlin.math.sqrt

data class LiveCameraUi(val label: String = "摄像端已就绪", val cameraCode: String = "CAM", val onAir: Boolean = false, val capabilitiesVersion: Int = 0,
  val publishing: Boolean = false, val connecting: Boolean = false, val metrics: String = "", val audio: String = "AUDIO OFF", val warning: String = "")

/** Owns the room and camera outside the Activity; returning to the app only reattaches a renderer. */
class LiveCameraService : LifecycleService() {
  inner class LocalBinder : Binder() { val service get() = this@LiveCameraService }
  private val binder = LocalBinder()
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private val mutableState = MutableStateFlow(LiveCameraUi())
  val state = mutableState.asStateFlow()
  lateinit var capturer: LiveCameraCapturer
    private set
  private lateinit var api: LiveCameraApi
  private var room: Room? = null
  private var video: LocalVideoTrack? = null
  private var audio: LocalAudioTrack? = null
  private var renderer: SurfaceViewRenderer? = null
  private var module: JavaAudioDeviceModule? = null
  private var loop: Job? = null
  private var events: Job? = null
  private var pairing: Job? = null
  private var control = JSONObject()
  private var cameraId = ""
  private var wanted = false
  private val audioMutex = Mutex()
  private var wakeLock: PowerManager.WakeLock? = null
  @Volatile private var audioDb = -100.0
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
  private val devices = object : AudioDeviceCallback() {
    override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) { preferUsb() }
    override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) {
      preferUsb()
      if (removedDevices.any { it.type == AudioDeviceInfo.TYPE_USB_DEVICE || it.type == AudioDeviceInfo.TYPE_USB_HEADSET }) {
        mutableState.value = mutableState.value.copy(warning = "USB 麦克风已断开，已切回内置麦克风")
      }
    }
  }

  override fun onCreate() {
    super.onCreate()
    api = LiveCameraApi(this)
    if (Build.VERSION.SDK_INT >= 26) getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel("multicamera", "多机位直播", NotificationManager.IMPORTANCE_LOW))
    notifyState("摄像端已就绪")
    audioManager.registerAudioDeviceCallback(devices, null)
    prepareLocal()
  }
  override fun onBind(intent: Intent): IBinder { super.onBind(intent); return binder }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    super.onStartCommand(intent, flags, startId)
    if (intent?.action == "STOP") { stopPublishing(); return START_NOT_STICKY }
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
  fun toggle() { if (wanted) stopPublishing() else startPublishing() }
  fun startPublishing() {
    if (wanted) return
    if (pairing?.isActive == true) { mutableState.value = mutableState.value.copy(warning = "正在配对，请稍候"); return }
    if (!api.paired) { mutableState.value = mutableState.value.copy(label = "尚未配对", warning = "请点重新配对，扫描后台当前的配对二维码"); return }
    wanted = true
    mutableState.value = mutableState.value.copy(connecting = true, warning = "")
    wakeLock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ayumaoqiu:multicamera").apply { acquire() }
    loop = scope.launch {
      while (isActive && wanted) {
        try {
          if (room == null || room?.state == Room.State.DISCONNECTED) connect()
          sampleStats()
          val report = JSONObject().put("state", if (room?.state == Room.State.CONNECTED) "STREAMING" else "RECONNECTING")
            .put("bitrateKbps", bitrate).put("fps", measuredFps).put("width", actualWidth).put("height", actualHeight)
            .put("zoom", capturer.zoom().toDouble()).put("battery", getSystemService(BatteryManager::class.java).getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY).coerceIn(0, 100))
            .put("networkType", network()).put("rttMs", rtt).put("packetLoss", loss)
            .put("audioStatus", audioStatus()).put("audioSource", audioName()).put("audioLevelDb", audioDb.coerceIn(-160.0, 0.0))
            .put("thermal", thermal()).put("message", mutableState.value.warning.take(120))
          val config = api.call("heartbeat", report)
          applyControl(config)
          mutableState.value = mutableState.value.copy(metrics = "目标 ${selectedQuality.label} · 采集 ${capturer.capturedFps} FPS · 发送 ${actualHeight}P / $measuredFps FPS · ↑ $bitrate kbps · RTT $rtt ms · 丢包 ${"%.1f".format(loss)}% · ${network()} · 电量 ${report.optInt("battery")}% · ${thermal()}",
            audio = if (audio == null) "AUDIO OFF" else "${audioName()} · ${audioDb.toInt()} dB")
        } catch (e: CancellationException) { throw e }
        catch (e: ApiException) {
          if (e.status == 401) { api.forget(); stopPublishing(); mutableState.value = mutableState.value.copy(label = "直播已结束或配对失效", warning = e.message.orEmpty()); break }
          mutableState.value = mutableState.value.copy(warning = "后台暂时不可达，正在重试")
        } catch (e: Exception) {
          Log.e("LiveCameraService", "Camera connection failed", e)
          mutableState.value = mutableState.value.copy(label = "RECONNECTING", publishing = false, connecting = true,
            warning = "连接异常，正在恢复：${e.message?.takeIf { it.isNotBlank() }?.take(90) ?: e.javaClass.simpleName}")
        }
        delay(3000)
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
    }
    val options = qualityOptions()
    selectedQuality = requestedQuality?.takeIf { it in options }
      ?: CaptureQualityPolicy.auto(options) ?: LocalQuality("720p", 30)
    actualWidth = selectedQuality.width; actualHeight = selectedQuality.height
    // Initialize native WebRTC before creating the caller-owned audio module.
    PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(this).createInitializationOptions())
    val adm = JavaAudioDeviceModule.builder(this).setAudioSource(MediaRecorder.AudioSource.MIC)
      .setUseHardwareAcousticEchoCanceler(false).setUseHardwareNoiseSuppressor(false)
      .setSamplesReadyCallback { samples ->
        val bytes = samples.data
        var sum = 0.0
        for (i in 0 until bytes.size - 1 step 2) {
          val sample = ((bytes[i].toInt() and 255) or (bytes[i + 1].toInt() shl 8)).toShort().toDouble() / 32768.0
          sum += sample * sample
        }
        audioDb = (20 * log10(sqrt(sum / (bytes.size / 2).coerceAtLeast(1)).coerceAtLeast(0.00000001))).coerceIn(-160.0, 0.0)
      }.createAudioDeviceModule()
    module = adm
    val created = LiveKit.create(this, options = RoomOptions(dynacast = true), overrides = LiveKitOverrides(
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
      created.localParticipant.setTrackSubscriptionPermissions(false, emptyList())
      val media = config.getJSONObject("media")
      created.connect(media.getString("url"), media.getString("token"), ConnectOptions(autoSubscribe = false))
      // Deny subscriptions before publishing; only the server's room metadata can open specific tracks.
      created.localParticipant.setTrackSubscriptionPermissions(false, emptyList())
      val local = video ?: error("相机尚未就绪")
      check(created.localParticipant.publishVideoTrack(local, VideoTrackPublishOptions(source = Track.Source.CAMERA,
        videoCodec = VideoCodec.H264.codecName,
        videoEncoding = VideoEncoding(LocalQuality.recommendedBitrateKbps(selectedQuality.resolution, selectedQuality.fps) * 1000, selectedQuality.fps), simulcast = true,
        simulcastLayers = listOf(VideoPreset169.H360),
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
      mutableState.value = mutableState.value.copy(publishing = true, connecting = false, label = if (mutableState.value.onAir) "ON AIR" else "STANDBY", warning = "")
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
    val onAir = next.optBoolean("live") && next.optString("activeCameraId") == cameraId
    mutableState.value = mutableState.value.copy(onAir = onAir, label = if (onAir) "ON AIR" else "STANDBY")
    val created = room ?: return
    audioMutex.withLock {
      val enabled = next.optString("audioCameraId") == cameraId
      if (!enabled && audio != null) { audio?.let { created.localParticipant.unpublishTrack(it); it.dispose() }; audio = null }
      if (enabled && audio == null && created.state == Room.State.CONNECTED) {
        preferUsb()
        val local = created.localParticipant.createAudioTrack("master-audio", LocalAudioTrackOptions(echoCancellation = false, autoGainControl = false, noiseSuppression = false))
        if (created.localParticipant.publishAudioTrack(local)) audio = local else local.dispose()
      }
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
  private fun preferUsb() {
    val inputs = audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS)
    val device = inputs.firstOrNull { it.type == AudioDeviceInfo.TYPE_USB_DEVICE || it.type == AudioDeviceInfo.TYPE_USB_HEADSET || it.type == AudioDeviceInfo.TYPE_USB_ACCESSORY }
      ?: inputs.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_MIC }
    if (device != null) module?.setPreferredInputDevice(device)
  }
  private fun routedInput(): AudioDeviceInfo? = audioManager.activeRecordingConfigurations.firstOrNull()?.audioDevice
  private fun audioStatus(): String = if (audio == null) "DISABLED" else when (routedInput()?.type) {
    AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_USB_ACCESSORY -> "USB_EXTERNAL"
    else -> "INTERNAL_MIC"
  }
  private fun audioName(): String = if (audioStatus() == "USB_EXTERNAL") "USB · ${routedInput()?.productName ?: "外接麦克风"}" else "手机内置麦克风"
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
    report.statsMap.values.forEach { stat ->
      val data = stat.members
      fun number(key: String) = (data[key] as? Number)?.toDouble() ?: 0.0
      if (stat.type == "outbound-rtp" && data["kind"] == "video") {
        totalBytes += number("bytesSent"); frames = maxOf(frames, number("framesPerSecond"))
        width = maxOf(width, number("frameWidth").toInt()); height = maxOf(height, number("frameHeight").toInt())
      }
      if (stat.type == "candidate-pair" && data["state"] == "succeeded") rtt = (number("currentRoundTripTime") * 1000).toInt().coerceIn(0, 60000)
      if (stat.type == "remote-inbound-rtp") loss = (number("fractionLost") * 100).coerceIn(0.0, 100.0)
    }
    val now = System.currentTimeMillis()
    if (previousStatsTime > 0 && now > previousStatsTime) bitrate = ((totalBytes - previousBytes).coerceAtLeast(0.0) * 8 / (now - previousStatsTime)).toInt().coerceIn(0, 100000)
    previousStatsTime = now; previousBytes = totalBytes; measuredFps = frames.toInt()
    actualWidth = width; actualHeight = height
  }
  fun stopPublishing(keepPreview: Boolean = true) {
    wanted = false; loop?.cancel(); loop = null; disconnect()
    wakeLock?.let { if (it.isHeld) it.release() }; wakeLock = null
    mutableState.value = mutableState.value.copy(publishing = false, connecting = false, onAir = false, label = "已停止接入", metrics = "", warning = "", audio = "AUDIO OFF")
    notifyState("已停止接入")
    if (keepPreview) prepareLocal()
  }
  private fun disconnect() {
    events?.cancel(); events = null
    renderer?.let { video?.removeRenderer(it) }
    video?.let { room?.localParticipant?.unpublishTrack(it); it.dispose() }
    renderer?.release()
    room?.disconnect(); room?.release(); room = null
    video = null; audio = null; module?.release(); module = null
    previousBytes = 0.0; previousStatsTime = 0
  }
  private fun notifyState(text: String) {
    val open = PendingIntent.getActivity(this, 20, Intent(this, LiveCameraActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val stop = PendingIntent.getService(this, 21, Intent(this, LiveCameraService::class.java).setAction("STOP"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val notification = NotificationCompat.Builder(this, "multicamera").setSmallIcon(R.drawable.ic_stat_stream).setContentTitle("羽动云赛多机位摄像")
      .setContentText(text).setContentIntent(open).setOngoing(true).addAction(0, "停止接入", stop).build()
    ServiceCompat.startForeground(this, 42, notification, if (Build.VERSION.SDK_INT >= 30) ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0)
  }
  override fun onDestroy() { stopPublishing(keepPreview = false); audioManager.unregisterAudioDeviceCallback(devices); scope.cancel(); super.onDestroy() }
}
