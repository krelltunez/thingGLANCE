package com.thingglance.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugins have to be registered before the bridge starts.
        registerPlugin(SecureStorePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
