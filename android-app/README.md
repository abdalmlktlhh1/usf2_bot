# إحسان — Android APK

This directory builds a small Android application that opens the existing production platform at:

https://app8964547541.tgcloud.ai/

The APK uses Android WebView rather than copying the web application's files into a different origin. This is deliberate: the current Supabase Edge Functions allow the production TGCloud origin, and keeping that origin avoids changing live authentication and CORS configuration.

## User access

- Telegram users continue to open the platform from the bot as before.
- The standalone APK uses the existing username/password login.
- A Telegram-only account must first set a browser password from the account settings while signed in through Telegram; then the same username and password can be used in the APK.
- The same Supabase account is used. This wrapper does not create a second student profile.

## Network behavior

The APK requires an internet connection to load the platform. The hosted web app can be updated without reinstalling the APK. Student data and attempts remain in Supabase.

The app keeps navigation inside the trusted TGCloud host. Other web links are opened by Android outside the app. HTTPS certificate errors are rejected rather than bypassed.

## Build

The GitHub Actions workflow builds a debug APK on GitHub-hosted Android build tools. Download the artifact named `ihsan-android-debug-apk` from the workflow run.

This first build is intended for direct testing and installation, not Google Play publication. A Play release needs a persistent release-signing key, store metadata, a privacy policy, and a separate review of the store's app-functionality requirements.
