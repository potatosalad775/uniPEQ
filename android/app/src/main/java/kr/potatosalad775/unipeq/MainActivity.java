package kr.potatosalad775.unipeq;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The splash's colour (light or dark with the system) until the page paints its own, rather
        // than the WebView's blank canvas, which is black in dark mode.
        getBridge().getWebView().setBackgroundColor(getColor(R.color.splash_background));
    }
}
