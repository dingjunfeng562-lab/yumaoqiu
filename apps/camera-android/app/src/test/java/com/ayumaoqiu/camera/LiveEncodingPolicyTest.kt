package com.ayumaoqiu.camera

import org.junit.Assert.*
import org.junit.Test

class LiveEncodingPolicyTest {
  @Test fun restoresSmoothSixtyFpsPreviewOnlyWhenSupported() {
    assertEquals(LocalQuality("1080p", 60), LiveEncodingPolicy.defaultQuality(listOf(LocalQuality("1080p", 60), LocalQuality("1080p", 30))))
    assertEquals(LocalQuality("1080p", 30), LiveEncodingPolicy.defaultQuality(listOf(LocalQuality("720p", 60), LocalQuality("1080p", 30))))
    assertEquals(LocalQuality("720p", 60), LiveEncodingPolicy.defaultQuality(listOf(LocalQuality("720p", 30), LocalQuality("720p", 60))))
    assertEquals(LocalQuality("720p", 30), LiveEncodingPolicy.defaultQuality(listOf(LocalQuality("720p", 30))))
    assertNull(LiveEncodingPolicy.defaultQuality(emptyList()))
  }
  @Test fun capsMainVideoAndBudgetsLowPreviewSeparately() {
    assertEquals(4_000_000, LiveEncodingPolicy.bitrate(LiveEncodingPolicy.DEFAULT_MBPS))
    assertEquals(6_000_000, LiveEncodingPolicy.bitrate(99))
    assertEquals(2_000_000, LiveEncodingPolicy.bitrate(0))
    assertEquals(400_000, LiveEncodingPolicy.PREVIEW_BITRATE)
    assertEquals(12, LiveEncodingPolicy.PREVIEW_FPS)
  }
}
