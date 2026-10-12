package kr.potatosalad775.unipeq;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * The modernGraphTool link's foreground service (`connectedDevice`), from approval to the end of
 * the session. It does no work of its own: it keeps the process alive so the WebView keeps
 * answering the link and writing the device while uniPEQ is in the background. Keep-visible in
 * MainActivity covers the other freeze, Chromium's on a hidden page.
 *
 * Started and stopped by LinkPlugin. The notification's Unlink goes back to the plugin, which tells
 * the page; the page ends the session and calls stop().
 */
public class LinkService extends Service {

    static final String EXTRA_HOST = "host";
    static final String EXTRA_DEVICE = "device";
    private static final String ACTION_UNLINK = "kr.potatosalad775.unipeq.link.UNLINK";
    private static final String CHANNEL_ID = "link";
    private static final int NOTIFICATION_ID = 7301;

    /** Set by LinkPlugin while it's loaded: the notification's Unlink and a swiped-away task. */
    interface Listener {
        void onUnlink();

        void onTaskRemoved();
    }

    static Listener listener;
    private static boolean running = false;

    static boolean isRunning() {
        return running;
    }

    static Intent intent(Context context, String host, String device) {
        return new Intent(context, LinkService.class).putExtra(EXTRA_HOST, host).putExtra(EXTRA_DEVICE, device);
    }

    /** Replaces the running service's notification ("Linked with squig.link · FiiO KA17"). */
    static void update(Context context, String host, String device) {
        if (!running) return;
        context.getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification(context, host, device));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_UNLINK.equals(intent.getAction())) {
            if (listener != null) listener.onUnlink();
            stopSelf();
            return START_NOT_STICKY;
        }
        String host = intent != null ? intent.getStringExtra(EXTRA_HOST) : null;
        String device = intent != null ? intent.getStringExtra(EXTRA_DEVICE) : null;
        Notification notification = notification(this, host, device);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        running = true;
        // Restarting after a kill would bring back a notification for a session the page lost.
        return START_NOT_STICKY;
    }

    /** The WebView dies with the task, and the session with it. */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        if (listener != null) listener.onTaskRemoved();
        stopSelf();
    }

    @Override
    public void onDestroy() {
        running = false;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private static Notification notification(Context context, String host, String device) {
        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                context.getString(R.string.link_channel),
                NotificationManager.IMPORTANCE_LOW
            );
            context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
            builder = new Notification.Builder(context, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(context);
        }
        String name = host != null ? host : "modernGraphTool";
        String title = device != null
            ? context.getString(R.string.link_notification_device, name, device)
            : context.getString(R.string.link_notification, name);
        Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        Intent unlink = new Intent(context, LinkService.class).setAction(ACTION_UNLINK);
        return builder
            .setSmallIcon(R.drawable.ic_stat_link)
            .setContentTitle(title)
            .setContentIntent(PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE))
            .addAction(
                new Notification.Action.Builder(
                    null,
                    context.getString(R.string.link_unlink),
                    PendingIntent.getService(context, 1, unlink, PendingIntent.FLAG_IMMUTABLE)
                ).build()
            )
            .setOngoing(true)
            .setShowWhen(false)
            .build();
    }
}
