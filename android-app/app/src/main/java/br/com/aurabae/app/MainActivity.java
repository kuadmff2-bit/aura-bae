package br.com.aurabae.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Parcelable;
import android.provider.MediaStore;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    private static final int REQUEST_LOCATION = 4101;
    private static final int REQUEST_FILES = 4102;
    private static final String TRACKING_PREFS = "aura_bae_native";

    private WebView webView;
    private View splashView;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private File cameraFile;
    private GeolocationPermissions.Callback geolocationCallback;
    private String geolocationOrigin;
    private boolean pendingDriverService;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(8, 10, 9));
        getWindow().setNavigationBarColor(Color.rgb(8, 10, 9));
        createInterface();
        configureWebView();

        if (savedInstanceState == null) {
            webView.loadUrl(BuildConfig.AURA_BAE_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }

        boolean wasTracking = getSharedPreferences(TRACKING_PREFS, MODE_PRIVATE)
                .getBoolean("driver_tracking", false);
        if (wasTracking) {
            pendingDriverService = true;
            webView.postDelayed(this::ensureDriverService, 1200);
        }
    }

    private void createInterface() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(8, 10, 9));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(8, 10, 9));
        webView.setVisibility(View.INVISIBLE);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        LinearLayout splash = new LinearLayout(this);
        splash.setOrientation(LinearLayout.VERTICAL);
        splash.setGravity(Gravity.CENTER);
        splash.setPadding(dp(30), dp(30), dp(30), dp(30));
        splash.setBackgroundColor(Color.rgb(8, 10, 9));

        TextView icon = new TextView(this);
        icon.setText("A");
        icon.setTextColor(Color.WHITE);
        icon.setTextSize(48);
        icon.setTypeface(Typeface.DEFAULT_BOLD);
        icon.setGravity(Gravity.CENTER);
        GradientDrawable iconBackground = new GradientDrawable();
        iconBackground.setColor(Color.rgb(13, 92, 70));
        iconBackground.setCornerRadius(dp(30));
        icon.setBackground(iconBackground);
        splash.addView(icon, new LinearLayout.LayoutParams(dp(104), dp(104)));

        TextView name = new TextView(this);
        name.setText("Aura Bae");
        name.setTextColor(Color.WHITE);
        name.setTextSize(28);
        name.setTypeface(Typeface.DEFAULT_BOLD);
        name.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams nameParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        nameParams.topMargin = dp(20);
        splash.addView(name, nameParams);

        TextView subtitle = new TextView(this);
        subtitle.setText("Mobilidade local em Barreirinha");
        subtitle.setTextColor(Color.rgb(174, 188, 182));
        subtitle.setTextSize(14);
        subtitle.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams subtitleParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        subtitleParams.topMargin = dp(6);
        splash.addView(subtitle, subtitleParams);

        ProgressBar progress = new ProgressBar(this);
        progress.setIndeterminateTintList(android.content.res.ColorStateList.valueOf(Color.rgb(32, 201, 139)));
        LinearLayout.LayoutParams progressParams = new LinearLayout.LayoutParams(dp(36), dp(36));
        progressParams.topMargin = dp(26);
        splash.addView(progress, progressParams);

        splashView = splash;
        root.addView(splash, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(root);
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(false);
        settings.setUserAgentString(settings.getUserAgentString() + " AuraBaeAndroid/1.0");

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);
        // O APK de teste também transporta dados reais. Nunca exponha o conteúdo
        // autenticado do WebView ao depurador USB.
        WebView.setWebContentsDebuggingEnabled(false);

        webView.addJavascriptInterface(new NativeBridge(), "AuraBaeNative");
        webView.setWebViewClient(new AuraWebViewClient());
        webView.setWebChromeClient(new AuraChromeClient());
    }

    private class AuraWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) return false;
            return openUrl(request.getUrl());
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            CookieManager.getInstance().flush();
            view.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('AuraBaeNativeReady'));", null
            );
            webView.setVisibility(View.VISIBLE);
            webView.animate().alpha(1f).setDuration(180).start();
            splashView.animate().alpha(0f).setDuration(260).withEndAction(() -> {
                splashView.setVisibility(View.GONE);
            }).start();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            super.onReceivedError(view, request, error);
            if (request.isForMainFrame()) showOfflinePage();
        }
    }

    private class AuraChromeClient extends WebChromeClient {
        @Override
        public void onGeolocationPermissionsShowPrompt(
                String origin,
                GeolocationPermissions.Callback callback
        ) {
            if (!isTrustedAppUrl(Uri.parse(origin))) {
                callback.invoke(origin, false, false);
                return;
            }
            if (hasLocationPermission()) {
                callback.invoke(origin, true, true);
                return;
            }
            geolocationOrigin = origin;
            geolocationCallback = callback;
            requestPermissions(new String[]{
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
            }, REQUEST_LOCATION);
        }

        @Override
        public boolean onShowFileChooser(
                WebView webView,
                ValueCallback<Uri[]> callback,
                FileChooserParams params
        ) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            cameraUri = null;
            cameraFile = null;

            Intent picker;
            try {
                picker = params.createIntent();
            } catch (ActivityNotFoundException exception) {
                picker = new Intent(Intent.ACTION_GET_CONTENT);
                picker.addCategory(Intent.CATEGORY_OPENABLE);
                picker.setType("image/*");
            }

            List<Intent> captureIntents = new ArrayList<>();
            Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            if (camera.resolveActivity(getPackageManager()) != null) {
                try {
                    File directory = new File(getCacheDir(), "camera");
                    if (!directory.exists()) directory.mkdirs();
                    cameraFile = new File(directory, "aura-bae-" + System.currentTimeMillis() + ".jpg");
                    cameraUri = FileProvider.getUriForFile(
                            MainActivity.this,
                            getPackageName() + ".files",
                            cameraFile
                    );
                    camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
                    camera.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    captureIntents.add(camera);
                } catch (Exception ignored) {
                    cameraUri = null;
                    cameraFile = null;
                }
            }

            Intent chooser = new Intent(Intent.ACTION_CHOOSER);
            chooser.putExtra(Intent.EXTRA_INTENT, picker);
            chooser.putExtra(Intent.EXTRA_TITLE, "Escolher foto");
            chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, captureIntents.toArray(new Parcelable[0]));
            try {
                startActivityForResult(chooser, REQUEST_FILES);
                return true;
            } catch (ActivityNotFoundException exception) {
                fileCallback.onReceiveValue(null);
                fileCallback = null;
                Toast.makeText(MainActivity.this, "Não foi possível abrir suas fotos.", Toast.LENGTH_LONG).show();
                return false;
            }
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            request.deny();
        }
    }

    private boolean openUrl(Uri uri) {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme();
        String host = uri.getHost() == null ? "" : uri.getHost();
        if (isTrustedAppUrl(uri)) {
            return false;
        }
        try {
            Intent intent;
            if ("intent".equalsIgnoreCase(scheme)) {
                intent = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME);
            } else {
                intent = new Intent(Intent.ACTION_VIEW, uri);
            }
            startActivity(intent);
        } catch (Exception exception) {
            Toast.makeText(this, "Não há aplicativo disponível para abrir este link.", Toast.LENGTH_LONG).show();
        }
        return true;
    }

    private boolean isTrustedAppUrl(Uri uri) {
        Uri appUri = Uri.parse(BuildConfig.AURA_BAE_URL);
        return "https".equalsIgnoreCase(uri.getScheme())
                && uri.getHost() != null
                && uri.getHost().equalsIgnoreCase(appUri.getHost())
                && effectivePort(uri) == effectivePort(appUri);
    }

    private int effectivePort(Uri uri) {
        return uri.getPort() == -1 ? 443 : uri.getPort();
    }

    private void showOfflinePage() {
        String html = "<!doctype html><html lang='pt-BR'><meta name='viewport' content='width=device-width,initial-scale=1'>"
                + "<body style='margin:0;background:#080a09;color:#fffefb;font-family:sans-serif;display:grid;place-items:center;min-height:100vh'>"
                + "<main style='padding:32px;text-align:center;max-width:360px'><div style='width:76px;height:76px;border-radius:24px;background:#0d5c46;display:grid;place-items:center;margin:auto;font-size:38px;font-weight:900'>A</div>"
                + "<h1>Sem conexão</h1><p style='color:#aebcb6;line-height:1.6'>Confira sua internet para acessar corridas, mapa e pagamentos.</p>"
                + "<button onclick='AuraBaeNative.reloadApp()' style='border:0;border-radius:14px;background:#20c98b;color:#04150f;padding:16px 24px;font-weight:900;font-size:16px'>Tentar novamente</button></main></body></html>";
        webView.loadDataWithBaseURL(BuildConfig.AURA_BAE_URL, html, "text/html", "UTF-8", null);
    }

    private boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void ensureDriverService() {
        if (!pendingDriverService) return;
        if (!hasLocationPermission()) {
            List<String> permissions = new ArrayList<>();
            permissions.add(Manifest.permission.ACCESS_FINE_LOCATION);
            permissions.add(Manifest.permission.ACCESS_COARSE_LOCATION);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                    && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.POST_NOTIFICATIONS);
            }
            requestPermissions(permissions.toArray(new String[0]), REQUEST_LOCATION);
            return;
        }
        startDriverService();
    }

    private void startDriverService() {
        pendingDriverService = false;
        String cookie = CookieManager.getInstance().getCookie(BuildConfig.AURA_BAE_URL);
        Intent intent = new Intent(this, DriverLocationService.class);
        intent.putExtra(DriverLocationService.EXTRA_COOKIE, cookie);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent);
        else startService(intent);
    }

    private void stopDriverService() {
        pendingDriverService = false;
        stopService(new Intent(this, DriverLocationService.class));
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != REQUEST_LOCATION) return;
        boolean granted = hasLocationPermission();
        if (geolocationCallback != null) {
            geolocationCallback.invoke(geolocationOrigin, granted, granted);
            geolocationCallback = null;
            geolocationOrigin = null;
        }
        if (pendingDriverService && granted) startDriverService();
        else if (pendingDriverService) {
            pendingDriverService = false;
            Toast.makeText(this, "A localização é necessária para receber corridas.", Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_FILES || fileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK) {
            result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            if ((result == null || result.length == 0)
                    && cameraUri != null
                    && cameraFile != null
                    && cameraFile.exists()
                    && cameraFile.length() > 0) {
                result = new Uri[]{cameraUri};
            }
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
        cameraUri = null;
        cameraFile = null;
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        if (webView != null) {
            webView.removeJavascriptInterface("AuraBaeNative");
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    public class NativeBridge {
        @JavascriptInterface
        public void setDriverOnline(boolean online) {
            runOnUiThread(() -> {
                getSharedPreferences(TRACKING_PREFS, MODE_PRIVATE)
                        .edit()
                        .putBoolean("driver_tracking", online)
                        .apply();
                if (online) {
                    pendingDriverService = true;
                    ensureDriverService();
                } else {
                    stopDriverService();
                }
            });
        }

        @JavascriptInterface
        public void reloadApp() {
            runOnUiThread(() -> webView.loadUrl(BuildConfig.AURA_BAE_URL));
        }

        @JavascriptInterface
        public void openAppSettings() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + getPackageName()));
                startActivity(intent);
            });
        }
    }
}
