package com.ayumaoqiu.camera

import org.json.JSONObject

/**
 * What the admin page puts into the pairing QR code.
 *
 * It carries the server address *and* the one-time token together. Typing a
 * 40-character token on a phone keyboard is where pairing usually fails, so the
 * operator just scans the code shown next to the "生成配对码" button.
 *
 * Pure logic (no Android types) so the parsing rules can be unit tested.
 */
data class PairingPayload(val baseUrl: String, val token: String, val version: Int = 1) {
  val isMulticamera: Boolean get() = version == 2 || token.startsWith("live_")

  fun toJson(): String = JSONObject().apply {
    put(FIELD_VERSION, version)
    put(FIELD_URL, baseUrl)
    put(FIELD_TOKEN, token)
  }.toString()

  companion object {
    const val VERSION = 1
    private const val FIELD_VERSION = "v"
    private const val FIELD_URL = "u"
    private const val FIELD_TOKEN = "t"

    /**
     * Parses a scanned code or a pasted string. Returns null when it is not a
     * payload we understand, so the caller can show one clear message instead of
     * failing later with a confusing network error.
     */
    fun parse(raw: String?): PairingPayload? {
      val text = raw?.trim().orEmpty()
      if (text.isEmpty()) return null

      val root = runCatching { JSONObject(text) }.getOrNull()
      if (root != null && root.has(FIELD_TOKEN)) {
        val version = root.optInt(FIELD_VERSION, VERSION)
        if (version !in 1..2) return null
        val url = root.optString(FIELD_URL)
        val token = root.optString(FIELD_TOKEN)
        return build(url, token)?.copy(version = version)
      }

      // Tolerate a bare token so an operator can still paste one by hand. It
      // must look like a real token (base64url only), otherwise an unrelated QR
      // code - a WeChat or web link - would be taken for one.
      return if (TOKEN_PATTERN.matches(text)) PairingPayload(Prefs.DEFAULT_BASE_URL, text) else null
    }

    /** Backend tokens are randomBytes(24) in base64url: 32 chars of A-Z a-z 0-9 - _. */
    private val TOKEN_PATTERN = Regex("^[A-Za-z0-9_-]{$MIN_TOKEN_LENGTH,128}$")

    private fun build(url: String, token: String): PairingPayload? {
      val base = url.trim().trimEnd('/')
      val clean = token.trim()
      if (!TOKEN_PATTERN.matches(clean)) return null
      if (!base.startsWith("http://") && !base.startsWith("https://")) return null
      return PairingPayload(base, clean)
    }

    /** Short enough to allow real tokens, long enough to reject junk. */
    private const val MIN_TOKEN_LENGTH = 16
  }
}
