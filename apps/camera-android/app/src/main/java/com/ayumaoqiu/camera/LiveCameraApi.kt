package com.ayumaoqiu.camera

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

class LiveCameraApi(context: Context) {
  val prefs = context.getSharedPreferences("multicamera", Context.MODE_PRIVATE)
  private val client = OkHttpClient.Builder().connectTimeout(8, TimeUnit.SECONDS).readTimeout(12, TimeUnit.SECONDS).build()
  private val json = "application/json; charset=utf-8".toMediaType()
  val paired: Boolean get() = !prefs.getString("credential", "").isNullOrBlank()
  suspend fun call(path: String, body: JSONObject? = null, baseUrl: String = prefs.getString("baseUrl", "")!!, authenticated: Boolean = true): JSONObject = withContext(Dispatchers.IO) {
    val url = baseUrl.trimEnd('/') + "/api/live-camera/" + path
    val request = Request.Builder().url(url)
    if (authenticated) request.header("Authorization", "Bearer " + prefs.getString("credential", ""))
    if (body != null) request.post(body.toString().toRequestBody(json))
    client.newCall(request.build()).execute().use { response ->
      val text = response.body?.string().orEmpty()
      if (!response.isSuccessful) throw ApiException(response.code, runCatching { JSONObject(text).optString("message") }.getOrDefault("请求失败"))
      JSONObject(text)
    }
  }
  suspend fun redeem(url: String, code: String) {
    val deviceId = prefs.getString("deviceId", null) ?: UUID.randomUUID().toString().also { prefs.edit().putString("deviceId", it).apply() }
    val result = call("redeem", JSONObject().put("code", code).put("deviceId", deviceId), baseUrl = url, authenticated = false)
    prefs.edit().putString("baseUrl", url.trimEnd('/')).putString("credential", result.getString("credential")).putString("cameraCode", result.getString("code")).apply()
  }
  suspend fun restore(url: String): Boolean {
    if (!paired || url.trimEnd('/') != prefs.getString("baseUrl", "")?.trimEnd('/')) return false
    val config = try { call("config") } catch (e: ApiException) {
      if (e.status == 401) { forget(); return false }
      throw e
    }
    prefs.edit().putString("cameraCode", config.getString("cameraCode")).apply()
    return true
  }
  fun forget() { prefs.edit().remove("credential").apply() }
}
