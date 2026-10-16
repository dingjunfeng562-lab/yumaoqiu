package com.ayumaoqiu.camera

import android.os.Handler
import android.os.Looper
import android.view.Choreographer
import androidx.camera.core.Camera
import androidx.camera.core.CameraControl
import java.util.concurrent.CancellationException
import java.util.concurrent.Executor

/** Native CameraX zoom, newest target once per vsync. No session/track/view scaling. */
class ZoomController(private val onSubmitted: (Float) -> Unit, private val onError: (String) -> Unit) {
  private val handler = Handler(Looper.getMainLooper())
  private val executor = Executor { handler.post(it) }
  private val choreographer = Choreographer.getInstance()
  private var camera: Camera? = null
  private var state = ZoomRequestState(1f, 1f, 1f)
  private var requestId = 0L
  private var scheduled = false
  private val frame = Choreographer.FrameCallback { frameTimeNs ->
    scheduled = false
    submitNext(frameTimeNs)
    if (state.animating) schedule()
  }

  fun bind(value: Camera?) {
    requestId++
    choreographer.removeFrameCallback(frame)
    scheduled = false
    camera = value
    val zoom = value?.cameraInfo?.zoomState?.value
    state = ZoomRequestState(zoom?.minZoomRatio ?: 1f, zoom?.maxZoomRatio ?: 1f, zoom?.zoomRatio ?: 1f)
    onSubmitted(state.submitted)
  }

  fun request(value: Float) {
    if (!value.isFinite()) return
    requestId++
    state.request(value)
    schedule()
  }

  fun animateTo(value: Float) {
    if (!value.isFinite()) return
    requestId++
    state.animateTo(value, System.nanoTime())
    schedule()
  }

  private fun schedule() {
    if (scheduled || camera == null) return
    scheduled = true
    choreographer.postFrameCallback(frame)
  }

  private fun submitNext(frameTimeNs: Long) {
    val bound = camera ?: return
    val next = state.next(frameTimeNs) ?: return
    val version = ++requestId
    try {
      val future = bound.cameraControl.setZoomRatio(next)
      onSubmitted(next)
      // CameraX replaces its previous zoom request. Its future can finish only
      // after sensor results arrive, so waiting for it adds several frames of
      // latency. Completion is for errors only, never to pace finger movement.
      future.addListener({
        if (requestId != version) return@addListener
        try {
          future.get()
        } catch (error: Exception) {
          val cause = error.cause ?: error
          if (cause !is CameraControl.OperationCanceledException && cause !is CancellationException) {
            bind(bound)
            onError("当前镜头无法应用此倍率")
          }
        }
      }, executor)
    } catch (_: Exception) {
      bind(bound)
      onError("当前镜头无法应用此倍率")
    }
  }
}
