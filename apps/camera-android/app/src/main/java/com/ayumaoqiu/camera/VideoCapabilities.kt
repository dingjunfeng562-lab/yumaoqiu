package com.ayumaoqiu.camera

import android.content.Context
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat

/**
 * Reads what this phone's camera and H.264 encoder can do, so the settings
 * list only offers qualities that will actually start.
 */
object VideoCapabilities {

  fun options(context: Context, cameraId: String): List<LocalQuality> {
    return availability(context, cameraId).filter { it.unavailableReason == null }.map { it.quality }
  }

  fun availability(context: Context, cameraId: String): List<QualityAvailability> {
    val manager = context.getSystemService(Context.CAMERA_SERVICE) as? CameraManager ?: return emptyList()
    val id = cameraId.ifBlank { runCatching { manager.cameraIdList.firstOrNull() }.getOrNull() } ?: return emptyList()
    val characteristics = runCatching { manager.getCameraCharacteristics(id) }.getOrNull() ?: return emptyList()

    val config = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP) ?: return emptyList()
    val outputSizes = config.getOutputSizes(SurfaceTexture::class.java).orEmpty()
    val modes = outputSizes.map { size -> CameraOutputMode(size.width, size.height,
      runCatching { config.getOutputMinFrameDuration(SurfaceTexture::class.java, size) }.getOrDefault(0L)) }
    val ranges = characteristics.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)
      ?.map { it.lower to it.upper }
      .orEmpty()
    val encoders = avcEncoders()

    return LocalQuality.RESOLUTIONS.flatMap { resolution -> LocalQuality.FRAME_RATES.map { fps ->
      val quality = LocalQuality(resolution, fps)
      val w = quality.width; val h = quality.height
      val encoderSupports = encoders.any { caps ->
        // Encoders report landscape and portrait separately on some devices.
        runCatching { caps.areSizeAndRateSupported(w, h, fps.toDouble()) }.getOrDefault(false) ||
          runCatching { caps.areSizeAndRateSupported(h, w, fps.toDouble()) }.getOrDefault(false)
      }
      QualityAvailability(quality, CaptureQualityPolicy.unavailableReason(quality, modes, ranges, encoderSupports))
    } }
  }

  /** Video capabilities of the H.264 encoders, hardware ones first. */
  private fun avcEncoders(): List<MediaCodecInfo.VideoCapabilities> =
    runCatching { MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.toList() }
      .getOrDefault(emptyList())
      .filter { info -> info.isEncoder && info.supportedTypes.any { it.equals(MediaFormat.MIMETYPE_VIDEO_AVC, true) } }
      .mapNotNull { info ->
        runCatching { info.getCapabilitiesForType(MediaFormat.MIMETYPE_VIDEO_AVC).videoCapabilities }.getOrNull()
      }
}
