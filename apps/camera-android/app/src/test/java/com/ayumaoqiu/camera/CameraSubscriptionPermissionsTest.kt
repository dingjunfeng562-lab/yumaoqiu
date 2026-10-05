package com.ayumaoqiu.camera

import io.livekit.android.room.participant.ParticipantTrackPermission
import java.lang.reflect.InvocationTargetException
import livekit.LivekitRtc
import org.junit.Assert.*
import org.junit.Test

class CameraSubscriptionPermissionsTest {
  // Execute the installed SDK's real protobuf conversion, including its nullable
  // identifier bug. No camera, Android runtime or mocked serializer is involved.
  private fun serialize(permission: ParticipantTrackPermission): LivekitRtc.TrackPermission =
    permission.javaClass.declaredMethods.single { it.name.startsWith("toProto") }.invoke(permission) as LivekitRtc.TrackPermission

  @Test fun reproducesIdentityOnlyNullPointerInInstalledSdk() {
    try {
      serialize(ParticipantTrackPermission(participantIdentity = "director_test", allTracksAllowed = true))
      fail("LiveKit 2.29.0 should reproduce the missing SID null pointer")
    } catch (error: InvocationTargetException) {
      assertTrue(error.cause is NullPointerException)
    }
  }

  @Test fun directorPermissionSerializesWhenJoiningAnActiveCamera() {
    val proto = serialize(cameraSubscriptionPermission("director_test", "PA_director", false, null, null)!!)
    assertEquals("director_test", proto.participantIdentity)
    assertEquals("PA_director", proto.participantSid)
    assertTrue(proto.allTracks)
  }

  @Test fun viewerOnlyReceivesSelectedVideoAndMasterAudio() {
    val videoOnly = serialize(cameraSubscriptionPermission("viewer_test", "PA_viewer", true, "TR_video", null)!!)
    assertFalse(videoOnly.allTracks)
    assertEquals(listOf("TR_video"), videoOnly.trackSidsList)
    val audioOnly = serialize(cameraSubscriptionPermission("viewer_test", "PA_viewer", true, null, "TR_audio")!!)
    assertEquals(listOf("TR_audio"), audioOnly.trackSidsList)
    val both = serialize(cameraSubscriptionPermission("viewer_test", "PA_viewer", true, "TR_video", "TR_audio")!!)
    assertEquals(listOf("TR_video", "TR_audio"), both.trackSidsList)
  }

  @Test fun standbyCameraDoesNotGiveViewerAnyTracks() {
    val proto = serialize(cameraSubscriptionPermission("viewer_test", "PA_viewer", true, null, null)!!)
    assertFalse(proto.allTracks)
    assertTrue(proto.trackSidsList.isEmpty())
  }

  @Test fun rejectsUnidentifiedParticipantsAndPausedViewers() {
    assertNull(cameraSubscriptionPermission("director_test", "", true, "TR_video", null))
    assertNull(cameraSubscriptionPermission("", "PA_unknown", true, "TR_video", null))
    assertNull(cameraSubscriptionPermission("camera_test", "PA_camera", true, "TR_video", null))
    assertNull(cameraSubscriptionPermission("viewer_test", "PA_viewer", false, "TR_video", "TR_audio"))
  }
}
