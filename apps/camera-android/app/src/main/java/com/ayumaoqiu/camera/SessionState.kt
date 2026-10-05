package com.ayumaoqiu.camera

/** Where the session is in its life, as one explicit value. */
enum class SessionPhase {
  /** No pairing token yet, or the token is not usable. */
  UNPAIRED,

  /** Asking the site for the room's configuration. */
  LOADING,

  /** Config in hand, camera open, not publishing. */
  READY,

  /** Handing the stream to the ingest server. */
  CONNECTING,

  /** Publishing. */
  LIVE,

  /** Lost the connection and working on getting it back. */
  RECONNECTING,

  /** Something needs the operator's attention; [SessionState.message] says what. */
  ERROR,
}

/**
 * Everything the screen needs, in one immutable value.
 *
 * The activity renders this and nothing else: it holds no flags of its own, so
 * the UI cannot drift out of step with the stream. Reported states map onto the
 * heartbeat's vocabulary in [heartbeatState].
 */
data class SessionState(
  val phase: SessionPhase = SessionPhase.UNPAIRED,
  val message: String = "未配对",
  val config: CameraConfig? = null,
  val bitrateKbps: Int = 0,
  val fps: Int = 0,
  val battery: Int? = null,
  val zoom: Float = 1f,
  val zoomMin: Float = 1f,
  val zoomMax: Float = 1f,
  val micName: String = "",
  val cameras: List<String> = emptyList(),
  val cameraId: String = "",
  /** Version of the config currently applied, used to spot operator changes. */
  val appliedVersion: Int = -1,
) {
  val zoomScale: ZoomScale get() = ZoomScale(zoomMin, zoomMax)

  val isPublishing: Boolean
    get() = phase == SessionPhase.CONNECTING ||
      phase == SessionPhase.LIVE ||
      phase == SessionPhase.RECONNECTING

  /** The button reads "开始推流" or "停止推流" depending on this. */
  val isBusy: Boolean get() = phase == SessionPhase.LOADING

  /**
   * What this phone settled on. Marked 自适应 so the operator knows the number
   * comes from the device rather than from a setting anyone can change.
   */
  val resolutionLabel: String
    get() = config?.settings?.takeIf { it.quality != null }?.let {
      "${it.width}×${it.height}@${it.fps}fps · ${it.videoBitrate / 1024} kbps · 自适应"
    }.orEmpty()

  val title: String get() = config?.title.orEmpty()

  val subtitle: String
    get() = config?.let { cfg ->
      val venue = cfg.venueName?.takeIf { it.isNotBlank() } ?: "未绑定场地"
      "${cfg.tournamentName} · $venue"
    }.orEmpty()

  /** The only four states the site accepts, plus the two it now also knows. */
  fun heartbeatState(): String = when (phase) {
    SessionPhase.READY -> "PREVIEW"
    SessionPhase.CONNECTING -> "CONNECTING"
    SessionPhase.LIVE -> "STREAMING"
    SessionPhase.RECONNECTING -> "RECONNECTING"
    SessionPhase.ERROR -> "ERROR"
    SessionPhase.UNPAIRED, SessionPhase.LOADING -> "IDLE"
  }
}
