# LifeTrack Monetization Setup

## Voluntary support (local only)

The dashboard has an optional **Support LifeTrack / Buy Me a Coffee** dialog. It never unlocks or limits app features. A single configured custom UPI alias powers the amount chips, QR code, and Any UPI App, GPay, PhonePe, Paytm, and BHIM links. The QR is generated locally in the browser; the payment URI is not sent to an external QR service. Plain 10-13 digit phone-number aliases are rejected; provider-issued custom aliases with a suffix are accepted.

To configure local development:

1. Copy the blank keys from the root `.env.example` into `worker/.dev.vars`.
2. Set `SUPPORT_UPI_ID` to a custom non-phone-number UPI alias (for example, an alias containing letters and a UPI handle), and set `SUPPORT_PAYEE_NAME`.
3. Optionally set `FALLBACK_SUPPORT_URL` to an `https:`, `mailto:`, or `tel:` payment/support link.
4. Run the Worker locally so the dashboard can read `/api/support/config`. Empty or invalid UPI settings keep payment buttons disabled.

The Worker exposes only the validated UPI alias and payee name needed to initiate a payment. Do not configure or add a bank account number or IFSC code. Keep `worker/.dev.vars` local and private. No support payment details are set in `wrangler.toml`, and this feature has **not** been deployed to Cloudflare; do not deploy it while Microsoft Store certification is pending.

When support configuration is unavailable, the dialog displays the supplied PhonePe QR image as a static fallback; verify the payee and amount in the payment app before confirming. With valid local Worker configuration, the amount-specific QR is generated locally. The QR encoder bundle is rebuilt from the pinned npm dependency with `npm --prefix worker run build:support-qr`. Its browser bundle and the supplied fallback image are copied into the hosted, root, and Android offline assets.

## LifeTrack AI provider setup

Configure one key per provider in `worker/.dev.vars` locally:

```text
GEMINI_API_KEY=your_google_ai_studio_key
GROQ_API_KEY=your_groq_key
```

- Google Gemini is first: `gemini-2.5-flash` is used for tracker/action-plan prompts and `gemini-2.5-flash-lite` for general chat.
- Groq is the second provider, using the existing verified `openai/gpt-oss-120b` model.
- Cloudflare Workers AI is the final fallback through the local `[ai] binding = "AI"` in `wrangler.toml`, using `@cf/meta/llama-3.1-8b-instruct-fp8`.
- Keys are Worker secrets only. Never add API keys to `config.js`, HTML, JavaScript, APK assets, or Git files.
- The router retries only provider/key errors and 429 responses; it does not pool multiple accounts for one provider.
- The dashboard sends only the last 8 messages and a compact LifeTrack snapshot. Guest chat is stored in localStorage; signed-account conversations can use the existing cloud backup and D1 conversation history.
- Savage and Calm coach styles are selectable in the AI panel. Both keep replies clean and review every tracker change before applying.
- Normal mode applies 10 chats per hour and 40 chats per day per client; account metering remains in D1 when `AI_USAGE_CONTROL_ENABLED=true`.

Create the secrets locally with `.dev.vars`, then deploy only after certification approval:

```powers
cd worker
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put GROQ_API_KEY
npx wrangler deploy --dry-run
```

## Android rewarded ads

1. Open `android/`.
2. Create or update `gradle.properties` locally with the test defaults:

```properties
ENABLE_ADMOB_TEST_ADS=true
ENABLE_REAL_ADMOB_ADS=false
```

3. Debug builds already use Google's official Android rewarded-interstitial test ad:
   - App ID: `ca-app-pub-3940256099942544~3347511713`
   - Rewarded-interstitial unit: `ca-app-pub-3940256099942544/5354046379`
4. Build locally:

```powershell
cd android
.\gradlew.bat assembleDebug
```

The debug APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.

Free and Guest Android sessions can receive banner ads when the public ad switch is enabled and the user has consented. Rewarded AI credits still require an authenticated account and server verification; a Guest session cannot earn them. Real ad delivery may remain limited until the Android app is linked to a supported store listing and AdMob review is complete.

## Cloud APK build with GitHub Actions

You do not need Android Studio or a heavy local Android SDK. The repository now includes a Gradle wrapper and `.github/workflows/build-android-apk.yml`.

### First push

1. Create a GitHub repository for this workspace and push the project.
2. Open the repository on GitHub.
3. Select **Actions**.
4. Open **Build Android APK**.
5. Select **Run workflow**.
6. Choose `test` for Google's official AdMob test ads, or `release` for real signed monetization.

### Test APK

The test workflow runs:

- JDK 17
- Gradle 8.11.1
- Android SDK 36
- `assembleDebug`
- Google's official rewarded test unit

Download **lifetrack-test-apk** from the workflow's **Artifacts** section. The APK is usually `app-debug.apk`.

### Release APK secrets

Configure these repository secrets before a `release` workflow:

- `ADMOB_ANDROID_APP_ID`
- `ADMOB_BANNER_AD_UNIT_ID`
- `ADMOB_REWARDED_AD_UNIT_ID`
- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Create `ANDROID_KEYSTORE_BASE64` with:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\lifetrack-release.jks"))
```

Paste the resulting one-line Base64 value into the GitHub secret. Do not paste the keystore or passwords into source files.

The release workflow decodes the keystore, verifies its certificate against the registered `com.lifetrackai.app` fingerprint, validates that real AdMob IDs are not Google's demo IDs, signs the APK, and uploads **lifetrack-release-apk**. It stops before building if the signing key does not match.

## app-ads.txt verification

1. In the AdMob console, open the Android app and use **Set up app-ads.txt**.
2. The exact publisher line for this AdMob account is:

```text
google.com, pub-6178802859712219, DIRECT, f08c47fec0942fa0
```

3. This line is now in the local `app-ads.txt` copies and `APP_ADS_TXT` in `worker/wrangler.toml`.
4. Publish it at the root of the developer website whose domain is listed on the Android app's supported store listing. The route serves `text/plain`.
5. The Worker route is deployed at `https://lifetrack.surajshukla22051.workers.dev/app-ads.txt`. Do not submit an updated Microsoft Store package while its certification is in progress.

The app's current AdMob setup has no supported store linked, so `app-ads.txt` verification and full ad serving remain pending until a supported Android store listing is available.

## Test the native flow

1. Install the debug APK on a real Android device or emulator.
2. Sign in with Google.
3. Open Additional features and choose **Preview Google test rewarded ad**.
4. A completed test ad must show that no real AI credits are added.
5. Verify failed-load and canceled-ad states show an error/status message instead of crediting the account.

## Replace test IDs with real IDs

Only after AdMob approval and account setup:

```properties
ADMOB_APP_ID=ca-pub-REAL_APP_ID_WITH_APP_SUFFIX
ADMOB_BANNER_AD_UNIT_ID=ca-pub-REAL_PUBLISHER_ID/REAL_BANNER_UNIT
ADMOB_REWARDED_AD_UNIT_ID=ca-pub-REAL_PUBLISHER_ID/REAL_REWARDED_UNIT
ENABLE_ADMOB_TEST_ADS=false
ENABLE_REAL_ADMOB_ADS=true
```

Build and validate a release APK:

```powershell
cd android
.\gradlew.bat assembleRelease
```

The release build rejects Google's demo AdMob IDs.

## Web and Windows PWA

Web browsers and the Windows Store PWA do not use AdMob rewarded ads. They show:

- the server-controlled free daily AI credit quota;
- remaining daily AI credits;
- an optional LifeTrack Pro upgrade notice.

The web UI deliberately has no fake or broken rewarded-ad button.

## Current publishing status

- The web Worker is deployed at `https://lifetrack.surajshukla22051.workers.dev`, including the plain-text `app-ads.txt` route.
- The Android application ID is `com.lifetrackai.app`, matching the registered package name.
- The Android package registration is complete, but there is no new signed APK or public Android store listing yet. Build and verify a release APK before submitting it to a store.
- Microsoft Store certification is still in progress; avoid submitting an updated Windows package until that review is resolved.
