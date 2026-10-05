package com.ayumaoqiu.camera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The phone's side of the backend contract in broadcasts.service.ts. */
class CameraConfigTest {

  @Test
  fun parsesTheBackendConfigResponse() {
    // Shape returned by GET /api/camera/config (see test/camera.smoke.cjs). The
    // site no longer sends a resolution or frame rate: the phone picks those.
    val body = """
      {"broadcastId":"b1","title":"1号场直播","status":"LIVE","configVersion":7,
       "tournamentName":"春季公开赛","venueName":"1号场",
       "settings":{"videoBitrateKbps":4500,"audioBitrateKbps":160,
                   "facing":"front","preferExternalMic":false},
       "ingestUrl":"srt://push.example.com:9000?streamid=abc"}
    """.trimIndent()
    val config = CameraJson.parseConfig(body)
    assertEquals("b1", config.broadcastId)
    assertEquals(7, config.configVersion)
    assertEquals("1号场", config.venueName)
    assertEquals("front", config.settings.facing)
    assertFalse(config.settings.preferExternalMic)
    assertEquals("srt://push.example.com:9000?streamid=abc", config.ingestUrl)
    // Until the camera is open nothing has been measured, so the framing
    // fallback applies; the site's 4500 is below that tier's own rate and so it
    // caps the encoder.
    assertNull(config.settings.quality)
    assertEquals(1920, config.settings.width)
    assertEquals(1080, config.settings.height)
    assertEquals(30, config.settings.fps)
    assertEquals(4500 * 1024, config.settings.videoBitrate)
  }

  @Test
  fun aLegacyResolutionFromTheSiteIsIgnored() {
    // Rows written before the app chose its own quality may still carry these.
    // Honouring them would pin a phone to a resolution nobody can change.
    val config = CameraJson.parseConfig(
      """{"broadcastId":"b3","title":"t","status":"READY","configVersion":1,
          "tournamentName":"x","venueName":null,
          "settings":{"resolution":"720p","fps":60,"videoBitrateKbps":4500},
          "ingestUrl":"rtmp://push.example.com/live/key"}""",
    )
    assertNull(config.settings.quality)
    assertEquals(1920, config.settings.width)
    assertEquals(30, config.settings.fps)
  }

  @Test
  fun theSiteBitrateIsACeilingNotATarget() {
    val measured = LocalQuality("2160p", 30)
    // A ceiling below the tier's own recommendation is applied: the operator may
    // be on a venue uplink that cannot carry 4K, and a smaller stable picture
    // beats a sharp one that keeps dropping frames.
    assertEquals(4000 * 1024, CameraSettings(videoBitrateKbps = 4000, quality = measured).videoBitrate)
    // A ceiling above what this tier needs is never reached, so the tier's own
    // figure stands rather than the site's larger number.
    assertEquals(20000 * 1024, CameraSettings(videoBitrateKbps = 20000, quality = measured).videoBitrate)
    // Zero is how the site says "no limit", which is the default: the phone sizes
    // the bitrate for the tier it measured.
    assertEquals(24000 * 1024, CameraSettings(videoBitrateKbps = 0, quality = measured).videoBitrate)
    assertEquals(24000 * 1024, CameraSettings(quality = measured).videoBitrate)
    // The cap also applies to the fallback tier used before measurement.
    assertEquals(4000 * 1024, CameraSettings(videoBitrateKbps = 4000).videoBitrate)
  }

  @Test
  fun missingPushAddressAndVenueAreNull() {
    val config = CameraJson.parseConfig(
      """{"broadcastId":"b2","title":"t","status":"READY","configVersion":1,
          "tournamentName":"x","venueName":null,"settings":{},"ingestUrl":null}""",
    )
    assertNull(config.ingestUrl)
    assertNull(config.venueName)
    assertTrue(config.settings.preferExternalMic)
  }

  @Test
  fun heartbeatOmitsUnknownValuesAndCapsTheMessage() {
    val json = Heartbeat(state = "PREVIEW", zoom = 2.5f, message = "x".repeat(300)).toJson()
    val parsed = org.json.JSONObject(json)
    assertEquals("PREVIEW", parsed.getString("state"))
    assertEquals(2.5, parsed.getDouble("zoom"), 0.0001)
    assertFalse(parsed.has("bitrateKbps"))
    assertFalse(parsed.has("battery"))
    // The backend DTO rejects messages longer than 120 characters.
    assertEquals(120, parsed.getString("message").length)
  }

  @Test
  fun everyPhaseMapsToAStateTheBackendAccepts() {
    // Must stay in step with CameraHeartbeatDto.state on the backend.
    val accepted = setOf("IDLE", "PREVIEW", "CONNECTING", "STREAMING", "RECONNECTING", "ERROR")
    for (phase in SessionPhase.values()) {
      val reported = SessionState(phase = phase).heartbeatState()
      assertTrue("$phase -> $reported", reported in accepted)
    }
    assertEquals("STREAMING", SessionState(phase = SessionPhase.LIVE).heartbeatState())
    assertEquals("PREVIEW", SessionState(phase = SessionPhase.READY).heartbeatState())
  }

  @Test
  fun publishingCoversTheTransientStates() {
    assertTrue(SessionState(phase = SessionPhase.CONNECTING).isPublishing)
    assertTrue(SessionState(phase = SessionPhase.LIVE).isPublishing)
    assertTrue(SessionState(phase = SessionPhase.RECONNECTING).isPublishing)
    assertFalse(SessionState(phase = SessionPhase.READY).isPublishing)
    assertFalse(SessionState(phase = SessionPhase.ERROR).isPublishing)
  }
}
