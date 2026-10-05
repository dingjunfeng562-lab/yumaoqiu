package com.ayumaoqiu.camera

import org.junit.Assert.*
import org.junit.Test

class CaptureQualityPolicyTest {
  @Test fun variableSixtyRangeIsUsedWithoutInventingAFixedRange() {
    assertEquals(30 to 60, CaptureQualityPolicy.frameRateRange(listOf(15 to 30, 30 to 60), 60))
    assertNull(CaptureQualityPolicy.frameRateRange(listOf(15 to 30, 30 to 30), 60))
  }

  @Test fun prefersFixedSixtyWhenCameraExposesIt() {
    assertEquals(60 to 60, CaptureQualityPolicy.frameRateRange(listOf(15 to 60, 30 to 60, 60 to 60), 60))
  }

  @Test fun slow4kOutputCannotSilentlyLimit1080p60Capture() {
    val sixty = LocalQuality("1080p", 60)
    assertFalse(CaptureQualityPolicy.outputSupports(CameraOutputMode(3840, 2160, 33_333_333), sixty))
    assertTrue(CaptureQualityPolicy.outputSupports(CameraOutputMode(1920, 1080, 16_666_667), sixty))
    assertFalse(CaptureQualityPolicy.outputSupports(CameraOutputMode(1280, 720, 16_666_667), sixty))
    assertFalse(CaptureQualityPolicy.outputSupports(CameraOutputMode(4000, 3000, 16_666_667), sixty))
  }

  @Test fun acceptsPortraitOrderAndUnknownDurationWithoutCallingIt30fps() {
    assertTrue(CaptureQualityPolicy.outputSupports(CameraOutputMode(1080, 1920, 0), LocalQuality("1080p", 60)))
  }

  @Test fun automaticLiveQualityPrefers1080p60AndFallsBackHonestly() {
    assertEquals(LocalQuality("1080p", 60), CaptureQualityPolicy.auto(listOf(LocalQuality("2160p", 30), LocalQuality("1080p", 30), LocalQuality("1080p", 60))))
    assertEquals(LocalQuality("1080p", 30), CaptureQualityPolicy.auto(listOf(LocalQuality("1080p", 30), LocalQuality("720p", 60))))
    assertNull(CaptureQualityPolicy.auto(emptyList()))
  }

  @Test fun explainsSensorRateOutputSizeAndEncoderLimitsSeparately() {
    val quality = LocalQuality("1080p", 60)
    val modes = listOf(CameraOutputMode(1920, 1080, 16_666_667))
    assertEquals("当前镜头未向此 App 开放 60 帧", CaptureQualityPolicy.unavailableReason(quality, modes, listOf(30 to 30), true))
    assertEquals("当前镜头未开放 1080p / 60 帧输出", CaptureQualityPolicy.unavailableReason(quality, listOf(CameraOutputMode(1920, 1080, 33_333_333)), listOf(30 to 60), true))
    assertEquals("当前编码器不支持 1080p / 60 帧", CaptureQualityPolicy.unavailableReason(quality, modes, listOf(30 to 60), false))
    assertNull(CaptureQualityPolicy.unavailableReason(quality, modes, listOf(30 to 60), true))
  }
}
