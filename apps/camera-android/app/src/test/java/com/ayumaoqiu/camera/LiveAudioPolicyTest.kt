package com.ayumaoqiu.camera

import org.junit.Assert.*
import org.junit.Test

class LiveAudioPolicyTest {
  @Test fun emptyIdsNeverStartMicrophoneCapture() {
    assertFalse(LiveAudioPolicy.isAssigned("", ""))
    assertFalse(LiveAudioPolicy.isAssigned("CAM1", "CAM2"))
    assertTrue(LiveAudioPolicy.isAssigned("CAM1", "CAM1"))
  }
  @Test fun internalMicIsOptInOnly() {
    assertFalse(LiveAudioPolicy.canUseInput(false, false))
    assertTrue(LiveAudioPolicy.canUseInput(true, false))
    assertTrue(LiveAudioPolicy.canUseInput(false, true))
  }
  @Test fun unknownRouteUsesBackendErrorEnumInsteadOfPretendingToBeInternal() {
    assertEquals("DISABLED", LiveAudioPolicy.status(false, false, false))
    assertEquals("USB_EXTERNAL", LiveAudioPolicy.status(true, true, false))
    assertEquals("INTERNAL_MIC", LiveAudioPolicy.status(true, false, true))
    assertEquals("ERROR", LiveAudioPolicy.status(true, false, false))
  }
}
