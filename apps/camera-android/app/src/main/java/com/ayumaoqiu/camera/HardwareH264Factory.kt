package com.ayumaoqiu.camera

import livekit.org.webrtc.EglBase
import livekit.org.webrtc.HardwareVideoEncoderFactory
import livekit.org.webrtc.VideoCodecInfo
import livekit.org.webrtc.VideoEncoder
import livekit.org.webrtc.VideoEncoderFactory

/** Never delegates a failed hardware encoder to a software implementation. */
class HardwareH264Factory(context: EglBase.Context) : VideoEncoderFactory {
  private val hardware = HardwareVideoEncoderFactory(context, false, false) { VideoCapabilities.isHardwareEncoder(it) }
  override fun getSupportedCodecs(): Array<VideoCodecInfo> = hardware.supportedCodecs.filter { it.name.equals("H264", true) }.toTypedArray()
  override fun createEncoder(info: VideoCodecInfo): VideoEncoder? =
    if (info.name.equals("H264", true)) hardware.createEncoder(info) else null
}
