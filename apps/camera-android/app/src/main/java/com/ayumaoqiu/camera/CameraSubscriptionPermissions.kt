package com.ayumaoqiu.camera

import io.livekit.android.room.participant.ParticipantTrackPermission

/** Build SFU permissions with both identifiers populated for LiveKit 2.29.0.
 * Its toProto() passes even an omitted nullable SID to a non-null protobuf setter.
 */
internal fun cameraSubscriptionPermission(
  identity: String,
  participantSid: String,
  live: Boolean,
  videoSid: String?,
  audioSid: String?,
): ParticipantTrackPermission? {
  if (identity.isBlank() || participantSid.isBlank()) return null
  return when {
    identity.startsWith("director_") -> ParticipantTrackPermission(
      participantIdentity = identity, participantSid = participantSid, allTracksAllowed = true,
    )
    identity.startsWith("viewer_") && live -> ParticipantTrackPermission(
      participantIdentity = identity, participantSid = participantSid,
      allowedTrackSids = listOfNotNull(videoSid, audioSid).filter { it.isNotBlank() },
    )
    else -> null
  }
}
