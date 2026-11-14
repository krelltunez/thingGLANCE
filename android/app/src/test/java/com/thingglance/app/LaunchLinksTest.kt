package com.thingglance.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

// What a share is called. (Building the intents themselves needs Android and
// is covered by scripts/android-check.mjs on an emulator.)
class LaunchLinksTest {
    @Test
    fun thePageTitleWinsOverItsAddress() {
        assertEquals("Sony WH-1000XM5", LaunchLinks.sharedName("Sony WH-1000XM5", "https://example.com/p/123"))
    }

    @Test
    fun aNameSharedWithItsLinkLosesTheLink() {
        assertEquals("Check out this kettle", LaunchLinks.sharedName(null, "Check out this kettle https://shop.example/k?id=1"))
        assertEquals("Kettle Pro", LaunchLinks.sharedName("  ", "https://a.example/x  Kettle\nPro  http://b.example"))
    }

    @Test
    fun aBareAddressNamesNothing() {
        assertNull(LaunchLinks.sharedName(null, "https://example.com/p/123"))
        assertNull(LaunchLinks.sharedName("", ""))
        assertNull(LaunchLinks.sharedName(null, null))
    }

    @Test
    fun aLongTitleIsCut() {
        val name = LaunchLinks.sharedName("x".repeat(500), null)
        assertEquals(200, name!!.length)
    }
}
