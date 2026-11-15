package com.thingglance.app.ownership

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OwnershipTest {
    private val installed = 1_794_700_000_000L

    @Test fun `an install made by the Play Store is a purchase, dated from the first install`() {
        assertEquals(Ownership.Fact(installed, "play", "1.0.0"), Ownership.settle(null, "com.android.vending", installed, "1.0.0"))
    }

    @Test fun `a build put on the phone any other way records nothing`() {
        assertNull(Ownership.settle(null, null, installed, "1.0.0"))
        assertNull(Ownership.settle(null, "com.android.shell", installed, "1.0.0"))
        assertNull(Ownership.settle(null, "com.google.android.packageinstaller", installed, "1.0.0"))
        // No install time to date it from: nothing, sooner than a record dated 1970.
        assertNull(Ownership.settle(null, "com.android.vending", 0L, "1.0.0"))
    }

    @Test fun `a record already held stands, whoever installed this copy`() {
        val held = Ownership.Fact(installed, "play", "1.0.0")
        // Restored to a new phone from a backup, then updated outside the store.
        assertEquals(held, Ownership.settle(held, null, installed + 86_400_000L, "1.2.0"))
        // A later reinstall from the store does not move the date forward.
        assertEquals(held, Ownership.settle(held, "com.android.vending", installed + 86_400_000L, "1.2.0"))
    }
}
