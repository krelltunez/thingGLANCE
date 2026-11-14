package com.thingglance.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugins have to be registered before the bridge starts.
        registerPlugin(SecureStorePlugin.class);
        registerPlugin(WidgetBridgePlugin.class);
        // Whatever started the app is turned into a thingglance:// link (or
        // into nothing, if Android is only replaying an old start) before the
        // bridge reads it. A non-null saved state means the system is
        // rebuilding an activity it killed.
        setIntent(LaunchLinks.INSTANCE.forLaunch(getIntent(), savedInstanceState != null));
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        // The app is already running: the same translation, then the bridge
        // hands the link to the web app.
        super.onNewIntent(LaunchLinks.INSTANCE.forLaunch(intent, false));
    }
}
