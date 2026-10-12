package kr.potatosalad775.unipeq;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** The framework sends GONE again on later relayouts, so keep-visible re-asserts this often. */
    private static final long REASSERT_MS = 5000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private boolean keepVisible = false;
    private boolean stopped = false;

    private final Runnable reassert = new Runnable() {
        @Override
        public void run() {
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView != null) webView.dispatchWindowVisibilityChanged(View.VISIBLE);
            if (keepVisible && stopped) main.postDelayed(this, REASSERT_MS);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(LinkPlugin.class);
        super.onCreate(savedInstanceState);
        // The splash's colour (light or dark with the system) until the page paints its own, rather
        // than the WebView's blank canvas, which is black in dark mode.
        getBridge().getWebView().setBackgroundColor(getColor(R.color.splash_background));
    }

    /**
     * While the modernGraphTool link is on, the WebView is told its window is still visible after
     * the activity stops. Chromium freezes a hidden page 60 s after it's hidden, foreground service
     * or not; a page that counts as visible never freezes. Off hands it the real visibility again.
     */
    void setKeepVisible(boolean on) {
        main.post(() -> {
            keepVisible = on;
            main.removeCallbacks(reassert);
            if (on) {
                if (stopped) reassert.run();
            } else {
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView != null) webView.dispatchWindowVisibilityChanged(getWindow().getDecorView().getWindowVisibility());
            }
        });
    }

    @Override
    public void onStart() {
        super.onStart();
        stopped = false;
        main.removeCallbacks(reassert);
    }

    @Override
    public void onStop() {
        super.onStop();
        stopped = true;
        // The window goes GONE in the traversal after onStop; undo it right after.
        if (keepVisible) main.postDelayed(reassert, 300);
    }

    @Override
    public void onDestroy() {
        main.removeCallbacks(reassert);
        super.onDestroy();
    }
}
