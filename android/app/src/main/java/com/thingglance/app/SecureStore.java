package com.thingglance.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.UnrecoverableKeyException;

import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

// The Keystore-backed store behind SecureStorePlugin: where the vault token and
// the encryption root key live on Android (src/sync/secrets.ts decides what
// goes in). Values are AES-GCM ciphertext in a private SharedPreferences file;
// the AES key lives in the Android Keystore, so the ciphertext is useless off
// the device.
//
// It works on a Context alone, so code with no WebView (a widget, a background
// refresh) can read the same entries.
//
// The contract the web side relies on (docs/shells.md), and where this differs
// from lastGLANCE's store, which it is otherwise modelled on:
//   - get() answers null for "nothing stored", and for an entry that can never
//     be read again (restored from another device, key invalidated). Those are
//     dropped, so the app asks for the credential once and starts clean.
//   - get() THROWS when the Keystore itself could not be used just now. That is
//     not "nothing stored": the app retries, and if it still cannot read it
//     says so instead of behaving as if it was never connected.
public final class SecureStore {

    /** The Keystore could not be used. Nothing is known about the entry. */
    public static final class Unavailable extends Exception {
        Unavailable(Throwable cause) { super(cause); }
    }

    private static final String PREFS = "thingglance_secure_store";
    private static final String KEY_ALIAS = "thingglance_secure_store";
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    // GCM with the Keystore-generated IV and a 128-bit tag. A stored value is
    // "v1:" + base64(iv) + ":" + base64(ciphertext).
    private static final int GCM_TAG_BITS = 128;
    private static final String FORMAT_PREFIX = "v1:";

    private SecureStore() {}

    public static String get(Context context, String key) throws Unavailable {
        String stored = prefs(context).getString(key, null);
        if (stored == null) return null;
        if (!stored.startsWith(FORMAT_PREFIX)) return drop(context, key);
        String[] parts = stored.substring(FORMAT_PREFIX.length()).split(":", 2);
        if (parts.length != 2) return drop(context, key);
        try {
            SecretKey secret = existingKey();
            // The entry outlived its key (a backup restored onto another
            // device): it can never be read.
            if (secret == null) return drop(context, key);
            byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
            byte[] ct = Base64.decode(parts[1], Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, secret, new GCMParameterSpec(GCM_TAG_BITS, iv));
            return new String(cipher.doFinal(ct), StandardCharsets.UTF_8);
        } catch (AEADBadTagException | KeyPermanentlyInvalidatedException | UnrecoverableKeyException | IllegalArgumentException e) {
            // Wrong key, invalidated key or a mangled entry: permanent.
            return drop(context, key);
        } catch (Exception e) {
            // Anything else is the Keystore failing to answer. Keep the entry.
            throw new Unavailable(e);
        }
    }

    public static void set(Context context, String key, String value) throws Unavailable {
        String stored;
        try {
            stored = encrypt(value);
        } catch (Exception first) {
            // One retry with a fresh key covers a corrupted alias (a partly
            // restored Keystore). Entries under the old key were already
            // unreadable in that state, so rotating it loses nothing.
            deleteKeyQuietly();
            try {
                stored = encrypt(value);
            } catch (Exception second) {
                throw new Unavailable(second);
            }
        }
        // commit(), not apply(): the web side reloads right after a connection
        // change, and the write has to be on disk before it is told "done".
        if (!prefs(context).edit().putString(key, stored).commit()) {
            throw new Unavailable(new IllegalStateException("could not write the store"));
        }
    }

    public static void delete(Context context, String key) throws Unavailable {
        if (!prefs(context).edit().remove(key).commit()) {
            throw new Unavailable(new IllegalStateException("could not write the store"));
        }
    }

    private static String drop(Context context, String key) {
        prefs(context).edit().remove(key).apply();
        return null;
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ── Keystore-backed AES-GCM ───────────────────────────────────────────────

    private static String encrypt(String plaintext) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        // The Keystore must generate the IV: keys are created with randomized
        // encryption required (the secure default), and a caller-provided IV
        // throws. lastGLANCE shipped a release candidate that did exactly that.
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        byte[] iv = cipher.getIV();
        byte[] ct = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
        return FORMAT_PREFIX
            + Base64.encodeToString(iv, Base64.NO_WRAP)
            + ":"
            + Base64.encodeToString(ct, Base64.NO_WRAP);
    }

    private static SecretKey existingKey() throws Exception {
        KeyStore ks = KeyStore.getInstance(ANDROID_KEYSTORE);
        ks.load(null);
        KeyStore.Entry entry = ks.getEntry(KEY_ALIAS, null);
        return entry instanceof KeyStore.SecretKeyEntry ? ((KeyStore.SecretKeyEntry) entry).getSecretKey() : null;
    }

    private static SecretKey getOrCreateKey() throws Exception {
        SecretKey existing = existingKey();
        if (existing != null) return existing;
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        kg.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            // No user-auth binding: these are read at boot, and by background
            // work, before any unlock prompt could be shown.
            .build());
        return kg.generateKey();
    }

    private static void deleteKeyQuietly() {
        try {
            KeyStore ks = KeyStore.getInstance(ANDROID_KEYSTORE);
            ks.load(null);
            ks.deleteEntry(KEY_ALIAS);
        } catch (Exception ignored) {
        }
    }
}
