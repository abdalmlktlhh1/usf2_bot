package com.ihsan.platform;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.SafeBrowsingResponse;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.webkit.SslError;

import java.util.Locale;

public final class MainActivity extends Activity {
    private static final String HOME_URL = "https://app8964547541.tgcloud.ai/";
    private static final String TRUSTED_HOST = "app8964547541.tgcloud.ai";
    private static final int GREEN = Color.rgb(16, 77, 63);

    private FrameLayout root;
    private WebView webView;
    private ProgressBar progressBar;
    private View errorPanel;

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        window.setStatusBarColor(Color.rgb(10, 53, 45));
        window.setNavigationBarColor(Color.rgb(10, 53, 45));
        window.getDecorView().setSystemUiVisibility(0);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadsImagesAutomatically(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setTextZoom(100);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);

        webView.setWebViewClient(new SecureWebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progressBar.setProgress(newProgress);
                progressBar.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }
        });
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            openExternal(Uri.parse(url));
        });

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setIndeterminate(false);

        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        FrameLayout.LayoutParams progressParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(3),
                Gravity.TOP
        );
        root.addView(progressBar, progressParams);
        setContentView(root);

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        if (savedInstanceState != null && webView.restoreState(savedInstanceState) != null) {
            // The previous page state has been restored.
        } else {
            webView.loadUrl(HOME_URL);
        }
    }

    private final class SecureWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return routeUrl(request.getUrl());
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return routeUrl(Uri.parse(url));
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            progressBar.setVisibility(View.VISIBLE);
            hideErrorPanel();
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            progressBar.setVisibility(View.GONE);
            CookieManager.getInstance().flush();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) {
                showErrorPanel("تحقق من اتصال الإنترنت ثم أعد المحاولة.");
            }
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                showErrorPanel("تعذر تحميل المنصة. تحقق من الاتصال ثم أعد المحاولة.");
            }
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (request.isForMainFrame() && response.getStatusCode() >= 500) {
                showErrorPanel("الخادم لا يستجيب حاليًا. أعد المحاولة لاحقًا.");
            }
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            handler.cancel();
            showErrorPanel("تعذر التحقق من أمان الاتصال. لا يمكن فتح المنصة عبر اتصال غير آمن.");
        }
    }

    private boolean routeUrl(Uri uri) {
        String scheme = uri.getScheme();
        if (scheme == null) return true;
        scheme = scheme.toLowerCase(Locale.ROOT);

        if ("https".equals(scheme) && TRUSTED_HOST.equalsIgnoreCase(uri.getHost())) {
            return false;
        }

        if ("https".equals(scheme) || "http".equals(scheme)
                || "tel".equals(scheme) || "mailto".equals(scheme)
                || "sms".equals(scheme) || "tg".equals(scheme)) {
            openExternal(uri);
            return true;
        }

        if ("intent".equals(scheme)) {
            openIntentUrl(uri.toString());
            return true;
        }

        return true;
    }

    private void openIntentUrl(String url) {
        try {
            Intent intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                startActivity(intent);
            } catch (ActivityNotFoundException missingApp) {
                String fallback = intent.getStringExtra("browser_fallback_url");
                if (fallback != null && fallback.startsWith("https://")) {
                    openExternal(Uri.parse(fallback));
                }
            }
        } catch (Exception ignored) {
            // Unknown or unsafe intent schemes are intentionally not opened.
        }
    }

    private void openExternal(Uri uri) {
        String scheme = uri.getScheme();
        if (scheme == null) return;
        scheme = scheme.toLowerCase(Locale.ROOT);
        if (!("https".equals(scheme) || "http".equals(scheme)
                || "tel".equals(scheme) || "mailto".equals(scheme)
                || "sms".equals(scheme) || "tg".equals(scheme))) {
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            startActivity(intent);
        } catch (ActivityNotFoundException ignored) {
            // No compatible app is installed for this link.
        }
    }

    private void showErrorPanel(String message) {
        progressBar.setVisibility(View.GONE);
        if (errorPanel != null) return;

        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(dp(28), dp(24), dp(28), dp(24));
        panel.setBackgroundColor(Color.rgb(247, 249, 248));

        TextView title = new TextView(this);
        title.setText("منصة إحسان");
        title.setTextColor(GREEN);
        title.setTextSize(23);
        title.setGravity(Gravity.CENTER);
        title.setTypeface(null, android.graphics.Typeface.BOLD);

        TextView detail = new TextView(this);
        detail.setText(message);
        detail.setTextColor(Color.rgb(86, 103, 96));
        detail.setTextSize(15);
        detail.setGravity(Gravity.CENTER);
        detail.setTextDirection(View.TEXT_DIRECTION_RTL);
        detail.setPadding(0, dp(12), 0, dp(22));

        Button retry = new Button(this);
        retry.setText("إعادة المحاولة");
        retry.setTextColor(Color.WHITE);
        retry.setBackgroundTintList(android.content.res.ColorStateList.valueOf(GREEN));
        retry.setOnClickListener(v -> {
            hideErrorPanel();
            webView.loadUrl(HOME_URL);
        });

        panel.addView(title, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        panel.addView(detail, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
        );
        panel.addView(retry, buttonParams);

        errorPanel = panel;
        root.addView(errorPanel, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
    }

    private void hideErrorPanel() {
        if (errorPanel != null && root != null) {
            root.removeView(errorPanel);
            errorPanel = null;
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onBackPressed() {
        if (errorPanel != null) {
            hideErrorPanel();
            webView.loadUrl(HOME_URL);
            return;
        }
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.removeAllViews();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
