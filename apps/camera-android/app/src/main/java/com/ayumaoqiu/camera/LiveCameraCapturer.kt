package com.ayumaoqiu.camera

import android.content.Context
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.os.Handler
import android.os.Looper
import android.util.Range
import android.util.Size
import android.view.Surface
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.Preview
import androidx.camera.core.SurfaceOrientedMeteringPointFactory
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import livekit.org.webrtc.CapturerObserver
import livekit.org.webrtc.SurfaceTextureHelper
import livekit.org.webrtc.TextureBufferImpl
import livekit.org.webrtc.VideoCapturer
import livekit.org.webrtc.VideoFrame
import java.util.concurrent.TimeUnit

/** One CameraX session feeds both the local renderer and the WebRTC video track. */
@androidx.annotation.OptIn(markerClass = [ExperimentalCamera2Interop::class])
class LiveCameraCapturer(private val context: Context, private val owner: LifecycleOwner, private var front: Boolean = false) : VideoCapturer {
  private val main = Handler(Looper.getMainLooper())
  private var helper: SurfaceTextureHelper? = null
  private var observer: CapturerObserver? = null
  private var provider: ProcessCameraProvider? = null
  private var preview: Preview? = null
  private var camera: Camera? = null
  @Volatile private var running = false
  private data class FrameTransform(val sensorRotation: Int, val mirrored: Boolean, val rotation: Int, val cameraTransform: Boolean)
  @Volatile private var frameTransform: FrameTransform? = null
  @Volatile var capturedFps: Int = 0
    private set
  private var frameWindowStart = 0L
  private var frameCount = 0
  val isFrontFacing: Boolean get() = front
  private var width = 1280
  private var height = 720
  private var fps = 30
  var rotation: Int = Surface.ROTATION_90
    set(value) { field = value; main.post { preview?.targetRotation = value } }
  var onError: ((String) -> Unit)? = null
  var onCapabilitiesChanged: (() -> Unit)? = null
  var stabilization = "防抖检测中"
    private set

  fun currentCameraId(): String {
    camera?.let { return Camera2CameraInfo.from(it.cameraInfo).cameraId }
    val manager = context.getSystemService(CameraManager::class.java)
    val facing = if (front) CameraCharacteristics.LENS_FACING_FRONT else CameraCharacteristics.LENS_FACING_BACK
    return manager.cameraIdList.firstOrNull { manager.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == facing }.orEmpty()
  }

  fun selectOtherLens() { front = !front }

  override fun initialize(surfaceTextureHelper: SurfaceTextureHelper, applicationContext: Context, capturerObserver: CapturerObserver) {
    helper = surfaceTextureHelper; observer = capturerObserver
    surfaceTextureHelper.startListening { frame ->
      val transform = frameTransform
      if (running && transform != null) {
        if (frameWindowStart == 0L) frameWindowStart = frame.timestampNs
        frameCount++
        val elapsed = frame.timestampNs - frameWindowStart
        if (elapsed >= 1_000_000_000L) {
          capturedFps = ((frameCount - 1) * 1_000_000_000.0 / elapsed).toInt()
          frameWindowStart = frame.timestampNs; frameCount = 1
        }
        val buffer = frame.buffer as TextureBufferImpl
        // CameraX's SurfaceTexture already contains the sensor rotation and
        // front-camera mirror. Undo those before applying WebRTC frame rotation,
        // as in LiveKit 2.29.0 CameraXSession; otherwise landscape is sideways.
        val matrix = Matrix().apply {
          preTranslate(0.5f, 0.5f)
          if (transform.cameraTransform) {
            if (transform.mirrored) preScale(-1f, 1f)
            preRotate(-transform.sensorRotation.toFloat())
          }
          preTranslate(-0.5f, -0.5f)
        }
        val corrected = VideoFrame(buffer.applyTransformMatrix(matrix, buffer.width, buffer.height), transform.rotation, frame.timestampNs)
        try { capturerObserver.onFrameCaptured(corrected) } finally { corrected.release() }
      }
    }
  }
  override fun startCapture(width: Int, height: Int, framerate: Int) {
    this.width = width; this.height = height; this.fps = framerate
    running = true
    main.post {
      val future = ProcessCameraProvider.getInstance(context)
      future.addListener({
        if (!running) return@addListener
        runCatching { provider = future.get(); bind() }.onFailure { observer?.onCapturerStarted(false); onError?.invoke(it.message ?: "相机打开失败") }
      }, ContextCompat.getMainExecutor(context))
    }
  }
  private fun bind() {
    val provider = provider ?: return
    preview?.let { provider.unbind(it) }
    val selector = if (front) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
    val info = selector.filter(provider.availableCameraInfos).firstOrNull() ?: error("没有可用镜头")
    val camera2 = Camera2CameraInfo.from(info)
    val ranges = camera2.getCameraCharacteristic(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES).orEmpty().map { it.lower to it.upper }
    val supportedRange = CaptureQualityPolicy.frameRateRange(ranges, fps) ?: error("当前镜头未开放 $fps 帧，请选择较低帧率")
    val targetRange = Range(supportedRange.first, supportedRange.second)
    val outputConfig = camera2.getCameraCharacteristic(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
    val requested = LocalQuality(LocalQuality.RESOLUTIONS.first { LocalQuality.widthOf(it) == width }, fps)
    val resolutionSelector = ResolutionSelector.Builder()
      .setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY)
      .setResolutionStrategy(ResolutionStrategy(Size(width, height), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
      .setResolutionFilter { sizes, _ ->
        sizes.filter { size -> CaptureQualityPolicy.outputSupports(CameraOutputMode(size.width, size.height,
          runCatching { outputConfig?.getOutputMinFrameDuration(SurfaceTexture::class.java, size) ?: 0L }.getOrDefault(0L)), requested) }
      }.build()
    val builder = Preview.Builder().setResolutionSelector(resolutionSelector).setTargetRotation(rotation).setTargetFrameRate(targetRange)
    val eis = camera2.getCameraCharacteristic(CameraCharacteristics.CONTROL_AVAILABLE_VIDEO_STABILIZATION_MODES)
    val ois = camera2.getCameraCharacteristic(CameraCharacteristics.LENS_INFO_AVAILABLE_OPTICAL_STABILIZATION)
    val interop = Camera2Interop.Extender(builder)
    interop.setCaptureRequestOption(CaptureRequest.CONTROL_CAPTURE_INTENT, CaptureRequest.CONTROL_CAPTURE_INTENT_VIDEO_RECORD)
    interop.setCaptureRequestOption(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, targetRange)
    stabilization = when {
      ois?.contains(CaptureRequest.LENS_OPTICAL_STABILIZATION_MODE_ON) == true -> {
        interop.setCaptureRequestOption(CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE, CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE_OFF)
        interop.setCaptureRequestOption(CaptureRequest.LENS_OPTICAL_STABILIZATION_MODE, CaptureRequest.LENS_OPTICAL_STABILIZATION_MODE_ON); "OIS ON"
      }
      fps <= 30 && eis?.contains(CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE_ON) == true -> {
        interop.setCaptureRequestOption(CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE, CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE_ON); "EIS ON"
      }
      fps > 30 -> {
        interop.setCaptureRequestOption(CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE, CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE_OFF); "60 帧优先 · EIS OFF"
      }
      else -> "设备未开放防抖"
    }
    val useCase = builder.build()
    preview = useCase
    useCase.setSurfaceProvider { request ->
      val textureHelper = helper
      if (textureHelper == null || !running || preview !== useCase) { request.willNotProvideSurface(); return@setSurfaceProvider }
      textureHelper.setTextureSize(request.resolution.width, request.resolution.height)
      request.setTransformationInfoListener(ContextCompat.getMainExecutor(context)) {
        if (running && preview === useCase) frameTransform = FrameTransform(
          camera2.getCameraCharacteristic(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0,
          camera2.getCameraCharacteristic(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_FRONT,
          it.rotationDegrees, it.hasCameraTransform(),
        )
      }
      val surface = Surface(textureHelper.surfaceTexture)
      request.provideSurface(surface, ContextCompat.getMainExecutor(context)) { surface.release() }
    }
    camera = provider.bindToLifecycle(owner, selector, useCase)
    observer?.onCapturerStarted(true)
    onCapabilitiesChanged?.invoke()
  }
  fun zoomRange(): Pair<Float, Float> = camera?.cameraInfo?.zoomState?.value?.let { it.minZoomRatio to it.maxZoomRatio } ?: (1f to 1f)
  fun zoom(): Float = camera?.cameraInfo?.zoomState?.value?.zoomRatio ?: 1f
  fun setZoom(value: Float) { val range = zoomRange(); camera?.cameraControl?.setZoomRatio(value.coerceIn(range.first, range.second)) }
  fun focus(x: Float, y: Float, viewWidth: Int, viewHeight: Int, lock: Boolean = false) {
    if (viewWidth <= 0 || viewHeight <= 0) return
    val point = SurfaceOrientedMeteringPointFactory(viewWidth.toFloat(), viewHeight.toFloat()).createPoint(x, y)
    val action = FocusMeteringAction.Builder(point, FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE)
    if (lock) action.disableAutoCancel() else action.setAutoCancelDuration(3, TimeUnit.SECONDS)
    camera?.cameraControl?.startFocusAndMetering(action.build())
  }
  fun exposureRange(): IntRange = camera?.cameraInfo?.exposureState?.exposureCompensationRange?.let { it.lower..it.upper } ?: 0..0
  fun exposure(index: Int) { val range = exposureRange(); camera?.cameraControl?.setExposureCompensationIndex(index.coerceIn(range.first, range.last)) }
  fun switchCamera() { front = !front; main.post { runCatching { bind() }.onFailure { front = !front; onError?.invoke("此设备无法切换镜头") } } }
  override fun stopCapture() {
    running = false; frameTransform = null; capturedFps = 0
    val stoppedPreview = preview
    val stoppedObserver = observer
    stoppedObserver?.onCapturerStopped()
    main.post {
      stoppedPreview?.let { provider?.unbind(it) }
      if (preview === stoppedPreview) { preview = null; camera = null }
    }
  }
  override fun changeCaptureFormat(width: Int, height: Int, framerate: Int) { this.width = width; this.height = height; fps = framerate; if (running) main.post { bind() } }
  override fun dispose() { stopCapture(); helper?.stopListening(); helper = null }
  override fun isScreencast() = false
}
