package com.ayumaoqiu.camera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalQualityTest {
  @Test
  fun fixedSensorRateDoesNotOfferUnsupportedLowerRates() {
    val options = LocalQuality.supported(listOf(1920 to 1080), listOf(60 to 60)) { _, _, _ -> true }
    assertEquals(setOf(60), options.map { it.fps }.toSet())
  }

  @Test
  fun unknownStoredValuesAreNotATier() {
    assertNull(LocalQuality.of(null, 30))
    assertNull(LocalQuality.of("1080p", 0))
    assertNull(LocalQuality.of("480p", 30))
    assertEquals(LocalQuality("2160p", 30), LocalQuality.of("2160p", 30))
  }

  @Test
  fun offersOnlyWhatCameraAndEncoderSupport() {
    // A typical mid-range phone: 4K sensor output, 60 fps exposure, but the
    // encoder cannot do 4K60.
    val sizes = listOf(3840 to 2160, 1920 to 1080, 1280 to 720, 4000 to 3000)
    val ranges = listOf(15 to 30, 30 to 30, 60 to 60)
    val options = LocalQuality.supported(sizes, ranges) { w, _, fps -> !(w == 3840 && fps > 30) }
    assertTrue(LocalQuality("1080p", 60) in options)
    assertTrue(LocalQuality("2160p", 30) in options)
    assertTrue(LocalQuality("2160p", 60) !in options)
  }

  @Test
  fun noFramesAboveTheCamerasExposureRange() {
    val options = LocalQuality.supported(listOf(1920 to 1080), listOf(15 to 30)) { _, _, _ -> true }
    assertTrue(options.all { it.fps <= 30 })
    // A 1080p sensor output also covers 720p (scaled down), never 4K.
    assertEquals(setOf("720p", "1080p"), options.map { it.resolution }.toSet())
  }

  @Test
  fun non16by9SensorSizesDoNotCount() {
    val options = LocalQuality.supported(listOf(4000 to 3000, 1440 to 1080), listOf(30 to 30)) { _, _, _ -> true }
    assertTrue(options.isEmpty())
  }

  @Test
  fun a1440pOnlyPhoneIsNotHeldBackTo1080p() {
    // 2560x1440 outputs are common on phones that cannot reach 4K; treating the
    // tiers as 720p/1080p/2160p only would silently drop them a step.
    val options = LocalQuality.supported(listOf(2560 to 1440), listOf(30 to 30)) { _, _, _ -> true }
    assertEquals(listOf("720p", "1080p", "1440p").sorted(), options.map { it.resolution }.distinct().sorted())
    assertEquals(LocalQuality("1440p", 30), LocalQuality.auto(options))
  }

  @Test
  fun autoTakesTheHighestTierWithAUsableFrameRate() {
    // 4K is available but only at 24 fps. A "pick the biggest number" rule would
    // choose it and give the audience a visibly choppy picture.
    val slow4k = listOf(LocalQuality("2160p", 24), LocalQuality("1080p", 30), LocalQuality("720p", 30))
    assertEquals(LocalQuality("1080p", 30), LocalQuality.auto(slow4k))
  }

  @Test
  fun autoPrefersTheHighestFamiliarTier() {
    val everything = LocalQuality.FRAME_RATES.flatMap { fps ->
      LocalQuality.RESOLUTIONS.map { LocalQuality(it, fps) }
    }
    assertEquals(LocalQuality("2160p", 30), LocalQuality.auto(everything))
  }

  @Test
  fun autoStillWorksOnAWeakDevice() {
    // Nothing in the preferred set: fall back to the best of what is left rather
    // than refusing to stream.
    val weak = listOf(LocalQuality("720p", 24), LocalQuality("1080p", 24), LocalQuality("720p", 30))
    assertEquals(LocalQuality("720p", 30), LocalQuality.auto(weak))
    // Nothing at all is reported as "not measured yet", never as a crash.
    assertNull(LocalQuality.auto(emptyList()))
  }

  @Test
  fun bitrateFollowsTheTierAndStaysCarryable() {
    // The landing rates an operator can compare against their uplink budget.
    assertEquals(2600, LocalQuality.recommendedBitrateKbps("720p", 30))
    assertEquals(6000, LocalQuality.recommendedBitrateKbps("1080p", 30))
    assertEquals(12000, LocalQuality.recommendedBitrateKbps("1080p", 60))
    assertEquals(12000, LocalQuality.recommendedBitrateKbps("1440p", 30))
    assertEquals(24000, LocalQuality.recommendedBitrateKbps("2160p", 30))
    // Above 30 fps the 4K tier would want more than a phone hot-spot can carry,
    // so it is capped there instead of growing without bound.
    assertEquals(24000, LocalQuality.recommendedBitrateKbps("2160p", 60))
    // Odd frame rates scale down rather than snapping to the 30 fps figure.
    assertEquals(5000, LocalQuality.recommendedBitrateKbps("1080p", 25))
    assertEquals(4800, LocalQuality.recommendedBitrateKbps("1080p", 24))
    // Never below what a small tier needs.
    assertTrue(LocalQuality.recommendedBitrateKbps("720p", 24) >= 2000)
    // Monotonic in both directions, so a higher tier never asks for less.
    assertTrue(
      LocalQuality.recommendedBitrateKbps("2160p", 30) >
        LocalQuality.recommendedBitrateKbps("1440p", 30),
    )
    assertTrue(
      LocalQuality.recommendedBitrateKbps("1080p", 60) >
        LocalQuality.recommendedBitrateKbps("1080p", 30),
    )
  }

  @Test
  fun autoChosenTierDrivesTheEncoderSettings() {
    // No site bitrate, which is the default: the tier's own rate stands.
    val config = CameraConfig(
      broadcastId = "b", title = "t", status = "READY", configVersion = 1,
      tournamentName = "x", venueName = null,
      settings = CameraSettings(videoBitrateKbps = 0), ingestUrl = "rtmp://x/y",
    )
    val applied = config.withAuto(LocalQuality("2160p", 30)).settings
    assertEquals(3840, applied.width)
    assertEquals(2160, applied.height)
    assertEquals(30, applied.fps)
    assertEquals(24000 * 1024, applied.videoBitrate)
    // Unrelated site settings survive.
    assertEquals("back", applied.facing)
    // A site cap still applies on top of the chosen tier.
    val capped = config.withAuto(LocalQuality("2160p", 30)).settings.copy(videoBitrateKbps = 8000)
    assertEquals(8000 * 1024, capped.videoBitrate)
    // Switching tiers keeps everything else and moves only the quality.
    val switched = config.withAuto(LocalQuality("2160p", 30)).withAuto(LocalQuality("720p", 60)).settings
    assertEquals(LocalQuality("720p", 60), switched.quality)
    assertEquals(1280, switched.width)
    assertEquals(60, switched.fps)
    assertEquals(5200 * 1024, switched.videoBitrate)
  }
}
