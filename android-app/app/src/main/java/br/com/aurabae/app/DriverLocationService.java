package br.com.aurabae.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.NumberFormat;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public class DriverLocationService extends Service implements LocationListener {
    public static final String EXTRA_COOKIE = "aura_session_cookie";
    private static final String TRACKING_PREFS = "aura_bae_native";
    private static final String TRACKING_CHANNEL = "aura_tracking";
    private static final String RIDES_CHANNEL = "aura_rides";
    private static final int TRACKING_NOTIFICATION = 1101;
    private static final int RIDE_NOTIFICATION = 1102;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean requestRunning = new AtomicBoolean(false);
    private LocationManager locationManager;
    private Location latestLocation;
    private String sessionCookie;
    private String lastNotifiedRideId;

    private final Runnable syncTask = new Runnable() {
        @Override
        public void run() {
            Location location = latestLocation != null ? latestLocation : lastKnownLocation();
            if (location != null) syncLocationAndRides(location);
            handler.postDelayed(this, 10_000);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannels();
        Notification notification = trackingNotification("Localização ativa", "Você está disponível para receber corridas.");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(TRACKING_NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(TRACKING_NOTIFICATION, notification);
        }
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String suppliedCookie = intent.getStringExtra(EXTRA_COOKIE);
            if (suppliedCookie != null && !suppliedCookie.trim().isEmpty()) sessionCookie = suppliedCookie;
        }
        if (sessionCookie == null || sessionCookie.trim().isEmpty()) {
            sessionCookie = CookieManager.getInstance().getCookie(BuildConfig.AURA_BAE_URL);
        }
        getSharedPreferences(TRACKING_PREFS, MODE_PRIVATE)
                .edit()
                .putBoolean("driver_tracking", true)
                .apply();
        beginLocationUpdates();
        handler.removeCallbacks(syncTask);
        handler.post(syncTask);
        return START_STICKY;
    }

    private void beginLocationUpdates() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
                && checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            stopTrackingForMissingPermission();
            return;
        }
        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 5_000, 5f, this);
            }
        } catch (Exception ignored) {
        }
        try {
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 5_000, 5f, this);
            }
        } catch (Exception ignored) {
        }
    }

    private Location lastKnownLocation() {
        if (locationManager == null) return null;
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
                && checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) return null;
        Location best = null;
        try {
            Location gps = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            if (gps != null) best = gps;
        } catch (Exception ignored) {
        }
        try {
            Location network = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            if (network != null && (best == null || network.getTime() > best.getTime())) best = network;
        } catch (Exception ignored) {
        }
        return best;
    }

    @Override
    public void onLocationChanged(Location location) {
        latestLocation = location;
        syncLocationAndRides(location);
    }

    @Override
    public void onProviderEnabled(String provider) {
    }

    @Override
    public void onProviderDisabled(String provider) {
    }

    @Override
    public void onStatusChanged(String provider, int status, Bundle extras) {
    }

    private void syncLocationAndRides(Location location) {
        if (!requestRunning.compareAndSet(false, true)) return;
        networkExecutor.execute(() -> {
            try {
                if (sessionCookie == null || sessionCookie.trim().isEmpty()) return;
                int status = sendLocation(location);
                if (status == HttpURLConnection.HTTP_UNAUTHORIZED || status == HttpURLConnection.HTTP_FORBIDDEN) {
                    handler.post(this::stopTrackingForLoggedOutUser);
                    return;
                }
                if (status >= 200 && status < 300) pollAvailableRides();
            } catch (Exception ignored) {
            } finally {
                requestRunning.set(false);
            }
        });
    }

    private int sendLocation(Location location) throws Exception {
        HttpURLConnection connection = openConnection("/api/driver/status", "POST");
        String body = "{\"online\":true,\"latitude\":" + location.getLatitude()
                + ",\"longitude\":" + location.getLongitude() + "}";
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        connection.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
        connection.setFixedLengthStreamingMode(bytes.length);
        connection.setDoOutput(true);
        connection.getOutputStream().write(bytes);
        int status = connection.getResponseCode();
        consume(connection);
        connection.disconnect();
        return status;
    }

    private void pollAvailableRides() throws Exception {
        HttpURLConnection connection = openConnection("/api/rides/available", "GET");
        int status = connection.getResponseCode();
        String response = readResponse(connection, status);
        connection.disconnect();
        if (status == HttpURLConnection.HTTP_UNAUTHORIZED || status == HttpURLConnection.HTTP_FORBIDDEN) {
            handler.post(this::stopTrackingForLoggedOutUser);
            return;
        }
        if (status < 200 || status >= 300 || response.trim().isEmpty()) return;

        JSONObject payload = new JSONObject(response);
        JSONArray rides = payload.optJSONArray("rides");
        if (rides == null || rides.length() == 0) {
            lastNotifiedRideId = null;
            return;
        }
        JSONObject ride = rides.optJSONObject(0);
        if (ride == null) return;
        String rideId = ride.optString("id", "");
        if (rideId.trim().isEmpty() || rideId.equals(lastNotifiedRideId)) return;
        lastNotifiedRideId = rideId;

        String passenger = ride.optString("passengerName", "Passageiro");
        double distance = ride.optDouble("pickupDistanceKm", 0);
        int totalCents = ride.optInt("totalCents", 0);
        String price = NumberFormat.getCurrencyInstance(new Locale("pt", "BR"))
                .format(totalCents / 100.0);
        String details = passenger + " • " + String.format(new Locale("pt", "BR"), "%.1f km", distance)
                + " • " + price;
        showRideNotification(details);
    }

    private HttpURLConnection openConnection(String path, String method) throws Exception {
        URL url = new URL(BuildConfig.AURA_BAE_URL + path);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(12_000);
        connection.setReadTimeout(12_000);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("User-Agent", "AuraBaeAndroid/1.0");
        if (sessionCookie != null && !sessionCookie.trim().isEmpty()) {
            connection.setRequestProperty("Cookie", sessionCookie);
        }
        return connection;
    }

    private String readResponse(HttpURLConnection connection, int status) throws Exception {
        InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        if (stream == null) return "";
        StringBuilder output = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) output.append(line);
        }
        return output.toString();
    }

    private void consume(HttpURLConnection connection) {
        try {
            readResponse(connection, connection.getResponseCode());
        } catch (Exception ignored) {
        }
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        NotificationChannel tracking = new NotificationChannel(
                TRACKING_CHANNEL,
                getString(R.string.tracking_channel_name),
                NotificationManager.IMPORTANCE_LOW
        );
        tracking.setDescription("Mostra quando o motorista está disponível e enviando localização.");
        manager.createNotificationChannel(tracking);

        NotificationChannel rides = new NotificationChannel(
                RIDES_CHANNEL,
                getString(R.string.rides_channel_name),
                NotificationManager.IMPORTANCE_HIGH
        );
        rides.setDescription("Avisa o motorista quando uma nova corrida estiver disponível.");
        rides.enableVibration(true);
        manager.createNotificationChannel(rides);
    }

    private PendingIntent openAppIntent() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(this, 0, intent, flags);
    }

    private Notification trackingNotification(String title, String text) {
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, TRACKING_CHANNEL)
                : new Notification.Builder(this);
        return builder
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(text)
                .setContentIntent(openAppIntent())
                .setCategory(Notification.CATEGORY_SERVICE)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .build();
    }

    private void showRideNotification(String details) {
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, RIDES_CHANNEL)
                : new Notification.Builder(this);
        Notification notification = builder
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("Nova corrida na Aura Bae")
                .setContentText(details)
                .setStyle(new Notification.BigTextStyle().bigText(details + "\nToque para abrir e aceitar."))
                .setContentIntent(openAppIntent())
                .setCategory(Notification.CATEGORY_CALL)
                .setAutoCancel(true)
                .build();
        getSystemService(NotificationManager.class).notify(RIDE_NOTIFICATION, notification);
    }

    private void stopTrackingForMissingPermission() {
        getSharedPreferences(TRACKING_PREFS, MODE_PRIVATE)
                .edit()
                .putBoolean("driver_tracking", false)
                .apply();
        stopSelf();
    }

    private void stopTrackingForLoggedOutUser() {
        getSharedPreferences(TRACKING_PREFS, MODE_PRIVATE)
                .edit()
                .putBoolean("driver_tracking", false)
                .apply();
        stopSelf();
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(syncTask);
        if (locationManager != null) {
            try {
                locationManager.removeUpdates(this);
            } catch (Exception ignored) {
            }
        }
        networkExecutor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
