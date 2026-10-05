package com.ayumaoqiu.camera

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/** A non-2xx answer from the site. 401 means the pairing is gone. */
class ApiException(val status: Int, message: String) : IOException(message)

/**
 * Talks to the site's camera endpoints with the pairing token. The token is the
 * only credential the phone holds; it is scoped to one broadcast room.
 */
class ApiClient(private val prefs: Prefs) {

  private val client = OkHttpClient.Builder()
    .connectTimeout(8, TimeUnit.SECONDS)
    .readTimeout(12, TimeUnit.SECONDS)
    .writeTimeout(12, TimeUnit.SECONDS)
    .build()

  private val jsonType = "application/json; charset=utf-8".toMediaType()

  private fun build(path: String, method: String, body: String?): Request {
    val builder = Request.Builder()
      .url(prefs.baseUrl.trimEnd('/') + "/api" + path)
      .header("Accept", "application/json")
      .header("Authorization", "Bearer " + prefs.pairingToken)
    when {
      body != null -> builder.method(method, body.toRequestBody(jsonType))
      method == "GET" -> builder.get()
      else -> builder.method(method, ByteArray(0).toRequestBody(jsonType))
    }
    return builder.build()
  }

  private suspend fun execute(request: Request): String = withContext(Dispatchers.IO) {
    client.newCall(request).execute().use { response ->
      val text = response.body?.string().orEmpty()
      if (!response.isSuccessful) {
        val message = runCatching { JSONObject(text).optString("message") }.getOrNull()
        throw ApiException(response.code, message?.takeIf { it.isNotBlank() } ?: "请求失败（${response.code}）")
      }
      text
    }
  }

  suspend fun fetchConfig(): CameraConfig =
    CameraJson.parseConfig(execute(build("/camera/config", "GET", null)))

  suspend fun heartbeat(state: Heartbeat): CameraConfig =
    CameraJson.parseConfig(execute(build("/camera/heartbeat", "POST", state.toJson())))

  suspend fun unpair() {
    execute(build("/camera/unpair", "POST", null))
  }
}
