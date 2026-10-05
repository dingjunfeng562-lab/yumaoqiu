package com.ayumaoqiu.camera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test

class PairingPayloadTest {

  private val token = "Qm9vdHN0cmFwLXRva2VuLWZvci10ZXN0aW5n"

  @Test
  fun readsWhatTheAdminPageEncodes() {
    // Exactly what CameraPairingModal.tsx produces.
    val scanned = """{"v":1,"u":"http://192.168.1.23:4000","t":"$token"}"""
    val payload = PairingPayload.parse(scanned)
    assertNotNull(payload)
    assertEquals("http://192.168.1.23:4000", payload!!.baseUrl)
    assertEquals(token, payload.token)
  }

  @Test
  fun roundTripsThroughJson() {
    val original = PairingPayload("https://live.example.com", token)
    assertEquals(original, PairingPayload.parse(original.toJson()))
  }

  @Test
  fun trailingSlashesAndWhitespaceAreTrimmed() {
    val payload = PairingPayload.parse("""  {"v":1,"u":" http://10.0.0.5:4000/ ","t":" $token "}  """)
    assertEquals("http://10.0.0.5:4000", payload!!.baseUrl)
    assertEquals(token, payload.token)
  }

  @Test
  fun aBareTokenIsAcceptedForManualEntry() {
    val payload = PairingPayload.parse(token)
    assertEquals(token, payload!!.token)
  }

  @Test
  fun rejectsCodesThatAreNotOurs() {
    assertNull(PairingPayload.parse(null))
    assertNull(PairingPayload.parse(""))
    assertNull(PairingPayload.parse("https://weixin.qq.com/some-other-qr"))
    assertNull(PairingPayload.parse("hello world"))
    assertNull(PairingPayload.parse("short"))
    assertNull(PairingPayload.parse("这是一段很长的中文文字不是配对码而是别的内容"))
  }

  @Test
  fun acceptsATokenShapedLikeTheBackendsOwn() {
    // randomBytes(24).toString('base64url') -> 32 chars, may contain - and _.
    val real = "a-Zb_9c8D7e6F5g4H3i2J1k0L9m8N7o6"
    assertEquals(32, real.length)
    assertEquals(real, PairingPayload.parse(real)!!.token)
  }

  @Test
  fun rejectsUnusableAddressesAndTokens() {
    assertNull(PairingPayload.parse("""{"v":1,"u":"192.168.1.2:4000","t":"$token"}"""))
    assertNull(PairingPayload.parse("""{"v":1,"u":"ftp://192.168.1.2","t":"$token"}"""))
    assertNull(PairingPayload.parse("""{"v":1,"u":"http://192.168.1.2:4000","t":"abc"}"""))
  }

  @Test
  fun rejectsAFutureFormatInsteadOfMisreadingIt() {
    assertNull(PairingPayload.parse("""{"v":3,"u":"http://192.168.1.2:4000","t":"$token"}"""))
  }

  @Test
  fun recognizesMulticameraQrAndManualCodes() {
    val parsed = PairingPayload.parse("""{"v":2,"u":"https://ydysyumao.cn","t":"live_$token"}""")!!
    assertTrue(parsed.isMulticamera)
    assertEquals(2, parsed.version)
    assertEquals(parsed, PairingPayload.parse(parsed.toJson()))
    assertTrue(PairingPayload.parse("live_$token")!!.isMulticamera)
    assertFalse(PairingPayload.parse(token)!!.isMulticamera)
  }
}
