package kr.potatosalad775.unipeq;

import android.Manifest;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * The modernGraphTool link's native side: the foreground service, keep-visible and a wake lock.
 * Protocol-free, like DeviceIo, and kept out of it: DeviceIo moves device bytes and knows no link.
 * Typings and the web no-ops: src/lib/platform/link.ts.
 *
 * Event: `unlink` (the notification's Unlink, or the task swiped away).
 */
@CapacitorPlugin(
    name = "Link",
    permissions = { @Permission(alias = LinkPlugin.NOTIFICATIONS, strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class LinkPlugin extends Plugin implements LinkService.Listener {

    static final String NOTIFICATIONS = "notifications";
    private PowerManager.WakeLock wakeLock;

    @Override
    public void load() {
        LinkService.listener = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (LinkService.listener == this) LinkService.listener = null;
        release();
    }

    /**
     * Starts the service and keep-visible. Called at approval, which happens in the foreground, so
     * the limits on starting a foreground service from the background don't apply. Asks for
     * notifications the first time; a refusal only hides the notification, the service still runs.
     */
    @PluginMethod
    public void start(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState(NOTIFICATIONS) == PermissionState.PROMPT) {
            requestPermissionForAlias(NOTIFICATIONS, call, "startAfterPermission");
            return;
        }
        startService(call);
    }

    @PermissionCallback
    private void startAfterPermission(PluginCall call) {
        startService(call);
    }

    private void startService(PluginCall call) {
        Context context = getContext();
        ContextCompat.startForegroundService(
            context,
            LinkService.intent(context, call.getString("host"), call.getString("device"))
        );
        setKeepVisible(true);
        call.resolve();
    }

    @PluginMethod
    public void update(PluginCall call) {
        LinkService.update(getContext(), call.getString("host"), call.getString("device"));
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopService();
        call.resolve();
    }

    /** A partial wake lock around one device command; a new one re-arms the timeout. */
    @PluginMethod
    public void wake(PluginCall call) {
        int ms = call.getInt("ms", 10_000);
        if (wakeLock == null) {
            PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "uniPEQ:link");
            // Not counted: the page counts overlapping commands and releases after the last one.
            wakeLock.setReferenceCounted(false);
        }
        wakeLock.acquire(ms);
        call.resolve();
    }

    @PluginMethod
    public void release(PluginCall call) {
        release();
        call.resolve();
    }

    /** The Restricted battery setting, under which Android pauses uniPEQ despite the service. */
    @PluginMethod
    public void state(PluginCall call) {
        boolean restricted = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            ActivityManager manager = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
            restricted = manager.isBackgroundRestricted();
        }
        call.resolve(new JSObject().put("backgroundRestricted", restricted));
    }

    /**
     * The app's system settings page, where battery use is set. Not
     * REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, which Play restricts.
     */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.fromParts("package", getContext().getPackageName(), null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @Override
    public void onUnlink() {
        setKeepVisible(false);
        notifyListeners("unlink", new JSObject());
    }

    @Override
    public void onTaskRemoved() {
        setKeepVisible(false);
        release();
    }

    private void stopService() {
        getContext().stopService(new Intent(getContext(), LinkService.class));
        setKeepVisible(false);
        release();
    }

    private void release() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    }

    private void setKeepVisible(boolean on) {
        if (getActivity() instanceof MainActivity) ((MainActivity) getActivity()).setKeepVisible(on);
    }
}
