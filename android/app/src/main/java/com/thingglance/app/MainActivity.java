package com.thingglance.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.thingglance.app.refresh.RefreshWorker;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // A background refresh shares this app's storage. One in progress is
        // destroyed here, on this thread, before the app's own page loads.
        RefreshWorker.abortForLiveApp();
        // App-local plugins have to be registered before the bridge starts.
        registerPlugin(SecureStorePlugin.class);
        registerPlugin(WidgetBridgePlugin.class);
        registerPlugin(com.thingglance.app.reminders.RemindersPlugin.class);
        registerPlugin(com.thingglance.app.sse.VaultSsePlugin.class);
        // Whatever started the app is turned into a thingglance:// link (or
        // into nothing, if Android is only replaying an old start) before the
        // bridge reads it. A non-null saved state means the system is
        // rebuilding an activity it killed.
        setIntent(LaunchLinks.INSTANCE.forLaunch(getIntent(), savedInstanceState != null));
        super.onCreate(savedInstanceState);
        // The routine refresh, a few times a day. Asking again changes nothing.
        RefreshWorker.ensureRoutine(this);
    }

    @Override
    public void onDestroy() {
        // The page is gone: from here on a refresh may run.
        RefreshWorker.setAppOpen(false);
        super.onDestroy();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        // The app is already running: the same translation, then the bridge
        // hands the link to the web app.
        super.onNewIntent(LaunchLinks.INSTANCE.forLaunch(intent, false));
    }
}
