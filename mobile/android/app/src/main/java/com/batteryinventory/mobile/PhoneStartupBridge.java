package com.batteryinventory.mobile;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import androidx.core.splashscreen.SplashScreen;
import androidx.lifecycle.DefaultLifecycleObserver;
import androidx.lifecycle.Lifecycle;
import androidx.lifecycle.LifecycleOwner;
import com.getcapacitor.WebViewListener;

/** Keep the platform starting window until local document content can be drawn. */
public final class PhoneStartupBridge extends WebViewListener {
    private static final long MAX_LOCAL_CONTENT_WAIT_MS = 5000;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Lifecycle lifecycle;
    private boolean released;
    private boolean visualRequested;
    private final Runnable deadline = this::release;
    private final DefaultLifecycleObserver observer = new DefaultLifecycleObserver() {
        @Override public void onDestroy(LifecycleOwner owner) { release(); }
    };

    private PhoneStartupBridge(Lifecycle lifecycle) {
        this.lifecycle = lifecycle;
        lifecycle.addObserver(observer);
        // Failure ceiling only: successful content releases immediately, without a minimum.
        handler.postDelayed(deadline, MAX_LOCAL_CONTENT_WAIT_MS);
    }

    public static PhoneStartupBridge install(Activity activity, Lifecycle lifecycle) {
        SplashScreen splash = SplashScreen.installSplashScreen(activity);
        PhoneStartupBridge startup = new PhoneStartupBridge(lifecycle);
        splash.setKeepOnScreenCondition(() -> !startup.released);
        // Reveal the ready local frame directly, without the platform icon fade/reveal sequence.
        splash.setOnExitAnimationListener(provider -> provider.remove());
        return startup;
    }

    private void awaitLocalFrame(WebView view, String url) {
        if (released || visualRequested || view == null || url == null || url.isEmpty() || "about:blank".equals(url)) return;
        visualRequested = true;
        try {
            view.postVisualStateCallback(0, new WebView.VisualStateCallback() {
                @Override public void onComplete(long requestId) { release(); }
            });
        } catch (RuntimeException failure) {
            // The existing WebView/error surface remains available if rendering cannot start.
            release();
        }
    }

    @Override public void onPageCommitVisible(WebView view, String url) { awaitLocalFrame(view, url); }
    @Override public void onPageLoaded(WebView view) { awaitLocalFrame(view, view == null ? null : view.getUrl()); }
    @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
        release();
        return false;
    }

    private void release() {
        if (released) return;
        released = true;
        handler.removeCallbacks(deadline);
        lifecycle.removeObserver(observer);
    }
}
