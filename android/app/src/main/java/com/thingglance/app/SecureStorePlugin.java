package com.thingglance.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// The web side's door to SecureStore. Three calls on strings, which is all
// src/native/shell.ts asks of a keystore; src/native/capacitor.ts wraps them.
//
// A call that rejects means "the Keystore could not be used", never "nothing
// stored" (that is a resolved null). The web side treats the two differently.
@CapacitorPlugin(name = "SecureStore")
public class SecureStorePlugin extends Plugin {

    @PluginMethod
    public void get(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty()) {
            call.reject("missing key");
            return;
        }
        try {
            JSObject ret = new JSObject();
            String value = SecureStore.get(getContext(), key);
            // An absent value has to travel as JSON null, not a missing field.
            ret.put("value", value == null ? JSObject.NULL : value);
            call.resolve(ret);
        } catch (SecureStore.Unavailable e) {
            call.reject("the keystore is unavailable", e);
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");
        if (key == null || key.isEmpty() || value == null) {
            call.reject("missing key or value");
            return;
        }
        try {
            SecureStore.set(getContext(), key, value);
            call.resolve();
        } catch (SecureStore.Unavailable e) {
            call.reject("the keystore is unavailable", e);
        }
    }

    @PluginMethod
    public void delete(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty()) {
            call.reject("missing key");
            return;
        }
        try {
            SecureStore.delete(getContext(), key);
            call.resolve();
        } catch (SecureStore.Unavailable e) {
            call.reject("the keystore is unavailable", e);
        }
    }
}
