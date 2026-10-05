package com.ayumaoqiu.camera

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * Keeps the broadcast alive outside the activity.
 *
 * It owns the [SessionController], so locking the screen or switching apps does
 * not drop the stream. Everything else is derived from the session state: the
 * notification text and the wake lock simply follow it, rather than being
 * switched on and off by hand in several places.
 */
class StreamService : Service() {

  inner class LocalBinder : Binder() {
    val controller: SessionController get() = this@StreamService.controller
  }

  private val binder = LocalBinder()
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private var wakeLock: PowerManager.WakeLock? = null

  lateinit var controller: SessionController
    private set

  override fun onCreate() {
    super.onCreate()
    controller = SessionController(this, Prefs(this), scope)
    createChannel()
    // Must be in the foreground before the camera is opened.
    startForegroundCompat(getString(R.string.notification_idle))
    followSession()
    if (controller.isPaired) controller.loadConfig()
  }

  /** Notification and wake lock track the session; nothing toggles them directly. */
  private fun followSession() {
    scope.launch {
      controller.state
        .map { it.phase to it.message }
        .distinctUntilChanged()
        .collect { (phase, message) ->
          updateNotification(notificationText(phase, message))
          val publishing = phase == SessionPhase.CONNECTING ||
            phase == SessionPhase.LIVE ||
            phase == SessionPhase.RECONNECTING
          if (publishing) acquireWakeLock() else releaseWakeLock()
        }
    }
  }

  private fun notificationText(phase: SessionPhase, message: String): String = when (phase) {
    SessionPhase.LIVE -> "推流中"
    SessionPhase.CONNECTING -> "连接中…"
    SessionPhase.RECONNECTING -> "网络中断，正在重连…"
    SessionPhase.ERROR -> message
    SessionPhase.READY -> "预览中，未推流"
    SessionPhase.LOADING -> "正在读取后台配置…"
    SessionPhase.UNPAIRED -> "未配对"
  }

  override fun onBind(intent: Intent?): IBinder = binder

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP_STREAM -> controller.stopPublishing()
      ACTION_SHUTDOWN -> {
        controller.shutdown()
        stopSelf()
        return START_NOT_STICKY
      }
    }
    return START_STICKY
  }

  override fun onDestroy() {
    controller.shutdown()
    releaseWakeLock()
    scope.cancel()
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  // ---------- Wake lock ----------

  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    val power = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
    wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKELOCK_TAG).apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  private fun releaseWakeLock() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
  }

  // ---------- Notification ----------

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(
      CHANNEL_ID, getString(R.string.notification_channel_name), NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = getString(R.string.notification_channel_desc)
      setShowBadge(false)
    }
    manager.createNotificationChannel(channel)
  }

  private fun startForegroundCompat(text: String) {
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
    } else {
      0
    }
    ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(text), type)
  }

  private fun buildNotification(text: String): Notification {
    val open = PendingIntent.getActivity(
      this, 0, Intent(this, MainActivity::class.java),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val stop = PendingIntent.getService(
      this, 1, Intent(this, StreamService::class.java).setAction(ACTION_STOP_STREAM),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(getString(R.string.notification_title))
      .setContentText(text)
      .setSmallIcon(R.drawable.ic_stat_stream)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(open)
      .addAction(0, "停止推流", stop)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()
  }

  private fun updateNotification(text: String) {
    val manager = getSystemService(NotificationManager::class.java) ?: return
    manager.notify(NOTIFICATION_ID, buildNotification(text))
  }

  companion object {
    const val ACTION_STOP_STREAM = "com.ayumaoqiu.camera.STOP_STREAM"
    const val ACTION_SHUTDOWN = "com.ayumaoqiu.camera.SHUTDOWN"
    private const val CHANNEL_ID = "stream"
    private const val NOTIFICATION_ID = 41
    private const val WAKELOCK_TAG = "ayumaoqiu:stream"

    fun start(context: Context) {
      val intent = Intent(context, StreamService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
      else context.startService(intent)
    }
  }
}
