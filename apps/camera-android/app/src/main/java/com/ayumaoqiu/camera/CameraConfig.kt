package com.ayumaoqiu.camera

import org.json.JSONObject

/** Everything the phone needs to publish. */
data class CameraConfig(
  val broadcastId: String,
  val title: String,
  val status: String,
  val configVersion: Int,
  val tournamentName: String,
  val venueName: String?,
  val settings: CameraSettings,
  /** null until the operator saves a push address in the admin page. */
  val ingestUrl: String?,
)

/** Reported back every few seconds for the admin status light. */
data class Heartbeat(
  val state: String,
  val bitrateKbps: Int? = null,
  val fps: Int? = null,
  val width: Int? = null,
  val height: Int? = null,
  val zoom: Float? = null,
  val audioSource: String? = null,
  val battery: Int? = null,
  val message: String? = null,
) {
  fun toJson(): String = JSONObject().apply {
    put("state", state)
    bitrateKbps?.let { put("bitrateKbps", it) }
    fps?.let { put("fps", it) }
    width?.let { put("width", it) }
    height?.let { put("height", it) }
    zoom?.let { put("zoom", it.toDouble()) }
    audioSource?.let { put("audioSource", it) }
    battery?.let { put("battery", it) }
    message?.let { put("message", it.take(120)) }
  }.toString()
}

object CameraJson {
  fun parseConfig(body: String): CameraConfig {
    val root = JSONObject(body)
    val settings = root.optJSONObject("settings")
    return CameraConfig(
      broadcastId = root.getString("broadcastId"),
      title = root.optString("title"),
      status = root.optString("status", "READY"),
      configVersion = root.optInt("configVersion", 1),
      tournamentName = root.optString("tournamentName"),
      venueName = if (root.isNull("venueName")) null else root.optString("venueName"),
      settings = CameraSettings(
        // The site deliberately sends neither resolution nor frame rate: the app
        // measures the phone and picks the tier itself (see LocalQuality.auto).
        videoBitrateKbps = settings?.optInt("videoBitrateKbps", 0) ?: 0,
        audioBitrateKbps = settings?.optInt("audioBitrateKbps", 128) ?: 128,
        facing = settings?.optString("facing") ?: "back",
        preferExternalMic = settings?.optBoolean("preferExternalMic", true) ?: true,
      ),
      ingestUrl = if (root.isNull("ingestUrl")) null else root.optString("ingestUrl").ifBlank { null },
    )
  }
}
