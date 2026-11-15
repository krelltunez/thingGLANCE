package com.thingglance.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.thingglance.app.refresh.RefreshWorker;

public class MainActivity extends BridgeActivity {

    // When the app went to the background; 0 while it is on screen. A page
    // that stopped answering GLANCElauncher is only closed once it has been
    // away a while (launcher/LauncherPageRetire).
    public static volatile long stoppedAt = 0L;

    private static java.lang.ref.WeakReference<MainActivity> live = new java.lang.ref.WeakReference<>(null);

    // The activity whose page exists, or null when there is none.
    public static MainActivity liveInstance() {
        MainActivity activity = live.get();
        return activity == null || activity.isFinishing() || activity.isDestroyed() ? null : activity;
    }

    // Asks the page whether it may be closed: "ok", or anything else. Run as a
    // script handed straight to the WebView, which a stalled page still runs.
    // Main thread only.
    public void checkRetireReady(android.webkit.ValueCallback<String> callback) {
        try {
            getBridge().getWebView().evaluateJavascript(
                "(function(){ try { return window.__tgRetireCheck ? window.__tgRetireCheck() : 'busy'; } catch (e) { return 'error'; } })();",
                callback);
        } catch (Exception e) {
            callback.onReceiveValue(null);
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        stoppedAt = 0L;
    }

    @Override
    public void onStop() {
        super.onStop();
        stoppedAt = System.currentTimeMillis();
    }

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
        registerPlugin(com.thingglance.app.automation.AutomationPlugin.class);
        // Whatever started the app is turned into a thingglance:// link (or
        // into nothing, if Android is only replaying an old start) before the
        // bridge reads it. A non-null saved state means the system is
        // rebuilding an activity it killed.
        setIntent(LaunchLinks.INSTANCE.forLaunch(getIntent(), savedInstanceState != null));
        super.onCreate(savedInstanceState);
        live = new java.lang.ref.WeakReference<>(this);
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
