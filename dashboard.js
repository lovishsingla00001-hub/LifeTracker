(function () {
    "use strict";
    if (window.LT_REDIRECTING) return;

    const nativeAndroidBridge = window.LifeTrackNativeReminders;
    const isNativeAndroidApp = Boolean(
        nativeAndroidBridge
        && typeof nativeAndroidBridge.isNativeApp === "function"
        && nativeAndroidBridge.isNativeApp()
    );
    const isNativeLifeTrackApp = isNativeAndroidApp || Boolean(
        nativeAndroidBridge
        && typeof nativeAndroidBridge.isNativePlatform === "function"
        && nativeAndroidBridge.isNativePlatform()
    );
    const isWindowsStorePwa = !isNativeLifeTrackApp
        && /Windows/i.test(navigator.userAgent)
        && (navigator.standalone === true
            || window.matchMedia("(display-mode: standalone)").matches
            || document.referrer.includes("ms-store"));
    if (isNativeAndroidApp) document.documentElement.classList.add("native-android-app");
    if (isWindowsStorePwa) document.documentElement.classList.add("windows-store-pwa");
    document.documentElement.classList.add(isNativeLifeTrackApp ? "native-lifetrack-app" : "web-lifetrack-app");

    const currentUser = JSON.parse(localStorage.getItem("lifetrack-user") || "null");
    if (!currentUser || !currentUser.name) {
        window.location.href = "index.html";
        return;
    }

    /* ---- per-account storage: every login gets its own private slot in this browser ---- */
    const CFG = window.LT_CONFIG || {};
    const GID = CFG.GOOGLE_CLIENT_ID || "";
    const HEALTH_ON = false;

    if (!currentUser.uid) {
        currentUser.uid = currentUser.name === "Guest" ? "guest"
            : currentUser.email ? "e_" + currentUser.email.toLowerCase()
            : "n_" + currentUser.name.toLowerCase().replace(/\s+/g, " ");
        localStorage.setItem("lifetrack-user", JSON.stringify(currentUser));
    }
    const NS = "lifetrack:" + currentUser.uid + ":";
    let cloudTimer = null;
    let cloudSyncing = false;
    let cloudSyncRequested = false;
    let cloudRateLimitUntil = 0;
    let cloudRateLimitAttempts = 0;
    let cloudApplying = false;
    let cloudFileId = null;
    const store = {
        get: (k) => localStorage.getItem(NS + k),
        set: (k, v) => {
            localStorage.setItem(NS + k, v);
            if (!cloudApplying) scheduleCloudSync();
        },
        remove: (k) => {
            localStorage.removeItem(NS + k);
            if (!cloudApplying) scheduleCloudSync();
        }
    };
    // one time only: the first account to open the app after this update keeps the data saved by the old single-user version
    if (!localStorage.getItem("lifetrack-migrated")) {
        ["habits", "checks", "habit-start", "body", "goals", "deleted-goals", "fitness", "reading-plan"].forEach((k) => {
            const old = localStorage.getItem("lifetrack-" + k);
            if (old !== null && localStorage.getItem(NS + k) === null) localStorage.setItem(NS + k, old);
        });
        localStorage.setItem("lifetrack-migrated", "1");
    }
    if (!localStorage.getItem(NS + "cloud-updated-at") && ["habits", "checks", "habit-start", "body", "goals", "deleted-goals", "fitness", "reading-plan"].some((key) => localStorage.getItem(NS + key) !== null)) {
        localStorage.setItem(NS + "cloud-updated-at", String(Date.now()));
    }

    const monthSelect = document.getElementById("monthSelect");
    const yearSelect = document.getElementById("yearSelect");
    const dashboardSettingsTrigger = document.getElementById("dashboardSettingsTrigger");
    const dashboardSettingsMenu = document.getElementById("dashboardSettingsMenu");
    const dashboardSettingsClose = document.getElementById("dashboardSettingsClose");
    const aiReminderEmptyState = document.getElementById("aiReminderEmptyState");
    const androidThemeSettings = document.getElementById("androidThemeSettings");
    const adsPrivacyOptions = document.getElementById("adsPrivacyOptions");
    const rewardedAiSettings = document.getElementById("rewardedAiSettings");
    const rewardedAiTitle = document.getElementById("rewardedAiTitle");
    const rewardedAiDescription = document.getElementById("rewardedAiDescription");
    const watchRewardedAd = document.getElementById("watchRewardedAd");
    const rewardedAiStatus = document.getElementById("rewardedAiStatus");
    const webAiUsageMeter = document.getElementById("webAiUsageMeter");
    const webAiUsageProgress = document.getElementById("webAiUsageProgress");
    const webProUpgrade = document.getElementById("webProUpgrade");
    const isAdMobTestBuild = Boolean(isNativeAndroidApp
        && nativeAndroidBridge
        && typeof nativeAndroidBridge.isAdMobTestAdsEnabled === "function"
        && nativeAndroidBridge.isAdMobTestAdsEnabled());
    const ownerAdControls = document.getElementById("ownerAdControls");
    const ownerAdsEnabled = document.getElementById("ownerAdsEnabled");
    const ownerRewardedAdsEnabled = document.getElementById("ownerRewardedAdsEnabled");
    const saveOwnerAdControls = document.getElementById("saveOwnerAdControls");
    const ownerAdControlsStatus = document.getElementById("ownerAdControlsStatus");
    const nativeHealthSettings = document.getElementById("nativeHealthSettings");
    const nativeHealthConnect = document.getElementById("nativeHealthConnect");
    const nativeHealthStatus = document.getElementById("nativeHealthStatus");
    const nativeHealthAutoSync = document.getElementById("nativeHealthAutoSync");
    const nativeHealthBackgroundStatus = document.getElementById("nativeHealthBackgroundStatus");
    const nativeHealthPermissionStatus = document.getElementById("nativeHealthPermissionStatus");
    const nativeHealthLastSuccess = document.getElementById("nativeHealthLastSuccess");
    const nativeHealthNextSync = document.getElementById("nativeHealthNextSync");
    const nativeHealthLatestData = document.getElementById("nativeHealthLatestData");
    const deviceFocusSettings = document.getElementById("deviceFocusSettings");
    const deviceFocusPermission = document.getElementById("deviceFocusPermission");
    const deviceFocusStatus = document.getElementById("deviceFocusStatus");
    const hasDeviceFocusBridge = isNativeAndroidApp
        && nativeAndroidBridge
        && typeof nativeAndroidBridge.getDeviceFocusUsage === "function";
    const androidUpdateNotice = document.getElementById("androidUpdateNotice");
    if (isNativeAndroidApp && typeof nativeAndroidBridge.showAdPrivacyOptions === "function") {
        adsPrivacyOptions.hidden = false;
        adsPrivacyOptions.addEventListener("click", () => nativeAndroidBridge.showAdPrivacyOptions());
    }
    const androidUpdateMessage = document.getElementById("androidUpdateMessage");
    let nativeHealthConnected = Boolean(
        isNativeAndroidApp
        && nativeAndroidBridge
        && typeof nativeAndroidBridge.isHealthSyncEnabled === "function"
        && nativeAndroidBridge.isHealthSyncEnabled()
    );
    let nativeHealthAutomaticEnabled = nativeHealthConnected;
    let deviceFocusPermissionGranted = false;
    if (isNativeAndroidApp && androidUpdateNotice) {
        const installedVersion = typeof nativeAndroidBridge.getAppVersionCode === "function"
            ? Number(nativeAndroidBridge.getAppVersionCode())
            : 0;
        fetch("/api/android/version", { cache: "no-store" })
            .then((response) => {
                if (!response.ok) throw new Error(`Update check failed (${response.status}).`);
                return response.json();
            })
            .then((update) => {
                const latestVersion = Number(update.versionCode);
                if (!Number.isSafeInteger(latestVersion) || latestVersion <= installedVersion) return;
                androidUpdateMessage.textContent =
                    `Version ${String(update.versionName || latestVersion)} is ready. Download it in your browser, then tap Install to update LifeTrack.`;
                const dlBtn = document.getElementById("androidUpdateDownload");
                if (dlBtn && update.downloadUrl) dlBtn.href = update.downloadUrl;
                androidUpdateNotice.hidden = false;
            })
            .catch((error) => console.warn("LifeTrack could not check for Android app updates.", error));
    }
    const pullRefreshIndicator = document.getElementById("pullRefreshIndicator");
    const pullRefreshLabel = document.getElementById("pullRefreshLabel");
    const pullRefreshThreshold = 110;
    let touchPullStart = null;
    let pullRefreshDistance = 0;
    let wheelPullDistance = 0;
    let wheelPullTimer = null;
    let pullRefreshReloading = false;
    const calendarHead = document.getElementById("calendarHead");
    const habitBody = document.getElementById("habitBody");
    const habitCount = document.getElementById("habitCount");
    const completedCount = document.getElementById("completedCount");
    const completionChart = document.getElementById("completionChart");
    const tableWrapper = document.querySelector(".table-wrapper");
    const dailyReminder = document.getElementById("dailyReminder");
    const goalAnalysis = document.getElementById("goalAnalysis");
    const habitManageList = document.getElementById("habitManageList");
    const goalPageList = document.getElementById("goalPageList");
    const analyticsSummary = document.getElementById("analyticsSummary");
    const themeToggle = document.getElementById("themeToggle");
    const userName = document.getElementById("userName");
    const profileLetter = document.getElementById("profileLetter");

    function closeDashboardSettings(returnFocus = false) {
        dashboardSettingsMenu.hidden = true;
        dashboardSettingsTrigger.setAttribute("aria-expanded", "false");
        if (returnFocus) dashboardSettingsTrigger.focus();
    }

    dashboardSettingsTrigger.addEventListener("click", () => {
        dashboardSettingsMenu.hidden = !dashboardSettingsMenu.hidden;
        dashboardSettingsTrigger.setAttribute("aria-expanded", String(!dashboardSettingsMenu.hidden));
        updateNativeAdSuppression();
    });
    dashboardSettingsClose.addEventListener("click", () => {
        closeDashboardSettings(true);
        updateNativeAdSuppression();
    });
    dashboardSettingsMenu.addEventListener("click", (event) => event.stopPropagation());
    document.addEventListener("click", (event) => {
        if (!dashboardSettingsMenu.hidden && !dashboardSettingsMenu.contains(event.target) && !dashboardSettingsTrigger.contains(event.target)) {
            closeDashboardSettings();
            updateNativeAdSuppression();
        }
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !dashboardSettingsMenu.hidden) {
            closeDashboardSettings(true);
            updateNativeAdSuppression();
        }
    });

    function updateNativeAdSuppression() {
        if (!isNativeAndroidApp || !nativeAndroidBridge
            || typeof nativeAndroidBridge.setAdSuppressed !== "function") return;
        const aiPanel = document.getElementById("aiPanel");
        const focusState = document.getElementById("focusState");
        const activeSection = document.querySelector(".nav-item.active");
        const modalRoot = document.getElementById("modalRoot");
        const suppress = Boolean(aiPanel && !aiPanel.hidden)
            || Boolean(focusState && focusState.textContent === "In session")
            || Boolean(activeSection && activeSection.dataset.section !== "dashboard")
            || Boolean(modalRoot && modalRoot.childElementCount > 0);
        nativeAndroidBridge.setAdSuppressed(suppress);
    }

    function monetizationEndpoint(path) {
        const base = String(CFG.GROQ_WORKER_URL || location.origin).trim();
        return new URL(path, base.endsWith("/") ? base : `${base}/`);
    }

    async function readMonetizationStatus() {
        const response = await fetch(monetizationEndpoint("/api/monetization/status"), {
            method: "GET",
            credentials: "include",
            headers: { Accept: "application/json" },
            cache: "no-store"
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Account status could not be loaded (HTTP ${response.status}).`);
        return data;
    }

    function updateRewardedAdControls(account) {
        if (!isNativeAndroidApp) {
            rewardedAiSettings.hidden = false;
            watchRewardedAd.hidden = true;
            watchRewardedAd.disabled = true;
            rewardedAiTitle.textContent = account.plan === "pro_monthly" || account.plan === "pro_yearly"
                ? "LifeTrack Pro · daily AI credits"
                : "Free daily AI credits";
            rewardedAiDescription.textContent = isWindowsStorePwa
                ? "Windows Store PWA credit status"
                : "Daily AI credit status";
            webAiUsageMeter.hidden = true;
            webProUpgrade.hidden = account.plan === "pro_monthly" || account.plan === "pro_yearly";
            const aiUsage = account.aiUsage;
            if (aiUsage && aiUsage.enabled) {
                const allowance = Math.max(0, Number(aiUsage.dailyAllowance) || 0);
                const used = Math.max(0, Number(aiUsage.dailyUsed) || 0);
                const remaining = Math.max(0, Number(aiUsage.remainingCredits) || 0);
                const percent = allowance > 0 ? Math.min(100, Math.round((used / allowance) * 100)) : 0;
                webAiUsageMeter.hidden = false;
                webAiUsageMeter.setAttribute("aria-valuemax", String(Math.max(1, allowance)));
                webAiUsageMeter.setAttribute("aria-valuenow", String(used));
                webAiUsageMeter.setAttribute("aria-label", `${remaining} of ${allowance} daily AI credits remaining`);
                webAiUsageProgress.style.width = `${percent}%`;
                rewardedAiStatus.textContent = `${remaining} of ${allowance} AI credits remaining today.`;
            } else {
                rewardedAiStatus.textContent = "Daily AI credits are managed by the server.";
            }
            if (account.plan !== "pro_monthly" && account.plan !== "pro_yearly") {
                webProUpgrade.hidden = false;
            }
            return;
        }
        rewardedAiSettings.hidden = false;
        if (isAdMobTestBuild) {
            watchRewardedAd.hidden = false;
            watchRewardedAd.textContent = "Preview Google test rewarded ad";
            watchRewardedAd.disabled = Boolean(
                (document.getElementById("focusState") || {}).textContent === "In session"
                || !(document.getElementById("aiPanel") || {}).hidden
            );
            rewardedAiDescription.textContent = "Debug builds use Google's official test ad unit only. Completing a test ad never grants AI credits.";
            rewardedAiStatus.textContent = "Test mode: no real ads, clicks, earnings, or AI credits.";
            return;
        }
        if (currentUser.provider !== "google") {
            rewardedAiSettings.hidden = true;
            return;
        }
        watchRewardedAd.hidden = false;
        watchRewardedAd.textContent = "Watch ad for AI credits";
        rewardedAiDescription.textContent = "Watch one rewarded ad to earn temporary AI credits. Each account can claim once every 7 days; credits expire after 24 hours.";
        const reward = account.reward;
        if (account.plan !== "free") {
            watchRewardedAd.disabled = true;
            rewardedAiStatus.textContent = "Rewarded AI credits are available to Free accounts only.";
        } else if (!reward || !reward.enabled) {
            watchRewardedAd.disabled = true;
            rewardedAiStatus.textContent = "Rewarded ads are currently disabled or not configured.";
        } else if (reward.pending) {
            watchRewardedAd.disabled = true;
            rewardedAiStatus.textContent = "Reward verification is pending. Google must confirm the completed ad before credits are added.";
        } else if (reward.activeCredits > 0) {
            watchRewardedAd.disabled = !reward.available;
            const expiresAt = reward.activeExpiresAt ? new Date(reward.activeExpiresAt).toLocaleString() : "soon";
            rewardedAiStatus.textContent = `${reward.activeCredits} temporary AI credits available until ${expiresAt}. One reward every ${reward.cooldownDays} days; credits expire after 24 hours.`;
        } else if (!reward.available) {
            watchRewardedAd.disabled = true;
            const next = reward.nextAvailableAt ? new Date(reward.nextAvailableAt).toLocaleString() : "later";
            rewardedAiStatus.textContent = `You can claim your next reward ${next}. Rewards are limited to one every ${reward.cooldownDays} days.`;
        } else {
            watchRewardedAd.disabled = Boolean(
                (document.getElementById("focusState") || {}).textContent === "In session"
                || !(document.getElementById("aiPanel") || {}).hidden
            );
            rewardedAiStatus.textContent = `Watch one optional ad for ${reward.creditsPerReward} AI credits. Credits expire after 24 hours.`;
        }
    }

    async function refreshMonetizationControls() {
        if (isNativeAndroidApp && typeof nativeAndroidBridge.refreshAdEntitlement === "function") {
            nativeAndroidBridge.refreshAdEntitlement();
        }
        try {
            const account = await readMonetizationStatus();
            updateRewardedAdControls(account);
            ownerAdControls.hidden = !account.isOwner;
            if (account.isOwner) {
                const settingsResponse = await fetch(monetizationEndpoint("/api/monetization/admin/settings"), {
                    method: "GET",
                    credentials: "include",
                    headers: { Accept: "application/json" },
                    cache: "no-store"
                });
                const settings = await settingsResponse.json().catch(() => ({}));
                if (!settingsResponse.ok) throw new Error(settings.error || "Owner ad settings could not be loaded.");
                ownerAdsEnabled.checked = settings.adsEnabled === true;
                ownerRewardedAdsEnabled.checked = settings.rewardedAdsEnabled === true;
                ownerAdControlsStatus.textContent = settings.adsEnabled
                    ? "Global ad settings are on for eligible users. AdMob setup and each user's consent still apply."
                    : "Global ad settings are off for everyone until you enable them here.";
            }
        } catch (error) {
            if (isNativeAndroidApp && currentUser.provider === "google" && !isAdMobTestBuild) {
                rewardedAiSettings.hidden = false;
                watchRewardedAd.disabled = true;
                rewardedAiStatus.textContent = error.message || "Account and reward status could not be verified.";
            }
            console.warn("LifeTrack could not refresh monetization controls.", error);
        }
    }

    if (isAdMobTestBuild) updateRewardedAdControls({});

    if (isNativeAndroidApp) {
        watchRewardedAd.addEventListener("click", async () => {
            if (watchRewardedAd.disabled || !nativeAndroidBridge
                || isAdMobTestBuild && typeof nativeAndroidBridge.showRewardedAdTest !== "function"
                || !isAdMobTestBuild && (currentUser.provider !== "google"
                    || typeof nativeAndroidBridge.showRewardedAd !== "function")) return;
            watchRewardedAd.disabled = true;
            if (isAdMobTestBuild) {
                rewardedAiStatus.textContent = "Loading Google's official test ad. It cannot grant real credits.";
                nativeAndroidBridge.showRewardedAdTest();
                return;
            }
            rewardedAiStatus.textContent = "Preparing a secure reward request…";
            try {
                const response = await fetch(monetizationEndpoint("/api/monetization/reward/challenge"), {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json", Accept: "application/json" },
                    body: "{}"
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(data.error || `Reward request failed (HTTP ${response.status}).`);
                if (typeof data.challengeId !== "string" || typeof data.userId !== "string") {
                    throw new Error("The Worker returned an invalid reward challenge.");
                }
                rewardedAiStatus.textContent = "Complete the optional ad. Google must verify it before credits are added.";
                nativeAndroidBridge.showRewardedAd(data.challengeId, data.userId);
            } catch (error) {
                rewardedAiStatus.textContent = error.message || "A reward ad could not be started.";
                await refreshMonetizationControls();
            }
        });
        window.onLifeTrackRewardedAdTestResult = (message) => {
            rewardedAiStatus.textContent = message || "Test ad closed. No AI credits were added.";
            updateRewardedAdControls({});
        };
        window.onLifeTrackRewardedAdResult = async (earned, message) => {
            rewardedAiStatus.textContent = message || (earned
                ? "Google is verifying your reward."
                : "The ad did not earn a reward.");
            if (!earned) {
                await refreshMonetizationControls();
                return;
            }
            for (let attempt = 0; attempt < 8; attempt += 1) {
                await new Promise((resolve) => setTimeout(resolve, 2500));
                try {
                    const account = await readMonetizationStatus();
                    updateRewardedAdControls(account);
                    if (account.reward && account.reward.activeCredits > 0) return;
                } catch (error) {
                    console.warn("LifeTrack is waiting for AdMob reward confirmation.", error);
                }
            }
            rewardedAiStatus.textContent = "Google is still verifying the ad. Your credits will appear here after confirmation.";
            await refreshMonetizationControls();
        };
    }

    saveOwnerAdControls.addEventListener("click", async () => {
        saveOwnerAdControls.disabled = true;
        ownerAdControlsStatus.textContent = "Saving…";
        try {
            const response = await fetch(monetizationEndpoint("/api/monetization/admin/settings"), {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({
                    adsEnabled: ownerAdsEnabled.checked,
                    rewardedAdsEnabled: ownerRewardedAdsEnabled.checked
                })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `Ad settings could not be saved (HTTP ${response.status}).`);
            ownerAdsEnabled.checked = data.adsEnabled;
            ownerRewardedAdsEnabled.checked = data.rewardedAdsEnabled;
            ownerAdControlsStatus.textContent = data.adsEnabled
                ? "Saved app-wide. Ads are available to eligible users when AdMob and consent allow."
                : "Saved app-wide. Ads are now off for all users.";
            await refreshMonetizationControls();
        } catch (error) {
            ownerAdControlsStatus.textContent = error.message || "Ad settings could not be saved.";
        } finally {
            saveOwnerAdControls.disabled = false;
        }
    });
    refreshMonetizationControls();
    if (isNativeLifeTrackApp && nativeAndroidBridge && typeof nativeAndroidBridge.requestHealthData === "function") {
        nativeHealthSettings.hidden = false;
        nativeHealthConnect.textContent = nativeHealthConnected ? "Sync health data now" : `Connect ${isNativeAndroidApp ? "Android Health Connect" : "Apple Health"}`;
        if (nativeHealthAutoSync) {
            nativeHealthAutoSync.hidden = !isNativeAndroidApp
                || typeof nativeAndroidBridge.startAutomaticHealthSync !== "function";
        }
        if (nativeHealthConnected) {
            nativeHealthStatus.textContent = "Connected. Automatic background timing can vary with Android power and device policies.";
        }
        nativeHealthConnect.addEventListener("click", () => {
            nativeHealthStatus.textContent = nativeHealthConnected ? "Syncing health data…" : "Opening health permissions…";
            if (isNativeAndroidApp && nativeHealthConnected
                && typeof nativeAndroidBridge.syncHealthDataNow === "function") {
                nativeAndroidBridge.syncHealthDataNow();
            } else if (isNativeAndroidApp
                && typeof nativeAndroidBridge.requestHealthPermissions === "function") {
                nativeAndroidBridge.requestHealthPermissions();
            } else {
                nativeAndroidBridge.requestHealthData(isoFromUTC(todayUTC()));
            }
        });
        if (isNativeAndroidApp && nativeHealthAutoSync
            && typeof nativeAndroidBridge.startAutomaticHealthSync === "function"
            && typeof nativeAndroidBridge.getHealthSyncStatus === "function") {
            nativeHealthAutoSync.addEventListener("click", () => {
                nativeHealthAutomaticEnabled = !nativeHealthAutomaticEnabled;
                nativeAndroidBridge.startAutomaticHealthSync(nativeHealthAutomaticEnabled);
                nativeHealthAutoSync.setAttribute("aria-pressed", String(nativeHealthAutomaticEnabled));
                nativeHealthAutoSync.textContent = nativeHealthAutomaticEnabled
                    ? "Turn automatic sync off"
                    : "Turn automatic sync on";
            });
            window.__lifeTrackUpdateHealthSyncStatus = (status) => {
                if (!status || typeof status !== "object") return;
                nativeHealthAutomaticEnabled = status.automaticSyncEnabled === true;
                nativeHealthConnected = nativeHealthAutomaticEnabled
                    || (status.permissions && status.permissions.anyHealthData === true);
                nativeHealthAutoSync.setAttribute("aria-pressed", String(nativeHealthAutomaticEnabled));
                nativeHealthAutoSync.textContent = nativeHealthAutomaticEnabled
                    ? "Turn automatic sync off"
                    : "Turn automatic sync on";
                if (status.permissions) {
                    const permissions = status.permissions;
                    nativeHealthPermissionStatus.textContent = [
                        `Steps ${permissions.steps ? "allowed" : "not allowed"}`,
                        `Sleep ${permissions.sleep ? "allowed" : "not allowed"}`,
                        `Health Connect exercise ${permissions.exercise ? "allowed" : "not allowed"}`,
                        `Active calories ${permissions.activeCalories ? "allowed" : "not allowed"}`,
                        `Activity ${permissions.activityRecognition ? "allowed" : "not allowed"}`,
                        `Notifications ${permissions.notifications ? "allowed" : "off"}`
                    ].join(" · ");
                    nativeHealthBackgroundStatus.textContent = !status.backgroundAvailable
                        ? "Health Connect background reads are unavailable on this device."
                        : permissions.background
                            ? "Background read permission is allowed."
                            : "Allow Health Connect background read permission for scheduled sync.";
                }
                const formatTime = (value) => {
                    const timestamp = Number(value);
                    return Number.isFinite(timestamp) && timestamp > 0
                        ? new Date(timestamp).toLocaleString()
                        : "Not yet";
                };
                nativeHealthLastSuccess.textContent = `Last successful sync: ${formatTime(status.lastSuccessfulAt)}`;
                nativeHealthNextSync.textContent = nativeHealthAutomaticEnabled
                    ? `Next sync estimate: ${formatTime(status.nextSyncEstimateAt)} (Android may delay it).`
                    : "Next scheduled sync: off.";
                nativeHealthLatestData.textContent = `Latest health data: ${formatTime(status.latestHealthDataAt)} · ${Number(status.pendingUploads) || 0} upload(s) waiting`;
                if (typeof status.error === "string" && status.error) {
                    nativeHealthStatus.textContent = status.error;
                } else if (status.status === "drive_sync_complete") {
                    nativeHealthStatus.textContent = "Health data was saved to your LifeTrack Google Drive.";
                } else if (status.status === "local_sync_complete") {
                    nativeHealthStatus.textContent = "Health data was saved on this phone; Drive upload may still be pending.";
                } else if (status.status === "waiting_for_google_sign_in") {
                    nativeHealthStatus.textContent = "Health data is saved on this phone. Connect Google Drive to sync it to your PC.";
                }
            };
            try {
                const status = JSON.parse(nativeAndroidBridge.getHealthSyncStatus());
                window.__lifeTrackUpdateHealthSyncStatus(status);
                nativeAndroidBridge.checkHealthPermissions();
            } catch (error) {
                nativeHealthStatus.textContent = "Health sync status could not be loaded. Reopen LifeTrack and try again.";
            }
        }

    }
    if (hasDeviceFocusBridge) {
        deviceFocusSettings.hidden = false;
        deviceFocusPermission.addEventListener("click", () => {
            deviceFocusStatus.textContent = "Opening Android Usage Access settings…";
            nativeAndroidBridge.openDeviceFocusSettings();
        });
        window.__lifeTrackUpdateDeviceFocusUsage = (result) => {
            if (!result || typeof result !== "object") return;
            if (result.error) {
                deviceFocusStatus.textContent = result.error;
                return;
            }
            deviceFocusPermissionGranted = result.permission === true;
            deviceFocusPermission.textContent = deviceFocusPermissionGranted
                ? "Device usage access is enabled"
                : "Allow device usage access";
            deviceFocusStatus.textContent = deviceFocusPermissionGranted
                ? "Access is on. LifeTrack reads only total minutes in other apps; Android does not provide a Focus-specific Health Connect permission."
                : result.restrictedSettingsMayBeRequired
                    ? "Android blocked this restricted access. In LifeTrack app info, tap ⋮ > Allow restricted settings, then return and enable Usage Access."
                    : "Allow Usage Access in Android settings to show today's device-usage total.";
            const date = typeof result.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(result.date)
                ? result.date
                : isoFromUTC(todayUTC());
            const minutes = Number(result.minutes);
            if (deviceFocusPermissionGranted && Number.isFinite(minutes) && minutes >= 0) {
                const entry = fitness[date] || (fitness[date] = {});
                const roundedMinutes = Math.round(minutes);
                if (entry.deviceFocusMinutes !== roundedMinutes
                    || entry.src_deviceFocus !== "android-usage") {
                    entry.deviceFocusMinutes = roundedMinutes;
                    entry.src_deviceFocus = "android-usage";
                    saveFit();
                }
            }
            renderStats();
        };
        window.refreshDeviceFocusUsage = () => {
            try {
                window.__lifeTrackUpdateDeviceFocusUsage(
                    JSON.parse(nativeAndroidBridge.getDeviceFocusUsage())
                );
            } catch (error) {
                deviceFocusStatus.textContent = "Device usage could not be read. Check Android Usage Access and reopen LifeTrack.";
                console.error("LifeTrack could not refresh device Focus usage.", error);
            }
        };
        window.addEventListener("focus", window.refreshDeviceFocusUsage);
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") window.refreshDeviceFocusUsage();
        });
        window.setInterval(() => {
            if (document.visibilityState === "visible") window.refreshDeviceFocusUsage();
        }, 60_000);
        window.setTimeout(window.refreshDeviceFocusUsage, 0);
    }

    function canStartPullRefresh(target, clientY, isMouse) {
        if (window.scrollY > 0 || (isMouse && clientY > 96)) return false;
        if (!(target instanceof Element)) return false;
        if (target.closest("a, button, input, select, textarea, [contenteditable='true'], [role='button'], .sidebar, .dashboard-settings-menu, .profile-menu")) {
            return false;
        }
        for (let element = target; element && element !== document.body; element = element.parentElement) {
            const overflowY = getComputedStyle(element).overflowY;
            if (["auto", "scroll", "overlay"].includes(overflowY) && element.scrollHeight > element.clientHeight + 1) {
                return false;
            }
        }
        return true;
    }

    function updatePullRefresh(distance) {
        pullRefreshDistance = distance;
        const offset = Math.min(150, distance * 0.9);
        pullRefreshIndicator.style.setProperty("--pull-offset", `${offset}px`);
        pullRefreshIndicator.classList.add("is-visible");
        pullRefreshIndicator.setAttribute("aria-hidden", "false");
        pullRefreshLabel.textContent = "Pull down to refresh";
    }

    function resetPullRefresh() {
        touchPullStart = null;
        clearTimeout(wheelPullTimer);
        wheelPullTimer = null;
        wheelPullDistance = 0;
        pullRefreshDistance = 0;
        if (pullRefreshReloading) return;
        pullRefreshIndicator.classList.remove("is-visible");
        pullRefreshIndicator.style.removeProperty("--pull-offset");
        pullRefreshIndicator.setAttribute("aria-hidden", "true");
    }

    function triggerPullRefresh() {
        if (pullRefreshDistance < pullRefreshThreshold || pullRefreshReloading) {
            resetPullRefresh();
            return;
        }
        pullRefreshReloading = true;
        touchPullStart = null;
        clearTimeout(wheelPullTimer);
        wheelPullTimer = null;
        pullRefreshIndicator.classList.add("is-refreshing");
        pullRefreshIndicator.style.setProperty("--pull-offset", "92px");
        pullRefreshLabel.textContent = "Refreshing…";
        window.setTimeout(() => window.location.reload(), 10);
    }

    document.addEventListener("touchstart", (event) => {
        if (event.touches.length !== 1 || pullRefreshReloading) return;
        const touch = event.touches[0];
        if (!canStartPullRefresh(event.target, touch.clientY, false)) return;
        touchPullStart = { x: touch.clientX, y: touch.clientY };
    }, { passive: true });

    document.addEventListener("touchmove", (event) => {
        if (!touchPullStart || event.touches.length !== 1) return;
        const touch = event.touches[0];
        const deltaY = touch.clientY - touchPullStart.y;
        const deltaX = touch.clientX - touchPullStart.x;
        if (deltaY < 8 || Math.abs(deltaX) > Math.abs(deltaY)) {
            if (deltaY < 0 || Math.abs(deltaX) > Math.abs(deltaY)) resetPullRefresh();
            return;
        }
        if (event.cancelable) event.preventDefault();
        updatePullRefresh(deltaY);
    }, { passive: false });

    document.addEventListener("touchend", triggerPullRefresh, { passive: true });
    document.addEventListener("touchcancel", resetPullRefresh, { passive: true });

    document.addEventListener("wheel", (event) => {
        if (pullRefreshReloading) return;
        if (event.deltaY >= 0 || window.scrollY > 0 || !canStartPullRefresh(event.target, event.clientY, false)) {
            if (wheelPullDistance) {
                clearTimeout(wheelPullTimer);
                wheelPullTimer = null;
                wheelPullDistance = 0;
                if (!touchPullStart) resetPullRefresh();
            }
            return;
        }
        const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? 16
            : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? window.innerHeight : 1;
        wheelPullDistance += -event.deltaY * deltaScale;
        updatePullRefresh(wheelPullDistance);
        clearTimeout(wheelPullTimer);
        wheelPullTimer = window.setTimeout(() => {
            wheelPullTimer = null;
            triggerPullRefresh();
        }, 10);
    }, { passive: true });

    const monthNames = Array.from(monthSelect.options).map((option) => option.textContent);
    let habits = JSON.parse(store.get("habits")) || [
        "Wake up early",
        "Workout",
        "Read",
        "Meditation",
        "No junk food"
    ];
    let dailyTaskState = JSON.parse(store.get("daily-task") || "null");
    let deletedHabits = JSON.parse(store.get("deleted-habits") || "{}");
    let checks = JSON.parse(store.get("checks")) || {};
    let habitStarts = JSON.parse(store.get("habit-start") || "{}");
    let bodyProfile = JSON.parse(store.get("body") || "null");
    let readingPlan = JSON.parse(store.get("reading-plan") || "null") || {
        bookIndex: 0, bookId: "atomic-habits", pageCount: 320, currentPage: 0,
        dailyTarget: 10, dailyStart: 1, dailyEnd: 10, dailyDate: "", completedBooks: [],
        customBooks: [], bookProgress: {}
    };
    let editingBody = false;
    let lastLife = null;
    let renderedDay = null;
    let focusDuration = 25;
    let focusRemaining = 25 * 60;
    let focusEndsAt = null;
    let focusSessionDate = null;
    let focusTimerRestored = false;
    let focusInterval = null;
    let focusDurationValid = true;
    let focusAudioContext = null;
    let focusAlarmInterval = null;
    let focusAlarmTimeout = null;
    let focusSoundMuted = localStorage.getItem(`lifetrack:${currentUser.uid}:focus-sound-muted`) === "true";
    let focusLockActive = false;
    let focusLockPlaceholder = null;
    let focusLockInertState = [];
    let nativeFocusLockRequested = false;

    /* ===================== dates + lifetime progress ===================== */

    const DAY_MS = 86400000;

    function todayUTC() {
        const n = new Date();
        return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
    }

    function isoFromUTC(ms) {
        const d = new Date(ms);
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    }

    function utcFromISO(s) {
        const [y, m, d] = s.split("-").map(Number);
        return Date.UTC(y, m - 1, d);
    }

    function keyFor(ms, habit) {
        const d = new Date(ms);
        return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}-${habit}`;
    }

    function fmtDate(ms) {
        return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    }

    // Walks every saved tick (all months, all years) up to today: first tick ever + per-habit counts.
    function scanTicks() {
        const t0 = todayUTC();
        const per = {};
        let first = null;
        Object.keys(checks).forEach((key) => {
            if (!checks[key]) return;
            const m = /^(\d{4})-(\d{1,2})-(\d{1,2})-(.+)$/.exec(key);
            if (!m) return;
            const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
            if (t > t0) return;
            if (first === null || t < first) first = t;
            const rec = per[m[4]] || (per[m[4]] = { first: t, count: 0 });
            if (t < rec.first) rec.first = t;
            rec.count += 1;
        });
        return { per, first };
    }

    // A habit starts counting from the day it was added (or its first tick, whichever is earlier).
    function ensureHabitStarts(scan) {
        let changed = false;
        habits.forEach((habit) => {
            if (!habitStarts[habit]) {
                habitStarts[habit] = isoFromUTC(scan.first !== null ? scan.first : todayUTC());
                changed = true;
            }
        });
        if (changed) saveState();
    }

    function habitStartMs(habit, scan) {
        const t0 = todayUTC();
        let start = habitStarts[habit] ? utcFromISO(habitStarts[habit]) : t0;
        const rec = scan.per[habit];
        if (rec && rec.first < start) start = rec.first;
        return Math.min(start, t0);
    }

    // Lifetime ("overall") progress: every tick since the very first one, across all months and years.
    function computeLifetime() {
        const scan = scanTicks();
        ensureHabitStarts(scan);
        const t0 = todayUTC();
        let ticks = 0;
        let window = 0;
        let recentTicks = 0;
        let recentPossible = 0;
        let todayDone = 0;

        habits.forEach((habit) => {
            const start = habitStartMs(habit, scan);
            const rec = scan.per[habit];
            window += Math.round((t0 - start) / DAY_MS) + 1;
            ticks += rec ? rec.count : 0;
            if (checks[keyFor(t0, habit)]) todayDone += 1;

            for (let i = 0; i < 7; i += 1) {
                const t = t0 - i * DAY_MS;
                if (t < start) break;
                recentPossible += 1;
                if (checks[keyFor(t, habit)]) recentTicks += 1;
            }
        });

        return {
            percent: window ? Math.round((ticks / window) * 100) : 0,
            first: scan.first,
            spanDays: scan.first === null ? 0 : Math.round((t0 - scan.first) / DAY_MS) + 1,
            recent: recentPossible ? Math.round((recentTicks / recentPossible) * 100) : 0,
            todayDone,
            scan
        };
    }

    // Daily target: starts gentle for beginners, rises with lifetime progress + last-7-day consistency.
    function computeDailyTarget(life) {
        const n = habits.length;
        if (!n) return { pct: 0, goal: 0 };
        let raw = 50 + life.percent * 0.4;   // 50% (new) .. 90% (mastered)
        if (life.recent >= 70) raw += 5;      // consistency bonus
        if (life.recent >= 85) raw += 5;
        raw = Math.min(100, raw);
        const goal = Math.min(n, Math.max(1, Math.round((n * raw) / 100)));
        return { pct: Math.round((goal / n) * 100), goal };
    }

    function storageKey(day, habit) {
        return `${yearSelect.value}-${monthSelect.selectedIndex + 1}-${day}-${habit}`;
    }

    function setLiveMonthAndYear() {
        const today = new Date();
        const currentYear = String(today.getFullYear());
        monthSelect.selectedIndex = today.getMonth();
        yearSelect.value = currentYear;
    }

    function saveState() {
        store.set("habits", JSON.stringify(habits));
        store.set("checks", JSON.stringify(checks));
        store.set("habit-start", JSON.stringify(habitStarts));
        store.set("deleted-habits", JSON.stringify(deletedHabits));
    }

    function mergeDeletedHabits(local, remote) {
        const merged = {};
        const merge = (changes) => Object.entries(changes || {}).forEach(([name, value]) => {
            const change = value && typeof value === "object"
                ? { at: Number(value.at) || 0, deleted: Boolean(value.deleted) }
                : { at: Number(value) || 0, deleted: true };
            const previous = merged[name];
            if (!previous || change.at > previous.at) merged[name] = change;
            else if (change.at === previous.at) previous.deleted = previous.deleted || change.deleted;
        });
        merge(remote);
        merge(local);
        return merged;
    }

    function mergeDeletedGoals(local, remote) {
        const merged = {};
        const merge = (changes) => Object.entries(changes || {}).forEach(([id, value]) => {
            if (!id) return;
            const change = value && typeof value === "object"
                ? { at: Number(value.at) || 0, deleted: Boolean(value.deleted) }
                : { at: Number(value) || 0, deleted: true };
            const previous = merged[id];
            if (!previous || change.at > previous.at) merged[id] = change;
            else if (change.at === previous.at) previous.deleted = previous.deleted || change.deleted;
        });
        merge(remote);
        merge(local);
        return merged;
    }

    function mergeHabitNames(local, remote, removed) {
        return Array.from(new Set([...(local || []), ...(remote || [])].map(String)))
            .filter((name) => !(removed[name] && removed[name].deleted));
    }

    function markHabitDeleted(name) {
        const previousAt = deletedHabits[name] && typeof deletedHabits[name] === "object" ? Number(deletedHabits[name].at) || 0 : 0;
        deletedHabits[name] = { at: Math.max(Date.now(), previousAt + 1), deleted: true };
    }

    function restoreHabitName(name) {
        const previousAt = deletedHabits[name] && typeof deletedHabits[name] === "object" ? Number(deletedHabits[name].at) || 0 : 0;
        deletedHabits[name] = { at: Math.max(Date.now(), previousAt + 1), deleted: false };
    }

    function getDaysInSelectedMonth() {
        return new Date(Number(yearSelect.value), monthSelect.selectedIndex + 1, 0).getDate();
    }

    function createCell(tag, text) {
        const cell = document.createElement(tag);
        cell.textContent = text;
        return cell;
    }

    function renderCalendar() {
        const days = getDaysInSelectedMonth();
        const today = new Date();
        const t0 = todayUTC();
        renderedDay = t0;
        const activeSection = document.querySelector(".section.active-section")?.id;
        if (activeSection !== "dashboard") {
            renderStats();
            return;
        }
        const isLiveMonth = today.getMonth() === monthSelect.selectedIndex && today.getFullYear() === Number(yearSelect.value);

        calendarHead.innerHTML = "";
        habitBody.innerHTML = "";

        const headerRow = document.createElement("tr");
        headerRow.appendChild(createCell("th", `${monthNames[monthSelect.selectedIndex]} Habits`));

        let todayTh = null;
        for (let day = 1; day <= days; day += 1) {
            const th = createCell("th", day);
            if (isLiveMonth && day === today.getDate()) {
                th.classList.add("today-cell");
                todayTh = th;
            }
            headerRow.appendChild(th);
        }

        calendarHead.appendChild(headerRow);

        habits.forEach((habit, habitIndex) => {
            const row = document.createElement("tr");
            row.dataset.habitIndex = String(habitIndex);
            const nameCell = createCell("td", habit);
            nameCell.tabIndex = 0;
            nameCell.dataset.habitIndex = String(habitIndex);
            nameCell.setAttribute("aria-label", `${habit}. Hold and drag to reorder, or double-click and use the up/down arrow keys.`);
            row.appendChild(nameCell);

            for (let day = 1; day <= days; day += 1) {
                const cell = document.createElement("td");
                if (isLiveMonth && day === today.getDate()) cell.classList.add("today-cell");

                // only past days and today can be ticked; anything after today stays locked
                const cellUTC = Date.UTC(Number(yearSelect.value), monthSelect.selectedIndex, day);
                const locked = cellUTC > t0;

                const label = document.createElement("label");
                label.className = "habit-box" + (locked ? " locked" : "");
                label.title = locked
                    ? "Future day: locked"
                    : `${habit} · ${day} ${monthNames[monthSelect.selectedIndex]}`;

                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                checkbox.className = "habit-check";
                checkbox.checked = !locked && Boolean(checks[storageKey(day, habit)]);
                checkbox.disabled = locked;
                checkbox.setAttribute("aria-label", `${habit}, ${monthNames[monthSelect.selectedIndex]} ${day}${locked ? " (locked)" : ""}`);

                const box = document.createElement("span");
                box.className = "box";
                box.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>';

    let recentCheckinTimes = [];
    function checkHabitIntegrityRate() {
        const now = Date.now();
        recentCheckinTimes = recentCheckinTimes.filter((t) => now - t < 1500);
        recentCheckinTimes.push(now);
        if (recentCheckinTimes.length >= 4) {
            toast("⚠️ Integrity Guard: Multiple habits checked in 1 second. Please track habits as you genuinely complete them.");
        }
    }

                checkbox.addEventListener("change", () => {
                    if (locked) {
                        checkbox.checked = false;
                        return;
                    }
                    if (checkbox.checked) checkHabitIntegrityRate();
                    if (habit.toLowerCase() === "read" && checkbox.checked && cellUTC === t0) {
                        if (readingPlan.currentPage < readingPlan.dailyEnd) {
                            checkbox.checked = false;
                            toast(`Read pages ${readingPlan.dailyStart}-${readingPlan.dailyEnd} before completing this habit.`);
                            return;
                        }
                        completeReadingGoal();
                        renderStats();
                        renderCalendar();
                        return;
                    }
                    checks[storageKey(day, habit)] = checkbox.checked;
                    if (checkbox.checked) {
                        box.classList.remove("pop");
                        void box.offsetWidth;
                        box.classList.add("pop");
                    }
                    saveState();
                    renderStats();
                });

                label.appendChild(checkbox);
                label.appendChild(box);
                cell.appendChild(label);
                row.appendChild(cell);
            }

            habitBody.appendChild(row);
        });

        renderStats();
        scrollIntoViewCentered(tableWrapper, todayTh);
    }

    function scrollIntoViewCentered(wrapper, el) {
        if (!wrapper || !el) return;
        const doScroll = () => {
            const target = el.offsetLeft - (wrapper.clientWidth / 2) + (el.offsetWidth / 2);
            wrapper.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
        };
        requestAnimationFrame(() => requestAnimationFrame(doScroll));
        // fonts/images can settle sizes a beat late on first paint — nudge again once things are fully loaded
        window.addEventListener("load", doScroll, { once: true });
    }

    /* ===================== reusable inline graphics ===================== */

    // Circular progress ring. Returns an <svg> string; the stroke animates in
    // via CSS once .ring-progress gets its real stroke-dashoffset (see animateRings).
    function ringSVG(percent, opts) {
        const size = (opts && opts.size) || 96;
        const stroke = (opts && opts.stroke) || 9;
        const color = (opts && opts.color) || "var(--primary)";
        const clamped = Math.max(0, Math.min(100, percent));
        const r = (size - stroke) / 2;
        const c = 2 * Math.PI * r;
        const offset = c * (1 - clamped / 100);
        const mid = size / 2;
        const fontSize = Math.round(size * 0.22);
        const centerText = opts && opts.text != null ? esc(opts.text) : `${Math.round(clamped)}%`;
        const ariaLabel = opts && opts.ariaLabel ? esc(opts.ariaLabel) : `${Math.round(clamped)}% complete`;
        const icon = opts && opts.icon
            ? `<g class="ring-icon" aria-hidden="true" style="color:${color}" transform="translate(${mid - 9} ${mid - 24})">${{
                shoe: '<path d="M3 12c2.5-.2 4.2-1.4 5.2-4l1.8 1.5c1.4 1.1 2.9 1.7 4.7 2l2.3.4v3.3H3z"/><path d="M6 14h1m2 0h1m2 0h1"/>',
                water: '<path d="M9 1.5S3.5 8 3.5 11.8a5.5 5.5 0 0 0 11 0C14.5 8 9 1.5 9 1.5z"/><path d="M6.5 12a2.5 2.5 0 0 0 2.5 2.5"/>',
                sleep: '<text class="ring-icon-text" x="1" y="11" font-size="13" font-weight="800">Z</text><text class="ring-icon-text" x="11" y="8" font-size="9" font-weight="800">z</text><text class="ring-icon-text" x="18" y="5" font-size="6" font-weight="800">z</text>',
                focus: '<circle cx="9" cy="9" r="7"/><circle cx="9" cy="9" r="3"/><path d="M9 0v3m0 12v3M0 9h3m12 0h3"/>',
                flame: '<path d="M10 1c1 4-3 5-2 8 1-1 2-2 2-3 4 3 5 6 3 9-2 3-7 2-8-1-1-3 1-5 3-7 0 2 1 2 2 3C12 6 9 4 10 1z"/>',
                distance: '<path d="M9 17s6-6.2 6-10A6 6 0 0 0 3 7c0 3.8 6 10 6 10z"/><circle cx="9" cy="7" r="2"/>'
            }[opts.icon] || ""}</g>`
            : "";
        return `<svg class="ring-svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${ariaLabel}">
            <circle class="ring-track" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}"></circle>
            <circle class="ring-progress" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}" stroke="${color}"
                stroke-dasharray="${c}" stroke-dashoffset="${c}" data-offset="${offset}"
                transform="rotate(-90 ${mid} ${mid})"></circle>
            ${icon}
            <text class="ring-text" x="${mid}" y="${icon ? mid + 10 : mid}" text-anchor="middle" dominant-baseline="central" font-size="${icon ? Math.round(fontSize * 0.82) : fontSize}">${centerText}</text>
        </svg>`;
    }

    // Kicks the just-inserted rings from 0 -> their real offset so the stroke sweeps in.
    function animateRings(container) {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                container.querySelectorAll(".ring-progress[data-offset]").forEach((circle) => {
                    circle.style.strokeDashoffset = circle.dataset.offset;
                });
            });
        });
    }

    // Colour zones for the Overall Progress dial (0-25 red, 25-50 orange, 50-75 yellow, 75-100 green).
    const GAUGE_ZONES = [
        { key: "red",    from: 0,  to: 25,  label: "Needs Focus",   msg: "Just getting started. Tick off one habit today." },
        { key: "orange", from: 25, to: 50,  label: "Keep Pushing",  msg: "You're moving. Stay consistent." },
        { key: "yellow", from: 50, to: 75,  label: "Good Progress", msg: "Solid work. Don't break the chain." },
        { key: "green",  from: 75, to: 100, label: "Excellent!",    msg: "Outstanding discipline. Keep it up!" }
    ];

    function getGaugeZone(percent) {
        const p = Math.max(0, Math.min(100, percent));
        if (p >= 75) return GAUGE_ZONES[3];
        if (p >= 50) return GAUGE_ZONES[2];
        if (p >= 25) return GAUGE_ZONES[1];
        return GAUGE_ZONES[0];
    }

    // Semi-circle "dial" gauge with a swinging needle. 0% = far left (horizontal), 50% = straight up, 100% = far right.
    function gaugeSVG(percent, muted) {
        const clamped = Math.max(0, Math.min(100, percent));
        const w = 220;
        const h = 150;
        const cx = w / 2;
        const cy = 108;
        const r = 88;
        const stroke = 16;
        const gap = 2; // degrees of gap between colour zones

        // point on the dial: 0% -> 180deg (left), 100% -> 360deg (right), sweeping over the top
        const pt = (pct, radius) => {
            const rad = ((180 + (pct / 100) * 180) * Math.PI) / 180;
            return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
        };
        const gapPct = (gap / 180) * 100;

        let dim = "";
        let bright = "";
        GAUGE_ZONES.forEach((zone, i) => {
            const a = pt(zone.from + (i === 0 ? 0 : gapPct / 2), r);
            const b = pt(zone.to - (i === GAUGE_ZONES.length - 1 ? 0 : gapPct / 2), r);
            const d = `M ${a[0].toFixed(2)} ${a[1].toFixed(2)} A ${r} ${r} 0 0 1 ${b[0].toFixed(2)} ${b[1].toFixed(2)}`;
            const fill = Math.max(0, Math.min(1, (clamped - zone.from) / (zone.to - zone.from)));
            dim += `<path class="gauge-zone-dim zone-${zone.key}" d="${d}" stroke-width="${stroke}"></path>`;
            bright += `<path class="gauge-zone zone-${zone.key}" d="${d}" stroke-width="${stroke}" pathLength="100"
                stroke-dasharray="100" stroke-dashoffset="100" data-offset="${(100 * (1 - fill)).toFixed(2)}" style="transition-delay:${i * 180}ms"></path>`;
        });

        const needleLen = r - stroke - 2;
        const tip = pt(clamped, needleLen);
        const zone = getGaugeZone(clamped);
        return `<svg class="gauge-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${Math.round(clamped)}% overall progress: ${zone.label}">
            ${dim}
            ${bright}
            <line class="gauge-needle" x1="${cx}" y1="${cy}" x2="${cx - needleLen}" y2="${cy}" data-x2="${tip[0].toFixed(2)}" data-y2="${tip[1].toFixed(2)}"></line>
            <circle class="gauge-pivot" cx="${cx}" cy="${cy}" r="6"></circle>
            <text class="gauge-value ${muted ? "zone-text-none" : `zone-text-${zone.key}`}" x="${cx}" y="${cy + 34}" text-anchor="middle">${Math.round(clamped)}%</text>
        </svg>`;
    }

    function animateGauge(container) {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                container.querySelectorAll(".gauge-zone[data-offset]").forEach((seg) => {
                    seg.style.strokeDashoffset = seg.dataset.offset;
                });
                const needle = container.querySelector(".gauge-needle[data-x2]");
                if (needle) {
                    needle.setAttribute("x2", needle.dataset.x2);
                    needle.setAttribute("y2", needle.dataset.y2);
                }
            });
        });
    }

    // Smooth-ish line + gradient-fill area chart. `values` is one number per day;
    // `max` sets the top of the y-axis (defaults to the highest value, min 1).
    /* ======================================================================= */

    function renderStats() {
        const days = getDaysInSelectedMonth();
        const total = habits.length * days;
        let completed = 0;
        const dailyTotals = Array.from({ length: days }, () => 0);

        habits.forEach((habit) => {
            for (let day = 1; day <= days; day += 1) {
                if (checks[storageKey(day, habit)]) {
                    completed += 1;
                    dailyTotals[day - 1] += 1;
                }
            }
        });

        const percent = total ? Math.round((completed / total) * 100) : 0;
        habitCount.textContent = habits.length;
        completedCount.innerHTML = `${completed}<span class="stat-total"> / ${total}</span>`;

        const life = computeLifetime();
        lastLife = life;
        ctx = buildContext(life);
        const habitCompletionToday = document.getElementById("habitCompletionToday");
        if (habitCompletionToday) {
            habitCompletionToday.textContent = habits.length
                ? `${life.todayDone}/${habits.length} completed today`
                : "No active habits";
        }
        const activeSection = document.querySelector(".section.active-section")?.id;
        if (activeSection === "dashboard") {
            renderDailyTask();
            renderLifeScore(life);
            renderProgressGauge(percent);
            renderHabitLegend();
            renderCompletedCard(dailyTotals);
            renderDailyChart(dailyTotals);
            renderExerciseChart();
            renderFocusTimer();
            renderDailyReminder(life);
            renderGoalAnalysis(percent, life);
            renderWeekStrip();
            renderRadarsAndStreaks();
            syncStreakPanelHeight();
            renderFitness();
            renderBadges();
        } else if (activeSection === "habits") {
            renderManageList();
        } else if (activeSection === "goals") {
            renderGoalsPage();
        } else if (activeSection === "analytics") {
            renderAnalytics(percent, completed, total, dailyTotals);
        }
    }

    function lifeScoreCategoryValues(life) {
        const scores = {};
        if (habits.length) {
            const done = habits.reduce((count, habit) => count + (checks[keyFor(todayUTC(), habit)] ? 1 : 0), 0);
            scores.habits = (done / habits.length) * 100;
        }

        const today = isoFromUTC(todayUTC());
        const now = new Date();
        const measuredGoals = goals
            .filter((goal) => goal && typeof goal === "object")
            .map((goal) => goalStats(goal, now.getFullYear(), now.getMonth()))
            .filter((stats) => stats.possible > 0 && !stats.missing);
        if (measuredGoals.length) {
            scores.goals = measuredGoals.reduce((sum, stats) => sum + stats.ratio, 0) / measuredGoals.length;
        }

        const todayFitness = fitness[today] && typeof fitness[today] === "object" ? fitness[today] : {};
        if (Object.prototype.hasOwnProperty.call(todayFitness, "focusMinutes")
            && Number.isFinite(Number(todayFitness.focusMinutes))
            && Number(todayFitness.focusMinutes) >= 0) {
            scores.focus = clamp((Number(todayFitness.focusMinutes) / 30) * 100, 0, 100);
        }

        const targets = dailyTargets(life);
        const wellnessValues = [];
        [
            ["steps", targets.steps],
            ["water", targets.water],
            ["sleep", targets.sleep]
        ].forEach(([field, target]) => {
            const value = field === "sleep" ? normalizeHealthSleepHours(todayFitness[field]) : todayFitness[field];
            if (typeof value === "number" && Number.isFinite(value) && value >= 0 && target > 0) {
                wellnessValues.push(clamp((value / target) * 100, 0, 100));
            }
        });
        const mood = todayFitness.mood;
        if (typeof mood === "number" && Number.isFinite(mood) && mood >= 1 && mood <= 5) {
            wellnessValues.push((mood / 5) * 100);
        }
        if (wellnessValues.length) {
            scores.wellness = wellnessValues.reduce((sum, value) => sum + value, 0) / wellnessValues.length;
        }

        if (dailyTaskState && dailyTaskState.date === today && dailyTaskState.completed === true) {
            scores.task = 100;
        }
        return scores;
    }

    function renderLifeScore(life) {
        const value = document.getElementById("lifeScoreValue");
        const summary = document.getElementById("lifeScoreSummary");
        const breakdown = document.getElementById("lifeScoreBreakdown");
        if (!value || !summary || !breakdown) return;

        const scores = lifeScoreCategoryValues(life);
        const result = calculateWeightedLifeScore(scores, lifeScoreWeights);
        value.textContent = result.score === null ? "—" : String(result.score);
        summary.textContent = result.score === null
            ? "Add a habit or log data to begin."
            : `${result.scoredCategories} of ${LIFE_SCORE_CATEGORIES.length} categories counted today.`;

        const labels = {
            habits: "Habits",
            goals: "Goals",
            focus: "Focus",
            wellness: "Wellness",
            task: "Daily task"
        };
        breakdown.innerHTML = LIFE_SCORE_CATEGORIES.map((category) => {
            const score = scores[category];
            const included = Number(lifeScoreWeights[category]) > 0 && Number.isFinite(score);
            const contribution = included
                ? (result.contributions[category] || 0).toFixed(1)
                : null;
            const status = included
                ? `${Math.round(score)}% · +${contribution} pts`
                : Number(lifeScoreWeights[category]) <= 0
                    ? "Excluded by weight"
                    : category === "task"
                        ? "Optional · not completed"
                        : "No data · not counted";
            return `<div class="life-score-row">
                <div class="life-score-row-label"><span>${labels[category]}</span><strong>${status}</strong></div>
                <div class="life-score-track" role="progressbar" aria-label="${labels[category]} score" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${included ? Math.round(score) : 0}"><span style="width:${included ? clamp(score, 0, 100) : 0}%"></span></div>
            </div>`;
        }).join("");
    }

    function updateLifeScoreWeights(persist) {
        const inputs = Array.from(document.querySelectorAll("[data-score-weight]"));
        const nextWeights = {};
        inputs.forEach((input) => {
            nextWeights[input.dataset.scoreWeight] = Number(input.value);
        });
        if (!Object.values(nextWeights).some((weight) => weight > 0)) {
            if (persist) {
                LIFE_SCORE_CATEGORIES.forEach((category) => {
                    const input = document.querySelector(`[data-score-weight="${category}"]`);
                    if (input) input.value = String(lifeScoreWeights[category]);
                    const output = document.getElementById(`lifeScoreWeight${category[0].toUpperCase()}${category.slice(1)}Value`);
                    if (output) output.value = `${lifeScoreWeights[category]}%`;
                });
                toast("Keep at least one Life Score category above zero.");
            }
            return;
        }

        lifeScoreWeights = normalizeLifeScoreWeights(nextWeights);
        LIFE_SCORE_CATEGORIES.forEach((category) => {
            const output = document.getElementById(`lifeScoreWeight${category[0].toUpperCase()}${category.slice(1)}Value`);
            if (output) output.value = `${lifeScoreWeights[category]}%`;
        });
        if (persist) {
            localStorage.setItem(`${NS}life-score-weights`, JSON.stringify(lifeScoreWeights));
        }
        if (lastLife) renderLifeScore(lastLife);
    }

    function syncStreakPanelHeight() {
        const tracker = document.querySelector(".habit-panel");
        const streakPanel = document.querySelector(".streak-panel");
        if (!tracker || !streakPanel) return;
        streakPanel.style.height = `${tracker.getBoundingClientRect().height}px`;
    }

    window.addEventListener("resize", syncStreakPanelHeight, { passive: true });

    // Overall Progress = the selected month only. It starts from 0% on the 1st of every month.
    function renderProgressGauge(percent) {
        const year = Number(yearSelect.value);
        const monthIdx = monthSelect.selectedIndex;
        const t0 = todayUTC();
        const monthStart = Date.UTC(year, monthIdx, 1);
        const monthDays = getDaysInSelectedMonth();
        const monthEnd = Date.UTC(year, monthIdx, monthDays);
        const started = monthStart <= t0;

        const gaugeEl = document.getElementById("progressGauge");
        gaugeEl.innerHTML = gaugeSVG(percent, !started);
        animateGauge(gaugeEl);

        const feedback = document.getElementById("progressFeedback");
        if (!feedback) return;

        const label = `${monthNames[monthIdx]} ${year}`;
        if (!started) {
            feedback.innerHTML = `<strong class="gauge-feedback-title zone-text-none">Upcoming</strong><span>This month hasn't started yet.</span><small class="gauge-since">${label}</small>`;
            return;
        }
        const zone = getGaugeZone(percent);
        const sub = monthEnd < t0
            ? `${label} · final result`
            : `${label} · day ${Math.round((t0 - monthStart) / DAY_MS) + 1} of ${monthDays} · resets next month`;
        feedback.innerHTML = `<strong class="gauge-feedback-title zone-text-${zone.key}">${zone.label}</strong><span>${zone.msg}</span><small class="gauge-since">${sub}</small>`;
    }

    /* ===================== daily reminder (body + progress based) ===================== */

    const TIERS = [
        { name: "Easy",     rounds: 2, rest: 60, steps: 5000 },
        { name: "Easy–Mid", rounds: 3, rest: 45, steps: 7000 },
        { name: "Hard–Mid", rounds: 3, rest: 40, steps: 9000 },
        { name: "Hard",     rounds: 4, rest: 30, steps: 11000 }
    ];

    const WORKOUTS = {
        recovery: { title: "Active Recovery", pool: [
            { n: "Easy walk", u: "min", v: [15, 20, 25, 30] },
            { n: "Hamstring stretch (each leg)", u: "sec", v: [20, 25, 30, 40] },
            { n: "Neck & shoulder rolls", u: "reps", v: [8, 10, 12, 15] },
            { n: "Deep breathing", u: "min", v: [3, 5, 5, 8] },
            { n: "Hip opener stretch (each side)", u: "sec", v: [20, 25, 30, 40] }
        ] },
        upper: { title: "Upper Body", pool: [
            { n: "Push-ups", low: "Incline push-ups (wall or table)", u: "reps", v: [6, 10, 15, 22] },
            { n: "Chair dips", u: "reps", v: [6, 10, 14, 20] },
            { n: "Plank shoulder taps", low: "Knee plank shoulder taps", u: "reps", v: [8, 14, 20, 30] },
            { n: "Superman hold", u: "sec", v: [15, 20, 30, 40] },
            { n: "Arm circles", u: "reps", v: [20, 30, 40, 50] }
        ] },
        lower: { title: "Lower Body", pool: [
            { n: "Bodyweight squats", u: "reps", v: [10, 15, 22, 30] },
            { n: "Reverse lunges (each leg)", low: "Supported split squats (each leg)", u: "reps", v: [6, 8, 12, 16] },
            { n: "Glute bridges", u: "reps", v: [10, 15, 20, 28] },
            { n: "Wall sit", u: "sec", v: [20, 30, 45, 60] },
            { n: "Calf raises", u: "reps", v: [15, 20, 28, 36] }
        ] },
        core: { title: "Core & Mobility", pool: [
            { n: "Plank", u: "sec", v: [15, 25, 40, 60] },
            { n: "Dead bug (each side)", u: "reps", v: [6, 8, 12, 16] },
            { n: "Bicycle crunches", u: "reps", v: [10, 16, 24, 32] },
            { n: "Leg raises", low: "Bent-knee leg raises", u: "reps", v: [6, 10, 14, 20] },
            { n: "Cat-cow stretch", u: "reps", v: [8, 10, 12, 12] }
        ] },
        cardio: { title: "Cardio", pool: [
            { n: "Brisk walk", u: "min", v: [15, 20, 30, 40] },
            { n: "Jumping jacks", low: "Step jacks (no jumping)", u: "reps", v: [20, 30, 45, 60] },
            { n: "High knees", low: "Marching in place", u: "sec", v: [20, 30, 40, 60] },
            { n: "Shadow boxing", u: "sec", v: [30, 45, 60, 90] },
            { n: "Skipping or stair climb", low: "Slow stair climb", u: "min", v: [3, 5, 8, 12] }
        ] },
        full: { title: "Full Body", pool: [
            { n: "Burpees", low: "Squat, then step-back plank", u: "reps", v: [4, 6, 10, 15] },
            { n: "Mountain climbers", low: "Slow mountain climbers", u: "sec", v: [15, 20, 30, 45] },
            { n: "Squat to press (use a water bottle)", u: "reps", v: [8, 12, 16, 20] },
            { n: "Push-ups", low: "Incline push-ups (wall or table)", u: "reps", v: [6, 10, 15, 22] },
            { n: "Glute bridges", u: "reps", v: [10, 15, 20, 28] }
        ] }
    };

    // Sunday .. Saturday
    const WEEK_PLAN = ["recovery", "upper", "lower", "cardio", "core", "full", "cardio"];

    const LEVEL_MSG = [
        "Building your base. Keep today light and doable.",
        "Getting stronger. A little more effort than before.",
        "You're consistent. Time to push a bit harder.",
        "Top level. Full intensity, but respect recovery."
    ];

    const DAILY_TIPS = [
        "Drink a glass of water right after waking up.",
        "Take a 5-minute walk after meals. It helps digestion and focus.",
        "Keep your phone away from bed for the last 30 minutes before sleep.",
        "Add protein and vegetables to at least two meals today.",
        "If you sit for long, stand up and stretch every hour.",
        "10 minutes of morning sunlight helps you sleep better at night.",
        "Plan tomorrow's habits tonight. It takes 2 minutes.",
        "Never skip the warm-up. 5 minutes saves you from injuries.",
        "Sleep is when your body actually recovers. Protect 7 to 8 hours.",
        "Don't compare your day 1 with someone else's day 500.",
        "Swap one sugary drink for water or plain tea today.",
        "Posture check: shoulders back, chin level, feet flat.",
        "A 10-minute workout beats a skipped workout. Small wins count.",
        "Eat one meal today slowly and without screens."
    ];

    const READING_BOOKS = [
        { id: "atomic-habits", title: "Atomic Habits", author: "James Clear", focus: "Build consistency with small daily systems.", pages: 320 },
        { id: "deep-work", title: "Deep Work", author: "Cal Newport", focus: "Practice focus and protect your attention.", pages: 304 },
        { id: "scout-mindset", title: "The Scout Mindset", author: "Julia Galef", focus: "Stay curious and examine ideas clearly.", pages: 288 },
        { id: "thinking-fast-slow", title: "Thinking, Fast and Slow", author: "Daniel Kahneman", focus: "Explore judgment and decision-making.", pages: 512 },
        { id: "mindset", title: "Mindset", author: "Carol S. Dweck", focus: "Learn how practice and feedback shape growth.", pages: 320 },
        { id: "seven-habits", title: "The 7 Habits of Highly Effective People", author: "Stephen R. Covey", focus: "Build deliberate routines and personal responsibility.", pages: 384 },
        { id: "make-it-stick", title: "Make It Stick", author: "Peter C. Brown, Henry L. Roediger III, and Mark A. McDaniel", focus: "Use evidence-based strategies for learning.", pages: 336 }
    ];

    function completeReadingGoal() {
        const book = prepareReadingDay();
        const today = isoFromUTC(todayUTC());
        const completedBookId = readingPlan.goalCompletedBookId;
        if (readingPlan.goalCompletedDate === today
            && (completedBookId
                ? completedBookId === book.id
                : readingPlan.currentPage < readingPlan.pageCount)) return null;
        if (readingPlan.currentPage < readingPlan.dailyEnd) return null;
        const finishedBook = readingPlan.currentPage >= readingPlan.pageCount;
        if (finishedBook) {
            const completedAt = Date.now();
            readingPlan.bookProgress[book.id] = {
                page: readingPlan.currentPage,
                pageCount: readingPlan.pageCount,
                updatedAt: completedAt
            };
            if (book.fileId) book.currentPage = readingPlan.currentPage;
            readingPlan.completedBooks = readingPlan.completedBooks.filter((entry) => entry.id !== book.id);
            readingPlan.completedBooks.push({ id: book.id, title: book.title, author: book.author, pages: readingPlan.pageCount, currentPage: readingPlan.currentPage, completedAt: isoFromUTC(todayUTC()) });
            readingPlan.bookIndex = (readingPlan.bookIndex + 1) % READING_BOOKS.length;
            readingPlan.bookId = READING_BOOKS[readingPlan.bookIndex].id;
            prepareReadingDay();
        } else {
            readingPlan.dailyStart = readingPlan.currentPage + 1;
            readingPlan.dailyEnd = Math.min(readingPlan.pageCount, readingPlan.currentPage + readingPlan.dailyTarget);
            readingPlan.dailyDate = isoFromUTC(todayUTC());
        }
        const readHabit = habits.find((habit) => habit.toLowerCase() === "read");
        if (readHabit) checks[keyFor(todayUTC(), readHabit)] = true;
        readingPlan.goalCompletedDate = today;
        readingPlan.goalCompletedBookId = book.id;
        saveReadingPlan();
        if (dailyTaskState) store.set("daily-task", JSON.stringify(dailyTaskState)); else store.remove("daily-task");
        if (readHabit) saveState();
        return finishedBook;
    }

    function bodyInfo() {
        const hm = bodyProfile.height / 100;
        const bmi = bodyProfile.weight / (hm * hm);
        const label = bmi < 18.5 ? "Underweight" : bmi < 25 ? "Healthy" : bmi < 30 ? "Overweight" : "Obese";
        return { bmi, label };
    }

    function calorieEstimate() {
        if (!bodyProfile || !Number.isFinite(bodyProfile.age) || bodyProfile.age < 18 || bodyProfile.age > 100 || !["female", "male"].includes(bodyProfile.sex)) return null;
        const bmr = 10 * bodyProfile.weight + 6.25 * bodyProfile.height - 5 * bodyProfile.age + (bodyProfile.sex === "male" ? 5 : -161);
        const activityFactor = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 }[bodyProfile.activity] || 1.375;
        const maintenance = Math.round((bmr * activityFactor) / 50) * 50;
        const delta = bodyProfile.goal === "loss" ? -250 : bodyProfile.goal === "gain" ? 250 : 0;
        const target = Math.max(bmr, maintenance + delta);
        const round50 = (value) => Math.round(value / 50) * 50;
        return { maintenance: round50(maintenance), low: round50(Math.max(bmr, target - 100)), high: round50(target + 100), goal: bodyProfile.goal || "maintain" };
    }

    function currentReadingBook() {
        const customBooks = Array.isArray(readingPlan.customBooks) ? readingPlan.customBooks : [];
        return customBooks.find((book) => book.id === readingPlan.bookId)
            || READING_BOOKS.find((book) => book.id === readingPlan.bookId)
            || READING_BOOKS[clamp(Math.floor(Number(readingPlan.bookIndex) || 0), 0, READING_BOOKS.length - 1)]
            || null;
    }

    function saveReadingPlan() {
        const book = currentReadingBook();
        const updatedAt = Math.max(Date.now(), (Number(readingPlan.updatedAt) || 0) + 1);
        readingPlan.updatedAt = updatedAt;
        if (book) {
            if (!readingPlan.bookProgress || typeof readingPlan.bookProgress !== "object") readingPlan.bookProgress = {};
            readingPlan.bookProgress[book.id] = {
                page: Number(readingPlan.currentPage) || 0,
                pageCount: Number(readingPlan.pageCount) || book.pages,
                updatedAt
            };
            if (book.fileId) book.currentPage = Number(readingPlan.currentPage) || 0;
        }
        store.set("reading-plan", JSON.stringify(readingPlan));
        scheduleCloudSync();
    }

    function loadReadingBookProgress(book) {
        if (!readingPlan.bookProgress || typeof readingPlan.bookProgress !== "object") readingPlan.bookProgress = {};
        const saved = readingPlan.bookProgress[book.id];
        const completed = (Array.isArray(readingPlan.completedBooks) ? readingPlan.completedBooks : [])
            .filter((entry) => entry.id === book.id).pop();
        readingPlan.pageCount = Math.max(1, Math.floor(Number(saved && saved.pageCount) || Number(book.pages) || 1));
        const savedPage = saved && saved.page !== null && typeof saved.page !== "undefined"
            && Number.isFinite(Number(saved.page))
            ? Number(saved.page)
            : completed
                ? Number(completed.currentPage ?? completed.pages) || 0
                : Number(book.currentPage) || 0;
        readingPlan.currentPage = clamp(Math.floor(savedPage), 0, readingPlan.pageCount);
    }

    function resetReadingBookProgress(bookId) {
        const book = (Array.isArray(readingPlan.customBooks) ? readingPlan.customBooks : [])
            .find((entry) => entry.id === bookId)
            || READING_BOOKS.find((entry) => entry.id === bookId);
        if (!book) return null;
        const pageCount = Math.max(1, Math.floor(Number(book.pages) || 300));
        const previous = readingPlan.bookProgress && readingPlan.bookProgress[book.id];
        const updatedAt = Math.max(
            Date.now(),
            (Number(readingPlan.updatedAt) || 0) + 1,
            (Number(previous && previous.updatedAt) || 0) + 1
        );
        readingPlan.bookProgress = readingPlan.bookProgress || {};
        readingPlan.bookProgress[book.id] = { page: 0, pageCount, updatedAt };
        readingPlan.completedBooks = (readingPlan.completedBooks || []).filter((entry) => entry.id !== book.id);
        if (book.fileId || book.format === "physical") book.currentPage = 0;
        if (readingPlan.bookId === book.id) {
            readingPlan.pageCount = pageCount;
            readingPlan.currentPage = 0;
            readingPlan.dailyStart = 1;
            readingPlan.dailyEnd = Math.min(pageCount, Math.max(1, Number(readingPlan.dailyTarget) || 10));
            readingPlan.dailyDate = isoFromUTC(todayUTC());
            if (readingPlan.goalCompletedBookId === book.id) {
                readingPlan.goalCompletedDate = "";
                readingPlan.goalCompletedBookId = "";
            }
        }
        return book;
    }

    function notifyReadingPlanChanged() {
        const library = document.querySelector(".reading-library-modal");
        if (library) library.dispatchEvent(new Event("reading-plan-updated"));
    }

    function prepareReadingDay() {
        const book = currentReadingBook();
        if (!book) return null;
        if (!Array.isArray(readingPlan.completedBooks)) readingPlan.completedBooks = [];
        if (!Array.isArray(readingPlan.customBooks)) readingPlan.customBooks = [];
        if (!readingPlan.bookProgress || typeof readingPlan.bookProgress !== "object") readingPlan.bookProgress = {};
        if (!readingPlan.deletedCustomBooks || typeof readingPlan.deletedCustomBooks !== "object") readingPlan.deletedCustomBooks = {};
        const previousBookId = readingPlan.bookId;
        const previousPage = readingPlan.currentPage;
        const previousPageCount = readingPlan.pageCount;
        readingPlan.bookId = book.id;
        loadReadingBookProgress(book);
        if (previousBookId !== book.id
            || previousPage !== readingPlan.currentPage
            || previousPageCount !== readingPlan.pageCount) {
            readingPlan.dailyStart = Math.min(readingPlan.pageCount, readingPlan.currentPage + 1);
            readingPlan.dailyEnd = Math.min(readingPlan.pageCount, readingPlan.currentPage + (readingPlan.dailyTarget || 10));
            readingPlan.dailyDate = "";
        }
        const pageCount = Math.max(1, Math.floor(Number(readingPlan.pageCount) || book.pages));
        readingPlan.pageCount = pageCount;
        readingPlan.currentPage = clamp(Math.floor(Number(readingPlan.currentPage) || 0), 0, pageCount);
        readingPlan.dailyTarget = clamp(Math.floor(Number(readingPlan.dailyTarget) || 10), 1, 100);
        if (!Number.isFinite(readingPlan.dailyStart) || !Number.isFinite(readingPlan.dailyEnd)) {
            readingPlan.dailyStart = readingPlan.currentPage + 1;
            readingPlan.dailyEnd = Math.min(pageCount, readingPlan.currentPage + readingPlan.dailyTarget);
        }
        const today = isoFromUTC(todayUTC());
        if (readingPlan.dailyDate !== today) {
            if (readingPlan.currentPage >= readingPlan.dailyEnd && readingPlan.currentPage < pageCount) {
                readingPlan.dailyStart = readingPlan.currentPage + 1;
                readingPlan.dailyEnd = Math.min(pageCount, readingPlan.currentPage + readingPlan.dailyTarget);
            }
            readingPlan.dailyDate = today;
            saveReadingPlan();
        }
        return book;
    }

    function switchReadingBook(bookId) {
        const book = (Array.isArray(readingPlan.customBooks) ? readingPlan.customBooks : []).find((entry) => entry.id === bookId)
            || READING_BOOKS.find((entry) => entry.id === bookId);
        if (!book) return null;
        const index = READING_BOOKS.findIndex((entry) => entry.id === book.id);
        if (index >= 0) readingPlan.bookIndex = index;
        readingPlan.bookId = book.id;
        loadReadingBookProgress(book);
        readingPlan.dailyStart = Math.min(readingPlan.pageCount, Math.max(1, readingPlan.currentPage + 1));
        readingPlan.dailyEnd = Math.min(readingPlan.pageCount, readingPlan.currentPage + Math.max(1, Number(readingPlan.dailyTarget) || 10));
        readingPlan.dailyDate = "";
        prepareReadingDay();
        saveReadingPlan();
        renderStats();
        return book;
    }

    function bodyFormHTML() {
        return `<form class="body-form" id="bodyForm" novalidate>
            <label>Height (cm)<input id="bfHeight" type="number" inputmode="decimal" min="100" max="250" placeholder="170"></label>
            <label>Weight (kg)<input id="bfWeight" type="number" inputmode="decimal" min="25" max="250" step="0.1" placeholder="65"></label>
            <label>Age<input id="bfAge" type="number" inputmode="numeric" min="13" max="100" placeholder="Optional"></label>
            <label>Sex for calorie estimate<select id="bfSex"><option value="">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option></select></label>
            <label>Activity level<select id="bfActivity"><option value="sedentary">Mostly sitting</option><option value="light">Lightly active</option><option value="moderate">Moderately active</option><option value="active">Very active</option></select></label>
            <label>Weight goal<select id="bfGoal"><option value="maintain">Maintain</option><option value="loss">Gradual loss</option><option value="gain">Gradual gain</option></select></label>
            <label>Body size<select id="bfSize">
                <option value="S">S</option><option value="M" selected>M</option><option value="L">L</option>
                <option value="XL">XL</option><option value="XXL">XXL</option>
            </select></label>
            <p class="body-form-error" id="bfError">Enter height between 100 and 250 cm and weight between 25 and 250 kg.</p>
            <div class="body-form-actions">
                <button type="submit" class="primary-button">Save &amp; build my plan</button>
                ${bodyProfile ? '<button type="button" class="secondary-button" id="bfCancel">Cancel</button>' : ""}
            </div>
        </form>`;
    }

    function wireBodyForm() {
        const form = document.getElementById("bodyForm");
        if (!form) return;
        if (bodyProfile) {
            document.getElementById("bfHeight").value = bodyProfile.height;
            document.getElementById("bfWeight").value = bodyProfile.weight;
            document.getElementById("bfSize").value = bodyProfile.size;
            document.getElementById("bfAge").value = bodyProfile.age || "";
            document.getElementById("bfSex").value = bodyProfile.sex || "";
            document.getElementById("bfActivity").value = bodyProfile.activity || "light";
            document.getElementById("bfGoal").value = bodyProfile.goal || "maintain";
        }
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            const height = parseFloat(document.getElementById("bfHeight").value);
            const weight = parseFloat(document.getElementById("bfWeight").value);
            const size = document.getElementById("bfSize").value;
            const ageValue = document.getElementById("bfAge").value;
            const age = ageValue ? parseInt(ageValue, 10) : null;
            const sex = document.getElementById("bfSex").value;
            const activity = document.getElementById("bfActivity").value;
            const goal = document.getElementById("bfGoal").value;
            if (!(height >= 100 && height <= 250) || !(weight >= 25 && weight <= 250)) {
                document.getElementById("bfError").style.display = "block";
                return;
            }
            bodyProfile = { height, weight, size, age, sex, activity, goal };
            store.set("body", JSON.stringify(bodyProfile));
            editingBody = false;
            renderStats();
        });
        const cancel = document.getElementById("bfCancel");
        if (cancel) {
            cancel.addEventListener("click", () => {
                editingBody = false;
                renderDailyReminder(lastLife || computeLifetime());
            });
        }
    }

    // Refreshes every day: the focus follows the weekday, the exercise mix + tip rotate by date,
    // and difficulty follows the lifetime Overall Progress colour (red = easy ... green = hard).
    function renderDailyReminder(life) {
        const zone = getGaugeZone(life.percent);
        const tierIndex = GAUGE_ZONES.indexOf(zone);
        const tier = TIERS[tierIndex];
        const now = new Date();
        const dateText = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
        const dayNumber = Math.floor(todayUTC() / DAY_MS);
        const tip = DAILY_TIPS[dayNumber % DAILY_TIPS.length];
        const reading = prepareReadingDay();
        const readHabit = habits.find((habit) => habit.toLowerCase() === "read");
        const workoutHabit = habits.find((habit) => habit.toLowerCase() === "workout");
        const readingPagesToday = readingPlan.dailyEnd - readingPlan.dailyStart + 1;
        const readingPagesDone = clamp(readingPlan.currentPage - readingPlan.dailyStart + 1, 0, readingPagesToday);
        const readingGoalReady = readingPlan.currentPage >= readingPlan.dailyEnd;
        const readingGoalCompletedToday = readingPlan.goalCompletedDate === isoFromUTC(todayUTC())
            && (readingPlan.goalCompletedBookId
                ? readingPlan.goalCompletedBookId === readingPlan.bookId
                : readingPlan.currentPage < readingPlan.pageCount);
        const exerciseTimer = activeExerciseTimer();
        const exerciseTimerEntry = exerciseTimer ? exerciseTimer.entry : fitness[isoFromUTC(todayUTC())] || {};
        const exerciseElapsedSeconds = (Number(exerciseTimerEntry.exerciseElapsedSeconds) || 0)
            + (exerciseTimer
                ? Math.max(0, Math.floor((Date.now() - Number(exerciseTimerEntry.exerciseStartedAt)) / 1000))
                : 0);
        const readingActionLabel = readingGoalCompletedToday
            ? "Today's goal complete"
            : readingGoalReady
                ? readingPlan.currentPage >= readingPlan.pageCount ? "Finish book" : `Complete ${readingPagesToday} pages`
                : `Continue reading · ${readingPagesDone}/${readingPagesToday}`;
        const readHabitDone = readHabit && Boolean(checks[keyFor(todayUTC(), readHabit)]);
        const planButton = (habit, label) => {
            if (!habit) return `<span class="reminder-note">Add a ${label} habit to track this task.</span>`;
            const done = Boolean(checks[keyFor(todayUTC(), habit)]);
            return `<button type="button" class="plan-done${done ? " done" : ""}" data-plan-habit="${esc(habit)}" aria-pressed="${done}">${done ? "Done ✓" : "Mark done"}</button>`;
        };

        let html = `<div class="reminder-top">
                <span class="reminder-date">${dateText}</span>
                <span class="tier-badge tier-${zone.key}">Level: ${tier.name}</span>
            </div>`;

        if (editingBody || !bodyProfile) {
            html += `<p class="reminder-line">Add your height, weight and body size to get a plan made for your body, refreshed every day.</p>${bodyFormHTML()}`;
        } else {
            const info = bodyInfo();
            const focusKey = WEEK_PLAN[now.getDay()];
            const focus = WORKOUTS[focusKey];
            const isRecovery = focusKey === "recovery";
            const lowImpact = info.bmi >= 30 || (info.bmi >= 27 && ["XL", "XXL"].includes(bodyProfile.size));
            const underweight = info.bmi < 18.5;
            const calories = calorieEstimate();
            const goalLabel = calories ? ({ maintain: "Maintain", loss: "Gradual loss", gain: "Gradual gain" }[calories.goal]) : "Add adult profile";

            const items = [0, 1, 2, 3].map((i) => {
                const ex = focus.pool[(dayNumber + i) % focus.pool.length];
                const name = lowImpact && ex.low ? ex.low : ex.n;
                const val = ex.v[tierIndex];
                let amount;
                if (ex.u === "min") amount = `${val} min`;
                else if (isRecovery) amount = `${val} ${ex.u === "sec" ? "sec" : "reps"}`;
                else amount = `${tier.rounds} × ${val}${ex.u === "sec" ? " sec" : " reps"}`;
                return `<li><span>${name}</span><b>${amount}</b></li>`;
            }).join("");

            let water = bodyProfile.weight * 0.035 + (isRecovery ? 0 : 0.3);
            water = Math.max(1.5, Math.min(4.5, water));
            const steps = underweight ? Math.min(tier.steps, 8000) : tier.steps;

            let note = "";
            if (lowImpact) note = "Joint-friendly version: no jumping moves today. ";
            if (underweight) note += "Focus on strength and recovery, keep cardio light, and eat regular meals with enough protein. ";

            html += `<p class="reminder-line"><strong class="zone-text-${zone.key}">${tier.name} level.</strong> ${LEVEL_MSG[tierIndex]}</p>
                <div class="reminder-tiles">
                    <div class="r-tile"><span>💧</span><strong>${water.toFixed(1)} L</strong><small>Water</small></div>
                    <div class="r-tile"><span>👟</span><strong>${steps.toLocaleString("en-US")}</strong><small>Steps</small></div>
                    <div class="r-tile"><span>😴</span><strong>7–9 h</strong><small>Sleep</small></div>
                    <div class="r-tile"><span>⚖️</span><strong>${info.bmi.toFixed(1)}</strong><small>BMI · ${info.label}</small></div>
                    <div class="r-tile"><span>🍽️</span><strong>${calories ? `${calories.low.toLocaleString()}–${calories.high.toLocaleString()}` : "—"}</strong><small>kcal · ${goalLabel}</small></div>
                </div>
                <div class="reminder-work">
                    <h3>Today: ${focus.title}</h3>
                    <ul class="reminder-list tier-border-${zone.key}">${items}</ul>
                    <small class="reminder-note">${isRecovery ? "Go easy today, this is recovery." : `5 min warm-up first · rest ${tier.rest} s between rounds.`}</small>
                    <div class="exercise-timer-panel" aria-label="Workout exercise timer">
                        <strong>Exercise timer</strong>
                        <output id="exerciseClock" class="exercise-clock" aria-live="off">${formatExerciseDuration(exerciseElapsedSeconds)}</output>
                        <button type="button" class="secondary-button exercise-timer-toggle" data-exercise-toggle aria-label="${exerciseTimer ? "Stop" : "Start"} exercise timer" aria-pressed="${Boolean(exerciseTimer)}">${exerciseTimer ? "Stop" : "Start"}</button>
                        <button type="button" class="secondary-button exercise-timer-save" data-exercise-save disabled>Save today</button>
                        <small class="exercise-saved-today">Saved today: ${formatExerciseMinutes(Number(exerciseTimerEntry.exerciseMinutes) || 0)} min</small>
                    </div>
                    <div class="plan-task-action">${planButton(workoutHabit, "Workout")}</div>
                </div>`;
            html += `<div class="reminder-reading">
                    <div class="reading-book-copy"><div class="reading-heading"><small class="eyebrow">MIND &amp; DISCIPLINE</small><button type="button" class="reading-history-button" data-reading-history aria-label="Open your book library" title="My books"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 2.64-6.36L3 8.28"></path><path d="M3 3v5h5"></path><path d="M12 7v5l3 2"></path></svg></button></div><h3>Read pages ${readingPlan.dailyStart}–${readingPlan.dailyEnd}</h3><strong>${esc(reading.title)}</strong><span>by ${esc(reading.author)} · ${readingPlan.pageCount} pages</span><p>${esc(reading.focus)}</p>
                        <div class="reading-page-controls"><button type="button" data-reading-page="-1" aria-label="Decrease current page"${readingGoalCompletedToday || readingPlan.currentPage <= readingPlan.dailyStart - 1 ? " disabled" : ""}>−</button><span>Page ${readingPlan.currentPage} / ${readingPlan.pageCount}</span><button type="button" data-reading-page="1" aria-label="Increase current page"${readingGoalCompletedToday || readingPlan.currentPage >= readingPlan.pageCount ? " disabled" : ""}>+</button></div>
                        <div class="reading-progress"><b style="width:${Math.round((readingPagesDone / readingPagesToday) * 100)}%"></b></div><small class="reading-progress-label">${readingGoalCompletedToday ? "Today's reading goal is complete" : `${readingPagesDone}/${readingPagesToday} pages this goal${readHabitDone ? " · Read habit done today" : ""}`}</small>
                    </div>
                    <div class="reading-actions"><button type="button" class="secondary-button reading-online" data-reading-open="${esc(reading.id)}">${reading.fileId ? `Open PDF · page ${readingPlan.currentPage || 1}` : "Open in LifeTrack"}</button><button type="button" class="secondary-button reading-library" data-reading-library aria-haspopup="dialog" title="Open your saved books">My books</button><button type="button" class="plan-done${readingGoalReady ? " done" : ""}" data-reading-complete aria-pressed="${readingGoalReady}" aria-label="${esc(readingActionLabel)}" title="${readingGoalCompletedToday ? "Today's reading goal is complete" : readingGoalReady ? "Save your completed reading pages and continue" : "Open your book and continue from your saved page"}"${readingGoalCompletedToday ? " disabled" : ""}>${esc(readingActionLabel)}</button></div>
                </div>
                <p class="reminder-note">Page counts are edition estimates; adjust the total in Goals to match your copy.</p>`;
            if (note) html += `<p class="reminder-note">${note.trim()}</p>`;
        }

        html += `<div class="reminder-tip">💡 ${tip}</div>
            <p class="reminder-note">Level follows your all-time progress since your first tick. General wellness guide, not medical advice.</p>`;

        if (aiPlanTasks.length) {
            html += `<div class="ai-plan-tasks"><h3>My plan tasks</h3><ul>${aiPlanTasks.map((task) => {
                const done = task.doneDate === isoFromUTC(todayUTC());
                return `<li class="${done ? "done" : ""}"><span><strong>${esc(task.title)}</strong>${task.details ? `<small>${esc(task.details)}</small>` : ""}</span><button type="button" class="plan-done${done ? " done" : ""}" data-ai-plan-done="${esc(task.id)}" aria-pressed="${done}">${done ? "Done ✓" : "Mark done"}</button></li>`;
            }).join("")}</ul></div>`;
        }

        dailyReminder.innerHTML = html;
        wireBodyForm();
    }

    function renderGoalAnalysis(percent, life) {
        goalAnalysis.innerHTML = "";
        goalAnalysis.classList.add("rings-row");

        const zone = getGaugeZone(life.percent);
        const target = computeDailyTarget(life);
        const hit = target.goal > 0 && life.todayDone >= target.goal;
        const streakGoal = 30;
        const streakDone = ctx.bestStreak >= streakGoal;
        const streakProgress = clamp((ctx.bestStreak / streakGoal) * 100, 0, 100);
        const targetSub = !target.goal
            ? "Add a habit first"
            : hit
                ? "Target hit today! ✅"
                : `${life.todayDone}/${target.goal} habits done today`;

        [
            ["Daily Target", target.pct, `var(--zone-${zone.key})`, targetSub, hit],
            ["Discipline Score", percent, "var(--accent)", "", false],
            ["7-Day Consistency", life.recent, "var(--tertiary)", "", false],
            ["Best Habit Streak", streakProgress, "var(--zone-orange)", streakDone ? "30-day milestone reached" : `${ctx.bestStreak}/${streakGoal} days · longest run`, streakDone]
        ].forEach(([label, value, color, sub, done]) => {
            const item = document.createElement("div");
            item.className = "ring-card";
            item.innerHTML = `${ringSVG(value, { size: 76, stroke: 7, color })}<strong>${label}</strong>${sub ? `<p class="${done ? "hit" : ""}">${sub}</p>` : ""}`;
            goalAnalysis.appendChild(item);
        });
        animateRings(goalAnalysis);
    }

    // Per-month completion for the selected year (same maths as the monthly gauge).
    /* ======================================================================
       LifeTrack v2 additions: helpers, charts, goals, fitness, profile menu
       ====================================================================== */

    const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const PALETTE = ["#10B981", "#6366F1", "#F59E0B", "#0EA5E9", "#8B5CF6", "#EC4899", "#14B8A6", "#F97316"];
    const FIT_ON = false;
    const LIFE_SCORE_CATEGORIES = ["habits", "goals", "focus", "wellness", "task"];
    const LIFE_SCORE_DEFAULT_WEIGHTS = { habits: 30, goals: 25, focus: 20, wellness: 15, task: 10 };

    function normalizeLifeScoreWeights(saved) {
        const weights = {};
        LIFE_SCORE_CATEGORIES.forEach((category) => {
            const value = Number(saved && saved[category]);
            weights[category] = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : LIFE_SCORE_DEFAULT_WEIGHTS[category];
        });
        return Object.values(weights).some((value) => value > 0) ? weights : Object.assign({}, LIFE_SCORE_DEFAULT_WEIGHTS);
    }

    function calculateWeightedLifeScore(scores, weights) {
        const scoredCategories = Object.entries(scores || {}).filter(([category, score]) =>
            Object.prototype.hasOwnProperty.call(weights || {}, category)
            && Number.isFinite(Number(score))
            && Number(score) >= 0
            && Number(score) <= 100
            && Number(weights[category]) > 0);
        const totalWeight = scoredCategories.reduce((total, [category]) => total + Number(weights[category]), 0);
        if (!totalWeight) return { score: null, scoredCategories: 0, contributions: {} };

        const contributions = {};
        const weightedTotal = scoredCategories.reduce((total, [category, score]) => {
            const contribution = (Number(score) * Number(weights[category])) / totalWeight;
            contributions[category] = contribution;
            return total + contribution;
        }, 0);
        return { score: Math.round(weightedTotal), scoredCategories: scoredCategories.length, contributions };
    }

    function loadLifeScoreWeights() {
        try {
            return normalizeLifeScoreWeights(JSON.parse(store.get("life-score-weights") || "null"));
        } catch (error) {
            console.error("LifeTrack Life Score weights could not be read.", error);
            return Object.assign({}, LIFE_SCORE_DEFAULT_WEIGHTS);
        }
    }
    let lifeScoreWeights = loadLifeScoreWeights();

    let goals = JSON.parse(store.get("goals") || "null") || [
        { id: "g-all", name: "Monthly consistency", habit: "*", target: 80 }
    ];
    let deletedGoals = JSON.parse(store.get("deleted-goals") || "{}");
    let fitness = JSON.parse(store.get("fitness") || "{}");
    let correctedSleepHistory = false;
    Object.values(fitness).forEach((entry) => {
        if (entry && Number.isFinite(Number(entry.sleep)) && Number(entry.sleep) > 24) {
            entry.sleep = 24;
            correctedSleepHistory = true;
        }
    });
    if (correctedSleepHistory) store.set("fitness", JSON.stringify(fitness));
    let analyticsView = "month";
    let ctx = null;
    let fitStatus = { text: "", kind: "" };
    let syncing = false;
    function loadAssistantState(key, fallback) {
        const raw = store.get(key);
        if (!raw) return fallback;
        try {
            return JSON.parse(raw);
        } catch (error) {
            console.error(`LifeTrack assistant data "${key}" could not be read.`, error);
            return fallback;
        }
    }
    function normalizeAIConversation(messages, fallbackTimestamp = Date.now()) {
        if (!Array.isArray(messages)) return [];
        const valid = messages.filter((message) =>
            message
            && ["user", "assistant"].includes(message.role)
            && typeof message.content === "string"
            && message.content.trim());
        const recent = valid.slice(-AI_HISTORY_MESSAGE_LIMIT);
        const firstIndex = valid.length - recent.length;
        return recent.map((message, index) => {
            let hash = 2166136261;
            for (const character of `${message.role}\u0000${message.content}`) {
                hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
            }
            const timestamp = Number(message.createdAt);
            return {
                id: typeof message.id === "string" && message.id
                    ? message.id
                    : `legacy-${firstIndex + index}-${(hash >>> 0).toString(36)}`,
                createdAt: Number.isFinite(timestamp) && timestamp > 0
                    ? timestamp
                    : fallbackTimestamp - (recent.length - index),
                role: message.role,
                content: message.content
            };
        });
    }
    function mergeAIConversations(localMessages, remoteMessages, fallbackTimestamp) {
        const merged = new Map();
        normalizeAIConversation(localMessages, fallbackTimestamp).forEach((message) => merged.set(message.id, message));
        normalizeAIConversation(remoteMessages, fallbackTimestamp).forEach((message) => {
            const existing = merged.get(message.id);
            if (!existing || message.createdAt > existing.createdAt) merged.set(message.id, message);
        });
        return Array.from(merged.values())
            .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
            .slice(-AI_HISTORY_MESSAGE_LIMIT);
    }
    let aiNotes = loadAssistantState("ai-notes", []);
    let aiPlanTasks = loadAssistantState("ai-plan", []);
    let aiReminder = loadAssistantState("ai-reminder", { reminders: [] });
    const AI_HISTORY_MESSAGE_LIMIT = 48;
    const AI_REQUEST_MESSAGE_LIMIT = 8;
    const AI_REQUEST_MESSAGE_CHARS = 600;
    let aiConversation = normalizeAIConversation(
        loadAssistantState("ai-conversation", []),
        Number(localStorage.getItem(NS + "cloud-updated-at")) || Date.now()
    );
    let aiConversationId = loadAssistantState("ai-conversation-id", "");
    if (typeof aiConversationId !== "string" || !/^[A-Za-z0-9_-]{16,80}$/.test(aiConversationId)) {
        aiConversationId = assistantId();
        saveAssistantState("ai-conversation-id", aiConversationId);
    }
    let aiMemorySummary = typeof loadAssistantState("ai-memory-summary", "") === "string"
        ? loadAssistantState("ai-memory-summary", "").replace(/\s+/g, " ").trim().slice(0, 900)
        : "";
    let aiCoachMode = String(localStorage.getItem(NS + "ai-coach-mode") || "savage").toLowerCase() === "calm" ? "calm" : "savage";
    if (!Array.isArray(aiNotes)) aiNotes = [];
    if (!Array.isArray(aiPlanTasks)) aiPlanTasks = [];
    function normalizeAIReminders(saved) {
        const reminders = Array.isArray(saved && saved.reminders)
            ? saved.reminders
            : saved && typeof saved === "object" && saved.enabled === true
                ? [{ id: "legacy-daily-reminder", title: "Daily check-in", time: saved.time, enabled: true, lastSent: saved.lastSent }]
                : [];
        return reminders.slice(0, 20).filter((reminder) =>
            reminder && typeof reminder === "object"
            && typeof reminder.title === "string" && reminder.title.trim()
            && typeof reminder.time === "string" && /^\d{2}:\d{2}$/.test(reminder.time))
            .map((reminder) => ({
                id: typeof reminder.id === "string" && reminder.id ? reminder.id : assistantId(),
                title: reminder.title.trim().slice(0, 60),
                time: reminder.time,
                enabled: reminder.enabled !== false,
                lastSent: typeof reminder.lastSent === "string" ? reminder.lastSent : ""
            }));
    }
    const migrateAIReminders = !Array.isArray(aiReminder && aiReminder.reminders);
    aiReminder = { reminders: normalizeAIReminders(aiReminder) };
    if (migrateAIReminders) store.set("ai-reminder", JSON.stringify(aiReminder));
    let pendingAiActions = [];
    let aiRecognition = null;
    let aiAudioRecording = null;

    function esc(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const fmtNum = (n) => Math.round(n).toLocaleString("en-US");
    const shortName = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

    function habitColor(habit) {
        const i = habits.indexOf(habit);
        return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
    }

    function saveGoals() {
        store.set("goals", JSON.stringify(goals));
        store.set("deleted-goals", JSON.stringify(deletedGoals));
    }
    function markGoalDeleted(id) {
        const previousAt = deletedGoals[id] && typeof deletedGoals[id] === "object" ? Number(deletedGoals[id].at) || 0 : 0;
        deletedGoals[id] = { at: Math.max(Date.now(), previousAt + 1), deleted: true };
    }
    function restoreGoal(id) {
        const previousAt = deletedGoals[id] && typeof deletedGoals[id] === "object" ? Number(deletedGoals[id].at) || 0 : 0;
        deletedGoals[id] = { at: Math.max(Date.now(), previousAt + 1), deleted: false };
    }
    function saveFit() { store.set("fitness", JSON.stringify(fitness)); }
    if (isNativeLifeTrackApp && nativeHealthStatus) {
        window.__lifeTrackUpdateNativeHealthStatus = (message) => {
            if (typeof message === "string" && message) {
                nativeHealthStatus.textContent = message;
                if (isNativeAndroidApp && message.startsWith("Connected")) {
                    nativeHealthConnected = true;
                    nativeHealthConnect.textContent = "Sync health data now";
                }
            }
        };
        window.__lifeTrackUpdateHealthData = (result) => {
            if (!result || typeof result !== "object") {
                nativeHealthStatus.textContent = "Health data could not be read. Try connecting again from Additional features.";
                return;
            }
            if (result.error) {
                nativeHealthStatus.textContent = result.error;
                return;
            }
            const iso = typeof result.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(result.date)
                ? result.date
                : isoFromUTC(todayUTC());
            const entry = fitness[iso] || (fitness[iso] = {});
            const source = result.source === "apple-health" ? "apple-health" : "health-connect";
            let changed = false;
            const syncedAt = Number(result.syncedAt);
            if (typeof result.steps === "number" && Number.isFinite(result.steps) && result.steps >= 0) {
                const steps = Math.round(result.steps);
                if (entry.steps !== steps || entry.src_steps !== source
                    || (source === "health-connect" && Number.isFinite(syncedAt) && syncedAt > 0
                        && !(Number(entry.healthConnectStepsUpdatedAt) > 0))) {
                    entry.steps = steps;
                    entry.src_steps = source;
                    if (source === "health-connect" && Number.isFinite(syncedAt) && syncedAt > 0) {
                        entry.healthConnectStepsUpdatedAt = syncedAt;
                    }
                    changed = true;
                }
            }
            if (Number.isInteger(result.active) && result.active >= 0 && result.active <= 600) {
                if (entry.active !== result.active || entry.src_active !== source
                    || (source === "health-connect" && Number.isFinite(syncedAt) && syncedAt > 0
                        && !(Number(entry.healthConnectActiveUpdatedAt) > 0))) {
                    entry.active = result.active;
                    entry.src_active = source;
                    if (source === "health-connect" && Number.isFinite(syncedAt) && syncedAt > 0) {
                        entry.healthConnectActiveUpdatedAt = syncedAt;
                    }
                    changed = true;
                }
            }
            if (typeof result.activeCalories === "number" && Number.isFinite(result.activeCalories)
                && result.activeCalories >= 0 && result.activeCalories <= 20000) {
                const activeCalories = Math.round(result.activeCalories);
                if (entry.activeCalories !== activeCalories || entry.src_activeCalories !== source
                    || (source === "health-connect" && Number.isFinite(syncedAt) && syncedAt > 0
                        && !(Number(entry.healthConnectCaloriesUpdatedAt) > 0))) {
                    entry.activeCalories = activeCalories;
                    entry.src_activeCalories = source;
                    if (source === "health-connect" && Number.isFinite(syncedAt) && syncedAt > 0) {
                        entry.healthConnectCaloriesUpdatedAt = syncedAt;
                    }
                    changed = true;
                }
            }
            if (typeof result.sleep === "number" && Number.isFinite(result.sleep) && result.sleep > 0 && result.sleep <= 24) {
                const sleep = Math.round(result.sleep * 10) / 10;
                if (entry.sleep !== sleep || entry.src_sleep !== source
                    || (source === "health-connect" && Number.isFinite(syncedAt) && syncedAt > 0
                        && !(Number(entry.healthConnectSleepUpdatedAt) > 0))) {
                    entry.sleep = sleep;
                    entry.src_sleep = source;
                    if (source === "health-connect" && Number.isFinite(syncedAt) && syncedAt > 0) {
                        entry.healthConnectSleepUpdatedAt = syncedAt;
                    }
                    changed = true;
                }
            }
            if (changed) {
                saveFit();
                renderStats();
            }
            if (isNativeAndroidApp) {
                nativeHealthConnected = true;
                nativeHealthConnect.textContent = "Sync health data now";
            }
            if (typeof result.date === "string" && typeof result.syncedAt !== "undefined"
                && nativeAndroidBridge && typeof nativeAndroidBridge.acknowledgeHealthData === "function") {
                nativeAndroidBridge.acknowledgeHealthData(result.date, String(result.syncedAt));
            }
            const readings = [];
            if (typeof result.steps === "number") readings.push(`${fmtNum(result.steps)} steps`);
            if (typeof result.sleep === "number" && result.sleep > 0) readings.push(`${result.sleep.toFixed(1)} hours sleep`);
            if (Number.isInteger(result.active) && result.active >= 0) readings.push(`${result.active} active minutes`);
            if (typeof result.activeCalories === "number" && result.activeCalories >= 0) {
                readings.push(`${Math.round(result.activeCalories)} active kcal`);
            }
            nativeHealthStatus.textContent = readings.length
                ? `Synced from ${source === "apple-health" ? "Apple Health" : "Health Connect"}: ${readings.join(" and ")}.`
                : "No health readings were available. Check health permissions and that today's steps, sleep, or exercise data is recorded.";
        };
    }

    const TASK_POOL_SIZE = 70000;
    const TASK_DURATIONS = [3, 5, 7, 10, 12, 15, 18, 20, 25, 30];
    const TASK_TWISTS = [
        "give the mission a ridiculous action-movie title",
        "notice three tiny details you would usually miss",
        "make one part deliberately silly",
        "use your non-dominant hand if it feels comfortable",
        "add a tiny victory pose at the end",
        "do the smallest version that still feels fun",
        "pretend you're a friendly alien exploring Earth",
        "choose one color as the theme",
        "leave one imperfect bit in on purpose",
        "keep it private; sharing is never part of the challenge"
    ];
    const TASK_FINISHERS = [
        "give the moment a five-word headline",
        "write down the funniest detail",
        "name one thing that surprised you",
        "rate the mission out of ten, dramatically",
        "tell yourself one sentence about how it felt",
        "pick a soundtrack in your head for the ending",
        "celebrate with a quiet 'quest complete'",
        "save one tiny detail to remember later",
        "choose a silly award for your effort",
        "decide what your sequel challenge would be"
    ];
    const TASK_FAMILIES = [
        {
            name: "Offline side quest",
            missions: [
                ["Phone in exile", "leave your phone in another room and do one small thing just for you"],
                ["One-drawer rescue", "tidy one tiny drawer without trying to reorganize the whole house"],
                ["Window safari", "look outside and spot five details you have never paid attention to"],
                ["Analog minute", "write a short note or doodle on paper instead of opening an app"],
                ["Quiet snack", "enjoy a snack with your screen put away and notice its flavors"],
                ["Desk reset", "clear just one small patch of your desk and make it feel new"],
                ["Memory lane", "recall a funny old memory and write its best one-line summary"],
                ["No-scroll break", "take a screen-free breather somewhere comfortable"],
                ["Pocket declutter", "remove one piece of clutter from your bag or pocket"],
                ["Tiny home upgrade", "make one small corner of your room more pleasant"]
            ]
        },
        {
            name: "Creative chaos",
            missions: [
                ["Movie-trailer object", "make a private 10-second video treating an ordinary object like a movie star"],
                ["Wrong-hand masterpiece", "draw a silly portrait of an object with your non-dominant hand"],
                ["Three-shot story", "make a tiny private photo story using three things nearby"],
                ["New logo", "invent a ridiculous logo for a household object"],
                ["Soundtrack scene", "pick a song that would score an ordinary moment like a blockbuster"],
                ["Tiny comic", "draw a three-panel comic about something that happened today"],
                ["Paper invention", "sketch an invention that solves a very unimportant problem"],
                ["Object interview", "write three funny interview questions for an object near you"],
                ["Secret album cover", "design an imaginary album cover using items around you"],
                ["Mini voice-over", "record a private playful voice-over for a harmless everyday scene"]
            ]
        },
        {
            name: "Curiosity mode",
            missions: [
                ["Odd fact hunt", "look up one surprising fact about an animal you know little about"],
                ["Word collector", "learn five words from a language you do not speak"],
                ["Local legend", "search for a little-known place or story from your area"],
                ["Why chain", "pick a harmless everyday object and ask 'why?' about it five times"],
                ["Skill preview", "watch or read a short beginner guide to a skill you have never tried"],
                ["Map wander", "explore a map of a place you have never visited and pick one landmark"],
                ["Science snack", "find out why a familiar everyday science effect happens"],
                ["Museum window", "browse one museum collection online and choose an unexpectedly cool item"],
                ["Question jar", "write three questions you would love to ask an expert"],
                ["New perspective", "find one reliable explanation of a topic you usually overlook"]
            ]
        },
        {
            name: "Gentle movement",
            missions: [
                ["Safe-route scout", "take a short walk on a familiar, safe route if it suits your body and surroundings"],
                ["Stretch sampler", "try a few gentle stretches and stop if anything feels uncomfortable"],
                ["Room explorer", "walk around your room and notice how many different textures you can spot"],
                ["Balance check", "try a simple balance pose near something stable, or skip it if it feels unsafe"],
                ["Shoulder reset", "roll your shoulders gently and loosen up after sitting"],
                ["Step remix", "take a comfortable movement break at your own pace"],
                ["Fresh-air minute", "step outside or sit by an open window and notice the air"],
                ["Slow-motion walk", "walk slowly across a familiar room and notice each step"],
                ["Stretch soundtrack", "put on a favorite song and move gently in whatever way feels good"],
                ["Posture pause", "change position, relax your jaw, and take a few comfortable breaths"]
            ]
        },
        {
            name: "Kindness mission",
            missions: [
                ["Unexpected thanks", "send a sincere thank-you message to someone who helped you"],
                ["Helpful minute", "do one small helpful thing for someone at home, if welcome"],
                ["Kind review", "write a genuine kind note about a small business or creator you appreciate"],
                ["Reconnect", "send a low-pressure hello to someone you have been meaning to check on"],
                ["Compliment drop", "give someone a specific, respectful compliment"],
                ["Future-you favor", "prepare one small thing that will make tomorrow easier"],
                ["Quiet appreciation", "write down three things someone else did that you appreciate"],
                ["Share a win", "celebrate someone else's good news without making it about you"],
                ["Give space", "offer someone a little uninterrupted time or listening, if they want it"],
                ["Kindness note", "leave a friendly note somewhere appropriate for someone to find"]
            ]
        },
        {
            name: "Brave-but-safe",
            missions: [
                ["Beginner move", "try the first beginner step of a safe skill you have been curious about"],
                ["Ask the question", "ask a helpful, respectful question you have been holding back"],
                ["Tiny first step", "work on a task you have delayed for just one small, manageable step"],
                ["New playlist pick", "listen to a genre or artist you normally would not choose"],
                ["Order differently", "if convenient, choose a familiar food or drink in a new variation"],
                ["Speak up kindly", "share one harmless opinion you usually keep to yourself"],
                ["Solo mini-date", "spend a few minutes enjoying an activity you usually wait to do with others"],
                ["Try the tutorial", "follow the first safe step of a beginner tutorial you have saved"],
                ["Celebrate progress", "tell someone you trust about one small thing you are proud of"],
                ["Comfort-zone inch", "make one low-stakes change to your routine, and keep what feels right"]
            ]
        },
        {
            name: "Sound & senses",
            missions: [
                ["One-song focus", "listen to one favorite song without scrolling and notice three sounds"],
                ["Sound detective", "sit quietly and identify five different sounds around you"],
                ["Taste notes", "try a familiar drink slowly and notice its flavor like a food critic"],
                ["Color quest", "find five things nearby in a color you choose"],
                ["Texture hunt", "notice three different textures around you without needing to collect anything"],
                ["Nature soundtrack", "listen for outdoor sounds from a safe spot or an open window"],
                ["Memory track", "play a song that reminds you of a good moment and recall the story"],
                ["Scent snapshot", "notice a familiar scent nearby and what memory or mood it brings"],
                ["Quiet chorus", "hum or sing a little of a song if you feel comfortable"],
                ["Eyes-up walk", "on a safe familiar path, look up and notice details above eye level"]
            ]
        }
    ];

    function dailyTaskIndex(date, reroll) {
        const day = Math.floor(utcFromISO(date) / DAY_MS);
        let userHash = 0;
        for (const character of currentUser.uid) userHash = (Math.imul(userHash, 31) + character.charCodeAt(0)) >>> 0;
        return (day * 9973 + userHash + reroll * 9973) % TASK_POOL_SIZE;
    }

    function mergeDailyTaskState(localState, remoteState) {
        if (!localState) return remoteState || null;
        if (!remoteState) return localState;
        if (localState.date !== remoteState.date) return localState.date > remoteState.date ? localState : remoteState;
        if (Number(localState.reroll) !== Number(remoteState.reroll)) {
            return Number(localState.reroll) > Number(remoteState.reroll) ? localState : remoteState;
        }
        return {
            date: localState.date,
            reroll: Math.max(Number(localState.reroll) || 0, Number(remoteState.reroll) || 0),
            completed: Boolean(localState.completed || remoteState.completed)
        };
    }

    function currentDailyTask() {
        const date = isoFromUTC(todayUTC());
        if (!dailyTaskState || dailyTaskState.date !== date) {
            dailyTaskState = { date, reroll: 0, completed: false };
            store.set("daily-task", JSON.stringify(dailyTaskState));
        }
        dailyTaskState.reroll = Math.max(0, Math.floor(Number(dailyTaskState.reroll) || 0));
        dailyTaskState.completed = Boolean(dailyTaskState.completed);
        const index = dailyTaskIndex(date, dailyTaskState.reroll);
        const familyIndex = Math.floor(index / 10000);
        const combination = index % 10000;
        const missionIndex = Math.floor(combination / 1000);
        const durationIndex = Math.floor(combination / 100) % 10;
        const twistIndex = Math.floor(combination / 10) % 10;
        const finishIndex = combination % 10;
        const family = TASK_FAMILIES[familyIndex];
        const mission = family.missions[missionIndex];
        return {
            index,
            date,
            category: family.name,
            title: mission[0],
            instruction: mission[1],
            minutes: TASK_DURATIONS[durationIndex],
            twist: TASK_TWISTS[twistIndex],
            finish: TASK_FINISHERS[finishIndex],
            completed: dailyTaskState.completed
        };
    }

    function renderDailyTask() {
        const task = currentDailyTask();
        const summary = document.getElementById("todayTaskCard");
        const detail = document.getElementById("dailyTaskDetail");
        if (!summary || !detail) return;
        const dateLabel = new Date(utcFromISO(task.date)).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
        const taskMarkup = () => `<article class="task-challenge${task.completed ? " is-complete" : ""}">
            <div class="task-challenge-meta"><span>${esc(task.category)}</span><span>${esc(dateLabel)}</span></div>
            <h3>${esc(task.title)}</h3>
            <p>Give it ${task.minutes} minutes (or less if that suits you): ${esc(task.instruction)}.</p>
            <p class="task-twist"><strong>Bonus twist:</strong> ${esc(task.twist)}. <strong>Finish with:</strong> ${esc(task.finish)}.</p>
            <div class="task-actions"><button type="button" class="primary-button" data-task-action="complete" aria-pressed="${task.completed}">${task.completed ? "✓ Completed today" : "Mark complete"}</button><button type="button" class="secondary-button" data-task-action="reroll">Get another task</button></div>
        </article>`;
        summary.innerHTML = `<div class="task-summary-heading"><span class="eyebrow">TODAY'S TASK</span><span aria-hidden="true">⚡</span></div>${taskMarkup()}`;
        detail.innerHTML = taskMarkup();
        renderAiDailyBriefBanner();
        renderTaskNotifications();
        clearTimeout(renderDailyTask.refreshTimer);
        const now = new Date();
        const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
        renderDailyTask.refreshTimer = setTimeout(renderDailyTask, Math.max(1000, nextMidnight.getTime() - now.getTime()));
    }

    function getDailyTaskSummary() {
        const task = currentDailyTask();
        const now = todayUTC();
        const today = isoFromUTC(now);
        const todayStatuses = habits.map((habit) => ({
            name: habit,
            done: Boolean(checks[keyFor(now, habit)])
        }));
        const completed = todayStatuses.filter((item) => item.done).length;
        const total = todayStatuses.length;
        const percent = total ? Math.round((completed / total) * 100) : 0;
        const unticked = todayStatuses.filter((item) => !item.done).map((item) => item.name);
        const fit = (fitness && fitness[today]) || {};

        const summaryText = task.completed
            ? `Mission Completed! "${task.title}" (${task.category}). ${completed}/${total} habits done today (${percent}%).`
            : `Today's Mission: "${task.title}" (${task.category}, ${task.minutes}m). ${completed}/${total} habits done (${percent}%).`;

        return {
            task,
            completed,
            total,
            percent,
            unticked,
            fit,
            summaryText
        };
    }

    function renderAiDailyBriefBanner() {
        const banner = document.getElementById("aiDailyBriefBanner");
        if (!banner) return;
        const data = getDailyTaskSummary();
        const task = data.task;
        const dateLabel = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

        const dateEl = document.getElementById("aiBriefDate");
        const titleEl = document.getElementById("aiBriefTitle");
        const summaryEl = document.getElementById("aiBriefSummary");
        const tagEl = document.getElementById("aiBriefStatusTag");
        const metricsEl = document.getElementById("aiBriefMetrics");
        const completeBtn = document.getElementById("aiBriefCompleteBtn");

        if (dateEl) dateEl.textContent = dateLabel;
        if (tagEl) {
            tagEl.textContent = task.completed ? "✓ Completed" : `${task.minutes} min · ${task.category}`;
            tagEl.className = `ai-brief-status-tag ${task.completed ? "done" : "pending"}`;
        }
        if (titleEl) titleEl.textContent = task.title;
        if (summaryEl) summaryEl.textContent = `${task.instruction}. Finish with: ${task.finish}.`;
        if (completeBtn) {
            completeBtn.textContent = task.completed ? "✓ Task Completed" : "✓ Mark Complete";
            completeBtn.classList.toggle("done", Boolean(task.completed));
        }
        if (metricsEl) {
            metricsEl.innerHTML = `
                <span class="ai-brief-metric-chip">⚡ Habits: <b>${data.completed}/${data.total} (${data.percent}%)</b></span>
                <span class="ai-brief-metric-chip">💧 Water: <b>${data.fit.water || 0}ml</b></span>
                <span class="ai-brief-metric-chip">👟 Steps: <b>${data.fit.steps || 0}</b></span>
            `;
        }
    }

    function renderTaskNotifications() {
        const notifList = document.getElementById("notifList");
        const notifBadge = document.getElementById("notifBadge");
        if (!notifList || !notifBadge) return;

        const data = getDailyTaskSummary();
        const task = data.task;
        const isDone = Boolean(task.completed);

        notifBadge.textContent = isDone ? "✓" : "1";
        notifBadge.classList.toggle("is-done", isDone);

        notifList.innerHTML = `
            <div class="notif-card${isDone ? " is-complete" : " is-active"}">
                <div class="notif-card-header">
                    <span class="notif-pill ${isDone ? "done" : "priority"}">${isDone ? "COMPLETED" : "DAILY MISSION"}</span>
                    <span class="notif-time">${esc(task.category)}</span>
                </div>
                <h4 class="notif-card-title">${esc(task.title)}</h4>
                <p class="notif-card-desc">${esc(task.instruction)} (${task.minutes} min)</p>
                <div class="notif-meta-row">
                    <span>⚡ Habits: <strong>${data.completed}/${data.total}</strong> (${data.percent}%)</span>
                    <span>💧 Water: <strong>${data.fit.water || 0}ml</strong></span>
                </div>
                <div class="notif-card-actions">
                    <button type="button" class="notif-action-btn primary" data-notif-action="complete-task">
                        ${isDone ? "✓ Completed" : "Mark Complete"}
                    </button>
                    <button type="button" class="notif-action-btn secondary" data-notif-action="ask-ai">
                        ✨ Ask AI
                    </button>
                </div>
            </div>
        `;
    }

    function sendDeviceNotification() {
        const data = getDailyTaskSummary();
        const title = `LifeTrack Daily Briefing: ${data.task.title}`;
        const body = data.summaryText;

        if (!("Notification" in window)) {
            toast("Web notifications are not supported in this browser.");
            return;
        }

        if (Notification.permission === "granted") {
            try {
                const notif = new Notification(title, {
                    body,
                    icon: "lifetrack-logo.png",
                    badge: "lifetrack-logo.png",
                    tag: "daily-task-summary"
                });
                notif.onclick = () => {
                    window.focus();
                    const aiPanel = document.getElementById("aiPanel");
                    if (aiPanel) aiPanel.hidden = false;
                };
                toast("Daily task notification sent to device!");
            } catch (e) {
                toast("Could not display device notification: " + e.message);
            }
        } else if (Notification.permission !== "denied") {
            Notification.requestPermission().then((permission) => {
                if (permission === "granted") {
                    sendDeviceNotification();
                } else {
                    toast("Notification permission was dismissed.");
                }
            });
        } else {
            toast("Notifications are blocked in browser settings. Please allow notifications.");
        }
    }

    function renderFocusTimer() {
        const clock = document.getElementById("focusClock");
        if (!clock) return;
        if (!focusTimerRestored) restoreFocusTimer();
        setFocusLock(Boolean(focusEndsAt));
        const hours = Math.floor(focusRemaining / 3600);
        const minutes = Math.floor((focusRemaining % 3600) / 60);
        const seconds = focusRemaining % 60;
        clock.classList.toggle("long", focusDuration >= 60);
        clock.textContent = focusDuration >= 60
            ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
            : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
        document.getElementById("focusState").textContent = focusEndsAt ? "In session" : !focusDurationValid ? "Adjust duration" : focusRemaining === 0 ? "Session complete" : "Ready";
        const soundToggle = document.getElementById("focusSoundToggle");
        soundToggle.textContent = focusSoundMuted ? "🔇" : "🔊";
        soundToggle.setAttribute("aria-pressed", String(!focusSoundMuted));
        soundToggle.setAttribute("aria-label", focusSoundMuted ? "Unmute focus completion sound" : "Mute focus completion sound");
        soundToggle.title = focusSoundMuted ? "Unmute focus completion sound" : "Mute focus completion sound";
        const toggle = document.getElementById("focusToggle");
        toggle.textContent = focusEndsAt ? "Pause" : focusRemaining === 0 ? "Start again" : "Start";
        toggle.disabled = !focusEndsAt && !focusDurationValid;
        const hoursInput = document.getElementById("focusHours");
        const minutesInput = document.getElementById("focusMinutes");
        hoursInput.disabled = Boolean(focusEndsAt);
        minutesInput.disabled = Boolean(focusEndsAt);
        if (focusDurationValid && !hoursInput.matches(":focus")) hoursInput.value = String(Math.floor(focusDuration / 60));
        if (focusDurationValid && !minutesInput.matches(":focus")) minutesInput.value = String(focusDuration % 60);
        const today = fitness[isoFromUTC(todayUTC())] || {};
        document.getElementById("focusSummary").textContent = `${today.focusSessions || 0} sessions · ${today.focusMinutes || 0} minutes focused today`;
        const lockMessage = document.getElementById("focusLockMessage");
        lockMessage.hidden = !focusEndsAt;
        lockMessage.textContent = isNativeAndroidApp
            ? typeof nativeAndroidBridge.startFocusLock === "function"
                ? "Android app pinning limits switching when enabled. Android controls calls and notifications; they may still interrupt."
                : "LifeTrack is locked. Update the Android app to enable device-wide screen pinning."
            : "LifeTrack navigation is locked; other browser tabs and apps remain available.";
        updateNativeAdSuppression();
    }

    function setFocusLock(active, requestDeviceLock = false) {
        const focusSession = document.getElementById("focusSession");
        if (active && !focusLockActive) {
            focusLockPlaceholder = document.createComment("focus-session");
            focusSession.parentNode.insertBefore(focusLockPlaceholder, focusSession);
            document.body.appendChild(focusSession);
            focusLockActive = true;
            document.body.classList.add("focus-lock-active");
            focusLockInertState = Array.from(document.body.children)
                .filter((child) => child !== focusSession)
                .map((child) => ({ element: child, inert: child.inert }));
            focusLockInertState.forEach(({ element }) => { element.inert = true; });
            document.getElementById("focusToggle").focus();
        } else if (!active && focusLockActive) {
            focusLockActive = false;
            document.body.classList.remove("focus-lock-active");
            focusLockInertState.forEach(({ element, inert }) => { element.inert = inert; });
            focusLockInertState = [];
            if (focusLockPlaceholder && focusLockPlaceholder.parentNode) {
                focusLockPlaceholder.parentNode.insertBefore(focusSession, focusLockPlaceholder);
                focusLockPlaceholder.remove();
            }
            focusLockPlaceholder = null;
        }

        if (active && requestDeviceLock && isNativeAndroidApp && !nativeFocusLockRequested) {
            if (typeof nativeAndroidBridge.startFocusLock !== "function") {
                toast("Update the LifeTrack Android app to enable device-wide screen pinning.");
                return;
            }
            try {
                nativeAndroidBridge.startFocusLock(Math.ceil(focusRemaining));
                nativeFocusLockRequested = true;
            } catch (error) {
                console.error("LifeTrack could not start Android screen pinning.", error);
                toast("Android could not pin LifeTrack. The in-app focus lock is still active.");
            }
        } else if (!active && nativeFocusLockRequested) {
            nativeFocusLockRequested = false;
            try {
                if (typeof nativeAndroidBridge.stopFocusLock === "function") {
                    nativeAndroidBridge.stopFocusLock();
                }
            } catch (error) {
                console.error("LifeTrack could not stop Android screen pinning.", error);
                toast("Android screen pinning may need to be exited using the system controls.");
            }
        }
    }

    document.addEventListener("keydown", (event) => {
        if (!focusLockActive) return;
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (event.key !== "Tab") return;
        const controls = Array.from(document.getElementById("focusSession")
            .querySelectorAll("button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex='-1'])"));
        if (!controls.length) {
            event.preventDefault();
            return;
        }
        const index = controls.indexOf(document.activeElement);
        if (index < 0 || event.shiftKey && index === 0) {
            event.preventDefault();
            controls[event.shiftKey ? controls.length - 1 : 0].focus();
        } else if (!event.shiftKey && index === controls.length - 1) {
            event.preventDefault();
            controls[0].focus();
        }
    }, true);

    function normalizeFocusTimerState(timer, now = Date.now()) {
        if (!timer || typeof timer !== "object") return null;
        const durationMinutes = Number(timer.durationMinutes);
        const remainingSeconds = Number(timer.remainingSeconds);
        const endsAt = timer.endsAt == null ? null : Number(timer.endsAt);
        if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440
            || !Number.isFinite(remainingSeconds) || remainingSeconds < 0 || remainingSeconds > durationMinutes * 60
            || (endsAt !== null && (!Number.isFinite(endsAt) || endsAt <= 0))) return null;
        return {
            durationMinutes,
            remainingSeconds: endsAt === null
                ? Math.floor(remainingSeconds)
                : Math.max(0, Math.ceil((endsAt - now) / 1000)),
            endsAt
        };
    }

    function restoreFocusTimer(force = false) {
        if (focusTimerRestored && !force) return;
        focusTimerRestored = true;
        if (force) {
            clearInterval(focusInterval);
            focusInterval = null;
            focusSessionDate = null;
            focusDuration = 25;
            focusRemaining = 25 * 60;
            focusEndsAt = null;
        }
        const date = isoFromUTC(todayUTC());
        const entry = fitness[date];
        const timer = normalizeFocusTimerState(entry && entry.focusTimer);
        if (!timer) return;
        focusSessionDate = date;
        focusDuration = timer.durationMinutes;
        focusDurationValid = true;
        focusRemaining = timer.remainingSeconds;
        focusEndsAt = timer.endsAt;
        if (focusEndsAt !== null) {
            if (focusRemaining === 0) setTimeout(tickFocusTimer, 0);
            else focusInterval = setInterval(tickFocusTimer, 1000);
        }
    }

    function saveFocusTimerState() {
        if (!focusSessionDate) focusSessionDate = isoFromUTC(todayUTC());
        const entry = fitness[focusSessionDate] || (fitness[focusSessionDate] = {});
        entry.focusTimer = {
            durationMinutes: focusDuration,
            remainingSeconds: focusRemaining,
            endsAt: focusEndsAt
        };
        saveFit();
    }

    function clearFocusTimerState() {
        const entry = focusSessionDate && fitness[focusSessionDate];
        if (entry) delete entry.focusTimer;
        focusSessionDate = null;
        saveFit();
    }

    function tickFocusTimer() {
        const endsAt = focusEndsAt;
        if (!endsAt) return;
        focusRemaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
        if (focusRemaining > 0) {
            renderFocusTimer();
            return;
        }
        clearInterval(focusInterval);
        focusInterval = null;
        focusEndsAt = null;
        focusRemaining = 0;
        const iso = focusSessionDate || isoFromUTC(todayUTC());
        const today = fitness[iso] || (fitness[iso] = {});
        today.focusSessions = (today.focusSessions || 0) + 1;
        today.focusMinutes = (today.focusMinutes || 0) + focusDuration;
        delete today.focusTimer;
        focusSessionDate = null;
        saveFit();
        renderFocusTimer();
        renderStats();
        playFocusCompletionSound();
        toast("Focus session complete. Saved to today's focus log.");
    }

    function prepareFocusAudio() {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        try {
            if (!focusAudioContext) focusAudioContext = new AudioContextClass();
            if (focusAudioContext.state === "suspended") void focusAudioContext.resume();
        } catch (error) {
            console.warn("LifeTrack could not prepare the focus completion sound.", error);
        }
    }

    function playFocusCompletionSound() {
        if (focusSoundMuted || !focusAudioContext) return;
        stopFocusCompletionSound();
        const startAlarm = () => {
            if (focusSoundMuted || focusAudioContext.state !== "running") return;
            playFocusCompletionChime();
            focusAlarmInterval = setInterval(playFocusCompletionChime, 1400);
            focusAlarmTimeout = setTimeout(stopFocusCompletionSound, 30_000);
        };
        if (focusAudioContext.state === "running") {
            startAlarm();
        } else {
            focusAudioContext.resume().then(startAlarm).catch((error) => {
                console.warn("LifeTrack could not start the focus completion sound.", error);
            });
        }
    }

    function playFocusCompletionChime() {
        if (focusSoundMuted || !focusAudioContext || focusAudioContext.state !== "running") return;
        const notes = [784, 988, 1175];
        const startAt = focusAudioContext.currentTime + 0.03;
        notes.forEach((frequency, index) => {
            const start = startAt + index * 0.2;
            const oscillator = focusAudioContext.createOscillator();
            const gain = focusAudioContext.createGain();
            oscillator.type = "sine";
            oscillator.frequency.setValueAtTime(frequency, start);
            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(0.18, start + 0.025);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
            oscillator.connect(gain);
            gain.connect(focusAudioContext.destination);
            oscillator.start(start);
            oscillator.stop(start + 0.46);
        });
    }

    function stopFocusCompletionSound() {
        clearInterval(focusAlarmInterval);
        clearTimeout(focusAlarmTimeout);
        focusAlarmInterval = null;
        focusAlarmTimeout = null;
    }

    function toast(message) {
        const el = document.getElementById("toast");
        el.textContent = message;
        el.classList.add("show");
        clearTimeout(toast.t);
        toast.t = setTimeout(() => el.classList.remove("show"), 3200);
    }

    /* ---------- date + tick helpers ---------- */

    function selYM() { return { y: Number(yearSelect.value), m: monthSelect.selectedIndex }; }
    function daysIn(y, m) { return new Date(y, m + 1, 0).getDate(); }

    // days of that month that have started (0 = future month, full length = past month)
    function elapsedDays(y, m) {
        const t0 = todayUTC();
        const s = Date.UTC(y, m, 1);
        if (s > t0) return 0;
        return Math.min(daysIn(y, m), Math.round((t0 - s) / DAY_MS) + 1);
    }

    function dayCount(ms) {
        let n = 0;
        habits.forEach((h) => { if (checks[keyFor(ms, h)]) n += 1; });
        return n;
    }

    function habitTicksInMonth(habit, y, m) {
        const s = Date.UTC(y, m, 1);
        let c = 0;
        for (let d = 0; d < daysIn(y, m); d += 1) if (checks[keyFor(s + d * DAY_MS, habit)]) c += 1;
        return c;
    }

    // % of the days that have passed so far (fair for a month that is still running)
    function habitPct(habit, y, m) {
        const e = elapsedDays(y, m);
        return e ? Math.round((habitTicksInMonth(habit, y, m) / e) * 100) : 0;
    }

    function streakFor(habit, first) {
        const t0 = todayUTC();
        let cur = 0;
        let t = t0;
        if (!checks[keyFor(t, habit)]) t -= DAY_MS; // today isn't over yet, don't break the streak
        while (checks[keyFor(t, habit)]) { cur += 1; t -= DAY_MS; }
        let best = 0;
        let run = 0;
        const from = first === null || first === undefined ? t0 : first;
        for (let x = from; x <= t0; x += DAY_MS) {
            if (checks[keyFor(x, habit)]) { run += 1; if (run > best) best = run; } else run = 0;
        }
        return { cur, best: Math.max(best, cur) };
    }

    function monthlyStreakFor(habit, y, m) {
        const monthStart = Date.UTC(y, m, 1);
        const monthEnd = Math.min(Date.UTC(y, m + 1, 0), todayUTC());
        if (monthStart > monthEnd) return { cur: 0, best: 0 };

        const monthStartISO = isoFromUTC(monthStart);
        let cur = 0;
        let day = monthEnd;
        const isCurrentMonth = new Date(monthStart).getUTCFullYear() === new Date().getFullYear()
            && new Date(monthStart).getUTCMonth() === new Date().getMonth();
        if (!checks[keyFor(day, habit)]) {
            if (!isCurrentMonth) day = monthStart - DAY_MS;
            else day -= DAY_MS;
        }
        while (day >= monthStart && checks[keyFor(day, habit)]) {
            cur += 1;
            day -= DAY_MS;
        }

        let best = 0;
        let run = 0;
        for (let timestamp = monthStart; timestamp <= monthEnd; timestamp += DAY_MS) {
            if (timestamp < utcFromISO(habitStarts[habit] || monthStartISO)) {
                run = 0;
                continue;
            }
            if (checks[keyFor(timestamp, habit)]) {
                run += 1;
                best = Math.max(best, run);
            } else {
                run = 0;
            }
        }
        return { cur, best: Math.max(best, cur) };
    }

    function levelClass(frac) {
        if (frac <= 0) return "lvl0";
        if (frac < 0.34) return "lvl1";
        if (frac < 0.67) return "lvl2";
        if (frac < 1) return "lvl3";
        return "lvl4";
    }

    function buildContext(life) {
        const t0 = todayUTC();
        const first = life.first;
        const streaks = {};
        let bestStreak = 0;
        habits.forEach((h) => {
            streaks[h] = streakFor(h, first);
            if (streaks[h].best > bestStreak) bestStreak = streaks[h].best;
        });
        let perfectDays = 0;
        let totalTicks = 0;
        if (first !== null && habits.length) {
            for (let x = first; x <= t0; x += DAY_MS) {
                const c = dayCount(x);
                totalTicks += c;
                if (c === habits.length) perfectDays += 1;
            }
        }
        return { life, streaks, bestStreak, perfectDays, totalTicks };
    }

    /* ---------- SVG / HTML chart builders ---------- */

    function radarSVG(labels, sets, label) {
        const n = labels.length;
        if (n < 3) return `<p class="empty-note">Add at least 3 items to draw this shape.</p>`;
        const W = 480;
        const H = 450;
        const cx = W / 2;
        const cy = H / 2;
        const R = 120;
        const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
        const P = (i, r) => [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))];
        const f = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;

        let grid = "";
        [25, 50, 75, 100].forEach((lv) => {
            grid += `<polygon class="radar-grid" points="${labels.map((_, i) => f(P(i, (R * lv) / 100))).join(" ")}"></polygon>`;
        });
        const axes = labels.map((_, i) => {
            const p = P(i, R);
            return `<line class="radar-axis" x1="${cx}" y1="${cy}" x2="${p[0].toFixed(1)}" y2="${p[1].toFixed(1)}"></line>`;
        }).join("");

        const series = sets.map((s) => {
            const pts = s.vals.map((v, i) => P(i, (R * clamp(v, 0, 100)) / 100));
            const dots = pts.map((p, i) => `<circle class="radar-dot" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.6" fill="${s.color}"><title>${esc(labels[i])}: ${Math.round(s.vals[i])}%</title></circle>`).join("");
            return `<polygon class="radar-area" points="${pts.map(f).join(" ")}" fill="${s.color}" stroke="${s.color}"></polygon>${dots}`;
        }).join("");

        const radarLabels = labels.map((name, i) => {
            const value = sets[0] ? Math.round(sets[0].vals[i]) : 0;
            const angle = ang(i);
            const guideStart = P(i, R + 3);
            const guideEnd = P(i, R + 17);
            const labelPoint = P(i, R + 22);
            const cosine = Math.cos(angle);
            const anchor = cosine > 0.22 ? "start" : cosine < -0.22 ? "end" : "middle";
            const nameCharacters = Array.from(name);
            const shortName = nameCharacters.length > 10 ? `${nameCharacters.slice(0, 9).join("")}…` : name;
            return `<line class="radar-label-guide" x1="${guideStart[0].toFixed(1)}" y1="${guideStart[1].toFixed(1)}" x2="${guideEnd[0].toFixed(1)}" y2="${guideEnd[1].toFixed(1)}"></line>
                <text class="radar-label" x="${labelPoint[0].toFixed(1)}" y="${labelPoint[1].toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle"><title>${esc(name)}: ${value}%</title>${esc(shortName)}<tspan class="radar-value"> ${value}%</tspan></text>`;
        }).join("");

        return `<div class="radar-chart">
            <svg class="radar-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label || "Radar chart")}">${grid}${axes}${series}${radarLabels}</svg>
        </div>`;
    }

    function donutSVG(items, centerLabel) {
        const total = items.reduce((s, it) => s + it.value, 0);
        const r = 54;
        const c = 2 * Math.PI * r;
        let acc = 0;
        let segs = "";
        const segmentCount = items.filter((item) => item.value > 0).length;
        if (total > 0) {
            items.forEach((it) => {
                if (!it.value) return;
                const len = (it.value / total) * c;
                const gap = segmentCount > 1 ? Math.min(4, len * 0.1) : 0;
                const segmentLength = len - gap;
                segs += `<circle class="donut-seg" cx="80" cy="80" r="${r}" stroke="${it.color}" stroke-dasharray="${segmentLength.toFixed(2)} ${(c - segmentLength).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 80 80)"><title>${esc(it.label)}: ${it.value}</title></circle>`;
                acc += len;
            });
        }
        const legend = items.map((it) => `<li><i style="background:${it.color}"></i><span>${esc(it.label)}</span><b>${it.value}</b></li>`).join("");
        return `<div class="donut-wrap">
            <svg class="donut-svg" viewBox="0 0 160 160" role="img" aria-label="${esc(centerLabel)}">
                <circle class="donut-track" cx="80" cy="80" r="${r}"></circle>${segs}
                <text class="donut-num" x="80" y="78" text-anchor="middle">${total}</text>
                <text class="donut-cap" x="80" y="96" text-anchor="middle">check-ins</text>
            </svg>
            <ul class="donut-legend">${legend}</ul>
        </div>`;
    }

    function sparkSVG(values, id, color) {
        const W = 200;
        const H = 56;
        const max = Math.max(...values, 1);
        const n = values.length;
        if (!n) return "";
        const pts = values.map((v, i) => [n > 1 ? (i * W) / (n - 1) : W / 2, H - 4 - (v / max) * (H - 10)]);
        const line = pts.map((p, i) => `${i ? "L" : "M"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
        const area = `${line} L ${pts[n - 1][0].toFixed(1)} ${H} L ${pts[0][0].toFixed(1)} ${H} Z`;
        return `<svg class="spark-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
            <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.4"></stop><stop offset="100%" stop-color="${color}" stop-opacity="0"></stop></linearGradient></defs>
            <path d="${area}" fill="url(#${id})"></path>
            <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></path>
        </svg>`;
    }

    // Daily completion bars, always fills its panel: grid, target line, value labels, empty message.
    function dailyBarsSVG(totals, days, elapsed, goal, todayIdx) {
        const W = 640;
        const H = 230;
        const L = 30;
        const Rm = 8;
        const T = 16;
        const B = 26;
        const pw = W - L - Rm;
        const ph = H - T - B;
        const slot = pw / days;
        const bw = Math.min(18, slot * 0.62);
        const ymax = Math.max(habits.length, 1);
        const step = Math.max(1, Math.ceil(ymax / 4));
        let grid = "";
        for (let v = 0; v <= ymax; v += step) {
            const y = T + ph - (v / ymax) * ph;
            grid += `<line class="cg-line" x1="${L}" y1="${y.toFixed(1)}" x2="${W - Rm}" y2="${y.toFixed(1)}"></line><text class="cg-tick" x="${L - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end">${v}</text>`;
        }
        let bars = "";
        let labels = "";
        let sum = 0;
        totals.forEach((count, i) => {
            sum += count;
            const x = L + i * slot + (slot - bw) / 2;
            const future = i >= elapsed;
            const h = future ? 0 : (count / ymax) * ph;
            const y = T + ph - Math.max(h, future ? 0 : 2);
            if (i === todayIdx) bars += `<rect class="cg-today" x="${(L + i * slot).toFixed(1)}" y="${T}" width="${slot.toFixed(1)}" height="${ph}" rx="4"></rect>`;
            const cls = future ? "cg-future" : count >= goal && count > 0 ? "cg-hit" : count > 0 ? "cg-part" : "cg-zero";
            bars += `<rect class="cg-bar ${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${(future ? 2 : Math.max(h, 2)).toFixed(1)}" rx="3"><title>${monthNames[selYM().m]} ${i + 1}: ${count} of ${habits.length} done</title></rect>`;
            if (count > 0 && !future) bars += `<text class="cg-val" x="${(x + bw / 2).toFixed(1)}" y="${(y - 3).toFixed(1)}" text-anchor="middle">${count}</text>`;
            labels += `<text class="cg-day${i === todayIdx ? " now" : ""}" x="${(x + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${i + 1}</text>`;
        });
        let target = "";
        if (goal > 0) {
            const ty = T + ph - (goal / ymax) * ph;
            target = `<line class="cg-target" x1="${L}" y1="${ty.toFixed(1)}" x2="${W - Rm}" y2="${ty.toFixed(1)}"></line>`;
        }
        const empty = sum === 0 ? `<text class="cg-empty" x="${W / 2}" y="${T + ph / 2}" text-anchor="middle">Tick a habit and your bars show up here</text>` : "";
        return `<svg class="cg-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Habits completed per day">${grid}${target}${bars}${labels}${empty}</svg>`;
    }

    function lineChart2(values, ymax, elapsed) {
        const W = 960;
        const H = 260;
        const L = 32;
        const Rm = 12;
        const T = 14;
        const B = 28;
        const pw = W - L - Rm;
        const ph = H - T - B;
        const n = values.length;
        const X = (i) => L + (n > 1 ? (i * pw) / (n - 1) : pw / 2);
        const Y = (v) => T + ph - (clamp(v, 0, ymax) / ymax) * ph;
        const step = Math.max(1, Math.ceil(ymax / 4));
        let grid = "";
        for (let v = 0; v <= ymax; v += step) {
            grid += `<line class="cg-line" x1="${L}" y1="${Y(v).toFixed(1)}" x2="${W - Rm}" y2="${Y(v).toFixed(1)}"></line><text class="cg-tick" x="${L - 6}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${v}</text>`;
        }
        let xl = "";
        for (let i = 0; i < n; i += 1) {
            if (i === 0 || (i + 1) % 5 === 0 || i === n - 1) xl += `<text class="cg-day" x="${X(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${i + 1}</text>`;
        }
        if (!elapsed) return `<svg class="line-chart-svg" viewBox="0 0 ${W} ${H}">${grid}${xl}<text class="cg-empty" x="${W / 2}" y="${T + ph / 2}" text-anchor="middle">This month hasn't started yet</text></svg>`;

        const pts = values.slice(0, elapsed).map((v, i) => [X(i), Y(v)]);
        const line = pts.map((p, i) => `${i ? "L" : "M"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
        const area = `${line} L ${pts[pts.length - 1][0].toFixed(1)} ${T + ph} L ${pts[0][0].toFixed(1)} ${T + ph} Z`;
        const avg = values.slice(0, elapsed).map((_, i) => {
            const from = Math.max(0, i - 6);
            const slice = values.slice(from, i + 1);
            return slice.reduce((s, x) => s + x, 0) / slice.length;
        });
        const avgLine = avg.map((v, i) => `${i ? "L" : "M"} ${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
        const dots = pts.map((p, i) => `<circle class="line-dot" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.4"><title>Day ${i + 1}: ${values[i]} of ${habits.length}</title></circle>`).join("");
        return `<svg class="line-chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily completion trend">
            <defs><linearGradient id="lineFill2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--primary)" stop-opacity="0.35"></stop><stop offset="100%" stop-color="var(--primary)" stop-opacity="0"></stop></linearGradient></defs>
            ${grid}${xl}
            <path d="${area}" fill="url(#lineFill2)"></path>
            <path class="line-avg" d="${avgLine}"></path>
            <path class="line-stroke" d="${line}"></path>
            ${dots}
        </svg>
        <div class="chart-legend"><span><i class="lg-line"></i>Habits done per day</span><span><i class="lg-dash"></i>7-day average</span></div>`;
    }

    function metricTrendSVG(values, target, visible, unit, color, labels, label) {
        const W = 960, H = 190, L = 64, R = 14, T = 14, B = 28;
        const plotW = W - L - R, plotH = H - T - B;
        const maxValue = Math.max(target || 0, 1, ...values.slice(0, visible));
        const y = (value) => T + plotH - (clamp(value, 0, maxValue) / maxValue) * plotH;
        const x = (index) => L + (values.length > 1 ? (index * plotW) / (values.length - 1) : plotW / 2);
        const format = (value) => Number.isInteger(value) ? fmtNum(value) : value.toFixed(1);
        let grid = "";
        for (let tick = 0; tick <= 4; tick += 1) {
            const value = (maxValue * tick) / 4;
            grid += `<line class="cg-line" x1="${L}" y1="${y(value).toFixed(1)}" x2="${W - R}" y2="${y(value).toFixed(1)}"></line><text class="cg-tick" x="${L - 7}" y="${(y(value) + 3).toFixed(1)}" text-anchor="end">${format(value)}</text>`;
        }
        let xLabels = "";
        labels.forEach((labelText, index) => {
            if (labels.length <= 12 || index === 0 || (index + 1) % 5 === 0 || index === labels.length - 1) {
                xLabels += `<text class="cg-day" x="${x(index).toFixed(1)}" y="${H - 7}" text-anchor="middle">${labelText}</text>`;
            }
        });
        if (!visible) return `<svg class="line-chart-svg metric-trend-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${grid}${xLabels}<text class="cg-empty" x="${W / 2}" y="${T + plotH / 2}" text-anchor="middle">No data for this range</text></svg>`;
        const points = values.slice(0, visible).map((value, index) => [x(index), y(value)]);
        const path = points.map((point, index) => `${index ? "L" : "M"} ${point[0].toFixed(1)} ${point[1].toFixed(1)}`).join(" ");
        const dots = points.map((point, index) => `<circle class="line-dot" cx="${point[0].toFixed(1)}" cy="${point[1].toFixed(1)}" r="3.2"><title>${labels[index]}: ${format(values[index])}${unit}</title></circle>`).join("");
        const targetLine = target > 0 ? `<line class="cg-target" x1="${L}" y1="${y(target).toFixed(1)}" x2="${W - R}" y2="${y(target).toFixed(1)}"><title>Daily target: ${format(target)}${unit}</title></line>` : "";
        return `<svg class="line-chart-svg metric-trend-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${grid}${xLabels}${targetLine}<path class="line-stroke" style="stroke:${color}" d="${path}"></path>${dots}</svg><div class="chart-legend"><span><i class="lg-line" style="border-color:${color}"></i>${label}</span>${target > 0 ? `<span><i class="tgt-line"></i>Daily target ${format(target)}${unit}</span>` : ""}</div>`;
    }

    function miniBarsSVG(values, target, color, unit) {
        const W = 240;
        const H = 84;
        const n = values.length;
        const max = Math.max(target || 0, ...values, 1) * 1.08;
        const slot = W / n;
        const bw = slot * 0.66;
        let bars = "";
        values.forEach((v, i) => {
            const h = (v / max) * (H - 18);
            bars += `<rect class="mb-bar" x="${(i * slot + (slot - bw) / 2).toFixed(1)}" y="${(H - 14 - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, v > 0 ? 2 : 1).toFixed(1)}" rx="2.5" fill="${color}" opacity="${v > 0 ? 1 : 0.25}"><title>${v}${unit}</title></rect>`;
        });
        const ty = H - 14 - (target / max) * (H - 18);
        const tl = target ? `<line class="cg-target" x1="0" y1="${ty.toFixed(1)}" x2="${W}" y2="${ty.toFixed(1)}"></line>` : "";
        return `<svg class="mb-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${tl}${bars}</svg>`;
    }

    function heatMonthHTML(y, m) {
        const days = daysIn(y, m);
        const first = new Date(y, m, 1).getDay();
        const t0 = todayUTC();
        const s = Date.UTC(y, m, 1);
        let html = `<div class="heat-month">${DOW.map((d) => `<span class="heat-dow">${d[0]}</span>`).join("")}`;
        for (let i = 0; i < first; i += 1) html += `<span class="heat-cell blank"></span>`;
        for (let d = 1; d <= days; d += 1) {
            const ms = s + (d - 1) * DAY_MS;
            const future = ms > t0;
            const c = future ? 0 : dayCount(ms);
            const frac = habits.length ? c / habits.length : 0;
            html += `<span class="heat-cell ${future ? "future" : levelClass(frac)}${ms === t0 ? " today" : ""}" title="${d} ${monthNames[m]}: ${future ? "upcoming" : `${c} of ${habits.length}`}">${d}</span>`;
        }
        return `${html}</div><div class="heat-legend"><span>Less</span><i class="heat-cell lvl0"></i><i class="heat-cell lvl1"></i><i class="heat-cell lvl2"></i><i class="heat-cell lvl3"></i><i class="heat-cell lvl4"></i><span>More</span></div>`;
    }

    function heatYearSVG(y) {
        const cell = 12;
        const gap = 3;
        const stride = cell + gap;
        const left = 26;
        const top = 18;
        const t0 = todayUTC();
        const jan1 = Date.UTC(y, 0, 1);
        const offset = new Date(y, 0, 1).getDay();
        const total = Math.round((Date.UTC(y + 1, 0, 1) - jan1) / DAY_MS);
        let rects = "";
        const monthX = {};
        for (let i = 0; i < total; i += 1) {
            const ms = jan1 + i * DAY_MS;
            const col = Math.floor((i + offset) / 7);
            const row = (i + offset) % 7;
            const d = new Date(ms);
            if (d.getUTCDate() === 1) monthX[d.getUTCMonth()] = col;
            const future = ms > t0;
            const c = future ? 0 : dayCount(ms);
            const frac = habits.length ? c / habits.length : 0;
            rects += `<rect class="heat-rect ${future ? "future" : levelClass(frac)}" x="${left + col * stride}" y="${top + row * stride}" width="${cell}" height="${cell}" rx="3"><title>${fmtDate(ms)}: ${future ? "upcoming" : `${c} of ${habits.length}`}</title></rect>`;
        }
        const cols = Math.ceil((total + offset) / 7);
        const labels = Object.keys(monthX).map((mm) => `<text class="cg-day" x="${left + monthX[mm] * stride}" y="11">${monthNames[mm].slice(0, 3)}</text>`).join("");
        const dl = [1, 3, 5].map((r) => `<text class="cg-day" x="0" y="${top + r * stride + 10}">${DOW[r]}</text>`).join("");
        const W = left + cols * stride;
        const H = top + 7 * stride;
        return `<svg class="heat-year-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Every day of ${y}">${labels}${dl}${rects}</svg>`;
    }

    function matrixHTML(rowLabels, rows, colorFor) {
        let html = `<table class="matrix"><thead><tr><th></th>${monthNames.map((n) => `<th title="${n}">${n.slice(0, 3)}</th>`).join("")}</tr></thead><tbody>`;
        rows.forEach((cells, r) => {
            html += `<tr><th>${rowLabels[r]}</th>${cells.map((v, i) => `<td><span class="mx ${v === null ? "future" : levelClass(v / 100)}" title="${monthNames[i]}: ${v === null ? "no data" : `${v}%`}">${v === null ? "" : v}</span></td>`).join("")}</tr>`;
        });
        return `${html}</tbody></table>`;
    }

    /* ---------- goals maths ---------- */

    function goalStats(goal, y, m) {
        const days = daysIn(y, m);
        const elapsed = elapsedDays(y, m);
        let ticks = 0;
        let possible = 0;
        if (goal.habit === "*") {
            habits.forEach((h) => { ticks += habitTicksInMonth(h, y, m); });
            possible = habits.length * days;
        } else if (habits.includes(goal.habit)) {
            ticks = habitTicksInMonth(goal.habit, y, m);
            possible = days;
        }
        const actual = possible ? (ticks / possible) * 100 : 0;
        const ratio = goal.target ? clamp((actual / goal.target) * 100, 0, 100) : 0;
        const needTicks = Math.ceil((goal.target / 100) * possible);
        const remainingTicks = Math.max(0, needTicks - ticks);
        const perDay = goal.habit === "*" ? habits.length : 1;
        const daysLeft = Math.max(0, days - elapsed);
        const reachable = remainingTicks <= daysLeft * perDay + (elapsed ? perDay : 0);
        const pace = days ? (goal.target * elapsed) / days : 0;
        return { ticks, possible, actual, ratio, remainingTicks, daysLeft, reachable, onTrack: actual >= pace * 0.9, elapsed, missing: goal.habit !== "*" && !habits.includes(goal.habit) };
    }

    /* ---------- dashboard renders ---------- */

    function renderHabitLegend() {
        const el = document.getElementById("habitLegend");
        const { y, m } = selYM();
        if (!habits.length) { el.innerHTML = `<p class="empty-note">No habits yet. Add one in the Habits tab.</p>`; return; }
        const rows = habits.slice(0, 6).map((h) => {
            const p = habitPct(h, y, m);
            const c = habitColor(h);
            return `<div class="hl-row" title="${esc(h)}: ${p}% of days so far"><i style="background:${c}"></i><span>${esc(h)}</span><div class="hl-bar"><b style="width:${p}%;background:${c}"></b></div><em>${p}%</em></div>`;
        }).join("");
        el.innerHTML = rows + (habits.length > 6 ? `<small class="hl-more">+${habits.length - 6} more in the Habits tab</small>` : "");
    }

    function renderCompletedCard(dailyTotals) {
        const spark = document.getElementById("completedSpark");
        const chips = document.getElementById("completedChips");
        const { y, m } = selYM();
        const elapsed = elapsedDays(y, m);
        spark.innerHTML = sparkSVG(dailyTotals.slice(0, Math.max(elapsed, 1)), "sparkFill", "var(--accent)");
        const t0 = todayUTC();
        const n = habits.length;
        const last7 = [];
        for (let i = 6; i >= 0; i -= 1) last7.push(dayCount(t0 - i * DAY_MS));
        const avg7 = n ? Math.round((last7.reduce((s, x) => s + x, 0) / (7 * n)) * 100) : 0;
        let perfect = 0;
        const s = Date.UTC(y, m, 1);
        for (let d = 0; d < elapsed; d += 1) if (n && dayCount(s + d * DAY_MS) === n) perfect += 1;
        chips.innerHTML = `<span class="chip">Today <b>${ctx.life.todayDone}/${n}</b></span><span class="chip">7-day avg <b>${avg7}%</b></span><span class="chip">Perfect days <b>${perfect}</b></span>`;
    }

    function renderWeekStrip() {
        const el = document.getElementById("weekStrip");
        const t0 = todayUTC();
        const n = habits.length;
        let thisWeek = 0;
        let previousWeek = 0;
        let html = `<h3 class="sub-head">Last 7 days</h3><div class="week-dots">`;
        for (let i = 6; i >= 0; i -= 1) {
            const ms = t0 - i * DAY_MS;
            const c = dayCount(ms);
            thisWeek += c;
            previousWeek += dayCount(ms - 7 * DAY_MS);
            const p = n ? Math.round((c / n) * 100) : 0;
            html += `<div class="wk${i === 0 ? " now" : ""}" title="${fmtDate(ms)}: ${c} of ${n}"><span class="wk-dot" style="--p:${p}">${c}</span><small>${DOW[new Date(ms).getUTCDay()][0]}</small></div>`;
        }
        let trend = `<span>Add a habit to see your trend.</span>`;
        if (n) {
            const possible = n * 7;
            const difference = Math.round((thisWeek / possible) * 100) - Math.round((previousWeek / possible) * 100);
            const direction = difference > 0 ? "up" : difference < 0 ? "down" : "steady";
            const summary = difference > 0 ? `Up ${difference} pts vs last week` : difference < 0 ? `Down ${Math.abs(difference)} pts vs last week` : "No change vs last week";
            trend = `<div class="week-trend ${direction}"><strong>${summary}</strong><span>This week ${thisWeek}/${possible} · Last week ${previousWeek}/${possible}</span></div>`;
        }
        el.innerHTML = `${html}</div>${trend}`;
    }

    function renderDailyChart(dailyTotals) {
        const { y, m } = selYM();
        const days = dailyTotals.length;
        const elapsed = elapsedDays(y, m);
        const t0 = todayUTC();
        const todayIdx = Date.UTC(y, m, 1) <= t0 && t0 <= Date.UTC(y, m, days) ? Math.round((t0 - Date.UTC(y, m, 1)) / DAY_MS) : -1;
        const goal = computeDailyTarget(ctx.life).goal;
        completionChart.innerHTML = dailyBarsSVG(dailyTotals, days, elapsed, goal, todayIdx);

        const n = habits.length;
        let best = { c: -1, d: 0 };
        let perfect = 0;
        let onTarget = 0;
        let sum = 0;
        for (let i = 0; i < elapsed; i += 1) {
            const c = dailyTotals[i];
            sum += c;
            if (c > best.c) best = { c, d: i + 1 };
            if (n && c === n) perfect += 1;
            if (goal && c >= goal) onTarget += 1;
        }
        document.getElementById("completionChips").innerHTML = elapsed
            ? `<span class="chip">Best day <b>${best.d} ${monthNames[m].slice(0, 3)} (${best.c}/${n})</b></span><span class="chip">Avg <b>${(sum / elapsed).toFixed(1)}/day</b></span><span class="chip">On target <b>${onTarget} days</b></span><span class="chip">Perfect <b>${perfect}</b></span><span class="chip"><i class="tgt-line"></i>Daily target <b>${goal}</b></span>`
            : `<span class="chip">This month hasn't started yet</span>`;

        // average by weekday
        const totalsByDow = Array(7).fill(0);
        const countsByDow = Array(7).fill(0);
        const s = Date.UTC(y, m, 1);
        for (let i = 0; i < elapsed; i += 1) {
            const dw = new Date(s + i * DAY_MS).getUTCDay();
            totalsByDow[dw] += dailyTotals[i];
            countsByDow[dw] += 1;
        }
        const todayDow = new Date().getDay();
        const order = Array.from({ length: 7 }, (_, offset) => (todayDow + offset) % 7);
        document.getElementById("weekdayBars").innerHTML = order.map((dw) => {
            const p = n && countsByDow[dw] ? Math.round((totalsByDow[dw] / (countsByDow[dw] * n)) * 100) : 0;
            const zone = getGaugeZone(p);
            const isToday = dw === todayDow;
            return `<div class="wd-row${isToday ? " is-today" : ""}"${isToday ? ` aria-label="Today is ${DOW[dw]}; weekdays rotate to keep today first"` : ""}><span class="wd-day">${DOW[dw]}${isToday ? "<small>Today</small>" : ""}</span><div class="wd-track"><b class="zone-bg-${zone.key}" style="width:${p}%"></b></div><em>${countsByDow[dw] ? `${p}%` : "–"}</em></div>`;
        }).join("");
    }

    function exerciseMinutesForEntry(entry, activeSeconds = 0) {
        const saved = Number(entry && entry.exerciseMinutes);
        const elapsed = Number(entry && entry.exerciseElapsedSeconds);
        const savedMinutes = Number.isFinite(saved) && saved > 0 ? saved : 0;
        const elapsedSeconds = (Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0)
            + (Number.isFinite(activeSeconds) && activeSeconds > 0 ? activeSeconds : 0);
        return Math.round((savedMinutes + elapsedSeconds / 60) * 10) / 10;
    }

    function exerciseBarsSVG(totals, days, elapsed, todayIdx, monthLabel) {
        const W = 640;
        const H = 230;
        const L = 30;
        const Rm = 8;
        const T = 16;
        const B = 26;
        const pw = W - L - Rm;
        const ph = H - T - B;
        const slot = pw / days;
        const bw = Math.min(18, slot * 0.62);
        const peak = totals.slice(0, elapsed).reduce((max, value) => Math.max(max, Number(value) || 0), 0);
        const step = Math.max(5, Math.ceil(peak / 20) * 5);
        const ymax = step * 4;
        let grid = "";
        for (let value = 0; value <= ymax; value += step) {
            const y = T + ph - (value / ymax) * ph;
            grid += `<line class="cg-line" x1="${L}" y1="${y.toFixed(1)}" x2="${W - Rm}" y2="${y.toFixed(1)}"></line><text class="cg-tick" x="${L - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end">${value}</text>`;
        }
        let bars = "";
        let labels = "";
        let sum = 0;
        totals.forEach((minutes, i) => {
            const value = Math.max(0, Number(minutes) || 0);
            const x = L + i * slot + (slot - bw) / 2;
            const future = i >= elapsed;
            if (!future) sum += value;
            const h = future ? 0 : (value / ymax) * ph;
            const y = T + ph - Math.max(h, future ? 0 : 2);
            if (i === todayIdx) bars += `<rect class="cg-today" x="${(L + i * slot).toFixed(1)}" y="${T}" width="${slot.toFixed(1)}" height="${ph}" rx="4"></rect>`;
            const cls = future ? "cg-future" : value > 0 ? "cg-exercise" : "cg-zero";
            const valueLabel = Number.isInteger(value) ? String(value) : value.toFixed(1);
            bars += `<rect class="cg-bar ${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${(future ? 2 : Math.max(h, 2)).toFixed(1)}" rx="3"><title>${monthLabel} ${i + 1}: ${valueLabel} min of exercise</title></rect>`;
            if (value > 0 && !future) bars += `<text class="cg-val" x="${(x + bw / 2).toFixed(1)}" y="${(y - 3).toFixed(1)}" text-anchor="middle">${valueLabel}</text>`;
            labels += `<text class="cg-day${i === todayIdx ? " now" : ""}" x="${(x + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${i + 1}</text>`;
        });
        const emptyText = elapsed ? "Start the exercise timer to see daily minutes here" : "This month hasn't started yet";
        const empty = sum === 0 ? `<text class="cg-empty" x="${W / 2}" y="${T + ph / 2}" text-anchor="middle">${emptyText}</text>` : "";
        return `<svg class="cg-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Exercise minutes per day">${grid}${bars}${labels}${empty}</svg>`;
    }

    function renderExerciseChart() {
        const exerciseProgress = document.getElementById("exerciseProgress");
        const exerciseChart = document.getElementById("exerciseChart");
        const exerciseChartDetails = document.getElementById("exerciseChartDetails");
        const exerciseChartChips = document.getElementById("exerciseChartChips");
        const exerciseWeekdayBars = document.getElementById("exerciseWeekdayBars");
        if (!exerciseProgress || !exerciseChart || !exerciseChartDetails || !exerciseChartChips || !exerciseWeekdayBars) return;
        exerciseProgress.hidden = !bodyProfile;
        if (!bodyProfile) return;
        exerciseChartDetails.hidden = false;
        const { y, m } = selYM();
        const days = getDaysInSelectedMonth();
        const elapsed = elapsedDays(y, m);
        const t0 = todayUTC();
        const todayIdx = Date.UTC(y, m, 1) <= t0 && t0 <= Date.UTC(y, m, days)
            ? Math.round((t0 - Date.UTC(y, m, 1)) / DAY_MS)
            : -1;
        const today = isoFromUTC(t0);
        const totals = Array.from({ length: days }, (_, index) => {
            const date = isoFromUTC(Date.UTC(y, m, index + 1));
            const entry = fitness[date] || {};
            const activeSeconds = date === today && Number(entry.exerciseStartedAt) > 0
                ? Math.max(0, Math.floor((Date.now() - Number(entry.exerciseStartedAt)) / 1000))
                : 0;
            return exerciseMinutesForEntry(entry, activeSeconds);
        });
        exerciseChart.innerHTML = exerciseBarsSVG(totals, days, elapsed, todayIdx, monthNames[m]);

        let total = 0;
        let exerciseDays = 0;
        let best = { minutes: 0, day: 0 };
        for (let i = 0; i < elapsed; i += 1) {
            const minutes = totals[i];
            total += minutes;
            if (minutes > 0) exerciseDays += 1;
            if (minutes > best.minutes) best = { minutes, day: i + 1 };
        }
        exerciseChartChips.innerHTML = elapsed
            ? `<span class="chip">Total <b>${formatExerciseMinutes(total)} min</b></span><span class="chip">Avg/day <b>${formatExerciseMinutes(total / elapsed)} min</b></span><span class="chip">Exercise days <b>${exerciseDays}</b></span><span class="chip">Best day <b>${best.minutes ? `${best.day} ${monthNames[m].slice(0, 3)} · ${formatExerciseMinutes(best.minutes)} min` : "–"}</b></span>`
            : `<span class="chip">This month hasn't started yet</span>`;

        const totalsByDow = Array(7).fill(0);
        const countsByDow = Array(7).fill(0);
        const monthStart = Date.UTC(y, m, 1);
        for (let i = 0; i < elapsed; i += 1) {
            const dayOfWeek = new Date(monthStart + i * DAY_MS).getUTCDay();
            totalsByDow[dayOfWeek] += totals[i];
            countsByDow[dayOfWeek] += 1;
        }
        const averages = totalsByDow.map((value, dayOfWeek) =>
            countsByDow[dayOfWeek] ? value / countsByDow[dayOfWeek] : 0);
        const maxAverage = Math.max(...averages, 1);
        const todayDow = new Date().getDay();
        const order = Array.from({ length: 7 }, (_, offset) => (todayDow + offset) % 7);
        exerciseWeekdayBars.innerHTML = order.map((dayOfWeek) => {
            const average = averages[dayOfWeek];
            const isToday = dayOfWeek === todayDow;
            const width = Math.round((average / maxAverage) * 100);
            return `<div class="wd-row${isToday ? " is-today" : ""}"${isToday ? ` aria-label="Today is ${DOW[dayOfWeek]}; weekdays rotate to keep today first"` : ""}><span class="wd-day">${DOW[dayOfWeek]}${isToday ? "<small>Today</small>" : ""}</span><div class="wd-track"><b class="exercise-wd-fill" style="width:${width}%"></b></div><em>${countsByDow[dayOfWeek] ? `${formatExerciseMinutes(average)} min` : "–"}</em></div>`;
        }).join("");
    }

    function renderRadarsAndStreaks() {
        const { y, m } = selYM();
        const labels = habits.slice();
        const vals = habits.map((h) => habitPct(h, y, m));
        const set = [{ vals, color: "var(--primary)" }];
        document.getElementById("habitRadar").innerHTML = radarSVG(labels, set, "Habit balance this month");
        document.getElementById("habitRadar2").innerHTML = radarSVG(labels, set, "Habit shape this month");

        // life balance, last 7 days
        const t0 = todayUTC();
        const tg = dailyTargets(ctx.life);
        const n = habits.length;
        const days = [];
        for (let i = 0; i < 7; i += 1) days.push(t0 - i * DAY_MS);
        const habitAvg = n ? (days.reduce((s, ms) => s + dayCount(ms), 0) / (7 * n)) * 100 : 0;
        const averageSteps = days.reduce((sum, ms) => sum + (Number((fitness[isoFromUTC(ms)] || {}).steps) || 0), 0) / 7;
        const stepProgress = tg.steps ? clamp((averageSteps / tg.steps) * 100, 0, 100) : 0;
        const strideMeters = bodyProfile && bodyProfile.height > 0 ? (bodyProfile.height / 100) * 0.415 : 0.72;
        const caloriesTarget = bodyProfile && bodyProfile.weight > 0 ? tg.steps * bodyProfile.weight * 0.0005 : 0;
        const averageCalories = bodyProfile && bodyProfile.weight > 0 ? averageSteps * bodyProfile.weight * 0.0005 : 0;
        const distanceTargetKm = (tg.steps * strideMeters) / 1000;
        const averageDistanceKm = (averageSteps * strideMeters) / 1000;
        const avgOf = (field, target) => {
            const logged = days.map((ms) => (fitness[isoFromUTC(ms)] || {})[field]).filter((v) => typeof v === "number" && v > 0);
            return logged.length ? clamp((logged.reduce((s, x) => s + x, 0) / logged.length / target) * 100, 0, 100) : 0;
        };
        const moods = days.map((ms) => (fitness[isoFromUTC(ms)] || {}).mood).filter(Boolean);
        const axes = [
            ["Habits", habitAvg],
            ["Steps", avgOf("steps", tg.steps)],
            ["Water", avgOf("water", tg.water)],
            ["Sleep", avgOf("sleep", tg.sleep)],
            ["Focus", avgOf("focusMinutes", tg.active)],
            ["Calories", caloriesTarget ? clamp((averageCalories / caloriesTarget) * 100, 0, 100) : 0],
            ["Distance", distanceTargetKm ? clamp((averageDistanceKm / distanceTargetKm) * 100, 0, 100) : 0],
            ["Mood", moods.length ? (moods.reduce((s, x) => s + x, 0) / moods.length / 5) * 100 : 0]
        ];
        document.getElementById("lifeRadar").innerHTML = radarSVG(axes.map((a) => a[0]), [{ vals: axes.map((a) => a[1]), color: "var(--accent)" }], "Life balance, last 7 days");
        document.getElementById("lifeLegend").innerHTML = axes.every((a) => a[0] === "Habits" || a[1] === 0)
            ? `<p class="empty-note">Log steps, water, sleep and mood in Fitness Today to fill the other corners.</p>` : "";

        // Streaks in this month's calendar range only.
        const list = document.getElementById("streakList");
        if (!habits.length) { list.innerHTML = `<p class="empty-note">No habits yet.</p>`; return; }
        const monthlyStreaks = habits.map((habit) => monthlyStreakFor(habit, y, m));
        const maxBest = Math.max(...monthlyStreaks.map((streak) => streak.best), 7);
        list.innerHTML = habits.map((h, index) => {
            const s = monthlyStreaks[index];
            const color = habitColor(h);
            const targetStreak = Math.max(s.best, 7);
            const pct = targetStreak > 0 ? clamp((s.cur / targetStreak) * 100, 0, 100) : 0;
            const isRecord = s.cur >= s.best && s.cur > 0;
            return `<div class="streak-circle-card${isRecord ? " is-record" : ""}" title="${esc(h)} · Current: ${s.cur}d · Best: ${s.best}d">
                <div class="streak-circle-graphic">
                    ${ringSVG(pct, {
                        size: 66,
                        stroke: 5.5,
                        color: color,
                        text: s.cur > 0 ? `${s.cur}d` : "0d",
                        ariaLabel: `${esc(h)}: ${s.cur} day streak`
                    })}
                </div>
                <div class="streak-circle-info">
                    <strong class="streak-habit-name" title="${esc(h)}">
                        <i class="streak-dot" style="background:${color}"></i>
                        <span>${esc(h)}</span>
                    </strong>
                    <div class="streak-circle-meta">
                        <span class="streak-best-pill">Best: ${s.best}d</span>
                        ${isRecord ? `<span class="streak-peak-pill">🔥 Best</span>` : ""}
                    </div>
                </div>
            </div>`;
        }).join("");
        animateRings(list);
    }

    function renderBadges() {
        const c = ctx;
        const readHabit = habits.find((habit) => habit.toLowerCase() === "read");
        const workoutHabit = habits.find((habit) => habit.toLowerCase() === "workout");
        const readStreak = readHabit ? c.streaks[readHabit].best : 0;
        const workoutCount = workoutHabit && c.life.scan.per[workoutHabit] ? c.life.scan.per[workoutHabit].count : 0;
        let best10k = 0;
        let bestSleep = 0;
        let bestWater = 0;
        Object.keys(fitness).forEach((k) => {
            const f = fitness[k];
            if (f.steps > best10k) best10k = f.steps;
            if (f.sleep > bestSleep) bestSleep = f.sleep;
            if (f.water > bestWater) bestWater = f.water;
        });
        const list = [
            { icon: "🌱", name: "First habit", desc: "Complete your first habit", cur: c.totalTicks, goal: 1 },
            { icon: "🔥", name: "7-day streak", desc: "Keep one habit going for a week", cur: c.bestStreak, goal: 7 },
            { icon: "⚡", name: "30-day streak", desc: "One habit, thirty days in a row", cur: c.bestStreak, goal: 30 },
            { icon: "💎", name: "90-day streak", desc: "One habit, ninety days in a row", cur: c.bestStreak, goal: 90 },
            { icon: "👑", name: "365-day streak", desc: "One habit, one full year in a row", cur: c.bestStreak, goal: 365 },
            { icon: "✨", name: "Perfect day", desc: "Finish every habit in one day", cur: c.perfectDays, goal: 1 },
            { icon: "🏅", name: "10 perfect days", desc: "Finish every habit on ten days", cur: c.perfectDays, goal: 10 },
            { icon: "🏆", name: "50 perfect days", desc: "Finish every habit on fifty days", cur: c.perfectDays, goal: 50 },
            { icon: "📖", name: "Reader · 7 days", desc: "Keep your Read habit going for a week", cur: readStreak, goal: 7 },
            { icon: "📚", name: "Reader · 30 days", desc: "Keep your Read habit going for thirty days", cur: readStreak, goal: 30 },
            { icon: "🎓", name: "Reader · 90 days", desc: "Keep your Read habit going for ninety days", cur: readStreak, goal: 90 },
            { icon: "🏋️", name: "25 workouts", desc: "Complete the Workout habit 25 times", cur: workoutCount, goal: 25 },
            { icon: "🥇", name: "100 workouts", desc: "Complete the Workout habit 100 times", cur: workoutCount, goal: 100 },
            { icon: "🚀", name: "250 workouts", desc: "Complete the Workout habit 250 times", cur: workoutCount, goal: 250 },
            { icon: "🏆", name: "500 workouts", desc: "Complete the Workout habit 500 times", cur: workoutCount, goal: 500 },
            { icon: "👟", name: "10k steps", desc: "A day with 10,000 steps", cur: best10k, goal: 10000 },
            { icon: "😴", name: "Full rest", desc: "Sleep 8 hours or more", cur: bestSleep, goal: 8 },
            { icon: "💧", name: "Hydrated", desc: "Drink 2.5 L in a day", cur: bestWater, goal: 2500 }
        ];
        document.getElementById("badgeGrid").innerHTML = list.map((b) => {
            const done = b.cur >= b.goal;
            const p = clamp((b.cur / b.goal) * 100, 0, 100);
            const progress = `${Math.min(b.cur, b.goal).toLocaleString("en-US")}/${b.goal.toLocaleString("en-US")}`;
            return `<div class="badge${done ? " done" : ""}" title="${esc(b.desc)}"><span class="badge-ico">${b.icon}</span><strong>${b.name}</strong><small>${done ? "Unlocked" : `${esc(b.desc)} · ${progress}`}</small><div class="badge-bar"><b style="width:${p}%"></b></div></div>`;
        }).join("");
    }

    /* ---------- habits page ---------- */

    function renameHabitData(oldName, newName) {
        Object.keys(checks).forEach((key) => {
            const match = key.match(/^(\d{4}-\d{1,2}-\d{1,2})-(.*)$/);
            if (!match || match[2] !== oldName) return;
            const renamedKey = `${match[1]}-${newName}`;
            checks[renamedKey] = Boolean(checks[renamedKey] || checks[key]);
            delete checks[key];
        });
        habitStarts[newName] = habitStarts[oldName];
        delete habitStarts[oldName];
        goals.forEach((goal) => {
            if (goal.habit === oldName) goal.habit = newName;
        });
        markHabitDeleted(oldName);
        restoreHabitName(newName);
        habits[habits.indexOf(oldName)] = newName;
    }

    function renameHabit(oldName, value) {
        const newName = value.trim();
        if (!newName) {
            toast("A habit name cannot be empty.");
            return false;
        }
        if (newName === oldName) return true;
        if (habits.includes(newName)) {
            toast("A habit with that name already exists.");
            return false;
        }
        renameHabitData(oldName, newName);
        saveGoals();
        saveState();
        renderCalendar();
        return true;
    }

    function moveHabit(from, to, restoreFocus) {
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= habits.length || to >= habits.length || from === to) return;
        const moved = habits.splice(from, 1)[0];
        habits.splice(to, 0, moved);
        saveState();
        renderCalendar();
        if (restoreFocus === "table") {
            const cell = habitBody.querySelector(`tr[data-habit-index="${to}"] td:first-child`);
            if (cell) {
                cell.classList.add("is-reorder-selected");
                cell.focus();
            }
        } else if (restoreFocus) {
            const card = habitManageList.querySelector(`[data-habit-index="${to}"]`);
            if (card) {
                card.classList.add("is-reorder-selected");
                card.focus();
            }
        }
    }

    habitBody.addEventListener("dblclick", (event) => {
        const cell = event.target.closest("td:first-child");
        if (!cell) return;
        habitBody.querySelectorAll(".is-reorder-selected").forEach((item) => item.classList.remove("is-reorder-selected"));
        cell.classList.add("is-reorder-selected");
        cell.focus();
        toast("Use the up/down arrow keys to move this habit. Press Enter when done.");
    });

    habitBody.addEventListener("keydown", (event) => {
        const cell = event.target.closest("td:first-child");
        if (!cell || !cell.classList.contains("is-reorder-selected")) return;
        if (event.key === "Enter" || event.key === "Escape") {
            event.preventDefault();
            cell.classList.remove("is-reorder-selected");
            return;
        }
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        const index = Number(cell.dataset.habitIndex);
        moveHabit(index, index + (event.key === "ArrowUp" ? -1 : 1), "table");
    });

    let pendingTableHabitDrag = null;
    function beginHabitDrag(drag, event, element, startOnTouch) {
        if (!drag || !element || drag.started) return;
        const shouldStart = !startOnTouch || Math.abs(event.clientX - drag.startX) > 8 || Math.abs(event.clientY - drag.startY) > 8;
        if (!shouldStart) return;
        drag.started = true;
        element.classList.add("is-dragging");
        element.setPointerCapture(event.pointerId);
    }

    habitBody.addEventListener("pointerdown", (event) => {
        const cell = event.target.closest("td:first-child");
        if (!cell || event.button !== 0 || event.isPrimary === false) return;
        const index = Number(cell.dataset.habitIndex);
        const row = cell.closest("tr");
        const drag = { pointerId: event.pointerId, from: index, to: index, cell, row, started: false, timer: 0, startX: event.clientX, startY: event.clientY };
        pendingTableHabitDrag = drag;
        if (event.pointerType === "touch" || event.pointerType === "pen") return;
        drag.timer = window.setTimeout(() => {
            if (pendingTableHabitDrag !== drag) return;
            beginHabitDrag(drag, event, row, false);
        }, 280);
    });

    habitBody.addEventListener("pointermove", (event) => {
        const drag = pendingTableHabitDrag;
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (!drag.started) {
            beginHabitDrag(drag, event, drag.row, true);
            if (!drag.started) return;
        }
        event.preventDefault();
        const target = document.elementFromPoint(event.clientX, event.clientY);
        const row = target && target.closest("#habitBody tr");
        habitBody.querySelectorAll("tr").forEach((item) => item.classList.remove("drop-before", "drop-after"));
        if (!row) {
            drag.to = drag.from;
            return;
        }
        const targetIndex = Number(row.dataset.habitIndex);
        const after = event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
        drag.to = targetIndex + (after ? 1 : 0);
        if (drag.to > drag.from) drag.to -= 1;
        drag.to = Math.max(0, Math.min(habits.length - 1, drag.to));
        if (drag.to !== drag.from) row.classList.add(after ? "drop-after" : "drop-before");
    });

    function finishTableHabitDrag(event, dropped) {
        const drag = pendingTableHabitDrag;
        if (!drag || drag.pointerId !== event.pointerId) return;
        window.clearTimeout(drag.timer);
        drag.cell.closest("tr").classList.remove("is-dragging");
        habitBody.querySelectorAll("tr").forEach((item) => item.classList.remove("drop-before", "drop-after"));
        pendingTableHabitDrag = null;
        if (dropped && drag.started) moveHabit(drag.from, drag.to, "table");
    }

    habitBody.addEventListener("pointerup", (event) => finishTableHabitDrag(event, true));
    habitBody.addEventListener("pointercancel", (event) => finishTableHabitDrag(event, false));

    function commitHabitEdit(input, keepInvalid) {
        if (!input.isConnected) return;
        const card = input.closest(".habit-card");
        const index = Number(card.dataset.habitIndex);
        const saved = renameHabit(habits[index], input.value);
        if ((saved && input.isConnected) || (!saved && !keepInvalid)) renderManageList();
    }

    function renderManageList() {
        const { y, m } = selYM();
        const t0 = todayUTC();
        if (!habits.length) {
            habitManageList.innerHTML = `<p class="empty-note">Nothing here yet. Type a habit above and press Add Habit.</p>`;
            document.getElementById("habitDonut").innerHTML = donutSVG([], "No check-ins yet");
            return;
        }
        habitManageList.innerHTML = habits.map((h, idx) => {
            const p = habitPct(h, y, m);
            const s = ctx.streaks[h];
            const ticks = habitTicksInMonth(h, y, m);
            let strip = "";
            for (let i = 29; i >= 0; i -= 1) {
                const ms = t0 - i * DAY_MS;
                strip += `<i class="${checks[keyFor(ms, h)] ? "on" : ""}" style="${checks[keyFor(ms, h)] ? `background:${habitColor(h)}` : ""}" title="${fmtDate(ms)}"></i>`;
            }
            const months = [];
            for (let mm = 0; mm < 12; mm += 1) {
                const e = elapsedDays(y, mm);
                months.push(e ? Math.round((habitTicksInMonth(h, y, mm) / daysIn(y, mm)) * 100) : 0);
            }
            return `<article class="habit-card" data-habit-index="${idx}" tabindex="0" aria-label="${esc(h)}. Double-click the card to reorder with arrow keys; hold and drag to move.">
                <header><span class="hc-name"><i style="background:${habitColor(h)}"></i><span class="hc-label" data-edit-habit="${idx}" title="Double-click to edit">${esc(h)}</span></span><button type="button" class="delete-btn" data-remove="${idx}" aria-label="Remove ${esc(h)}">Remove</button></header>
                <div class="hc-main">
                    ${ringSVG(p, { size: 72, stroke: 7, color: habitColor(h) })}
                    <ul class="hc-stats">
                        <li><b>${s.cur}</b><span>day streak</span></li>
                        <li><b>${s.best}</b><span>best streak</span></li>
                        <li><b>${ticks}</b><span>this month</span></li>
                    </ul>
                </div>
                <div class="hc-strip" aria-label="Last 30 days">${strip}</div>
                <div class="hc-year" title="Month by month, ${y}">${miniBarsSVG(months, 0, habitColor(h), "%")}<small>${y} by month</small></div>
            </article>`;
        }).join("");
        animateRings(habitManageList);

        const items = habits.map((h) => ({ label: h, value: habitTicksInMonth(h, y, m), color: habitColor(h) }));
        document.getElementById("habitDonut").innerHTML = donutSVG(items, "Check-ins by habit this month");
    }

    /* ---------- goals page ---------- */

    function fillGoalHabitSelect() {
        const sel = document.getElementById("goalHabit");
        const keep = sel.value;
        sel.innerHTML = `<option value="__create_habit__">Create habit from goal</option><option value="*">All habits together</option>${habits.map((h) => `<option value="${esc(h)}">${esc(h)}</option>`).join("")}`;
        if (keep) sel.value = keep;
    }

    function renderGoalsPage() {
        const { y, m } = selYM();
        fillGoalHabitSelect();
        const readingCard = document.getElementById("readingGoalCard");
        const readingBook = prepareReadingDay();
        const readingProgress = Math.round((readingPlan.currentPage / readingPlan.pageCount) * 100);
        const lastCompleted = readingPlan.completedBooks[readingPlan.completedBooks.length - 1];
        readingCard.innerHTML = `<article class="goal-card reading-goal-card">
            <header><span class="hc-name">Read · ${esc(readingBook.title)}</span><span class="reading-goal-tools"><span class="chip ${readingProgress >= 100 ? "good" : ""}">${readingProgress >= 100 ? "Complete" : `${readingProgress}% complete`}</span><button type="button" class="reading-history-button" data-reading-history aria-label="Open reading history" title="Reading history"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 2.64-6.36L3 8.28"></path><path d="M3 3v5h5"></path><path d="M12 7v5l3 2"></path></svg></button></span></header>
            <div class="hc-main">${ringSVG(readingProgress, { size: 76, stroke: 7, color: "var(--accent)" })}<div class="goal-meta"><span class="chip">by ${esc(readingBook.author)}</span><p>Page ${readingPlan.currentPage} of ${readingPlan.pageCount}</p><small>Today: pages ${readingPlan.dailyStart}–${readingPlan.dailyEnd}</small></div></div>
            <label class="reading-edition">Total pages in your edition<input type="number" min="1" max="5000" step="1" value="${readingPlan.pageCount}" data-reading-page-count aria-label="Total pages in this book"></label>
            ${lastCompleted ? `<p class="reading-completed">Last completed: <strong>${esc(lastCompleted.title)}</strong> · ${lastCompleted.pages} pages</p>` : ""}
        </article>`;
        animateRings(readingCard);
        const grid = document.getElementById("goalPageList");
        if (!goals.length) {
            grid.innerHTML = `<p class="empty-note">No goals yet. Name one above, choose a habit and a target.</p>`;
        } else {
            grid.innerHTML = goals.map((g) => {
                const st = goalStats(g, y, m);
                const color = g.habit === "*" ? "var(--primary)" : habitColor(g.habit);
                const difficulty = ["easy", "medium", "hard"].includes(g.difficulty) ? g.difficulty : "medium";
                let status;
                if (st.missing) status = `<span class="chip warn">Habit removed</span>`;
                else if (st.ratio >= 100) status = `<span class="chip good">Goal reached 🎉</span>`;
                else if (!st.elapsed) status = `<span class="chip">Starts soon</span>`;
                else if (!st.reachable) status = `<span class="chip bad">Out of reach this month</span>`;
                else if (st.onTrack) status = `<span class="chip good">On track</span>`;
                else status = `<span class="chip warn">Behind pace</span>`;
                const months = [];
                for (let mm = 0; mm < 12; mm += 1) months.push(elapsedDays(y, mm) ? Math.round(goalStats(g, y, mm).ratio) : 0);
                return `<article class="goal-card">
                    <header><span class="hc-name">${esc(g.name)}</span><button type="button" class="delete-btn" data-goal-remove="${esc(g.id)}" aria-label="Remove goal ${esc(g.name)}">Remove</button></header>
                    <div class="hc-main">
                        ${ringSVG(st.ratio, { size: 92, stroke: 9, color })}
                        <div class="goal-meta">
                            <span class="chip">${g.habit === "*" ? "All habits" : esc(g.habit)}</span>
                            <span class="chip difficulty-${difficulty}">${difficulty[0].toUpperCase()}${difficulty.slice(1)} difficulty</span>
                            <p>${Math.round(st.actual)}% of the month done, target ${g.target}%</p>
                            ${status}
                        </div>
                    </div>
                    ${st.ratio < 100 && !st.missing ? `<small class="goal-need">${st.remainingTicks} more check-in${st.remainingTicks === 1 ? "" : "s"} needed · ${st.daysLeft} day${st.daysLeft === 1 ? "" : "s"} left</small>` : ""}
                    <div class="hc-year">${miniBarsSVG(months, 100, color, "%")}<small>${y} by month, % of target</small></div>
                </article>`;
            }).join("");
            animateRings(grid);
        }

        const labels = goals.map((g) => g.name);
        const vals = goals.map((g) => goalStats(g, y, m).ratio);
        document.getElementById("goalRadar").innerHTML = radarSVG(labels, [{ vals, color: "var(--accent)" }], "Goal progress radar");

        const rows = goals.map((g) => {
            const row = [];
            for (let mm = 0; mm < 12; mm += 1) row.push(Date.UTC(y, mm, 1) > todayUTC() || ctx.life.first === null || Date.UTC(y, mm, daysIn(y, mm)) < ctx.life.first ? null : Math.round(goalStats(g, y, mm).ratio));
            return row;
        });
        document.getElementById("goalYear").innerHTML = goals.length ? `<div class="scroll-x">${matrixHTML(goals.map((g) => esc(shortName(g.name, 16))), rows)}</div><p class="empty-note">Each cell is % of that month's target.</p>` : `<p class="empty-note">Add a goal to see it month by month.</p>`;
    }

    /* ---------- analytics ---------- */

    function kpi(label, value, sub) {
        return `<div class="kpi"><small>${label}</small><b>${value}</b>${sub ? `<span>${sub}</span>` : ""}</div>`;
    }

    function renderAnalytics(percent, completed, total, dailyTotals) {
        const { y, m } = selYM();
        const elapsed = elapsedDays(y, m);
        const n = habits.length;
        let perfect = 0;
        let active = 0;
        const s = Date.UTC(y, m, 1);
        for (let i = 0; i < elapsed; i += 1) {
            if (dailyTotals[i] > 0) active += 1;
            if (n && dailyTotals[i] === n) perfect += 1;
        }
        document.getElementById("anKpis").innerHTML =
            kpi("Completion", `${percent}%`, `${monthNames[m]} ${y}`) +
            kpi("Check-ins", `${completed}<em> / ${total}</em>`, "this month") +
            kpi("Perfect days", perfect, `${active} active days`) +
            kpi("Best streak", `${ctx.bestStreak}<em> days</em>`, "any habit, all time") +
            kpi("Since first tick", ctx.life.first === null ? "–" : `${ctx.life.percent}%`, ctx.life.first === null ? "start ticking" : fmtDate(ctx.life.first));
        document.getElementById("analyticsChart").innerHTML = lineChart2(dailyTotals, Math.max(n, 1), elapsed);
        document.getElementById("heatMonth").innerHTML = heatMonthHTML(y, m);
        document.getElementById("anRadar").innerHTML = radarSVG(habits.slice(), [{ vals: habits.map((h) => habitPct(h, y, m)), color: "var(--primary)" }], "Habit balance this month");

        const tg = dailyTargets(ctx.life);
        const monthDays = daysIn(y, m);
        const monthlyFitSeries = (field, divisor) => Array.from({ length: monthDays }, (_, index) => {
            const ms = Date.UTC(y, m, index + 1);
            return Math.round(((Number((fitness[isoFromUTC(ms)] || {})[field]) || 0) / divisor) * 10) / 10;
        });
        const metricCard = (key, title, values, target, color, unit, labels, visible, period) => {
            const logged = values.slice(0, visible).filter((value) => value > 0);
            const average = visible ? values.slice(0, visible).reduce((sum, value) => sum + value, 0) / visible : 0;
            const summary = logged.length ? `avg ${average.toFixed(1)}${unit}/day` : "No readings yet";
            return `<article class="fit-trend-card" data-fit-metric="${key}" tabindex="-1"><div class="fit-trend-head"><strong>${title}</strong><span>${summary}</span></div>${metricTrendSVG(values, target, visible, unit, color, labels, `${title}, ${period}`)}</article>`;
        };
        const dayLabels = Array.from({ length: monthDays }, (_, index) => String(index + 1));
        document.getElementById("fitTrend").innerHTML =
            metricCard("steps", "Steps", monthlyFitSeries("steps", 1), tg.steps, "var(--primary)", "", dayLabels, elapsed, `${monthNames[m]} ${y}`) +
            metricCard("water", "Water", monthlyFitSeries("water", 1000), tg.water / 1000, "var(--accent)", " L", dayLabels, elapsed, `${monthNames[m]} ${y}`) +
            metricCard("sleep", "Sleep", monthlyFitSeries("sleep", 1), tg.sleep, "#8b9bb5", " h", dayLabels, elapsed, `${monthNames[m]} ${y}`) +
            metricCard("exercise", "Exercise", monthlyFitSeries("exerciseMinutes", 1), tg.active, "var(--zone-orange)", " min", dayLabels, elapsed, `${monthNames[m]} ${y}`);

        renderYearly(s);
    }

    function renderYearly() {
        const { y } = selYM();
        const t0 = todayUTC();
        const n = habits.length;
        let yearTicks = 0;
        let yearPossible = 0;
        let best = null;
        let tracked = 0;
        const months = [];
        const matrix = habits.map(() => []);
        for (let m = 0; m < 12; m += 1) {
            const monthStart = Date.UTC(y, m, 1);
            const days = daysIn(y, m);
            const started = monthStart <= t0;
            let ticks = 0;
            habits.forEach((h, hi) => {
                const c = started ? habitTicksInMonth(h, y, m) : 0;
                ticks += c;
                matrix[hi].push(started && ctx.life.first !== null && Date.UTC(y, m, days) >= ctx.life.first ? Math.round((c / (elapsedDays(y, m) || 1)) * 100) : null);
            });
            const possible = n * days;
            const inRange = started && ctx.life.first !== null && Date.UTC(y, m, days) >= ctx.life.first;
            const pct = inRange && possible ? Math.round((ticks / possible) * 100) : null;
            if (pct !== null) {
                yearTicks += ticks; yearPossible += possible; tracked += 1;
                if (!best || pct > best.pct) best = { pct, month: monthNames[m] };
            }
            months.push({ pct, ticks, possible, m, current: monthStart <= t0 && Date.UTC(y, m, days) >= t0 });
        }

        document.getElementById("yearlyChart").innerHTML = `<div class="year-scroll"><div class="year-chart">${months.map((o) => {
            const zone = o.pct === null ? null : getGaugeZone(o.pct);
            return `<div class="year-col${o.pct === null ? " empty" : ""}${o.current ? " current" : ""}" title="${o.pct === null ? `${monthNames[o.m]} ${y}: no data` : `${monthNames[o.m]} ${y}: ${o.ticks} of ${o.possible} check-ins (${o.pct}%)`}">
                <span class="year-val">${o.pct === null ? "–" : `${o.pct}%`}</span>
                <div class="year-track"><span class="year-bar ${zone ? `zone-bg-${zone.key}` : ""}" data-h="${o.pct === null ? 0 : Math.max(o.pct, 3)}"></span></div>
                <span class="year-mon">${monthNames[o.m].slice(0, 3)}</span></div>`;
        }).join("")}</div></div>`;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            document.querySelectorAll("#yearlyChart .year-bar[data-h]").forEach((bar) => { bar.style.height = `${bar.dataset.h}%`; });
        }));

        const tg = dailyTargets(ctx.life);
        const yearMetric = (field, divisor) => monthNames.map((_, month) => {
            const days = elapsedDays(y, month);
            if (!days) return 0;
            let total = 0;
            for (let day = 1; day <= days; day += 1) {
                total += (Number((fitness[isoFromUTC(Date.UTC(y, month, day))] || {})[field]) || 0) / divisor;
            }
            return Math.round((total / days) * 10) / 10;
        });
        const visibleMonths = y < new Date().getFullYear() ? 12 : y === new Date().getFullYear() ? new Date().getMonth() + 1 : 0;
        const monthLabels = monthNames.map((name) => name.slice(0, 3));
        const yearMetricCard = (key, title, values, target, color, unit) => {
            const logged = values.slice(0, visibleMonths).filter((value) => value > 0);
            const average = visibleMonths ? values.slice(0, visibleMonths).reduce((sum, value) => sum + value, 0) / visibleMonths : 0;
            return `<article class="fit-trend-card" data-fit-metric="${key}" tabindex="-1"><div class="fit-trend-head"><strong>${title}</strong><span>${logged.length ? `avg ${average.toFixed(1)}${unit}/day` : "No readings yet"}</span></div>${metricTrendSVG(values, target, visibleMonths, unit, color, monthLabels, `${title}, ${y}`)}</article>`;
        };
        document.getElementById("fitTrendYear").innerHTML =
            yearMetricCard("steps", "Steps · avg/day", yearMetric("steps", 1), tg.steps, "var(--primary)", "") +
            yearMetricCard("water", "Water · avg/day", yearMetric("water", 1000), tg.water / 1000, "var(--accent)", " L") +
            yearMetricCard("sleep", "Sleep · avg/day", yearMetric("sleep", 1), tg.sleep, "#8b9bb5", " h") +
            yearMetricCard("exercise", "Exercise · avg/day", yearMetric("exerciseMinutes", 1), tg.active, "var(--zone-orange)", " min");

        // year kpis
        let perfect = 0;
        let ticksToDate = 0;
        const jan1 = Date.UTC(y, 0, 1);
        const end = Math.min(t0, Date.UTC(y, 11, 31));
        if (jan1 <= t0 && n) {
            for (let x = jan1; x <= end; x += DAY_MS) { const c = dayCount(x); ticksToDate += c; if (c === n) perfect += 1; }
        }
        document.getElementById("anYearKpis").innerHTML =
            kpi(`${y} overall`, tracked ? `${yearPossible ? Math.round((yearTicks / yearPossible) * 100) : 0}%` : "–", tracked ? `${tracked} month${tracked === 1 ? "" : "s"} tracked` : "no data yet") +
            kpi("Check-ins", fmtNum(ticksToDate), `in ${y}`) +
            kpi("Best month", best ? best.month.slice(0, 3) : "–", best ? `${best.pct}%` : "") +
            kpi("Perfect days", perfect, `in ${y}`) +
            kpi("Longest streak", `${ctx.bestStreak}<em> days</em>`, "all time");

        document.getElementById("heatYear").innerHTML = heatYearSVG(y) + `<div class="heat-legend"><span>Less</span><i class="heat-cell lvl0"></i><i class="heat-cell lvl1"></i><i class="heat-cell lvl2"></i><i class="heat-cell lvl3"></i><i class="heat-cell lvl4"></i><span>More</span></div>`;
        document.getElementById("yearMatrix").innerHTML = habits.length ? matrixHTML(habits.map((h) => esc(shortName(h, 14))), matrix) : `<p class="empty-note">Add habits to see this grid.</p>`;

        const radarFrom = ctx.life.first === null ? jan1 : Math.max(jan1, ctx.life.first);
        const yearDays = radarFrom <= end ? Math.round((end - radarFrom) / DAY_MS) + 1 : 0;
        const yv = habits.map((h) => {
            if (!yearDays) return 0;
            let c = 0;
            for (let x = radarFrom; x <= end; x += DAY_MS) if (checks[keyFor(x, h)]) c += 1;
            return Math.round((c / yearDays) * 100);
        });
        document.getElementById("yearRadar").innerHTML = radarSVG(habits.slice(), [{ vals: yv, color: "var(--accent)" }], `Habit balance ${y}`) + `<p class="empty-note">Counted from your first tick in ${y}.</p>`;
    }

    /* ---------- fitness: manual log + Google Health ---------- */

    const pad2 = (n) => String(n).padStart(2, "0");

    function dailyTargets(life) {
        const tier = TIERS[GAUGE_ZONES.indexOf(getGaugeZone(life.percent))];
        const isRecovery = WEEK_PLAN[new Date().getDay()] === "recovery";
        let steps = tier.steps;
        let water = 2500;
        if (bodyProfile) {
            water = clamp(bodyProfile.weight * 0.035 + (isRecovery ? 0 : 0.3), 1.5, 4.5) * 1000;
            if (bodyInfo().bmi < 18.5) steps = Math.min(steps, 8000);
        }
        return { steps, water: Math.round(water / 50) * 50, sleep: 8, active: 30 };
    }

    function googleToken() {
        if (!HEALTH_ON) return null;
        try {
            const t = JSON.parse(sessionStorage.getItem("lifetrack-gtoken") || "null");
            if (t && t.token && t.exp > Date.now()) return t.token;
        } catch (e) { /* ignore */ }
        return null;
    }

    function driveToken() {
        try {
            const token = JSON.parse(sessionStorage.getItem("lifetrack-drive-token") || "null");
            return token && token.token && token.exp > Date.now() ? token.token : null;
        } catch (e) { return null; }
    }

    let persistentGoogleRefresh = null;

    async function refreshPersistentGoogleSession(forceRefresh) {
        if (currentUser.provider !== "google" || location.protocol === "file:") return false;
        const existingToken = driveToken();
        if (existingToken && !forceRefresh) {
            const stored = JSON.parse(sessionStorage.getItem("lifetrack-drive-token") || "null");
            if (stored && stored.exp > Date.now() + 120_000) return true;
        }
        if (persistentGoogleRefresh) return persistentGoogleRefresh;

        persistentGoogleRefresh = (async () => {
            const response = await fetch("/api/auth/session", {
                credentials: "same-origin",
                cache: "no-store"
            });
            if (response.status === 401) {
                sessionStorage.removeItem("lifetrack-drive-token");
                sessionStorage.removeItem("lifetrack-gtoken");
                setFitStatus("Google Drive sync needs reconnecting. Your LifeTrack account is still signed in; choose Reconnect Google sync from the profile menu.", "warn");
                return false;
            }
            if (!response.ok) throw new Error(`Could not refresh the Google session (HTTP ${response.status}).`);
            const session = await response.json();
            if (!session.user || session.user.uid !== currentUser.uid || !session.accessToken) {
                throw new Error("The saved Google session belongs to a different LifeTrack account. Reconnect Google sync from the profile menu.");
            }
            const scopes = new Set(Array.isArray(session.scopes) ? session.scopes : []);
            if (!scopes.has("https://www.googleapis.com/auth/drive.appdata")) {
                sessionStorage.removeItem("lifetrack-drive-token");
                sessionStorage.removeItem("lifetrack-gtoken");
                setFitStatus("Allow Google Drive app-data access to resume secure syncing.", "warn");
                return false;
            }
            const expiry = Date.now() + Math.max(30, Number(session.expiresIn || 3600) - 60) * 1000;
            sessionStorage.setItem("lifetrack-drive-token", JSON.stringify({ token: session.accessToken, exp: expiry }));
            sessionStorage.removeItem("lifetrack-gtoken");
            return true;
        })();
        try {
            return await persistentGoogleRefresh;
        } finally {
            persistentGoogleRefresh = null;
        }
    }

    function reconnectGoogleSync() {
        if (location.protocol === "file:") {
            toast("Google sync can only reconnect from the hosted HTTPS LifeTrack site.");
            return;
        }
        window.location.assign("/api/auth/google/start?returnTo=dashboard.html");
    }

    function mergeReadingPlans(localPlan, remotePlan) {
        const local = localPlan && typeof localPlan === "object" ? localPlan : null;
        const remote = remotePlan && typeof remotePlan === "object" ? remotePlan : null;
        if (!local) return remote || readingPlan;
        if (!remote) return local;

        const localCompleted = Array.isArray(local.completedBooks) ? local.completedBooks.length : 0;
        const remoteCompleted = Array.isArray(remote.completedBooks) ? remote.completedBooks.length : 0;
        const localUpdated = Number(local.updatedAt) || 0;
        const remoteUpdated = Number(remote.updatedAt) || 0;
        let preferred;

        if (localCompleted !== remoteCompleted) {
            preferred = localCompleted > remoteCompleted ? local : remote;
        } else {
            preferred = localUpdated > remoteUpdated ? local : remote;
        }

        const merged = Object.assign({}, preferred === local ? remote : local, preferred);
        const deletedCustomBooks = {};
        [local.deletedCustomBooks, remote.deletedCustomBooks].forEach((deletions) => {
            if (!deletions || typeof deletions !== "object") return;
            Object.entries(deletions).forEach(([id, deletedAt]) => {
                const timestamp = Number(deletedAt);
                if (id && Number.isFinite(timestamp)) {
                    deletedCustomBooks[id] = Math.max(deletedCustomBooks[id] || 0, timestamp);
                }
            });
        });
        const customBooks = new Map();
        [local, remote].forEach((plan) => {
            (Array.isArray(plan.customBooks) ? plan.customBooks : []).forEach((book) => {
                if (!book || typeof book.id !== "string" || !book.id) return;
                const existing = customBooks.get(book.id);
                const timestamp = Number(book.updatedAt || book.addedAt || plan.updatedAt) || 0;
                const existingTimestamp = existing
                    ? Number(existing.book.updatedAt || existing.book.addedAt || existing.planUpdatedAt) || 0
                    : -1;
                if (!existing || timestamp >= existingTimestamp) {
                    customBooks.set(book.id, { book, planUpdatedAt: Number(plan.updatedAt) || 0 });
                }
            });
        });
        Object.entries(deletedCustomBooks).forEach(([id, deletedAt]) => {
            const entry = customBooks.get(id);
            const addedAt = entry
                ? Number(entry.book.addedAt || entry.book.updatedAt) || 0
                : 0;
            if (entry && addedAt > deletedAt) {
                delete deletedCustomBooks[id];
            } else {
                customBooks.delete(id);
            }
        });
        merged.customBooks = Array.from(customBooks.values(), (entry) => entry.book);
        merged.deletedCustomBooks = deletedCustomBooks;

        const completedBooks = new Map();
        [local, remote].forEach((plan) => {
            (Array.isArray(plan.completedBooks) ? plan.completedBooks : []).forEach((book) => {
                if (!book || typeof book.id !== "string" || !book.id) return;
                const existing = completedBooks.get(book.id);
                const timestamp = String(book.completedAt || "");
                if (!existing || timestamp >= String(existing.completedAt || "")) completedBooks.set(book.id, book);
            });
        });
        merged.completedBooks = Array.from(completedBooks.values());

        const localProgressByBook = local.bookProgress && typeof local.bookProgress === "object" ? local.bookProgress : {};
        const remoteProgressByBook = remote.bookProgress && typeof remote.bookProgress === "object" ? remote.bookProgress : {};
        const bookProgress = {};
        const allProgressIds = new Set([
            ...Object.keys(localProgressByBook),
            ...Object.keys(remoteProgressByBook)
        ]);
        allProgressIds.forEach((id) => {
            const localProgress = localProgressByBook[id];
            const remoteProgress = remoteProgressByBook[id];
            if (!localProgress || !remoteProgress) {
                bookProgress[id] = Object.assign({}, localProgress || remoteProgress);
                return;
            }
            const localProgressAt = Number(localProgress.updatedAt) || 0;
            const remoteProgressAt = Number(remoteProgress.updatedAt) || 0;
            if (localProgressAt !== remoteProgressAt) {
                bookProgress[id] = Object.assign({}, localProgressAt > remoteProgressAt ? localProgress : remoteProgress);
            } else if (localProgressAt === 0) {
                // Older saved progress has no per-book timestamp; keep the furthest page instead of resetting it.
                bookProgress[id] = Object.assign(
                    {},
                    Number(localProgress.page) >= Number(remoteProgress.page) ? remoteProgress : localProgress,
                    Number(localProgress.page) >= Number(remoteProgress.page) ? localProgress : remoteProgress
                );
            } else {
                bookProgress[id] = Object.assign({}, localProgress);
            }
        });
        Object.keys(deletedCustomBooks).forEach((id) => delete bookProgress[id]);
        merged.bookProgress = bookProgress;
        const completedToday = [local.goalCompletedDate, remote.goalCompletedDate]
            .filter((date) => typeof date === "string")
            .sort()
            .pop();
        if (completedToday) merged.goalCompletedDate = completedToday;
        merged.updatedAt = Math.max(localUpdated, remoteUpdated);
        return merged;
    }

    // Keep unsent changes marked locally until a Drive upload succeeds.
    function scheduleCloudSync() {
        if (cloudApplying) return;
        localStorage.setItem(NS + "lt_dirty", "true");
        localStorage.setItem("lt_dirty", "true");
        const previousUpdatedAt = Number(localStorage.getItem(NS + "cloud-updated-at")) || 0;
        localStorage.setItem(NS + "cloud-updated-at", String(Math.max(Date.now(), previousUpdatedAt + 1)));
        if (!navigator.onLine) {
            setFitStatus("Offline: changes saved on this device", "warn");
            return;
        }
        if (!driveToken()) {
            const status = document.getElementById("fitStatus");
            if (status && currentUser.provider === "google") {
                status.textContent = "Google sync is paused; your LifeTrack account is still signed in. Reconnect Google sync from the profile menu.";
                status.className = "fit-status warn";
            }
            return;
        }
        clearTimeout(cloudTimer);
        cloudTimer = setTimeout(() => syncCloud(), 2000);
    }

    function clearLocalCloudDirtyFlag() {
        localStorage.removeItem(NS + "lt_dirty");
        const anotherAccountHasChanges = Object.keys(localStorage).some((key) =>
            key.startsWith("lifetrack:") && key.endsWith(":lt_dirty") && localStorage.getItem(key) === "true"
        );
        if (!anotherAccountHasChanges) localStorage.removeItem("lt_dirty");
    }

    function cloudSnapshot() {
        return {
            app: "LifeTrack",
            version: 1,
            updatedAt: Number(localStorage.getItem(NS + "cloud-updated-at")) || Date.now(),
            habits,
            deletedHabits,
            checks,
            habitStarts,
            body: bodyProfile,
            goals,
            deletedGoals,
            fitness,
            readingPlan,
            dailyTask: dailyTaskState,
            aiConversation,
            aiMemorySummary
        };
    }

    async function driveRequest(url, options, retried) {
        let token = driveToken();
        if (!token && await refreshPersistentGoogleSession()) token = driveToken();
        if (!token) throw new Error("Google sync needs reconnecting. Your LifeTrack account is still signed in; choose Reconnect Google sync from the profile menu.");
        const response = await fetch(url, Object.assign({}, options, {
            headers: Object.assign({ Authorization: `Bearer ${token}` }, options && options.headers || {})
        }));
        if (response.status === 401) {
            sessionStorage.removeItem("lifetrack-drive-token");
            if (!retried && await refreshPersistentGoogleSession()) return driveRequest(url, options, true);
            throw new Error("Google sync authorization expired. Your LifeTrack account is still signed in; choose Reconnect Google sync from the profile menu.");
        }
        if (response.status === 403) {
            const details = await response.clone().json().catch(() => null);
            const googleError = details && details.error && typeof details.error === "object" ? details.error : {};
            const reasons = Array.isArray(googleError.errors)
                ? googleError.errors.map((item) => item && item.reason).filter((reason) => typeof reason === "string")
                : [];
            const reason = reasons[0] || googleError.status || "";
            if (/rateLimitExceeded|userRateLimitExceeded|quotaExceeded/i.test(reason)) {
                const retryAfter = Number(response.headers.get("Retry-After"));
                const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0
                    ? retryAfter * 1000
                    : 0;
                const rateLimitError = new Error("Google Drive temporarily rate-limited LifeTrack. Sync will retry automatically after a short cooldown.");
                rateLimitError.driveRateLimited = true;
                rateLimitError.retryAfterMs = retryAfterMs;
                throw rateLimitError;
            }
            if (!retried) {
                sessionStorage.removeItem("lifetrack-drive-token");
                if (await refreshPersistentGoogleSession(true)) return driveRequest(url, options, true);
            }
            if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason)) {
                throw new Error("Google Drive API is disabled for this Google Cloud project. Enable the Google Drive API in the same project as LifeTrack's OAuth client, then choose Reconnect Google sync.");
            }
            if (/insufficientPermissions|insufficientFilePermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|PERMISSION_DENIED/i.test(reason)) {
                throw new Error("Google Drive denied LifeTrack's app-data permission. Choose Reconnect Google sync and allow Drive app-data access. If it still fails, verify the Google Drive API is enabled for LifeTrack's OAuth project.");
            }
            const message = typeof googleError.message === "string"
                ? googleError.message.replace(/[\r\n\t]+/g, " ").slice(0, 180)
                : "";
            throw new Error(`Google Drive denied sync (HTTP 403${reason ? `, ${reason}` : ""})${message ? `: ${message}` : "."}`);
        }
        if (!response.ok) throw new Error(`Google Drive sync failed (HTTP ${response.status}).`);
        return response;
    }

    async function readDriveBackup(response) {
        const text = await response.text();
        if (!text.trim()) return null;
        try {
            return JSON.parse(text);
        } catch {
            throw new Error(`Google Drive returned invalid LifeTrack backup JSON (HTTP ${response.status}); local data was not changed.`);
        }
    }

    async function syncCloud() {
        if (!navigator.onLine) {
            if (localStorage.getItem(NS + "lt_dirty") === "true") {
                setFitStatus("Offline: changes saved on this device", "warn");
            }
            return;
        }
        const persistedRateLimitUntil = Number(localStorage.getItem(NS + "drive-sync-backoff-until")) || 0;
        cloudRateLimitUntil = Math.max(cloudRateLimitUntil, persistedRateLimitUntil);
        if (Date.now() < cloudRateLimitUntil) return;
        if (cloudSyncing) {
            cloudSyncRequested = true;
            return;
        }
        cloudSyncing = true;
        cloudSyncRequested = false;
        setFitStatus("Syncing...", "");
        try {
            await syncCloudWithDrive();
        } finally {
            cloudSyncing = false;
            if (cloudSyncRequested && navigator.onLine) {
                cloudSyncRequested = false;
                clearTimeout(cloudTimer);
                cloudTimer = setTimeout(() => syncCloud(), 2000);
            }
        }
    }

    async function syncCloudWithDrive() {
        if (!driveToken()) {
            try {
                if (!await refreshPersistentGoogleSession()) return;
            } catch (error) {
                setFitStatus(error.message, "warn");
                return;
            }
        }
        const persistedRateLimitUntil = Number(localStorage.getItem(NS + "drive-sync-backoff-until")) || 0;
        cloudRateLimitUntil = Math.max(cloudRateLimitUntil, persistedRateLimitUntil);
        if (Date.now() < cloudRateLimitUntil) return;
        try {
            const listResponse = await driveRequest("https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&pageSize=1000&fields=files(id,name,mimeType)");
            const listed = await listResponse.json();
            const file = (listed.files || []).find((entry) => entry.name === "lifetrack-data.json");
            let remote = null;

            if (file) {
                cloudFileId = file.id;
                const response = await driveRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`);
                remote = await readDriveBackup(response);
            }

            const localUpdatedAt = Number(localStorage.getItem(NS + "cloud-updated-at")) || 0;
            const lastCloudSyncAt = Number(localStorage.getItem(NS + "cloud-synced-at")) || 0;
            const hasLocalChanges = localStorage.getItem(NS + "lt_dirty") === "true"
                || localUpdatedAt > lastCloudSyncAt;
            const mergedReadingPlan = remote && remote.app === "LifeTrack"
                ? mergeReadingPlans(readingPlan, remote.readingPlan)
                : readingPlan;
            const readingPlanNeedsUpload = Boolean(remote && remote.app === "LifeTrack"
                && JSON.stringify(mergedReadingPlan) !== JSON.stringify(remote.readingPlan));
            let conversationNeedsUpload = false;
            let conversationNeedsApply = false;
            if (remote && remote.app === "LifeTrack") {
                const remoteConversation = normalizeAIConversation(
                    remote.aiConversation,
                    Number(remote.updatedAt) || Date.now()
                );
                const mergedConversation = mergeAIConversations(
                    aiConversation,
                    remoteConversation,
                    Number(remote.updatedAt) || Date.now()
                );
                conversationNeedsUpload = JSON.stringify(mergedConversation) !== JSON.stringify(remoteConversation);
                conversationNeedsApply = JSON.stringify(mergedConversation) !== JSON.stringify(aiConversation);
                if (conversationNeedsApply) {
                    aiConversation = mergedConversation;
                    cloudApplying = true;
                    saveAssistantState("ai-conversation", aiConversation);
                    cloudApplying = false;
                    renderAIMessages();
                }
                const remoteMemory = typeof remote.aiMemorySummary === "string"
                    ? remote.aiMemorySummary.replace(/\s+/g, " ").trim().slice(0, 900)
                    : "";
                if (!aiMemorySummary && remoteMemory) {
                    aiMemorySummary = remoteMemory;
                    saveAssistantState("ai-memory-summary", aiMemorySummary);
                }
            }

            if (remote && remote.app === "LifeTrack" && Number(remote.updatedAt) > localUpdatedAt
                && !hasLocalChanges && !conversationNeedsUpload && !readingPlanNeedsUpload) {
                cloudApplying = true;
                deletedHabits = mergeDeletedHabits(deletedHabits, remote.deletedHabits);
                habits = Array.isArray(remote.habits)
                    ? remote.habits.map(String).filter((name) => !(deletedHabits[name] && deletedHabits[name].deleted))
                    : habits.filter((name) => !(deletedHabits[name] && deletedHabits[name].deleted));
                checks = remote.checks && typeof remote.checks === "object" ? remote.checks : checks;
                habitStarts = remote.habitStarts && typeof remote.habitStarts === "object" ? remote.habitStarts : habitStarts;
                bodyProfile = remote.body || null;
                deletedGoals = mergeDeletedGoals(deletedGoals, remote.deletedGoals);
                goals = Array.isArray(remote.goals)
                    ? remote.goals.filter((goal) => !(deletedGoals[goal.id] && deletedGoals[goal.id].deleted))
                    : goals.filter((goal) => !(deletedGoals[goal.id] && deletedGoals[goal.id].deleted));
                fitness = remote.fitness && typeof remote.fitness === "object" ? remote.fitness : fitness;
                restoreFocusTimer(true);
                readingPlan = mergedReadingPlan;
                dailyTaskState = remote.dailyTask && typeof remote.dailyTask === "object" ? remote.dailyTask : dailyTaskState;
                store.set("habits", JSON.stringify(habits));
                store.set("deleted-habits", JSON.stringify(deletedHabits));
                store.set("checks", JSON.stringify(checks));
                store.set("habit-start", JSON.stringify(habitStarts));
                if (bodyProfile) store.set("body", JSON.stringify(bodyProfile)); else store.remove("body");
                store.set("goals", JSON.stringify(goals));
                store.set("deleted-goals", JSON.stringify(deletedGoals));
                store.set("fitness", JSON.stringify(fitness));
                store.set("reading-plan", JSON.stringify(readingPlan));
                if (dailyTaskState) store.set("daily-task", JSON.stringify(dailyTaskState));
                localStorage.setItem(NS + "cloud-updated-at", String(Number(remote.updatedAt)));
                localStorage.setItem(NS + "cloud-synced-at", String(Number(remote.updatedAt)));
                cloudApplying = false;
                notifyReadingPlanChanged();
                ensureYearOptions();
                renderCalendar();
                renderStats();
            } else {
                let snapshot = cloudSnapshot();
                if (remote && remote.app === "LifeTrack" && (hasLocalChanges || conversationNeedsUpload || readingPlanNeedsUpload)) {
                    const mergedFitness = mergeCloudFitness(remote.fitness);
                    const mergedGoals = new Map((remote.goals || []).map((goal) => [goal.id, goal]));
                    (goals || []).forEach((goal) => mergedGoals.set(goal.id, goal));
                    deletedGoals = mergeDeletedGoals(deletedGoals, remote.deletedGoals);
                    snapshot = Object.assign({}, snapshot, {
                        updatedAt: Math.max(Date.now(), Number(remote.updatedAt) || 0),
                        deletedHabits: mergeDeletedHabits(deletedHabits, remote.deletedHabits),
                        habits: [],
                        checks: Object.assign({}, remote.checks || {}, checks),
                        habitStarts: Object.assign({}, remote.habitStarts || {}, habitStarts),
                        body: bodyProfile || remote.body || null,
                        goals: Array.from(mergedGoals.values()).filter((goal) => !(deletedGoals[goal.id] && deletedGoals[goal.id].deleted)),
                        deletedGoals,
                        fitness: mergedFitness,
                        readingPlan: mergedReadingPlan,
                        dailyTask: mergeDailyTaskState(dailyTaskState, remote.dailyTask),
                        aiConversation,
                        aiMemorySummary
                    });
                    snapshot.habits = mergeHabitNames(habits, remote.habits, snapshot.deletedHabits);
                    habits = snapshot.habits;
                    deletedHabits = snapshot.deletedHabits;
                    checks = snapshot.checks;
                    habitStarts = snapshot.habitStarts;
                    bodyProfile = snapshot.body;
                    goals = snapshot.goals;
                    fitness = snapshot.fitness;
                    restoreFocusTimer(true);
                    readingPlan = snapshot.readingPlan;
                    dailyTaskState = snapshot.dailyTask;
                    cloudApplying = true;
                    store.set("habits", JSON.stringify(habits));
                    store.set("deleted-habits", JSON.stringify(deletedHabits));
                    store.set("checks", JSON.stringify(checks));
                    store.set("habit-start", JSON.stringify(habitStarts));
                    if (bodyProfile) store.set("body", JSON.stringify(bodyProfile)); else store.remove("body");
                    store.set("goals", JSON.stringify(goals));
                    store.set("deleted-goals", JSON.stringify(deletedGoals));
                    store.set("fitness", JSON.stringify(fitness));
                    store.set("reading-plan", JSON.stringify(readingPlan));
                    if (dailyTaskState) store.set("daily-task", JSON.stringify(dailyTaskState));
                    cloudApplying = false;
                    notifyReadingPlanChanged();
                    ensureYearOptions();
                    renderCalendar();
                    renderStats();
                }

                const body = JSON.stringify(snapshot);
                let uploadSucceeded = false;
                if (file) {
                    await driveRequest(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(file.id)}?uploadType=media`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body
                    });
                    uploadSucceeded = true;
                } else {
                    const createResponse = await driveRequest("https://www.googleapis.com/drive/v3/files?fields=id", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name: "lifetrack-data.json", mimeType: "application/json", parents: ["appDataFolder"] })
                    });
                    const created = await createResponse.json();
                    cloudFileId = created.id;
                    await driveRequest(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(created.id)}?uploadType=media`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body
                    });
                    uploadSucceeded = true;
                }
                const latestLocalUpdatedAt = Number(localStorage.getItem(NS + "cloud-updated-at")) || 0;
                if (latestLocalUpdatedAt <= snapshot.updatedAt) {
                    localStorage.setItem(NS + "cloud-updated-at", String(snapshot.updatedAt));
                }
                localStorage.setItem(NS + "cloud-synced-at", String(snapshot.updatedAt));
                if (uploadSucceeded && latestLocalUpdatedAt <= snapshot.updatedAt) {
                    clearLocalCloudDirtyFlag();
                }
            }
            cloudRateLimitAttempts = 0;
            cloudRateLimitUntil = 0;
            localStorage.removeItem(NS + "drive-sync-backoff-until");
            const syncedAt = Date.now();
            localStorage.setItem(NS + "cloud-last-success-at", String(syncedAt));
            setFitStatus(`Last synced at ${new Date(syncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`, "good");
        } catch (error) {
            cloudApplying = false;
            console.error("LifeTrack cloud sync failed", error);
            if (error && error.driveRateLimited) {
                cloudRateLimitAttempts += 1;
                const backoffMs = Math.min(15 * 60_000, 30_000 * (2 ** Math.min(cloudRateLimitAttempts - 1, 5)));
                cloudRateLimitUntil = Date.now() + Math.max(backoffMs, Number(error.retryAfterMs) || 0);
                localStorage.setItem(NS + "drive-sync-backoff-until", String(cloudRateLimitUntil));
                const retryMinutes = Math.max(1, Math.ceil((cloudRateLimitUntil - Date.now()) / 60_000));
                error.message = `Google Drive rate-limited LifeTrack. Sync paused for about ${retryMinutes} minute${retryMinutes === 1 ? "" : "s"} and will retry automatically.`;
            }
            setFitStatus(error.message, "warn");
        }
    }

    function mergeCloudFitness(remoteFitness) {
        const merged = Object.assign({}, remoteFitness && typeof remoteFitness === "object" ? remoteFitness : {});
        Object.keys(fitness).forEach((day) => {
            const localEntry = fitness[day] && typeof fitness[day] === "object" ? fitness[day] : {};
            const remoteEntry = merged[day] && typeof merged[day] === "object" ? merged[day] : {};
            const entry = Object.assign({}, remoteEntry, localEntry);
            [
                ["steps", "src_steps", "healthConnectStepsUpdatedAt"],
                ["sleep", "src_sleep", "healthConnectSleepUpdatedAt"],
                ["active", "src_active", "healthConnectActiveUpdatedAt"],
                ["activeCalories", "src_activeCalories", "healthConnectCaloriesUpdatedAt"]
            ].forEach(([valueKey, sourceKey, updatedAtKey]) => {
                if ((Number(remoteEntry[updatedAtKey]) || 0) <= (Number(localEntry[updatedAtKey]) || 0)) return;
                [valueKey, sourceKey, updatedAtKey].forEach((key) => {
                    if (Object.prototype.hasOwnProperty.call(remoteEntry, key)) entry[key] = remoteEntry[key];
                    else delete entry[key];
                });
            });
            merged[day] = entry;
        });
        return merged;
    }

    function pollGoogleDrive() {
        if (document.visibilityState === "visible" && currentUser.provider === "google") void syncCloud();
    }
    window.addEventListener("focus", pollGoogleDrive);
    document.addEventListener("visibilitychange", pollGoogleDrive);
    setInterval(pollGoogleDrive, 30_000);

    function setFitStatus(text, kind) {
        fitStatus = { text, kind: kind || "" };
        const el = document.getElementById("fitStatus");
        if (el) { el.textContent = text; el.className = `fit-status ${kind || ""}`; }
    }

    function normalizeHealthSleepHours(value) {
        return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 24
            ? value
            : null;
    }

    function activeExerciseTimer() {
        const date = isoFromUTC(todayUTC());
        const entry = fitness[date];
        return entry && Number(entry.exerciseStartedAt) > 0 ? { date, entry } : null;
    }

    function formatExerciseDuration(seconds) {
        const total = Math.max(0, Math.floor(Number(seconds) || 0));
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const remainder = total % 60;
        return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
    }

    function formatExerciseMinutes(minutes) {
        const total = Math.max(0, Number(minutes) || 0);
        return Number.isInteger(total) ? String(total) : total.toFixed(1);
    }

    function accumulateExerciseMinutes(savedMinutes, elapsedSeconds) {
        const saved = Math.max(0, Number(savedMinutes) || 0);
        const elapsed = Math.max(0, Number(elapsedSeconds) || 0);
        return Math.round((saved + elapsed / 60) * 10) / 10;
    }

    let exerciseTimerInterval = null;
    let exerciseTimerDate = isoFromUTC(todayUTC());
    function updateExerciseTimerClock() {
        const today = isoFromUTC(todayUTC());
        if (today !== exerciseTimerDate) {
            exerciseTimerDate = today;
            renderStats();
            return;
        }
        const output = document.getElementById("exerciseClock");
        if (!output) return;
        const running = activeExerciseTimer();
        const entry = running ? running.entry : fitness[isoFromUTC(todayUTC())] || {};
        const startedAt = running ? Number(entry.exerciseStartedAt) : 0;
        const elapsed = (Number(entry.exerciseElapsedSeconds) || 0)
            + (startedAt > 0 ? Math.floor((Date.now() - startedAt) / 1000) : 0);
        output.textContent = formatExerciseDuration(elapsed);
        const button = document.querySelector("[data-exercise-toggle]");
        if (button) {
            button.textContent = running ? "Stop" : "Start";
            button.setAttribute("aria-label", running ? "Stop exercise timer" : "Start exercise timer");
            button.setAttribute("aria-pressed", String(Boolean(running)));
        }
        const saveButton = document.querySelector("[data-exercise-save]");
        if (saveButton) saveButton.disabled = elapsed < 1;
        if (bodyProfile && document.querySelector(".section.active-section")?.id === "dashboard") {
            renderExerciseChart();
        }
        if (running && !exerciseTimerInterval) {
            exerciseTimerInterval = window.setInterval(updateExerciseTimerClock, 1000);
        } else if (!running && exerciseTimerInterval) {
            window.clearInterval(exerciseTimerInterval);
            exerciseTimerInterval = null;
        }
    }

    function toggleExerciseTimer() {
        const running = activeExerciseTimer();
        if (running) {
            const startedAt = Number(running.entry.exerciseStartedAt);
            running.entry.exerciseElapsedSeconds = (Number(running.entry.exerciseElapsedSeconds) || 0)
                + Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
            running.entry.exerciseStartedAt = null;
        } else {
            const iso = isoFromUTC(todayUTC());
            const entry = fitness[iso] || (fitness[iso] = {});
            entry.exerciseElapsedSeconds = Number(entry.exerciseElapsedSeconds) || 0;
            entry.exerciseStartedAt = Date.now();
        }
        saveFit();
        renderStats();
    }

    function saveExerciseTimer() {
        const running = activeExerciseTimer();
        const iso = isoFromUTC(todayUTC());
        const entry = running ? running.entry : fitness[iso] || (fitness[iso] = {});
        const elapsedSeconds = (Number(entry.exerciseElapsedSeconds) || 0)
            + (running
                ? Math.max(0, Math.floor((Date.now() - Number(entry.exerciseStartedAt)) / 1000))
                : 0);
        if (elapsedSeconds < 1) return;

        entry.exerciseMinutes = accumulateExerciseMinutes(entry.exerciseMinutes, elapsedSeconds);
        entry.exerciseElapsedSeconds = 0;
        if (running) entry.exerciseStartedAt = Date.now();
        saveFit();
        renderStats();
    }

    function renderFitness() {
        const box = document.getElementById("fitBody");
        const acts = document.getElementById("fitActions");
        const iso = isoFromUTC(todayUTC());
        const f = fitness[iso] || {};
        const tg = dailyTargets(ctx.life);
        const linked = Boolean(googleToken());

        acts.innerHTML = !HEALTH_ON ? ""
            : linked
            ? `<span class="chip good">● Live from Google</span><button type="button" class="secondary-button" id="gSync">Sync now</button>`
            : `<span class="chip">Sign in with Google for health data</span>`;

        const src = (k) => ({
            google: `<small class="src">from Google</small>`,
            "health-connect": `<small class="src">from Health Connect</small>`,
            "apple-health": `<small class="src">from Apple Health</small>`,
            "android-usage": `<small class="src">from this device</small>`
        }[f[`src_${k}`]] || "");
        const lastSevenDayAverage = (field, divisor, formatter) => {
            const values = [];
            for (let offset = 6; offset >= 0; offset -= 1) {
                const day = fitness[isoFromUTC(todayUTC() - offset * DAY_MS)] || {};
                if (typeof day[field] === "number" && Number.isFinite(day[field]) && day[field] >= 0) {
                    values.push(day[field] / divisor);
                }
            }
            const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
            const loggedDays = values.length;
            const formatted = average === null ? "—" : formatter(average);
            const note = loggedDays ? `${loggedDays} of the last 7 days have readings` : "No readings in the last 7 days";
            return `<small class="fit-average" title="${note}"><span>7-day avg</span><strong>${formatted}</strong>${loggedDays ? `<span>${loggedDays}/7 days</span>` : ""}</small>`;
        };
        const tile = (key, label, value, goal, color, text, control, average = "", icon = "") => {
            const p = goal ? clamp(((Number(value) || 0) / goal) * 100, 0, 100) : 0;
            const trendAttributes = ["steps", "water", "sleep"].includes(key)
                ? key === "water"
                    ? ` data-fit-trend="${key}" role="group" tabindex="0" aria-label="Water metric. Press Enter to open its Analytics trend; water controls remain available."`
                    : ` data-fit-trend="${key}" role="button" tabindex="0" aria-label="Open ${label} trend in Analytics"`
                : "";
            return `<div class="fit-tile"${trendAttributes}>${ringSVG(p, { size: 84, stroke: 8, color, icon })}<strong>${label}</strong><span class="fit-val">${text}</span>${average}${control}${src(key)}</div>`;
        };
        const moods = ["😞", "🙁", "😐", "🙂", "😄"];
        const steps = Number(f.steps) || 0;
        const sleepHours = normalizeHealthSleepHours(f.sleep);
        const savedDeviceFocusMinutes = Number(f.deviceFocusMinutes);
        const deviceFocusMinutes = isNativeAndroidApp
            ? deviceFocusPermissionGranted && Number.isFinite(savedDeviceFocusMinutes) ? savedDeviceFocusMinutes : null
            : Number.isFinite(savedDeviceFocusMinutes) && savedDeviceFocusMinutes >= 0 ? savedDeviceFocusMinutes : null;
        const focusSessionMinutes = Number.isFinite(Number(f.focusMinutes)) && Number(f.focusMinutes) >= 0
            ? Number(f.focusMinutes)
            : 0;
        const focusMinutes = focusSessionMinutes;
        const hasFocusData = Object.prototype.hasOwnProperty.call(f, "focusMinutes");
        const focusGoalMinutes = 30;
        const hasProfile = Boolean(bodyProfile && bodyProfile.weight > 0 && bodyProfile.height > 0);
        const strideMeters = hasProfile ? (bodyProfile.height / 100) * 0.415 : 0.72;
        const distanceKm = Math.round((steps * strideMeters) / 10) / 100;
        const caloriesBurned = hasProfile ? Math.round(steps * bodyProfile.weight * 0.0005) : null;
        const calorieGoal = hasProfile ? Math.round(tg.steps * bodyProfile.weight * 0.0005) : 0;
        const metricTile = (label, value, unit, progress, color, ariaLabel, note = "", icon = "") =>
            `<div class="vital-tile">${ringSVG(progress, { size: 76, stroke: 7, color, text: value == null ? "—" : String(value), ariaLabel, icon })}<strong>${label}</strong><span class="fit-val">${unit}</span>${note ? `<small class="src">${note}</small>` : ""}</div>`;
        box.innerHTML = `<div class="fit-grid">
            ${tile("steps", "Steps", f.steps || 0, tg.steps, "var(--primary)", `${fmtNum(f.steps || 0)} / ${fmtNum(tg.steps)}`,
                "",
                lastSevenDayAverage("steps", 1, fmtNum), "shoe")}
            ${tile("water", "Water", f.water || 0, tg.water, "var(--accent)", `${((f.water || 0) / 1000).toFixed(2)} / ${(tg.water / 1000).toFixed(1)} L`,
                `<div class="fit-btns"><button type="button" data-water="-250" aria-label="Remove 250 ml">−</button><button type="button" data-water="250" aria-label="Add 250 ml">+250 ml</button></div>`,
                lastSevenDayAverage("water", 1000, (value) => `${value.toFixed(1)} L`), "water")}
            ${tile("sleep", "Sleep", sleepHours || 0, tg.sleep, "#8b9bb5", `${sleepHours === null ? "—" : sleepHours.toFixed(1)} / ${tg.sleep} h`,
                "",
                lastSevenDayAverage("sleep", 1, (value) => `${value.toFixed(1)} h`), "sleep")}
            <div class="fit-tile">${ringSVG(hasFocusData ? clamp((focusMinutes / focusGoalMinutes) * 100, 0, 100) : 0, {
                size: 84,
                stroke: 8,
                color: "var(--primary)",
                text: !hasFocusData ? "—" : focusMinutes >= 60
                    ? `${Math.floor(focusMinutes / 60)}h`
                    : `${focusMinutes}m`,
                ariaLabel: hasFocusData
                    ? `${focusMinutes} LifeTrack focus-session minutes today`
                    : "No completed LifeTrack focus sessions today",
                icon: "focus"
            })}<strong>Focus</strong><span class="fit-val">${hasFocusData ? `${fmtNum(focusMinutes)} / ${focusGoalMinutes} min` : `— / ${focusGoalMinutes} min`}</span><small class="src">LifeTrack sessions only · app usage excluded</small></div>
        </div>
        <div class="vitals-grid">
            ${metricTile("Calories burned", caloriesBurned == null ? null : fmtNum(caloriesBurned), "estimated kcal", calorieGoal ? (caloriesBurned / calorieGoal) * 100 : 0, "var(--zone-orange)", caloriesBurned == null ? "Calories unavailable until body weight is added" : `Estimated ${caloriesBurned} kilocalories from ${steps} steps and ${bodyProfile.weight} kg`, hasProfile ? "steps + plan weight" : "add weight in Daily Plan", "flame")}
            ${metricTile("Distance", distanceKm.toFixed(2), "km estimated", tg.steps ? (steps / tg.steps) * 100 : 0, "var(--primary)", `${distanceKm.toFixed(2)} kilometers estimated from ${steps} steps`, hasProfile ? "steps + plan height" : "steps · average stride", "distance")}
        </div>
        <div class="mood-row"><span>How do you feel today?</span><div>${moods.map((e, i) => `<button type="button" class="mood-btn${f.mood === i + 1 ? " on" : ""}" data-mood="${i + 1}" aria-label="Mood ${i + 1} of 5" aria-pressed="${f.mood === i + 1}">${e}</button>`).join("")}</div></div>
        <p id="fitStatus" class="fit-status ${fitStatus.kind}">${esc(fitStatus.text || (isNativeLifeTrackApp
            ? `Connect ${isNativeAndroidApp ? "Android Health Connect" : "Apple Health"} from Additional features to import steps and sleep.`
            : "Health Connect readings are read-only and available in the native Android or iPhone app."))}</p>`;
        animateRings(box);
        updateExerciseTimerClock();
    }

    function setFit(field, value) {
        if (["steps", "sleep", "active", "activeCalories", "deviceFocusMinutes"].includes(field)) {
            toast("Health and device metrics are read-only and update from your connected device.");
            return;
        }
        const iso = isoFromUTC(todayUTC());
        const f = fitness[iso] || (fitness[iso] = {});
        if (value === null || (typeof value === "number" && (Number.isNaN(value) || value <= 0))) delete f[field]; else f[field] = value;
        delete f[`src_${field}`]; // a hand-typed value replaces the Google one
        saveFit();
        renderStats();
    }

    async function gfetch(url, opts, retried) {
        let token = googleToken();
        if (!token && await refreshPersistentGoogleSession()) token = googleToken();
        if (!token) throw new Error("expired");
        const res = await fetch(url, Object.assign({}, opts, {
            headers: Object.assign({ Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" }, (opts && opts.headers) || {})
        }));
        if (res.status === 401) {
            sessionStorage.removeItem("lifetrack-drive-token");
            sessionStorage.removeItem("lifetrack-gtoken");
            if (!retried && await refreshPersistentGoogleSession()) return gfetch(url, opts, true);
            throw new Error("expired");
        }
        if (!res.ok) {
            let detail = "";
            try { const j = await res.json(); detail = (j && j.error && (j.error.message || j.error.status)) || ""; } catch (_) { /* no body */ }
            const err = new Error(`HTTP ${res.status}${detail ? ": " + String(detail).slice(0, 150) : ""}`);
            err.status = res.status;
            throw err;
        }
        return res.json();
    }

    /* Google Fit REST API: fallback that reads the phone's Google Fit data (works only while Google still runs the Fit API). */
    async function syncFit(notes, wantSteps, wantSleep) {
        const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
        const startMs = midnight.getTime() - 13 * DAY_MS;
        const endMs = midnight.getTime() + DAY_MS;
        const isoLocal = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

        if (wantSteps) {
            try {
                const r = await gfetch("https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate", {
                    method: "POST",
                    body: JSON.stringify({
                        aggregateBy: [{ dataTypeName: "com.google.step_count.delta", dataSourceId: "derived:com.google.step_count.delta:com.google.android.gms:estimated_steps" }],
                        bucketByTime: { durationMillis: DAY_MS },
                        startTimeMillis: String(startMs),
                        endTimeMillis: String(endMs)
                    })
                });
                (r.bucket || []).forEach((b) => {
                    let total = 0;
                    (b.dataset || []).forEach((ds) => (ds.point || []).forEach((p) => (p.value || []).forEach((v) => { total += Number(v.intVal || 0); })));
                    if (total > 0) {
                        const f = fitness[isoLocal(Number(b.startTimeMillis))] || (fitness[isoLocal(Number(b.startTimeMillis))] = {});
                        f.steps = total; f.src_steps = "google";
                    }
                });
            } catch (e) {
                if (e.message === "expired") throw e;
                console.error("Google Fit steps failed", e);
                notes.push((/insufficient/i.test(e.message) ? "Fit steps: permission missing, press Disconnect then Connect and tick ALL boxes" : `Fit steps failed (${e.message})`));
            }
        }

        if (wantSleep) {
            try {
                const url = `https://www.googleapis.com/fitness/v1/users/me/sessions?activityType=72&startTime=${encodeURIComponent(new Date(startMs).toISOString())}&endTime=${encodeURIComponent(new Date(endMs).toISOString())}`;
                const r = await gfetch(url);
                const nights = {};
                (r.session || []).forEach((s) => {
                    const mins = (Number(s.endTimeMillis) - Number(s.startTimeMillis)) / 60000;
                    if (mins > 0) { const iso = isoLocal(Number(s.endTimeMillis)); nights[iso] = (nights[iso] || 0) + mins; }
                });
                Object.keys(nights).forEach((iso) => {
                    const f = fitness[iso] || (fitness[iso] = {});
                    f.sleep = Math.min(24, Math.round((nights[iso] / 60) * 10) / 10); f.src_sleep = "google";
                });
            } catch (e) {
                if (e.message === "expired") throw e;
                console.error("Google Fit sleep failed", e);
                notes.push((/insufficient/i.test(e.message) ? "Fit sleep: permission missing, press Disconnect then Connect and tick ALL boxes" : `Fit sleep failed (${e.message})`));
            }
        }

    }

    async function syncGoogle() {
        if (!googleToken() || syncing) return;
        syncing = true;
        setFitStatus("Syncing with Google…", "");
        const notes = [];
        let stepsOk = false, sleepOk = false;
        try {
            const t0 = todayUTC();
            const civil = (ms) => { const d = new Date(ms); return { date: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() } }; };
            const SOURCES = "users/me/dataSourceFamilies/all-sources";

            if (!FIT_ON) try {
                const steps = await gfetch("https://health.googleapis.com/v4/users/me/dataTypes/steps/dataPoints:dailyRollUp", {
                    method: "POST",
                    body: JSON.stringify({ range: { start: civil(t0 - 13 * DAY_MS), end: civil(t0 + DAY_MS) }, windowSizeDays: 1, dataSourceFamily: SOURCES })
                });
                (steps.rollupDataPoints || []).forEach((p) => {
                    const d = p.civilStartTime && p.civilStartTime.date;
                    if (!d) return;
                    const iso = `${d.year}-${pad2(d.month)}-${pad2(d.day)}`;
                    const v = Number((p.steps && p.steps.countSum) || 0);
                    const f = fitness[iso] || (fitness[iso] = {});
                    if (v > 0) { f.steps = v; f.src_steps = "google"; }
                });
                stepsOk = true;
            } catch (e) {
                if (e.message === "expired") throw e;
                console.error("Google steps sync failed", e);
                notes.push(`Health steps failed (${e.message})`);
            }

            if (!FIT_ON) try {
                const sinceMs = t0 - 14 * DAY_MS;
                const since = isoFromUTC(sinceMs);
                const nights = {};
                let pageToken = "";
                for (let page = 0; page < 5; page += 1) {
                    const url = `https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints:reconcile?filter=${encodeURIComponent(`sleep.interval.civil_end_time >= "${since}"`)}${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`;
                    const sleep = await gfetch(url);
                    (sleep.dataPoints || []).forEach((dp) => {
                        const s = dp.sleep;
                        if (!s || !s.interval || !s.interval.endTime || (s.metadata && s.metadata.main === false)) return;
                        const end = new Date(s.interval.endTime);
                        const iso = isoFromUTC(Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()));
                        nights[iso] = (nights[iso] || 0) + Number((s.summary && s.summary.minutesAsleep) || 0);
                    });
                    pageToken = sleep.nextPageToken || "";
                    if (!pageToken) break;
                }
                Object.keys(nights).forEach((iso) => {
                    if (nights[iso] > 0) {
                        const f = fitness[iso] || (fitness[iso] = {});
                        f.sleep = Math.min(24, Math.round((nights[iso] / 60) * 10) / 10);
                        f.src_sleep = "google";
                    }
                });
                sleepOk = true;
            } catch (e) {
                if (e.message === "expired") throw e;
                console.error("Google sleep sync failed", e);
                notes.push(`Health sleep failed (${e.message})`);
            }

            if (FIT_ON && (!stepsOk || !sleepOk)) await syncFit(notes, !stepsOk, !sleepOk);

            saveFit();
            const now = new Date();
            setFitStatus(`[v5 ${FIT_ON ? "fit" : "health"}] Synced at ${pad2(now.getHours())}:${pad2(now.getMinutes())}${notes.length ? `. Skipped: ${notes.join(", ")}` : ""}`, notes.length ? "warn" : "good");
        } catch (e) {
            const accountNotLinked = /account[_ ]not[_ ]linked/i.test(e.message);
            if (accountNotLinked) sessionStorage.removeItem("lifetrack-gtoken");
            setFitStatus(e.message === "expired"
                ? "Google Health access expired. Your LifeTrack account is still signed in; reconnect Google sync from the profile menu."
                : accountNotLinked
                    ? "Open Google Health on this same Google account, finish linking it, then connect again."
                    : `Google sync failed: ${e.message}`, "bad");
        } finally {
            syncing = false;
            renderStats();
        }
    }

    /* ---------- modal + menu ---------- */

    let activeReadingObjectUrl = null;

    function closeModal() {
        document.getElementById("modalRoot").innerHTML = "";
        updateNativeAdSuppression();
        if (activeReadingCatalogController) {
            activeReadingCatalogController.abort();
            activeReadingCatalogController = null;
        }
        if (activeReadingObjectUrl) {
            URL.revokeObjectURL(activeReadingObjectUrl);
            activeReadingObjectUrl = null;
        }
    }

    function openModal(html) {
        const root = document.getElementById("modalRoot");
        root.innerHTML = `<div class="modal-back" data-close="1"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
        updateNativeAdSuppression();
        root.querySelector(".modal-back").addEventListener("mousedown", (e) => { if (e.target.dataset.close) closeModal(); });
        root.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", closeModal));
        const first = root.querySelector("input, button.primary-button");
        if (first) first.focus();
        return root.querySelector(".modal");
    }

    function confirmModal(title, text, okLabel, onOk) {
        const modal = openModal(`<h3>${esc(title)}</h3><p>${esc(text)}</p><div class="modal-actions"><button type="button" class="secondary-button" data-cancel>Cancel</button><button type="button" class="primary-button danger" id="modalOk">${esc(okLabel)}</button></div>`);
        modal.querySelector("#modalOk").addEventListener("click", () => { closeModal(); onOk(); });
    }

    let activeReadingCatalogController = null;

    function openPdfRoomSearch(query) {
        const searchText = String(query || "").trim().slice(0, 120);
        const url = new URL("https://pdfroom.com/");
        if (searchText) {
            url.pathname = "/search";
            url.searchParams.set("query", searchText);
        }
        const nativeReader = window.LifeTrackNativeReminders;
        if (nativeReader && typeof nativeReader.openPdfRoomSearch === "function") {
            nativeReader.openPdfRoomSearch(searchText);
            return;
        }
        const opened = window.open(url.toString(), "_blank");
        if (opened) opened.opener = null;
        if (!opened) window.location.assign(url.toString());
    }

    function openPdfRoomBook(url) {
        const nativeReader = window.LifeTrackNativeReminders;
        if (nativeReader && typeof nativeReader.openPdfRoomBook === "function") {
            nativeReader.openPdfRoomBook(url);
            return;
        }
        const opened = window.open(url, "_blank");
        if (opened) opened.opener = null;
        if (!opened) window.location.assign(url);
    }

    function openReadingHistory() {
        const progressFor = (book) => {
            const saved = readingPlan.bookProgress && readingPlan.bookProgress[book.id];
            const completed = (readingPlan.completedBooks || []).filter((entry) => entry.id === book.id).pop();
            const pages = Math.max(1, Number(saved && saved.pageCount) || Number(book.pages) || 1);
            const page = book.id === readingPlan.bookId
                ? readingPlan.currentPage
                : saved && Number.isFinite(Number(saved.page))
                    ? Number(saved.page)
                    : completed
                        ? Number(completed.currentPage ?? completed.pages) || 0
                        : Number(book.currentPage) || 0;
            return { page: clamp(page, 0, pages), pages };
        };
        const modal = openModal(`<div class="reading-history-heading"><div><h3>My reading library</h3><p>Read your authorized PDFs inside LifeTrack or track a printed book.</p></div><button type="button" class="reading-history-close" data-cancel aria-label="Close reading library">×</button></div>
            <div class="reading-library-columns">
            <section class="reading-library-info" aria-labelledby="readingCatalogTitle">
                <h4 id="readingCatalogTitle">Explore books &amp; previews</h4>
                <p>Search PDFRoom’s book listings. Select a result to open its book page and available preview on PDFRoom.</p>
                <form id="readingPdfRoomSearchForm" class="reading-preview-search">
                    <label class="sr-only" for="readingPdfRoomQuery">Search PDFRoom books</label>
                    <input id="readingPdfRoomQuery" type="search" maxlength="120" placeholder="Search title or author…" autocomplete="off" value="psychology">
                    <button type="submit" class="primary-button">Search &amp; preview</button>
                </form>
                <div class="reading-preview-topics" aria-label="Suggested searches">
                    <button type="button" class="reading-preview-topic" data-pdfroom-query="psychology">Psychology</button>
                    <button type="button" class="reading-preview-topic" data-pdfroom-query="self help">Self-help</button>
                    <button type="button" class="reading-preview-topic" data-pdfroom-query="mindfulness">Mindfulness</button>
                    <button type="button" class="reading-preview-topic" data-pdfroom-query="habits">Habits</button>
                </div>
                <p class="reading-catalog-status" id="readingPdfRoomStatus" role="status" aria-live="polite">Loading book listings…</p>
                <div class="reading-preview-results" id="readingPdfRoomResults"></div>
                <button type="button" class="secondary-button reading-catalog-more" id="readingPdfRoomMore" hidden>Load more books</button>
            </section>
            <section class="reading-owned-books" aria-labelledby="readingOwnedBooksTitle">
                <div class="reading-saved-books-heading"><div><h4 id="readingOwnedBooksTitle">Your books</h4><p>Your saved books and reading progress.</p></div><span class="reading-book-count" id="readingBookCount">0</span></div>
                <div class="reading-history-list" id="readingHistoryList"></div>
                <section class="reading-history-detail" id="readingHistoryDetail" aria-live="polite"></section>
            </section>
            </div>
            <div class="reading-library-actions"><button type="button" class="primary-button" id="readingAddBook">＋ Add a book (PDF or hard copy)</button><button type="button" class="secondary-button" data-cancel>Close</button></div>`);
        modal.classList.add("reading-library-modal");
        const searchInput = modal.querySelector("#readingPdfRoomQuery");
        const results = modal.querySelector("#readingPdfRoomResults");
        const status = modal.querySelector("#readingPdfRoomStatus");
        const more = modal.querySelector("#readingPdfRoomMore");
        let currentSearch = searchInput.value;
        let currentPage = 0;
        let hasMore = false;
        let isRetrying = false;
        let retryPage = 1;
        const renderBooks = (books, append) => {
            const cards = books.map((book) => {
                const cover = book.coverUrl
                    ? `<img class="reading-preview-cover" src="${esc(book.coverUrl)}" alt="${esc(book.coverAlt || book.title)}" loading="lazy" referrerpolicy="no-referrer">`
                    : `<span class="reading-preview-cover reading-preview-cover-empty" aria-hidden="true">📖</span>`;
                const metadata = [book.author, book.metadata].filter(Boolean).map(esc).join(" · ");
                return `<article class="reading-preview-card">
                    <a class="reading-preview-cover-link" data-pdfroom-book href="${esc(book.url)}" target="_blank" rel="noopener noreferrer" aria-label="Preview ${esc(book.title)} on PDFRoom">${cover}</a>
                    <div class="reading-preview-copy"><strong>${esc(book.title)}</strong>${metadata ? `<small>${metadata}</small>` : ""}
                        <a class="reading-preview-open" data-pdfroom-book href="${esc(book.url)}" target="_blank" rel="noopener noreferrer">Preview on PDFRoom</a>
                    </div>
                </article>`;
            }).join("");
            if (append) results.insertAdjacentHTML("beforeend", cards);
            else results.innerHTML = cards;
        };
        const loadBooks = async (query, append, requestedPage) => {
            const searchText = String(query || "").trim().slice(0, 120);
            if (!searchText) {
                status.textContent = "Enter a book title or author to search.";
                return;
            }
            if (activeReadingCatalogController) activeReadingCatalogController.abort();
            const controller = new AbortController();
            activeReadingCatalogController = controller;
            const page = append ? requestedPage : 1;
            if (!append) {
                currentSearch = searchText;
                currentPage = 0;
                hasMore = false;
                isRetrying = false;
                results.innerHTML = "";
                more.hidden = true;
            }
            searchInput.value = searchText;
            more.disabled = true;
            status.textContent = append ? "Loading more books…" : "Searching PDFRoom…";
            try {
                const endpoint = monetizationEndpoint("/api/reading/catalog");
                endpoint.searchParams.set("q", currentSearch);
                endpoint.searchParams.set("page", String(page));
                const response = await fetch(endpoint, {
                    headers: { Accept: "application/json" },
                    credentials: "include",
                    cache: "no-store",
                    signal: controller.signal
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || `Book search failed (HTTP ${response.status}).`);
                if (!modal.isConnected || activeReadingCatalogController !== controller) return;
                const books = Array.isArray(data.books) ? data.books : [];
                renderBooks(books, append);
                currentPage = page;
                hasMore = Boolean(data.hasMore) && page < 10;
                isRetrying = false;
                status.textContent = books.length
                    ? `Showing ${results.querySelectorAll(".reading-preview-card").length} results from PDFRoom. Book pages and previews open on PDFRoom.`
                    : "No books found. Try another title or topic.";
                more.hidden = !hasMore;
                retryPage = page + 1;
            } catch (error) {
                if (error.name === "AbortError" || !modal.isConnected) return;
                console.error("LifeTrack could not load PDFRoom book listings.", error);
                status.textContent = error.message || "Could not load book listings. Check your connection and try again.";
                retryPage = page;
                more.hidden = false;
                more.textContent = "Try again";
                isRetrying = true;
                hasMore = false;
            } finally {
                if (activeReadingCatalogController === controller) {
                    activeReadingCatalogController = null;
                    more.disabled = false;
                    if (!more.hidden && !isRetrying) more.textContent = "Load more books";
                }
            }
        };
        modal.querySelector("#readingPdfRoomSearchForm").addEventListener("submit", (event) => {
            event.preventDefault();
            loadBooks(searchInput.value, false, 1);
        });
        modal.querySelectorAll("[data-pdfroom-query]").forEach((button) => {
            button.addEventListener("click", () => loadBooks(button.dataset.pdfroomQuery, false, 1));
        });
        more.addEventListener("click", () => loadBooks(currentSearch, hasMore || isRetrying, retryPage));
        results.addEventListener("click", (event) => {
            const link = event.target.closest("[data-pdfroom-book]");
            if (!link) return;
            const nativeReader = window.LifeTrackNativeReminders;
            if (nativeReader && typeof nativeReader.openPdfRoomBook === "function") {
                event.preventDefault();
                openPdfRoomBook(link.href);
            }
        });
        results.addEventListener("error", (event) => {
            if (event.target instanceof HTMLImageElement && event.target.classList.contains("reading-preview-cover")) {
                event.target.outerHTML = `<span class="reading-preview-cover reading-preview-cover-empty" aria-hidden="true">📖</span>`;
            }
        }, true);
        const bookList = modal.querySelector("#readingHistoryList");
        const bookCount = modal.querySelector("#readingBookCount");
        const bookDetail = modal.querySelector("#readingHistoryDetail");
        const renderSavedBooks = () => {
            prepareReadingDay();
            const savedBooks = Array.from(new Map([
                ...READING_BOOKS,
                ...(Array.isArray(readingPlan.customBooks) ? readingPlan.customBooks : [])
            ].map((book) => [book.id, book])).values());
            bookCount.textContent = String(savedBooks.length);
            bookList.innerHTML = savedBooks.map((book) => {
                const progress = progressFor(book);
                const percent = Math.round((progress.page / progress.pages) * 100);
                const isCurrent = book.id === readingPlan.bookId;
                return `<div class="reading-library-row">
                    <button type="button" class="reading-history-item${isCurrent ? " selected" : ""}" data-reading-open="${esc(book.id)}">
                        <span><strong>${esc(book.title)}</strong><small>${esc(book.author || "Unknown author")} · Page ${progress.page} of ${progress.pages}</small></span>
                        <span>${book.format === "physical" ? "Hard copy" : book.fileId ? "PDF" : `${percent}%`}</span>
                    </button>
                    ${book.fileId || book.format === "physical" ? `<button type="button" class="reading-library-delete" data-reading-delete="${esc(book.id)}" aria-label="Delete ${esc(book.title)}${book.fileId ? " and its Drive PDF" : ""}">Delete</button>` : ""}
                    <button type="button" class="reading-library-reset" data-reading-reset="${esc(book.id)}" aria-label="Reset ${esc(book.title)} reading progress" title="Reset this book to page 0">Reset</button>
                </div>`;
            }).join("");
        };
        const renderCurrentBookDetail = () => {
            const book = currentReadingBook();
            if (!book) return;
            const progress = progressFor(book);
            const formatLabel = book.format === "physical" ? "YOUR HARD COPY" : book.fileId ? "YOUR PDF" : "CURRENT BOOK";
            const description = book.format === "physical"
                ? "Track the page in your printed book. Your progress saves automatically."
                : book.fileId
                    ? "PDF and page progress are saved in your private Google Drive app data."
                    : "This entry tracks pages only. Add an authorized PDF to read it inside LifeTrack.";
            bookDetail.innerHTML = `<span class="eyebrow">${formatLabel}</span><h4>${esc(book.title)}</h4><p>by ${esc(book.author || "Unknown author")}</p><strong>Page ${progress.page} / ${progress.pages} · ${Math.round((progress.page / progress.pages) * 100)}%</strong><small>${description}</small>`;
        };
        modal.addEventListener("reading-plan-updated", () => {
            renderSavedBooks();
            renderCurrentBookDetail();
        });
        modal.querySelector("#readingAddBook").addEventListener("click", openAddReadingBook);
        bookList.addEventListener("click", (event) => {
            const openButton = event.target.closest("[data-reading-open]");
            if (openButton) {
                openReadingBook(openButton.dataset.readingOpen);
                return;
            }
            const deleteButton = event.target.closest("[data-reading-delete]");
            if (deleteButton) {
                deleteReadingBook(deleteButton.dataset.readingDelete);
                return;
            }
            const resetButton = event.target.closest("[data-reading-reset]");
            if (resetButton) {
                const bookId = resetButton.dataset.readingReset;
                const book = [...READING_BOOKS, ...(readingPlan.customBooks || [])].find((entry) => entry.id === bookId);
                if (!book) return;
                confirmModal("Reset this book?", `${book.title} will return to page 0 and be removed from completed books.`, "Reset progress", () => {
                    if (!resetReadingBookProgress(bookId)) return;
                    saveReadingPlan();
                    renderStats();
                    openReadingHistory();
                    toast(`${book.title} progress was reset.`);
                });
                return;
            }
        });
        renderSavedBooks();
        renderCurrentBookDetail();
        loadBooks(currentSearch, false, 1);
    }

    function openAddReadingBook(prefillBook) {
        const modal = openModal(`<h3>Add your own book</h3>
            <p>Add a PDF you own or are authorized to read, or track a printed book. PDFs open inside LifeTrack and are stored in your private Google Drive app data.</p>
            <form id="readingBookForm">
                <span class="modal-label">Book format</span>
                <div class="reading-book-format" role="group" aria-label="Book format">
                    <button type="button" class="reading-book-format-option selected" data-reading-format="pdf" aria-pressed="true">PDF eBook</button>
                    <button type="button" class="reading-book-format-option" data-reading-format="physical" aria-pressed="false">Printed hard copy</button>
                </div>
                <label class="modal-label" for="readingBookTitle">Book title</label><input id="readingBookTitle" type="text" maxlength="100" required placeholder="Enter the book title" value="${esc(prefillBook && prefillBook.title || "")}">
                <label class="modal-label" for="readingBookAuthor">Author</label><input id="readingBookAuthor" type="text" maxlength="100" placeholder="Optional" value="${esc(prefillBook && prefillBook.author || "")}">
                <label class="modal-label" for="readingBookPages">Number of pages</label><input id="readingBookPages" type="number" min="1" max="5000" step="1" required placeholder="e.g. 240" value="${esc(prefillBook && prefillBook.pages || "")}">
                <div id="readingBookPdfField"><label class="modal-label" for="readingBookPdf">PDF file (up to 25 MB)</label><input id="readingBookPdf" type="file" accept="application/pdf,.pdf" required></div>
                <p class="modal-error" id="readingBookError" role="alert" hidden></p>
                <div class="modal-actions"><button type="button" class="secondary-button" data-cancel>Cancel</button><button type="submit" class="primary-button" id="readingBookSave">Upload PDF</button></div>
            </form>`);
        let format = "pdf";
        const pdfField = modal.querySelector("#readingBookPdfField");
        const pdfInput = modal.querySelector("#readingBookPdf");
        const save = modal.querySelector("#readingBookSave");
        modal.querySelectorAll("[data-reading-format]").forEach((button) => {
            button.addEventListener("click", () => {
                format = button.dataset.readingFormat;
                modal.querySelectorAll("[data-reading-format]").forEach((option) => {
                    const selected = option === button;
                    option.classList.toggle("selected", selected);
                    option.setAttribute("aria-pressed", String(selected));
                });
                pdfField.hidden = format !== "pdf";
                pdfInput.required = format === "pdf";
                save.textContent = format === "pdf" ? "Upload PDF" : "Add hard copy";
            });
        });
        modal.querySelector("#readingBookForm").addEventListener("submit", async (event) => {
            event.preventDefault();
            const title = modal.querySelector("#readingBookTitle").value.trim();
            const author = modal.querySelector("#readingBookAuthor").value.trim() || "Unknown author";
            const pages = Number(modal.querySelector("#readingBookPages").value);
            const file = pdfInput.files[0];
            const error = modal.querySelector("#readingBookError");
            if (!title || !Number.isInteger(pages) || pages < 1 || pages > 5000
                || (format === "pdf" && (!file
                    || (!file.type.includes("pdf") && !file.name.toLowerCase().endsWith(".pdf"))
                    || file.size > 25 * 1024 * 1024))) {
                error.textContent = format === "pdf"
                    ? "Enter a title and page count from 1 to 5,000, and choose a PDF no larger than 25 MB."
                    : "Enter a book title and page count from 1 to 5,000.";
                error.hidden = false;
                return;
            }
            save.disabled = true;
            save.textContent = format === "pdf" ? "Uploading…" : "Adding…";
            error.hidden = true;
            try {
                const uploadId = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
                const id = prefillBook && prefillBook.id
                    ? prefillBook.id
                    : uploadId;
                let uploaded = null;
                if (format === "pdf") {
                    if (await file.slice(0, 5).text() !== "%PDF-") {
                        throw new Error("The selected file does not look like a valid PDF.");
                    }
                    const boundary = `lifetrack_${uploadId.replace(/[^a-zA-Z0-9]/g, "")}`;
                    const metadata = JSON.stringify({
                        name: `lifetrack-book-${uploadId}.pdf`,
                        mimeType: "application/pdf",
                        parents: ["appDataFolder"]
                    });
                    const body = new Blob([
                        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
                        metadata,
                        `\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
                        file,
                        `\r\n--${boundary}--`
                    ], { type: `multipart/related; boundary=${boundary}` });
                    const response = await driveRequest("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType", {
                        method: "POST",
                        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
                        body
                    });
                    uploaded = await response.json();
                    if (!uploaded.id) throw new Error("Google Drive did not return an uploaded file ID.");
                }
                readingPlan.customBooks = Array.isArray(readingPlan.customBooks) ? readingPlan.customBooks : [];
                const addedAt = Math.max(Date.now(), (Number(readingPlan.updatedAt) || 0) + 1);
                const newBook = {
                    id,
                    title,
                    author,
                    focus: format === "physical"
                        ? "Continue your printed book from the page you last saved."
                        : "Continue your own book from the page you last saved.",
                    pages,
                    currentPage: prefillBook ? clamp(readingPlan.currentPage, 0, pages) : 0,
                    format,
                    addedAt,
                    updatedAt: addedAt
                };
                if (uploaded) Object.assign(newBook, {
                    fileId: uploaded.id,
                    mimeType: "application/pdf",
                    fileName: file.name
                });
                const existingBookIndex = readingPlan.customBooks.findIndex((book) => book.id === id);
                if (existingBookIndex >= 0) readingPlan.customBooks[existingBookIndex] = newBook;
                else readingPlan.customBooks.push(newBook);
                readingPlan.deletedCustomBooks = readingPlan.deletedCustomBooks || {};
                delete readingPlan.deletedCustomBooks[id];
                readingPlan.bookProgress = readingPlan.bookProgress || {};
                readingPlan.bookProgress[id] = { page: newBook.currentPage, pageCount: pages, updatedAt: addedAt };
                saveReadingPlan();
                closeModal();
                renderStats();
                openReadingHistory();
                toast(format === "physical" ? "Hard-copy book added. Update your page as you read." : "PDF uploaded to your private Drive library.");
            } catch (uploadError) {
                console.error("LifeTrack could not add the reading book.", uploadError);
                error.textContent = uploadError.message || "Could not add the book. Check your Google Drive connection and try again.";
                error.hidden = false;
                save.disabled = false;
                save.textContent = format === "pdf" ? "Upload PDF" : "Add hard copy";
            }
        });
    }

    async function openReadingBook(bookId) {
        const book = switchReadingBook(bookId);
        if (!book) {
            toast("That book is no longer in your reading library.");
            return;
        }
        closeModal();
        if (book.format === "physical") {
            const modal = openModal(`<h3>${esc(book.title)}</h3><p>Enter the page you have reached in your printed copy.</p>
                <label class="modal-label" for="readingPhysicalPage">Current page</label>
                <input id="readingPhysicalPage" type="number" min="0" max="${readingPlan.pageCount}" step="1" value="${readingPlan.currentPage}" required>
                <p class="modal-error" id="readingPhysicalError" role="alert" hidden></p>
                <div class="modal-actions"><button type="button" class="secondary-button" data-cancel>Close</button><button type="button" class="primary-button" id="readingPhysicalSave">Save page</button></div>`);
            modal.querySelector("#readingPhysicalSave").addEventListener("click", () => {
                const page = Number(modal.querySelector("#readingPhysicalPage").value);
                const error = modal.querySelector("#readingPhysicalError");
                if (!Number.isInteger(page) || page < 0 || page > readingPlan.pageCount) {
                    error.textContent = `Enter a page from 0 to ${readingPlan.pageCount}.`;
                    error.hidden = false;
                    return;
                }
                readingPlan.currentPage = page;
                readingPlan.dailyStart = Math.min(readingPlan.pageCount, Math.max(1, page + 1));
                readingPlan.dailyEnd = Math.min(readingPlan.pageCount, page + Math.max(1, Number(readingPlan.dailyTarget) || 10));
                readingPlan.dailyDate = isoFromUTC(todayUTC());
                saveReadingPlan();
                closeModal();
                renderStats();
                toast(`Saved your place: page ${page} of ${readingPlan.pageCount}.`);
            });
            return;
        }
        if (!book.fileId) {
            openModal(`<h3>${esc(book.title)}</h3><p>This library entry does not include book text. Add a PDF you own or are authorized to read, and LifeTrack will open it here while keeping your page progress.</p>
                <div class="modal-actions"><button type="button" class="secondary-button" data-cancel>Close</button><button type="button" class="secondary-button" id="readingPreviewPdfRoom">Preview on PDFRoom</button><button type="button" class="primary-button" id="readingAddAuthorizedPdf">Add authorized PDF</button></div>`);
            document.getElementById("readingPreviewPdfRoom").addEventListener("click", () => {
                openPdfRoomSearch(book.title);
            });
            document.getElementById("readingAddAuthorizedPdf").addEventListener("click", () => {
                openAddReadingBook(book);
            });
            return;
        }

        openModal(`<h3>Opening ${esc(book.title)}…</h3><p id="readingPdfStatus" role="status">Loading your private Drive PDF.</p>`);
        try {
            const response = await driveRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(book.fileId)}?alt=media`);
            const pdf = await response.blob();
            if (!pdf.size) throw new Error("The saved PDF is empty.");
            if (activeReadingObjectUrl) URL.revokeObjectURL(activeReadingObjectUrl);
            activeReadingObjectUrl = URL.createObjectURL(pdf);
            const reader = openModal(`<div class="reading-reader-heading"><div><h3>${esc(book.title)}</h3><p>Continue from your saved page.</p></div><button type="button" class="reading-history-close" data-cancel aria-label="Close book reader">×</button></div>
                <div class="reading-reader-controls"><button type="button" class="secondary-button" data-reader-step="-1" aria-label="Previous page">−</button><label>Page <input id="readingReaderPage" type="number" min="1" max="${readingPlan.pageCount}" value="${Math.max(1, readingPlan.currentPage)}" aria-label="Current book page"> of ${readingPlan.pageCount}</label><button type="button" class="secondary-button" data-reader-step="1" aria-label="Next page">＋</button></div>
                <iframe id="readingPdfFrame" class="reading-pdf-frame" title="${esc(book.title)} PDF reader"></iframe>`);
            reader.classList.add("reading-reader-modal");
            const frame = reader.querySelector("#readingPdfFrame");
            const pageInput = reader.querySelector("#readingReaderPage");
            const setReaderPage = (value) => {
                const page = clamp(Math.floor(Number(value) || 1), 1, readingPlan.pageCount);
                pageInput.value = String(page);
                if (readingPlan.currentPage !== page) {
                    readingPlan.currentPage = page;
                    readingPlan.dailyStart = Math.min(readingPlan.pageCount, page);
                    readingPlan.dailyEnd = Math.min(readingPlan.pageCount, Math.max(page, readingPlan.dailyEnd));
                    saveReadingPlan();
                    renderStats();
                }
                frame.src = `${activeReadingObjectUrl}#page=${page}`;
            };
            reader.querySelectorAll("[data-reader-step]").forEach((button) => {
                button.addEventListener("click", () => setReaderPage(Number(pageInput.value) + Number(button.dataset.readerStep)));
            });
            pageInput.addEventListener("change", () => setReaderPage(pageInput.value));
            setReaderPage(Math.max(1, readingPlan.currentPage));
        } catch (openError) {
            console.error("LifeTrack could not open the reading PDF.", openError);
            const errorModal = document.querySelector("#modalRoot .modal");
            errorModal.innerHTML = `<h3>Could not open this PDF</h3><p id="readingPdfError" role="alert"></p><div class="modal-actions"><button type="button" class="secondary-button" id="readingBackToLibrary">Back to library</button></div>`;
            errorModal.querySelector("#readingPdfError").textContent = openError.message || "Check your Google Drive connection and try again.";
            errorModal.querySelector("#readingBackToLibrary").addEventListener("click", openReadingHistory);
        }
    }

    function deleteReadingBook(bookId) {
        const book = (readingPlan.customBooks || []).find((entry) => entry.id === bookId);
        if (!book) return;
        const isPhysical = book.format === "physical";
        confirmModal("Delete this book?", isPhysical
            ? `${book.title} and its saved reading progress will be removed. This cannot be undone.`
            : `${book.title} and its uploaded PDF will be deleted from your private Google Drive app data. This cannot be undone.`, "Delete book", async () => {
            try {
                if (book.fileId) {
                    await driveRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(book.fileId)}`, { method: "DELETE" });
                }
                readingPlan.deletedCustomBooks = readingPlan.deletedCustomBooks || {};
                readingPlan.deletedCustomBooks[bookId] = Math.max(Date.now(), (Number(readingPlan.updatedAt) || 0) + 1);
                readingPlan.customBooks = readingPlan.customBooks.filter((entry) => entry.id !== bookId);
                if (readingPlan.bookProgress) delete readingPlan.bookProgress[bookId];
                if (readingPlan.bookId === bookId) {
                    const nextBook = READING_BOOKS[0];
                    readingPlan.bookIndex = 0;
                    readingPlan.bookId = nextBook.id;
                    readingPlan.pageCount = nextBook.pages;
                    readingPlan.currentPage = 0;
                    readingPlan.dailyStart = 1;
                    readingPlan.dailyEnd = Math.min(nextBook.pages, readingPlan.dailyTarget || 10);
                    readingPlan.dailyDate = "";
                    readingPlan.goalCompletedDate = "";
                    readingPlan.goalCompletedBookId = "";
                }
                saveReadingPlan();
                renderStats();
                openReadingHistory();
                toast(isPhysical ? "Book and its saved progress deleted." : "Book and its Drive PDF deleted.");
            } catch (deleteError) {
                console.error("LifeTrack could not delete the reading PDF from Drive.", deleteError);
                toast(deleteError.message || "Could not delete the book from Drive. Try again.");
                openReadingHistory();
            }
        });
    }

    function openProfileEditor() {
        const modal = openModal(`<h3>Edit profile</h3>
            <label class="modal-label" for="pfName">Name</label><input id="pfName" type="text" maxlength="40" value="${esc(currentUser.name)}">
            <label class="modal-label" for="pfEmail">Email</label><input id="pfEmail" type="email" value="${esc(currentUser.email || "")}">
            <p class="modal-error" id="pfErr" hidden>Enter a name to save.</p>
            <div class="modal-actions"><button type="button" class="secondary-button" data-cancel>Cancel</button><button type="button" class="primary-button" id="pfSave">Save profile</button></div>`);
        modal.querySelector("#pfSave").addEventListener("click", () => {
            const name = modal.querySelector("#pfName").value.trim();
            if (!name) { modal.querySelector("#pfErr").hidden = false; return; }
            currentUser.name = name;
            currentUser.email = modal.querySelector("#pfEmail").value.trim();
            localStorage.setItem("lifetrack-user", JSON.stringify(currentUser));
            paintUser();
            closeModal();
            toast("Profile saved.");
        });
    }

    function openFeedbackModal() {
        const entry = (() => {
            try {
                return JSON.parse(store.get("user-feedback") || "null") || {};
            } catch (error) {
                return {};
            }
        })();
        const selected = Number(entry.rating) || 0;
        const modal = openModal(`<h3>Feedback</h3>
            <div class="feedback-stars modal-feedback-stars" aria-label="Rate your experience">
                ${[1, 2, 3, 4, 5].map((rating) => `<button type="button" class="feedback-star ${rating <= selected ? "active" : ""}" data-rating="${rating}" aria-label="${rating} star" aria-pressed="${rating <= selected}">★</button>`).join("")}
            </div>
            <label class="modal-label" for="feedbackText">Tell us what you liked or what to improve</label>
            <textarea id="feedbackText" rows="5" placeholder="The tracker feels helpful, but I’d love a smarter habit filter.">${esc((typeof entry.message === "string" ? entry.message : "") || "")}</textarea>
            <div class="modal-actions"><button type="button" class="secondary-button" data-cancel>Cancel</button><button type="button" class="primary-button" id="feedbackSave">Save feedback</button></div>`);
        const stars = Array.from(modal.querySelectorAll(".feedback-star"));
        let rating = selected;
        stars.forEach((star) => {
            star.addEventListener("click", () => {
                rating = Number(star.dataset.rating || 0);
                stars.forEach((item) => {
                    const active = Number(item.dataset.rating || 0) <= rating;
                    item.classList.toggle("active", active);
                    item.setAttribute("aria-pressed", String(active));
                });
            });
        });
        modal.querySelector("#feedbackSave").addEventListener("click", () => {
            const text = modal.querySelector("#feedbackText").value.trim();
            const payload = { rating: rating || null, message: text, updatedAt: new Date().toISOString() };
            store.set("user-feedback", JSON.stringify(payload));
            closeModal();
            toast(rating ? "Thanks for the feedback." : "Feedback saved.");
        });
    }

    function paintUser() {
        userName.textContent = currentUser.name;
        if (currentUser.picture) {
            profileLetter.innerHTML = `<img alt="" referrerpolicy="no-referrer" src="${esc(currentUser.picture)}">`;
        } else {
            profileLetter.textContent = (Array.from(currentUser.name.trim())[0] || "U").toUpperCase();
        }
    }

    function saveAssistantState(key, value) {
        store.set(key, JSON.stringify(value));
    }

    function assistantId() {
        return window.crypto && typeof window.crypto.randomUUID === "function"
            ? window.crypto.randomUUID()
            : `ai-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    function appendAIMessage(role, content, action = "") {
        const message = { id: assistantId(), createdAt: Date.now(), role, content };
        if (action) message.action = action;
        aiConversation.push(message);
        aiConversation = aiConversation.slice(-AI_HISTORY_MESSAGE_LIMIT);
    }

    function updateAIMemorySummary(prompt, reply) {
        const text = `${prompt}\n${reply || ""}`.replace(/\s+/g, " ").trim();
        if (!text) return;
        const pieces = aiMemorySummary ? aiMemorySummary.split(/;\s*/).filter(Boolean) : [];
        const lower = prompt.toLowerCase();
        if (/\b(promise|promised|plan to|start|goal|target)\b/i.test(prompt)) {
            pieces.push(`Promise/goal: ${prompt.slice(0, 180)}`);
        } else if (/\b(prefer|like|language|morning|night|english|hindi|hinglish)\b/i.test(prompt)) {
            pieces.push(`Preference: ${prompt.slice(0, 160)}`);
        } else if (/\b(always skip|keep skipping|forgot|hardest|weak|excuse)\b/i.test(lower)) {
            pieces.push(`Recurring struggle: ${prompt.slice(0, 180)}`);
        }
        aiMemorySummary = pieces
            .filter((piece, index) => pieces.indexOf(piece) === index)
            .slice(-8)
            .join("; ")
            .split(/\s+/)
            .slice(0, 150)
            .join(" ");
        if (aiMemorySummary) saveAssistantState("ai-memory-summary", aiMemorySummary);
    }

    function renderAINotes() {
        const list = document.getElementById("aiNotesList");
        list.innerHTML = "";
        if (!aiNotes.length) {
            const empty = document.createElement("p");
            empty.className = "empty-note";
            empty.textContent = "No notes yet. Save a thought here or ask AI to draft one.";
            list.appendChild(empty);
            return;
        }
        aiNotes.slice().sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt)).forEach((note) => {
            const card = document.createElement("article");
            card.className = "ai-note";
            const text = document.createElement("p");
            text.textContent = note.text;
            const date = document.createElement("small");
            date.textContent = new Date(note.updatedAt).toLocaleString();
            const actions = document.createElement("div");
            actions.className = "ai-note-actions";
            actions.innerHTML = `<button type="button" data-note-edit="${esc(note.id)}">Edit</button><button type="button" data-note-delete="${esc(note.id)}">Delete</button>`;
            card.append(text, date, actions);
            list.appendChild(card);
        });
    }

    function saveAINote(text, id) {
        const cleaned = String(text || "").trim();
        if (!cleaned || cleaned.length > 1000) throw new Error("Notes must contain 1–1,000 characters.");
        const existing = id ? aiNotes.find((note) => note.id === id) : null;
        if (existing) {
            existing.text = cleaned;
            existing.updatedAt = Date.now();
        } else {
            aiNotes.unshift({ id: assistantId(), text: cleaned, createdAt: Date.now(), updatedAt: Date.now() });
            aiNotes = aiNotes.slice(0, 200);
        }
        saveAssistantState("ai-notes", aiNotes);
        renderAINotes();
    }

    function formatAIMessageContent(raw) {
        if (!raw) return "";
        let s = esc(raw);
        s = s.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
        s = s.replace(/\*(.*?)\*/g, "<em>$1</em>");
        s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
        return s;
    }

    function renderAIMessages() {
        const container = document.getElementById("aiMessages");
        container.innerHTML = "";
        if (!aiConversation.length) {
            const emptyState = document.createElement("p");
            emptyState.className = "ai-empty-state";
            emptyState.textContent = "Ask a specific question when you need help. I'll use only the LifeTrack data available and show proposed changes for review.";
            container.appendChild(emptyState);
            return;
        }
        aiConversation.slice(-AI_HISTORY_MESSAGE_LIMIT).forEach((message) => {
            const bubble = document.createElement("div");
            bubble.className = `ai-message ${message.role === "user" ? "user" : "assistant"}`;
            bubble.innerHTML = formatAIMessageContent(message.content);
            if (message.action === "sign-in") {
                const signInButton = document.createElement("button");
                signInButton.type = "button";
                signInButton.className = "ai-auth-recovery";
                signInButton.textContent = "Sign out and sign in again";
                signInButton.addEventListener("click", () => { void doLogout(); });
                bubble.appendChild(signInButton);
            }
            container.appendChild(bubble);
        });
        scrollAIMessagesToLatest();
    }

    function scrollAIMessagesToLatest() {
        const container = document.getElementById("aiMessages");
        requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight;
        });
    }

    function setAITab(tab) {
        document.querySelectorAll("[data-ai-tab]").forEach((button) => {
            const selected = button.dataset.aiTab === tab;
            button.classList.toggle("active", selected);
            button.setAttribute("aria-selected", String(selected));
        });
        document.querySelectorAll("[data-ai-view]").forEach((view) => {
            view.hidden = view.dataset.aiView !== tab;
        });
        if (tab === "notes") renderAINotes();
        if (tab === "chat") scrollAIMessagesToLatest();
    }

    function aiContext() {
        const now = todayUTC();
        const today = isoFromUTC(now);
        const istDate = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Kolkata",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        }).format(new Date());
        let checkinsLastWeek = 0;
        const dailyCheckins = [];
        for (let i = 6; i >= 0; i -= 1) {
            const date = now - i * DAY_MS;
            let count = 0;
            habits.forEach((habit) => { if (checks[keyFor(date, habit)]) count += 1; });
            dailyCheckins.push(count);
            checkinsLastWeek += count;
        }
        const todayStatuses = habits.slice(0, 25).map((habit) => ({
            name: habit.slice(0, 60),
            done: Boolean(checks[keyFor(now, habit)])
        }));
        const completedToday = todayStatuses.filter((item) => item.done).length;
        const completionPercent = todayStatuses.length
            ? Math.round(completedToday * 100 / todayStatuses.length)
            : 0;
        const streaks = {};
        todayStatuses.forEach(({ name }) => {
            let streak = 0;
            for (let i = 0; i < 365; i += 1) {
                if (!checks[keyFor(now - i * DAY_MS, name)]) break;
                streak += 1;
            }
            streaks[name] = streak;
        });
        return {
            habits: habits.slice(0, 25).map((habit) => habit.slice(0, 60)),
            todayHabitStatus: todayStatuses,
            todayHabitSummary: {
                completed: completedToday,
                total: todayStatuses.length,
                percent: completionPercent,
                unticked: todayStatuses.filter((item) => !item.done).map((item) => item.name),
                streaks,
                brokenOrZeroDay: todayStatuses
                    .filter((item) => !item.done || streaks[item.name] === 0)
                    .map((item) => item.name)
            },
            localIST: istDate,
            coachMode: aiCoachMode === "calm" ? "Calm Coach" : "Savage Coach",
            memorySummary: aiMemorySummary || "",
            goals: goals.slice(0, 20).map(({ id, name, habit, target, difficulty }) => ({ id, name: String(name).slice(0, 60), habit: String(habit).slice(0, 60), target, difficulty: ["easy", "medium", "hard"].includes(difficulty) ? difficulty : "medium" })),
            todayFitness: {
                steps: Number(fitness[today] && fitness[today].steps) || 0,
                water: Number(fitness[today] && fitness[today].water) || 0,
                sleep: Number(fitness[today] && fitness[today].sleep) || 0,
                focusMinutes: Number(fitness[today] && fitness[today].active) || 0,
                mood: Number(fitness[today] && fitness[today].mood) || null
            },
            reading: {
                bookId: readingPlan.bookId,
                title: currentReadingBook() && currentReadingBook().title || "",
                page: readingPlan.currentPage,
                pageCount: readingPlan.pageCount,
                dailyTarget: readingPlan.dailyTarget
            },
            availableReadingBooks: READING_BOOKS.map(({ id, title, pages }) => ({ id, title, pages })),
            dailyTask: (() => {
                const t = currentDailyTask();
                return {
                    title: t.title,
                    category: t.category,
                    instruction: t.instruction,
                    minutes: t.minutes,
                    twist: t.twist,
                    finish: t.finish,
                    completed: Boolean(dailyTaskState && dailyTaskState.completed)
                };
            })(),
            focusSession: { running: Boolean(focusEndsAt), minutes: focusDuration },
            reminders: aiReminder.reminders.map(({ id, title, time, enabled }) => ({ id, title, time, enabled })),
            sections: ["dashboard", "tasks", "habits", "goals", "analytics"],
            lastSevenDays: { dailyCheckins, total: checkinsLastWeek },
            bodyMindPlan: {
                hasBodyProfile: Boolean(bodyProfile),
                profileGoal: bodyProfile && bodyProfile.goal || "not set",
                activityLevel: bodyProfile && bodyProfile.activity || "not set",
                customTasks: aiPlanTasks.slice(0, 10).map(({ id, title, details, doneDate }) => ({
                    id, title: String(title).slice(0, 80), details: String(details || "").slice(0, 120), completedToday: doneDate === isoFromUTC(now)
                }))
            }
        };
    }

    function validateAiActions(actions) {
        if (!Array.isArray(actions) || actions.length > 5) throw new Error("The assistant suggested an invalid set of changes.");
        const habitNames = new Set(habits);
        const checkedHabitNames = new Set();
        const goalIds = new Set(goals.map((goal) => goal.id));
        const planIds = new Set(aiPlanTasks.map((task) => task.id));
        const reminderIds = new Set(aiReminder.reminders.map((reminder) => reminder.id));
        let readingBookId = readingPlan.bookId;
        let readingPage = readingPlan.currentPage;
        let readingDailyEnd = readingPlan.dailyEnd;
        let focusIsRunning = Boolean(focusEndsAt);
        return actions.map((action) => {
            if (!action || typeof action !== "object" || typeof action.type !== "string") throw new Error("The assistant suggested an unreadable change.");
            const text = (key, max, required) => {
                const value = typeof action[key] === "string" ? action[key].trim() : "";
                if ((required && !value) || value.length > max) throw new Error("One suggested change has missing or too-long text.");
                return value;
            };
            const target = Number(action.target);
            switch (action.type) {
                case "habit_add": {
                    const name = text("name", 60, true);
                    if (habitNames.has(name)) throw new Error(`Habit "${name}" already exists.`);
                    habitNames.add(name);
                    return { type: action.type, name };
                }
                case "habit_edit": {
                    const oldName = text("oldName", 60, true);
                    const name = text("name", 60, true);
                    if (!habitNames.has(oldName) || (name !== oldName && habitNames.has(name))) throw new Error("A suggested habit edit conflicts with your current habits.");
                    habitNames.delete(oldName);
                    habitNames.add(name);
                    return { type: action.type, oldName, name };
                }
                case "habit_remove": {
                    const name = text("name", 60, true);
                    if (!habitNames.has(name)) throw new Error(`Habit "${name}" no longer exists.`);
                    habitNames.delete(name);
                    return { type: action.type, name };
                }
                case "habit_check": {
                    const name = text("name", 60, true);
                    if (!habitNames.has(name)) throw new Error(`Habit "${name}" no longer exists.`);
                    if (typeof action.done !== "boolean") throw new Error("A habit check-in must be marked done or undone.");
                    if (checkedHabitNames.has(name)) throw new Error(`The assistant suggested more than one check-in for "${name}".`);
                    checkedHabitNames.add(name);
                    if (action.done && name.toLowerCase() === "read"
                        && !checks[keyFor(todayUTC(), name)]
                        && readingPage < readingDailyEnd) {
                        throw new Error(`Complete pages ${readingPlan.dailyStart}-${readingDailyEnd} before marking Read done.`);
                    }
                    return { type: action.type, name, done: action.done };
                }
                case "goal_add": {
                    const name = text("name", 60, true);
                    const habit = text("habit", 60, true);
                    const difficulty = action.difficulty === undefined ? "medium" : text("difficulty", 10, true);
                    if (habit !== "*" && !habitNames.has(habit)) throw new Error(`Goal habit "${habit}" does not exist.`);
                    if (!Number.isInteger(target) || target < 10 || target > 100 || target % 5 !== 0) throw new Error("Goal targets must be 10–100 in steps of 5.");
                    if (!["easy", "medium", "hard"].includes(difficulty)) throw new Error("Goal difficulty must be easy, medium, or hard.");
                    return { type: action.type, name, habit, target, difficulty };
                }
                case "goal_edit": {
                    const id = text("id", 100, true);
                    const name = text("name", 60, true);
                    const habit = text("habit", 60, true);
                    const existingGoal = goals.find((goal) => goal.id === id);
                    const difficulty = action.difficulty === undefined
                        ? (existingGoal && ["easy", "medium", "hard"].includes(existingGoal.difficulty) ? existingGoal.difficulty : "medium")
                        : text("difficulty", 10, true);
                    if (!goalIds.has(id) || (habit !== "*" && !habitNames.has(habit))) throw new Error("A suggested goal edit references a missing goal or habit.");
                    if (!Number.isInteger(target) || target < 10 || target > 100 || target % 5 !== 0) throw new Error("Goal targets must be 10–100 in steps of 5.");
                    if (!["easy", "medium", "hard"].includes(difficulty)) throw new Error("Goal difficulty must be easy, medium, or hard.");
                    return { type: action.type, id, name, habit, target, difficulty };
                }
                case "goal_remove": {
                    const id = text("id", 100, true);
                    if (!goalIds.has(id)) throw new Error("A suggested goal no longer exists.");
                    goalIds.delete(id);
                    return { type: action.type, id };
                }
                case "profile_edit": {
                    if (!bodyProfile) throw new Error("Set up your body profile first before asking AI to adjust plan preferences.");
                    const next = { type: action.type };
                    if (action.height !== undefined) {
                        if (typeof action.height !== "number" || !Number.isFinite(action.height) || action.height < 100 || action.height > 250) throw new Error("Height must be 100–250 cm.");
                        next.height = action.height;
                    }
                    if (action.weight !== undefined) {
                        if (typeof action.weight !== "number" || !Number.isFinite(action.weight) || action.weight < 25 || action.weight > 250) throw new Error("Weight must be 25–250 kg.");
                        next.weight = action.weight;
                    }
                    if (action.age !== undefined) {
                        if (!Number.isInteger(action.age) || action.age < 13 || action.age > 100) throw new Error("Age must be 13–100.");
                        next.age = action.age;
                    }
                    if (action.sex !== undefined) {
                        if (!["female", "male", ""].includes(action.sex)) throw new Error("The suggested profile sex is not supported.");
                        next.sex = action.sex;
                    }
                    if (action.size !== undefined) {
                        if (!["S", "M", "L", "XL", "XXL"].includes(action.size)) throw new Error("The suggested body size is not supported.");
                        next.size = action.size;
                    }
                    if (action.activity !== undefined) {
                        if (!["sedentary", "light", "moderate", "active"].includes(action.activity)) throw new Error("The suggested activity level is not supported.");
                        next.activity = action.activity;
                    }
                    if (action.goal !== undefined) {
                        if (!["maintain", "loss", "gain"].includes(action.goal)) throw new Error("The suggested body goal is not supported.");
                        next.goal = action.goal;
                    }
                    if (Object.keys(next).length === 1) throw new Error("The suggested profile change is empty.");
                    return next;
                }
                case "plan_add": {
                    const title = text("title", 80, true);
                    const details = text("details", 240, false);
                    if (planIds.size >= 30) throw new Error("The daily plan already has 30 custom tasks.");
                    return { type: action.type, title, details };
                }
                case "plan_edit": {
                    const id = text("id", 100, true);
                    const title = text("title", 80, true);
                    const details = text("details", 240, false);
                    if (!planIds.has(id)) throw new Error("A suggested plan task no longer exists.");
                    return { type: action.type, id, title, details };
                }
                case "plan_remove": {
                    const id = text("id", 100, true);
                    if (!planIds.has(id)) throw new Error("A suggested plan task no longer exists.");
                    planIds.delete(id);
                    return { type: action.type, id };
                }
                case "note_add":
                    return { type: action.type, text: text("text", 1000, true) };
                case "reminder_add": {
                    const title = text("title", 60, true);
                    const time = text("time", 5, true);
                    if (!/^\d{2}:\d{2}$/.test(time) || Number(time.slice(0, 2)) > 23 || Number(time.slice(3)) > 59) throw new Error("Enter a valid reminder time.");
                    if (reminderIds.size >= 20) throw new Error("You can save up to 20 reminders.");
                    reminderIds.add(`pending-${reminderIds.size}`);
                    return { type: action.type, title, time };
                }
                case "reminder_edit": {
                    const id = text("id", 100, true);
                    const title = text("title", 60, true);
                    const time = text("time", 5, true);
                    if (!reminderIds.has(id)) throw new Error("A suggested reminder no longer exists.");
                    if (!/^\d{2}:\d{2}$/.test(time) || Number(time.slice(0, 2)) > 23 || Number(time.slice(3)) > 59) throw new Error("Enter a valid reminder time.");
                    return { type: action.type, id, title, time };
                }
                case "reminder_remove": {
                    const id = text("id", 100, true);
                    if (!reminderIds.has(id)) throw new Error("A suggested reminder no longer exists.");
                    reminderIds.delete(id);
                    return { type: action.type, id };
                }
                case "fitness_set": {
                    const field = text("field", 20, true);
                    if (!["water", "mood"].includes(field)) throw new Error("Health readings are read-only; only water and mood can be edited.");
                    const value = action.value;
                    if (value !== null) {
                        if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Fitness values must be a number or null to clear.");
                        const valid = field === "steps" ? Number.isInteger(value) && value >= 0 && value <= 100000
                            : field === "water" ? Number.isInteger(value) && value >= 0 && value <= 10000
                                : field === "sleep" ? value > 0 && value <= 24 && Number.isInteger(value * 2)
                                    : field === "active" ? Number.isInteger(value) && value >= 0 && value <= 600
                                        : Number.isInteger(value) && value >= 1 && value <= 5;
                        if (!valid) throw new Error(`The ${field} value is outside the supported range.`);
                    }
                    return { type: action.type, field, value };
                }
                case "reading_set": {
                    const bookId = action.bookId === undefined ? readingBookId : text("bookId", 80, true);
                    const book = READING_BOOKS.find((item) => item.id === bookId);
                    if (!book) throw new Error("The suggested reading book is not in the library.");
                    const changedBook = bookId !== readingBookId;
                    const page = action.page === undefined ? (changedBook ? 0 : readingPage) : action.page;
                    if (!Number.isInteger(page) || page < 0 || page > book.pages) throw new Error(`Page must be 0–${book.pages} for ${book.title}.`);
                    if (action.bookId === undefined && action.page === undefined) throw new Error("The suggested reading change is empty.");
                    readingBookId = bookId;
                    readingPage = page;
                    readingDailyEnd = Math.min(book.pages, changedBook ? readingPlan.dailyTarget : readingDailyEnd);
                    return { type: action.type, bookId, page };
                }
                case "daily_task_complete":
                    if (typeof action.done !== "boolean") throw new Error("Daily task status must be done or not done.");
                    return { type: action.type, done: action.done };
                case "focus_control": {
                    const mode = text("action", 10, true);
                    if (!["start", "pause", "reset"].includes(mode)) throw new Error("The focus action is not supported.");
                    if (mode === "start") {
                        const minutes = Number(action.minutes);
                        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error("Focus duration must be 1–1,440 minutes.");
                        focusIsRunning = true;
                        return { type: action.type, action: mode, minutes };
                    }
                    if (mode === "pause" && !focusIsRunning) throw new Error("There is no focus session to pause.");
                    focusIsRunning = false;
                    return { type: action.type, action: mode };
                }
                case "navigate": {
                    const section = text("section", 20, true);
                    if (!["dashboard", "tasks", "habits", "goals", "analytics"].includes(section)) throw new Error("That LifeTrack page does not exist.");
                    return { type: action.type, section };
                }
                default:
                    throw new Error("The assistant suggested an unsupported change.");
            }
        });
    }

    function aiActionLabel(action) {
        switch (action.type) {
            case "habit_add": return `Add habit: ${action.name}`;
            case "habit_edit": return `Rename habit: ${action.oldName} → ${action.name}`;
            case "habit_remove": return `Remove habit and its linked goals: ${action.name}`;
            case "habit_check": return `${action.done ? "Mark" : "Undo"} "${action.name}" ${action.done ? "done" : "as not done"} for today`;
            case "goal_add": return `Add ${action.difficulty} goal: ${action.name} · ${action.habit === "*" ? "all habits" : action.habit} · ${action.target}%`;
            case "goal_edit": return `Edit ${action.difficulty} goal: ${action.name} · ${action.habit === "*" ? "all habits" : action.habit} · ${action.target}%`;
            case "goal_remove": return `Remove goal: ${goals.find((goal) => goal.id === action.id).name}`;
            case "profile_edit": return `Update body profile${action.height ? ` · ${action.height} cm` : ""}${action.weight ? ` · ${action.weight} kg` : ""}${action.age ? ` · age ${action.age}` : ""}${action.activity ? ` · activity: ${action.activity}` : ""}${action.goal ? ` · body goal: ${action.goal}` : ""}`;
            case "plan_add": return `Add daily plan task: ${action.title}`;
            case "plan_edit": return `Edit daily plan task: ${aiPlanTasks.find((task) => task.id === action.id).title} → ${action.title}`;
            case "plan_remove": return `Remove daily plan task: ${aiPlanTasks.find((task) => task.id === action.id).title}`;
            case "note_add": return `Save note: ${action.text}`;
            case "reminder_add": return `Add reminder: ${action.title} at ${action.time}`;
            case "reminder_edit": return `Update reminder: ${aiReminder.reminders.find((reminder) => reminder.id === action.id).title} → ${action.title} at ${action.time}`;
            case "reminder_remove": return `Remove reminder: ${aiReminder.reminders.find((reminder) => reminder.id === action.id).title}`;
            case "fitness_set": return `${action.value === null ? "Clear" : "Set"} today's ${action.field}${action.value === null ? "" : ` to ${action.value}${action.field === "water" ? " ml" : action.field === "sleep" ? " hours" : action.field === "active" ? " minutes" : ""}`}`;
            case "reading_set": {
                const book = READING_BOOKS.find((item) => item.id === action.bookId);
                return `Update reading: ${book ? book.title : "book"} · page ${action.page}`;
            }
            case "daily_task_complete": return `${action.done ? "Mark" : "Undo"} today's task ${action.done ? "as complete" : "completion"}`;
            case "focus_control": return action.action === "start" ? `Start a ${action.minutes}-minute focus session` : action.action === "pause" ? "Pause the focus session" : "Reset the focus timer";
            case "navigate": return `Open ${({ dashboard: "Dashboard", tasks: "Task", habits: "Habits", goals: "Goals", analytics: "Analytics" })[action.section]}`;
            default: return "";
        }
    }

    function showAIProposals(actions) {
        const panel = document.getElementById("aiProposals");
        pendingAiActions = actions;
        panel.innerHTML = `<h4>Review before applying</h4><ul class="ai-proposal-list">${actions.map((action) => `<li>${esc(aiActionLabel(action))}</li>`).join("")}</ul><div class="ai-proposal-actions"><button type="button" data-ai-reject>Cancel</button><button type="button" class="ai-apply" data-ai-apply>Apply changes</button></div>`;
        panel.hidden = false;
    }

    async function requestGroqAI(messages, context, endpoint) {
        const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 7000) : null;
        try {
            const response = await fetch(endpoint, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                signal: controller ? controller.signal : undefined,
                body: JSON.stringify({
                    messages,
                    context,
                    requestId: assistantId(),
                    conversationId: aiConversationId,
                    operation: "chat"
                })
            });
            if (timer) clearTimeout(timer);
            let data;
            try {
                data = await response.json();
            } catch {
                const err = new Error(`LifeTrack AI returned an invalid response (HTTP ${response.status}).`);
                err.status = response.status;
                throw err;
            }
            if (!response.ok) {
                const error = new Error(data.error || `LifeTrack AI failed (HTTP ${response.status}).`);
                error.status = response.status;
                throw error;
            }
            return data;
        } catch (err) {
            if (timer) clearTimeout(timer);
            throw err;
        }
    }

    async function applyAIProposals() {
        if (!pendingAiActions.length) return;
        const applyButton = document.querySelector("#aiProposals [data-ai-apply]");
        const proposalButtons = Array.from(document.querySelectorAll("#aiProposals button"));
        proposalButtons.forEach((button) => { button.disabled = true; });
        if (applyButton) {
            applyButton.textContent = "Applying…";
        }
        try {
            pendingAiActions = validateAiActions(pendingAiActions);
        } catch (error) {
            pendingAiActions = [];
            document.getElementById("aiProposals").hidden = true;
            toast(`These suggestions are no longer valid: ${error.message}`);
            return;
        }
        const reminderActions = pendingAiActions.filter((action) => action.type.startsWith("reminder_"));
        if (reminderActions.length) {
            let nextReminders = aiReminder.reminders.slice();
            reminderActions.forEach((action) => {
                if (action.type === "reminder_add") {
                    nextReminders.push({ id: assistantId(), title: action.title, time: action.time, enabled: true, lastSent: "" });
                } else if (action.type === "reminder_edit") {
                    nextReminders = nextReminders.map((reminder) => reminder.id === action.id
                        ? { ...reminder, title: action.title, time: action.time, lastSent: "" }
                        : reminder);
                } else {
                    nextReminders = nextReminders.filter((reminder) => reminder.id !== action.id);
                }
            });
            aiReminderStatus.textContent = "Updating background reminders…";
            try {
                if (nativeReminderBridge) syncNativeAIReminders(nextReminders);
                else {
                    await requestReminderPermission();
                    await syncAIReminderPush(nextReminders);
                }
            } catch (error) {
                proposalButtons.forEach((button) => { button.disabled = false; });
                if (applyButton) applyButton.textContent = "Apply changes";
                aiReminderStatus.textContent = error.message || "The reminder changes could not be saved.";
                return;
            }
            aiReminder.reminders = nextReminders;
            saveAssistantState("ai-reminder", aiReminder);
            renderAIReminders();
            aiReminderEnable.disabled = aiReminder.reminders.length === 0;
            aiReminderTest.disabled = aiReminder.reminders.length === 0;
            aiReminderStatus.textContent = "AI reminder changes saved.";
        }
        pendingAiActions.forEach((action) => {
            if (action.type === "habit_add") {
                restoreHabitName(action.name);
                habits.push(action.name);
                habitStarts[action.name] = isoFromUTC(todayUTC());
            } else if (action.type === "habit_edit") {
                renameHabitData(action.oldName, action.name);
            } else if (action.type === "habit_remove") {
                markHabitDeleted(action.name);
                delete habitStarts[action.name];
                habits = habits.filter((habit) => habit !== action.name);
                goals.filter((goal) => goal.habit === action.name).forEach((goal) => markGoalDeleted(goal.id));
                goals.filter((goal) => goal.habit === action.name).forEach((goal) => markGoalDeleted(goal.id));
                goals = goals.filter((goal) => goal.habit !== action.name);
            } else if (action.type === "habit_check") {
                const key = keyFor(todayUTC(), action.name);
                if (action.done && action.name.toLowerCase() === "read" && !checks[key]) completeReadingGoal();
                else checks[key] = action.done;
            } else if (action.type === "goal_add") {
                goals.push({ id: `g-${assistantId()}`, name: action.name, habit: action.habit, target: action.target, difficulty: action.difficulty });
            } else if (action.type === "goal_edit") {
                const goal = goals.find((item) => item.id === action.id);
                goal.name = action.name;
                goal.habit = action.habit;
                goal.target = action.target;
                goal.difficulty = action.difficulty;
            } else if (action.type === "goal_remove") {
                markGoalDeleted(action.id);
                goals = goals.filter((goal) => goal.id !== action.id);
            } else if (action.type === "profile_edit") {
                if (action.height !== undefined) bodyProfile.height = action.height;
                if (action.weight !== undefined) bodyProfile.weight = action.weight;
                if (action.age !== undefined) bodyProfile.age = action.age;
                if (action.sex !== undefined) bodyProfile.sex = action.sex;
                if (action.size !== undefined) bodyProfile.size = action.size;
                if (action.activity) bodyProfile.activity = action.activity;
                if (action.goal) bodyProfile.goal = action.goal;
                store.set("body", JSON.stringify(bodyProfile));
            } else if (action.type === "plan_add") {
                aiPlanTasks.push({ id: assistantId(), title: action.title, details: action.details, doneDate: "" });
            } else if (action.type === "plan_edit") {
                const task = aiPlanTasks.find((item) => item.id === action.id);
                task.title = action.title;
                task.details = action.details;
            } else if (action.type === "plan_remove") {
                aiPlanTasks = aiPlanTasks.filter((task) => task.id !== action.id);
            } else if (action.type === "note_add") {
                saveAINote(action.text);
            } else if (action.type.startsWith("reminder_")) {
                return;
            } else if (action.type === "fitness_set") {
                setFit(action.field, action.value);
            } else if (action.type === "reading_set") {
                const book = switchReadingBook(action.bookId);
                if (!book || book.fileId) throw new Error("The suggested reading book is not in the supported library.");
                readingPlan.currentPage = action.page;
                saveReadingPlan();
            } else if (action.type === "daily_task_complete") {
                currentDailyTask();
                dailyTaskState.completed = action.done;
                store.set("daily-task", JSON.stringify(dailyTaskState));
                renderDailyTask();
            } else if (action.type === "focus_control") {
                clearInterval(focusInterval);
                focusInterval = null;
                if (action.action === "start") {
                    prepareFocusAudio();
                    focusDuration = action.minutes;
                    focusDurationValid = true;
                    focusRemaining = focusDuration * 60;
                    focusEndsAt = Date.now() + focusRemaining * 1000;
                    focusInterval = setInterval(tickFocusTimer, 1000);
                    setFocusLock(true, true);
                } else if (action.action === "pause") {
                    focusRemaining = Math.max(0, Math.ceil((focusEndsAt - Date.now()) / 1000));
                    focusEndsAt = null;
                } else {
                    focusRemaining = focusDuration * 60;
                    focusEndsAt = null;
                }
                renderFocusTimer();
            } else if (action.type === "navigate") {
                navigateToSection(action.section);
            }
        });
        saveState();
        saveGoals();
        saveAssistantState("ai-plan", aiPlanTasks);
        pendingAiActions = [];
        document.getElementById("aiProposals").hidden = true;
        renderCalendar();
        toast("AI changes saved.");
    }

    function generateSmartLocalAIResponse(prompt, context) {
        const p = prompt.toLowerCase().trim();
        const isSavage = context.coachMode === "Savage Coach";
        const task = context.dailyTask || {};
        const habitSummary = context.todayHabitSummary || { completed: 0, total: 0, percent: 0, unticked: [], streaks: {} };
        const fitness = context.todayFitness || {};
        const reading = context.reading || {};
        const userName = currentUser.name ? currentUser.name.split(" ")[0] : "Friend";
        const actions = [];
        let reply = "";

        // 1. Help & Capabilities
        if ((/\b(help|commands?|features?|capabilities)\b/.test(p) && !p.includes("procrastinat") && !p.includes("habit")) || p.includes("what can you do") || p.includes("who are you")) {
            reply = `✨ **LifeTrack AI Capabilities**\n\n`
                + `I can directly inspect and update your tracker records. Here are things you can ask:\n\n`
                + `• **"Summarize today's mission"** — Daily focus task, action plan & twist\n`
                + `• **"Mark task complete"** — Check off today's daily mission\n`
                + `• **"Check streaks"** — View active habits, streaks, and what's left today\n`
                + `• **"I drank 500ml water"** — Log hydration into today's fitness\n`
                + `• **"I slept 8 hours"** — Record your sleep duration\n`
                + `• **"Start a 25 min focus sprint"** — Launch the deep work timer\n`
                + `• **"Help me stop procrastinating"** — Actionable 2-minute psychological tactics\n`
                + `• **"Coach me"** — Comprehensive day audit (${isSavage ? "🔥 Savage Mode" : "🌱 Calm Mode"})\n`
                + `• **"Clear chat"** — Reset conversation history`;
        }
        // 2. Greetings & Salutations
        else if (/\b(hi|hello|hey|greetings|good morning|good evening|good afternoon|what's up|sup|howdy)\b/.test(p)) {
            const habitsLeftCount = habitSummary.unticked ? habitSummary.unticked.length : 0;
            reply = `👋 **Hey ${userName}!** I'm your LifeTrack AI Coach.\n\n`
                + `Here is where you stand today:\n`
                + `• **Habits:** ${habitSummary.completed}/${habitSummary.total} completed (${habitSummary.percent}%)\n`
                + `• **Today's Mission:** ${task.title || "Daily Mission"} (${task.completed ? "✓ Done" : "⏳ Pending"})\n`
                + `• **Vitals:** ${fitness.water || 0} ml water · ${fitness.steps || 0} steps · ${fitness.sleep || 0}h sleep\n\n`
                + (isSavage
                    ? (habitsLeftCount > 0
                        ? `🔥 **Savage Coach:** No time to coast. You still have **${habitsLeftCount} habit${habitsLeftCount === 1 ? "" : "s"}** to check off today. What are we tackling right now?`
                        : `🔥 **Savage Coach:** 100% completion today! Outstanding discipline. Keep the standard high.`)
                    : (habitsLeftCount > 0
                        ? `🌱 **Calm Coach:** Take a deep breath. Focus on one gentle step at a time. What would you like to work on next?`
                        : `🌱 **Calm Coach:** You have completed all your habits today! Enjoy this wonderful moment of accomplishment.`));
        }
        // 3. Mark Daily Task Complete
        else if ((p.includes("complete") || p.includes("mark") || p.includes("done") || p.includes("finish")) && (p.includes("task") || p.includes("mission"))) {
            actions.push({ type: "daily_task_complete", done: true });
            reply = `✅ Prepared the change to mark today's mission **"${task.title || "Daily Task"}"** as complete!\n\n`
                + (isSavage
                    ? `🔥 Good execution. Click **Apply changes** below to confirm it. Now tackle your remaining habits: ${habitSummary.unticked && habitSummary.unticked.length ? habitSummary.unticked.join(", ") : "None left!"}!`
                    : `🌱 Beautiful work! Click **Apply changes** below to save your achievement.`);
        }
        // 4. Daily Task / Routine Briefing / What should I do next
        else if (p.includes("task") || p.includes("summar") || p.includes("mission") || p.includes("routine") || p.includes("what should i do") || p.includes("what's next")) {
            const statusBadge = task.completed ? "✓ COMPLETED" : "⏳ PENDING";
            const habitsLeft = habitSummary.unticked && habitSummary.unticked.length
                ? habitSummary.unticked.slice(0, 5).join(", ") + (habitSummary.unticked.length > 5 ? ` (+${habitSummary.unticked.length - 5} more)` : "")
                : "All habits completed! 🎉";

            reply = `📋 **Daily Mission & Routine Briefing**\n\n`
                + `• **Today's Mission:** **${task.title || "Daily Focus Task"}** [${statusBadge}]\n`
                + `• **Category:** ${task.category || "Personal Growth"}\n`
                + (task.instruction ? `• **Action Plan:** ${task.instruction} (${task.minutes || 5} min)\n` : "")
                + (task.twist ? `• **Bonus Twist:** ${task.twist}\n` : "")
                + (task.finish ? `• **Finish With:** ${task.finish}\n` : "")
                + `\n📊 **Today's Habit Progress:**\n`
                + `• **Completed:** ${habitSummary.completed} of ${habitSummary.total} (${habitSummary.percent}%)\n`
                + `• **Remaining:** ${habitsLeft}\n`
                + `• **Vitals:** ${fitness.steps || 0} steps · ${fitness.water || 0} ml water · ${fitness.sleep || 0}h sleep · ${fitness.focusMinutes || 0}m focus\n\n`
                + (isSavage
                    ? (task.completed
                        ? `🔥 **Savage Coach:** Mission is checked off, but don't slack off. Finish your remaining habits before bed.`
                        : `🔥 **Savage Coach:** Stop hesitating! Set a timer for ${task.minutes || 5} minutes and crush this mission right now. Zero excuses.`)
                    : (task.completed
                        ? `🌱 **Calm Coach:** Wonderful job completing today's mission. Take a breath and enjoy your steady consistency.`
                        : `🌱 **Calm Coach:** Take ${task.minutes || 5} peaceful minutes for today's mission. Consistent small steps build great habits.`));

            if (!task.completed && (p.includes("complete") || p.includes("done") || p.includes("finish") || p.includes("mark"))) {
                actions.push({ type: "daily_task_complete", done: true });
            }
        }
        // 5. Habits & Streaks Audit
        else if (p.includes("streak") || p.includes("habit") || p.includes("unticked") || p.includes("chain")) {
            const streaks = habitSummary.streaks || {};
            const streakEntries = Object.entries(streaks).sort((a, b) => b[1] - a[1]);
            const topStreaksText = streakEntries.length
                ? streakEntries.slice(0, 5).map(([name, days]) => `• **${name}**: ${days} day${days === 1 ? "" : "s"}`).join("\n")
                : "• No active streaks recorded yet.";

            reply = `🔥 **Habits & Streaks Audit**\n\n`
                + `• Today's completion rate: **${habitSummary.completed}/${habitSummary.total} (${habitSummary.percent}%)**\n`
                + `• Unticked habits: **${habitSummary.unticked && habitSummary.unticked.length ? habitSummary.unticked.join(", ") : "All completed! 🎉"}**\n\n`
                + `🏆 **Active Streaks:**\n${topStreaksText}\n\n`
                + (isSavage
                    ? "Never break the chain on two consecutive days. If an unticked habit is staring at you, get it done right now."
                    : "Honour your commitments to yourself with calm consistency. One step at a time.");
        }
        // 6. Log Water
        else if (p.includes("water") || p.includes("drink") || p.includes("drank") || p.includes("hydrat")) {
            const match = p.match(/(\d+)\s*(ml)?/);
            const amount = match ? parseInt(match[1], 10) : 250;
            const currentWater = fitness.water || 0;
            const newWater = currentWater + amount;
            actions.push({ type: "fitness_set", field: "water", value: newWater });
            reply = `💧 Logged **+${amount} ml** of water! Today's new total is **${newWater} ml**.\n\nClick **Apply changes** below to save this to your fitness log!`;
        }
        // 7. Log Sleep & Sleep Advice
        else if (p.includes("sleep") || p.includes("slept") || p.includes("bedtime") || p.includes("insomnia")) {
            const match = p.match(/(\d+(\.\d+)?)\s*(h|hr|hours)?/);
            if (match) {
                const hours = parseFloat(match[1]);
                actions.push({ type: "fitness_set", field: "sleep", value: hours });
                reply = `🌙 Set today's sleep to **${hours} hours**! Click **Apply changes** below to update your fitness vitals.`;
            } else {
                reply = `🌙 **Sleep & Recovery Protocol**\n\n`
                    + `• Logged sleep today: **${fitness.sleep || 0} hours**\n\n`
                    + `**Key Sleep Principles:**\n`
                    + `1. **Circadian Anchor:** Wake up at the exact same time every day, including weekends.\n`
                    + `2. **Light Control:** Get 10 minutes of natural sunlight within an hour of waking; dim screens 1 hour before sleep.\n`
                    + `3. **Temperature:** Keep bedroom cool (~18-20°C / 65-68°F).\n\n`
                    + `To record sleep, tell me e.g. *"I slept 7.5 hours"*.`;
            }
        }
        // 8. Focus Session / Deep Work Timer
        else if (p.includes("focus") || p.includes("timer") || p.includes("pomodoro") || p.includes("sprint")) {
            const match = p.match(/(\d+)\s*(m|min|minutes)?/);
            const minutes = match ? Math.min(120, parseInt(match[1], 10)) : 25;
            actions.push({ type: "focus_control", action: "start", minutes });
            reply = `⏱️ Prepared a **${minutes}-minute deep focus sprint**!\n\n`
                + `• Place your phone in another room or out of arm's reach.\n`
                + `• Single-task on your most important project.\n\n`
                + `Click **Apply changes** below to start your timer!`;
        }
        // 9. Procrastination & Motivation
        else if (p.includes("procrastinat") || p.includes("lazy") || p.includes("delay") || p.includes("can't focus") || p.includes("unmotivated") || p.includes("hard to start")) {
            const nextHabit = habitSummary.unticked && habitSummary.unticked[0] ? habitSummary.unticked[0] : task.title || "your daily task";
            reply = `⚡ **How to Beat Procrastination Right Now**\n\n`
                + `Procrastination is emotional friction, not a lack of willpower. Use the **2-Minute Rule**:\n\n`
                + `1. **Shrink the Entry Barrier:** Tell yourself you will work on **"${nextHabit}"** for literally *2 minutes only*. If you want to stop after 120 seconds, you are allowed to.\n`
                + `2. **5-Second Rule:** Count down 5-4-3-2-1 out loud, stand up, and physically touch your workspace.\n`
                + `3. Starting breaks the psychological resistance. 80% of the time, momentum keeps you going.\n\n`
                + (isSavage
                    ? `🔥 **Savage Coach:** Motivation is fickle. Discipline is a muscle. Stop negotiating with your excuses and do 2 minutes right now.`
                    : `🌱 **Calm Coach:** Give yourself permission to do a rough first step. Progress is built on imperfect, gentle beginnings.`);
        }
        // 10. Energy & Fatigue
        else if (p.includes("tired") || p.includes("exhausted") || p.includes("burnout") || p.includes("low energy") || p.includes("drained")) {
            reply = `🔋 **Energy Reset Check-In**\n\n`
                + `Your current vitals: **${fitness.water || 0} ml water**, **${fitness.sleep || 0}h sleep**, **${fitness.steps || 0} steps**.\n\n`
                + `**Instant Energy Resets:**\n`
                + `• **Hydrate:** Drink 300 ml of cool water immediately (mild dehydration drops focus by 20%).\n`
                + `• **Oxygen Boost:** 10 deep belly breaths or a 3-minute brisk outdoor walk.\n`
                + `• **Posture Shift:** Stand up, stretch your chest and hamstrings.\n\n`
                + `If you are truly sleep-deprived, listen to your body and schedule an early bedtime tonight.`;
        }
        // 11. Reading & Books
        else if (p.includes("read") || p.includes("book") || p.includes("reading") || p.includes("learn") || p.includes("study")) {
            reply = `📚 **Reading & Knowledge Protocol**\n\n`
                + (reading.title
                    ? `• **Current Book:** *${reading.title}*\n• **Progress:** Page ${reading.page || 0} of ${reading.pageCount || 0} (Target: ${reading.dailyTarget || 10} pages/day)\n\n`
                    : `• **Current Plan:** Set a book in the Reading section to track pages and daily targets.\n\n`)
                + `💡 **Retention Strategy (Feynman Technique):**\n`
                + `After closing your book or study session, explain the central idea out loud in plain words as if teaching someone else. If you stumble, re-read that page.`;
        }
        // 12. Steps, Movement & Fitness
        else if (p.includes("step") || p.includes("walk") || p.includes("fitness") || p.includes("workout") || p.includes("exercise") || p.includes("gym")) {
            const steps = fitness.steps || 0;
            const distKm = (steps * 0.00078).toFixed(1);
            reply = `🏃 **Movement & Activity Audit**\n\n`
                + `• **Today's Steps:** **${steps.toLocaleString()}** steps (~${distKm} km)\n`
                + `• **Active Focus Time:** ${fitness.focusMinutes || 0} minutes\n`
                + `• **Water:** ${fitness.water || 0} ml\n\n`
                + (steps < 5000
                    ? `💡 You are under 5,000 steps today. A brisk 15-minute walk will add ~1,500 steps, clear mental fatigue, and regulate insulin.`
                    : `🔥 Great movement today! Consistent walking improves baseline metabolic health and mental clarity.`);
        }
        // 13. Coaching / Motivation / Day Review
        else if (p.includes("coach") || p.includes("motivat") || p.includes("savage") || p.includes("calm") || p.includes("advice") || p.includes("audit") || p.includes("how am i")) {
            const score = habitSummary.percent;
            if (isSavage) {
                reply = `⚡ **Savage Coach Audit:**\n\n`
                    + `You are currently sitting at **${score}%** habit completion today. `
                    + (score < 50
                        ? `That's amateur numbers. You told yourself you wanted to improve. Stand up, close distractions, and check off "${habitSummary.unticked[0] || "your next habit"}" right now.`
                        : `You're putting in the work, but don't coast. Champions finish strong. Finish today's task and close out the remaining habits before bed.`);
            } else {
                reply = `🌿 **Calm Coach Audit:**\n\n`
                    + `You have completed **${habitSummary.completed} of ${habitSummary.total}** habits (${score}%) today. `
                    + `Remember that progress is about direction, not perfection. Focus on what is directly in front of you today.`;
            }
        }
        // 14. Thoughtful Conversational Fallback
        else {
            reply = `💡 **LifeTrack AI Coach**\n\n`
                + `I hear you, ${userName}! Every day is a chance to sharpen your routines and build unstoppable consistency.\n\n`
                + `• **Today's Mission:** ${task.title || "Daily Mission"} (${task.completed ? "✓ Done" : "⏳ Pending"})\n`
                + `• **Habits Remaining:** ${habitSummary.unticked && habitSummary.unticked.length ? habitSummary.unticked.join(", ") : "All complete! 🎉"}\n`
                + `• **Vitals:** ${fitness.water || 0} ml water · ${fitness.steps || 0} steps · ${fitness.sleep || 0}h sleep\n\n`
                + `What would you like to do next? You can ask me to **"Summarize today's mission"**, **"Log 500ml water"**, **"Start a 25m focus sprint"**, or **"Check streaks"**!`;
        }

        return {
            reply,
            actions,
            provider: "LifeTrack AI Assistant"
        };
    }

    async function sendAIMessage(message) {
        const prompt = String(message || "").trim();
        if (!prompt) return;
        if (prompt.length > 1200) {
            toast("Keep each message under 1,200 characters.");
            return;
        }

        // Support clear chat command
        if (/^(clear|reset|clear chat|reset chat|clean chat)$/i.test(prompt)) {
            aiConversation = [];
            saveAssistantState("ai-conversation", aiConversation);
            renderAIMessages();
            toast("Chat history cleared.");
            return;
        }

        // Never lock out the user: if pending actions exist, dismiss old unapplied proposals so user can chat freely
        if (pendingAiActions.length) {
            pendingAiActions = [];
            const prop = document.getElementById("aiProposals");
            if (prop) prop.hidden = true;
        }

        const base = String(CFG.GROQ_WORKER_URL || "").trim().replace(/\/+$/, "");
        let workerBaseUrl = null;
        if (base) {
            try {
                workerBaseUrl = new URL(base);
                // Only use remote worker if HTTPS or if localhost port 8000 (wrangler), avoid static server port 3000
                if (workerBaseUrl.protocol !== "https:" && !(workerBaseUrl.hostname === "localhost" && workerBaseUrl.port === "8000")) {
                    workerBaseUrl = null;
                }
            } catch {
                workerBaseUrl = null;
            }
        }

        const promptInput = document.getElementById("aiPrompt");
        const sendButton = document.getElementById("aiSend");
        const voiceStatus = document.getElementById("aiVoiceStatus");
        promptInput.value = "";
        appendAIMessage("user", prompt);
        saveAssistantState("ai-conversation", aiConversation);
        renderAIMessages();
        sendButton.disabled = true;
        sendButton.textContent = "…";
        voiceStatus.textContent = "Thinking…";
        try {
            const messages = aiConversation.slice(-AI_REQUEST_MESSAGE_LIMIT).map((item) => ({
                role: item.role,
                content: item.content.slice(-AI_REQUEST_MESSAGE_CHARS)
            }));
            const context = aiContext();
            let data = null;

            if (workerBaseUrl && location.protocol !== "file:") {
                try {
                    voiceStatus.textContent = "Connecting to LifeTrack AI…";
                    data = await requestGroqAI(messages, context, `${workerBaseUrl.origin}/api/assistant`);
                    if (typeof data.reply !== "string" || !Array.isArray(data.actions)) data = null;
                } catch {
                    data = null;
                }
            }

            if (!data) {
                voiceStatus.textContent = "LifeTrack AI reasoning…";
                data = generateSmartLocalAIResponse(prompt, context);
            }

            appendAIMessage("assistant", data.reply.slice(0, 4000));
            updateAIMemorySummary(prompt, data.reply);
            saveAssistantState("ai-conversation", aiConversation);
            saveAssistantState("ai-memory-summary", aiMemorySummary);
            renderAIMessages();
            if (data.actions && data.actions.length) {
                try {
                    showAIProposals(validateAiActions(data.actions));
                } catch (error) {
                    appendAIMessage("assistant", `I skipped a proposed change: ${error.message}`);
                    saveAssistantState("ai-conversation", aiConversation);
                    renderAIMessages();
                }
            }
            voiceStatus.textContent = `Answered by ${data.provider || "LifeTrack AI"}.`;
        } catch (error) {
            const authFailure = [401, 403].includes(error.status)
                && /session|account has been deleted|account is suspended/i.test(error.message || "");
            const message = location.protocol === "file:"
                ? "This dashboard is open as a local file, so the browser blocks its AI connection. Open the hosted HTTPS LifeTrack page to use the assistant."
                : authFailure
                    ? `LifeTrack AI needs an active sign-in: ${error.message} Sign out and sign in with an active account.`
                    : `LifeTrack AI note: ${error.message}`;
            appendAIMessage("assistant", message, authFailure ? "sign-in" : "");
            saveAssistantState("ai-conversation", aiConversation);
            renderAIMessages();
            voiceStatus.textContent = message;
        } finally {
            sendButton.disabled = false;
            sendButton.textContent = "Send";
        }
    }

    async function doLogout() {
        if (["google", "apple", "password"].includes(currentUser.provider) && location.protocol !== "file:") {
            try {
                const response = await fetch("/api/auth/logout", {
                    method: "POST",
                    credentials: "same-origin",
                    cache: "no-store"
                });
                if (!response.ok) throw new Error(`Logout failed (HTTP ${response.status}).`);
            } catch (error) {
                console.error("LifeTrack could not end the persistent Google session.", error);
                toast("Could not securely sign out. Check your connection and try again.");
                return;
            }
        }
        localStorage.removeItem("lifetrack-user");
        sessionStorage.removeItem("lifetrack-gtoken");
        sessionStorage.removeItem("lifetrack-drive-token");
        window.location.href = "index.html";
    }

    const profileMenu = document.getElementById("profileMenu");
    const logoBtn = document.getElementById("logoBtn");
    const userChip = document.getElementById("userChip");
    let menuOpener = null;

    function closeMenu() {
        profileMenu.hidden = true;
        logoBtn.setAttribute("aria-expanded", "false");
        userChip.setAttribute("aria-expanded", "false");
    }

    function openMenu(opener) {
        menuOpener = opener;
        const linked = Boolean(googleToken());
        const isGoogle = currentUser.provider === "google";
        const isDark = document.body.classList.contains("dark");
        const avatar = currentUser.picture ? `<img alt="" referrerpolicy="no-referrer" src="${esc(currentUser.picture)}">` : esc((Array.from(currentUser.name.trim())[0] || "U").toUpperCase());
        profileMenu.innerHTML = `<div class="pm-head"><span class="profile pm-avatar">${avatar}</span><div><strong>${esc(currentUser.name)}</strong><small>${esc(currentUser.email || (currentUser.name === "Guest" ? "Guest, data stays on this device" : "No email added"))}</small><span class="chip">${isGoogle ? "Google account remembered on this device" : "Account remembered on this device"}</span></div></div>
            <div class="pm-list" role="none">
                <button type="button" role="menuitem" data-act="section" data-section="dashboard">📊 Dashboard</button>
                <button type="button" role="menuitem" data-act="section" data-section="habits">✓ Habits</button>
                <button type="button" role="menuitem" data-act="section" data-section="goals">🎯 Goals</button>
                <button type="button" role="menuitem" data-act="section" data-section="analytics">📈 Analytics</button>
                <button type="button" role="menuitem" data-act="section" data-section="tasks">⚡ Task</button>
                ${isNativeAndroidApp ? "" : `<button type="button" role="menuitem" data-act="theme">${isDark ? "☀️ Light Mode" : "🌙 Dark Mode"}</button>`}
                <hr>
                <button type="button" role="menuitem" data-act="edit">✏️ Edit profile</button>
                <button type="button" role="menuitem" data-act="body">⚖️ Body profile</button>
                <button type="button" role="menuitem" data-act="feedback">💬 Feedback</button>
                ${currentUser.provider === "google" ? `<span class="chip">${linked ? "Google sync ready for this session" : "Google sync paused; account still signed in"}</span><button type="button" role="menuitem" data-act="reauth">🔄 Reconnect Google sync</button>` : ""}
                <hr>
                <button type="button" role="menuitem" class="danger" data-act="reset">🗑️ Delete all my data</button>
                <hr>
                <button type="button" role="menuitem" data-act="switch-account">🔁 Switch account</button>
                <button type="button" role="menuitem" class="danger" data-act="logout">🚪 Log out</button>
            </div>`;
        profileMenu.hidden = false;
        const viewportHeight = document.documentElement.clientHeight;
        const viewportWidth = document.documentElement.clientWidth;
        const edge = 12;
        const mobileNav = window.matchMedia("(max-width: 620px)").matches
            ? document.querySelector(".sidebar")
            : null;
        const availableBottom = Math.min(
            viewportHeight - edge,
            mobileNav ? mobileNav.getBoundingClientRect().top - edge : viewportHeight - edge
        );
        profileMenu.style.maxHeight = `${Math.max(80, availableBottom - edge)}px`;
        const r = opener.getBoundingClientRect();
        const w = profileMenu.offsetWidth;
        const h = profileMenu.offsetHeight;
        let left;
        let top;
        if (opener === logoBtn) {
            left = r.right + 12;
            top = Math.min(r.top, viewportHeight - h - edge);
        } else {
            left = r.right - w;
            top = r.bottom + 8;
            if (top + h > availableBottom) top = r.top - h - 8;
        }
        left = clamp(left, edge, Math.max(edge, viewportWidth - w - edge));
        const maxTop = availableBottom - h;
        profileMenu.style.left = `${left}px`;
        profileMenu.style.top = `${clamp(top, edge, Math.max(edge, maxTop))}px`;
        opener.setAttribute("aria-expanded", "true");
        const firstItem = profileMenu.querySelector("button");
        if (firstItem) firstItem.focus();
    }

    function toggleMenu(opener) {
        if (!profileMenu.hidden && menuOpener === opener) closeMenu(); else openMenu(opener);
    }

    logoBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleMenu(logoBtn); });
    userChip.addEventListener("click", (e) => { e.stopPropagation(); toggleMenu(userChip); });
    document.addEventListener("click", (e) => { if (!profileMenu.hidden && !profileMenu.contains(e.target)) closeMenu(); });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            const aiPanel = document.getElementById("aiPanel");
            if (!aiPanel.hidden) {
                aiPanel.hidden = true;
                document.getElementById("aiLauncher").setAttribute("aria-expanded", "false");
                updateNativeAdSuppression();
            }
            if (!profileMenu.hidden) { closeMenu(); if (menuOpener) menuOpener.focus(); }
            closeModal();
        }
    });

    profileMenu.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-act]");
        if (!b) return;
        const act = b.dataset.act;
        closeMenu();
        if (act === "section") navigateToSection(b.dataset.section);
        else if (act === "theme") setTheme(!document.body.classList.contains("dark"));
        else if (act === "edit") openProfileEditor();
        else if (act === "feedback") openFeedbackModal();
        else if (act === "body") {
            navigateToSection("dashboard");
            editingBody = true;
            renderDailyReminder(lastLife || computeLifetime());
            dailyReminder.scrollIntoView({ behavior: "smooth", block: "center" });
        } else if (act === "gsync") syncGoogle();
        else if (act === "reauth") reconnectGoogleSync();
        else if (act === "switch-account") window.location.href = "index.html?forceLogin=1";
        else if (act === "reset") {
            confirmModal("Delete all your data?", "This removes your habits, check-ins, goals, reading progress, body profile, fitness log, AI notes, reminders and custom plan tasks from this browser and removes its background reminder schedule. Download a backup first if you might want them back.", "Delete everything", async () => {
                try {
                    if (nativeReminderBridge) syncNativeAIReminders([]);
                    else await syncAIReminderPush([]);
                } catch (error) {
                    toast(`Could not remove background reminders: ${error.message}`);
                    return;
                }
                ["habits", "checks", "habit-start", "deleted-habits", "body", "goals", "fitness", "reading-plan", "daily-task", "ai-notes", "ai-plan", "ai-conversation", "ai-reminder", "ai-reminder-push-client"].forEach((k) => store.remove(k));
                window.location.reload();
            });
        } else if (act === "logout") doLogout();
    });

    /* ---------- page handlers ---------- */

    const aiLauncher = document.getElementById("aiLauncher");
    const aiPanel = document.getElementById("aiPanel");
    const aiPrompt = document.getElementById("aiPrompt");
    document.addEventListener("keydown", (event) => {
        if (focusLockActive || isNativeAndroidApp || !window.matchMedia("(min-width: 621px)").matches
            || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
            || event.repeat || event.defaultPrevented) return;
        const target = event.target;
        if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']")) return;

        const shortcuts = {
            d: () => navigateToSection("dashboard"),
            g: () => navigateToSection("goals"),
            h: () => navigateToSection("habits"),
            a: () => navigateToSection("analytics"),
            n: () => openAssistantView("notes"),
            r: () => openAssistantView("reminders"),
            i: () => openAssistantView("chat"),
            p: () => userChip.click(),
            t: () => themeToggle.click()
        };
        const action = shortcuts[event.key.toLowerCase()];
        if (!action) return;
        event.preventDefault();
        action();
    });

    function openAssistantView(tab) {
        if (aiPanel.hidden) aiLauncher.click();
        setAITab(tab);
    }

    const aiInstallTrigger = document.getElementById("aiInstallTrigger");
    const supportHeaderTrigger = document.getElementById("supportHeaderTrigger");
    const aiInstallMenu = document.getElementById("aiInstallMenu");
    const aiInstallStatus = document.getElementById("aiInstallStatus");
    const aiInstallWindows = document.getElementById("aiInstallWindows");
    const aiInstallMac = document.getElementById("aiInstallMac");
    const aiInstallAndroid = document.getElementById("aiInstallAndroid");
    if (isNativeLifeTrackApp) {
        aiInstallTrigger.hidden = true;
        if (supportHeaderTrigger) supportHeaderTrigger.hidden = false;
    }
    aiInstallTrigger.addEventListener("click", () => {
        aiInstallMenu.hidden = !aiInstallMenu.hidden;
        aiInstallTrigger.setAttribute("aria-expanded", String(!aiInstallMenu.hidden));
        aiInstallStatus.textContent = "";
    });
    async function promptPwaInstall(platform) {
        const installer = window.LifeTrackPwaInstall;
        if (!installer) {
            aiInstallStatus.textContent = platform === "Mac"
                ? "On Mac, use Chrome or Edge's Install option, or Safari's File → Add to Dock. See Mac installation instructions."
                : "Open this page in Chrome or Edge on Windows to install LifeTrack.";
            return;
        }
        try {
            const outcome = await installer.prompt();
            aiInstallStatus.textContent = outcome === "accepted"
                ? "LifeTrack install started."
                : outcome === "dismissed"
                    ? "Install was cancelled."
                    : "No install prompt is available. In Chrome or Edge, open the menu and choose Install LifeTrack.";
        } catch (error) {
            console.error(`LifeTrack could not open the ${platform} browser install prompt.`, error);
            aiInstallStatus.textContent = "The browser install prompt could not be opened. Try Install LifeTrack from the browser menu.";
        }
    }
    aiInstallWindows.addEventListener("click", () => promptPwaInstall("Windows"));
    aiInstallMac.addEventListener("click", () => promptPwaInstall("Mac"));
    aiInstallAndroid.addEventListener("click", () => {
        aiInstallStatus.textContent = "Downloading the Android APK. Open the downloaded file on your phone to install it.";
    });
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || aiInstallMenu.hidden) return;
        aiInstallMenu.hidden = true;
        aiInstallTrigger.setAttribute("aria-expanded", "false");
        aiInstallTrigger.focus();
    });
    const aiSetupNote = document.getElementById("aiSetupNote");
    const aiCoachModeSelect = document.getElementById("aiCoachMode");
    aiCoachModeSelect.value = aiCoachMode;
    aiCoachModeSelect.addEventListener("change", () => {
        aiCoachMode = aiCoachModeSelect.value === "calm" ? "calm" : "savage";
        localStorage.setItem(NS + "ai-coach-mode", aiCoachMode);
        toast(aiCoachMode === "calm" ? "Calm Coach mode selected." : "Savage Coach mode selected.");
    });
    aiSetupNote.textContent = "LifeTrack AI Assistant & Coach is ready. Ask to summarize today's task, review your streaks, log vitals, or give accountability coaching.";
    aiSetupNote.title = aiSetupNote.textContent;
    aiSetupNote.setAttribute("aria-label", aiSetupNote.textContent);
    renderAIMessages();
    renderAINotes();

    function openAIPanelWithFocus() {
        aiPanel.hidden = false;
        aiLauncher.setAttribute("aria-expanded", "true");
        updateNativeAdSuppression();
        clearAIReminderUnread();
        setAITab("chat");
        aiPrompt.focus();
        scrollAIMessagesToLatest();
    }

    aiLauncher.addEventListener("click", () => {
        aiPanel.hidden = !aiPanel.hidden;
        aiLauncher.setAttribute("aria-expanded", String(!aiPanel.hidden));
        updateNativeAdSuppression();
        if (!aiPanel.hidden) {
            clearAIReminderUnread();
            aiPrompt.focus();
            scrollAIMessagesToLatest();
        }
    });

    const navAiBtn = document.getElementById("navAiBtn");
    if (navAiBtn) navAiBtn.addEventListener("click", openAIPanelWithFocus);

    const aiTopbarBtn = document.getElementById("aiTopbarBtn");
    if (aiTopbarBtn) aiTopbarBtn.addEventListener("click", openAIPanelWithFocus);

    // Notifications Menu Toggle
    const notifBellBtn = document.getElementById("notifBellBtn");
    const notifMenu = document.getElementById("notifMenu");
    const notifCloseBtn = document.getElementById("notifCloseBtn");
    const notifRefreshBtn = document.getElementById("notifRefreshBtn");
    const notifSystemTrigger = document.getElementById("notifSystemTrigger");
    const notifList = document.getElementById("notifList");

    if (notifBellBtn && notifMenu) {
        notifBellBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const isOpen = !notifMenu.hidden;
            notifMenu.hidden = isOpen;
            notifBellBtn.setAttribute("aria-expanded", String(!isOpen));
            if (!isOpen) renderTaskNotifications();
        });
    }
    if (notifCloseBtn && notifMenu) {
        notifCloseBtn.addEventListener("click", () => {
            notifMenu.hidden = true;
            if (notifBellBtn) notifBellBtn.setAttribute("aria-expanded", "false");
        });
    }
    if (notifRefreshBtn) {
        notifRefreshBtn.addEventListener("click", () => {
            renderTaskNotifications();
            renderAiDailyBriefBanner();
            toast("Task summary refreshed.");
        });
    }
    if (notifSystemTrigger) {
        notifSystemTrigger.addEventListener("click", () => {
            sendDeviceNotification();
        });
    }
    if (notifList) {
        notifList.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-notif-action]");
            if (!btn) return;
            const action = btn.dataset.notifAction;
            if (action === "complete-task") {
                dailyTaskState.completed = !dailyTaskState.completed;
                store.set("daily-task", JSON.stringify(dailyTaskState));
                renderDailyTask();
                renderTaskNotifications();
                renderAiDailyBriefBanner();
                toast(dailyTaskState.completed ? "Daily task complete! Excellent work." : "Task marked incomplete.");
            } else if (action === "ask-ai") {
                if (notifMenu) notifMenu.hidden = true;
                openAIPanelWithFocus();
                sendAIMessage("Summarize my daily task and routine today");
            }
        });
    }
    document.addEventListener("click", (e) => {
        if (notifMenu && !notifMenu.hidden && !notifMenu.contains(e.target) && !notifBellBtn.contains(e.target)) {
            notifMenu.hidden = true;
            if (notifBellBtn) notifBellBtn.setAttribute("aria-expanded", "false");
        }
    });

    // AI Daily Brief banner controls
    const aiBriefCompleteBtn = document.getElementById("aiBriefCompleteBtn");
    if (aiBriefCompleteBtn) {
        aiBriefCompleteBtn.addEventListener("click", () => {
            dailyTaskState.completed = !dailyTaskState.completed;
            store.set("daily-task", JSON.stringify(dailyTaskState));
            renderDailyTask();
            renderTaskNotifications();
            renderAiDailyBriefBanner();
            toast(dailyTaskState.completed ? "Daily task completed!" : "Task marked incomplete.");
        });
    }
    const aiBriefAskAiBtn = document.getElementById("aiBriefAskAiBtn");
    if (aiBriefAskAiBtn) {
        aiBriefAskAiBtn.addEventListener("click", () => {
            openAIPanelWithFocus();
            sendAIMessage("Summarize my daily task and tell me what to do next.");
        });
    }
    const aiBriefNotifyBtn = document.getElementById("aiBriefNotifyBtn");
    if (aiBriefNotifyBtn) {
        aiBriefNotifyBtn.addEventListener("click", () => {
            sendDeviceNotification();
        });
    }

    // Quick Prompts click
    const aiQuickPrompts = document.getElementById("aiQuickPrompts");
    if (aiQuickPrompts) {
        aiQuickPrompts.addEventListener("click", (e) => {
            const chip = e.target.closest(".ai-prompt-chip");
            if (!chip) return;
            const prompt = chip.dataset.prompt;
            if (prompt) sendAIMessage(prompt);
        });
    }

    // Initialize briefings and notifications
    renderAiDailyBriefBanner();
    renderTaskNotifications();
    document.getElementById("aiClose").addEventListener("click", () => {
        aiPanel.hidden = true;
        aiInstallMenu.hidden = true;
        aiInstallTrigger.setAttribute("aria-expanded", "false");
        aiLauncher.setAttribute("aria-expanded", "false");
        aiLauncher.focus();
        updateNativeAdSuppression();
    });
    document.querySelector(".ai-tabs").addEventListener("click", (event) => {
        const button = event.target.closest("[data-ai-tab]");
        if (button) setAITab(button.dataset.aiTab);
    });

    const aiChatForm = document.getElementById("aiChatForm");
    aiPrompt.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        if (!document.getElementById("aiSend").disabled) aiChatForm.requestSubmit();
    });
    aiChatForm.addEventListener("submit", (event) => {
        event.preventDefault();
        sendAIMessage(aiPrompt.value);
    });
    const startAudioTranscriptionRecording = async () => {
        const status = document.getElementById("aiVoiceStatus");
        const micButton = document.getElementById("aiMic");
        const setVoiceStatus = (message, isError = false) => {
            status.textContent = message;
            status.dataset.state = isError ? "error" : "info";
        };
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
            setVoiceStatus("Audio transcription is not supported in this browser. Allow microphone access or type your message.", true);
            return;
        }
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
                .find((type) => MediaRecorder.isTypeSupported(type));
            const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
            const recording = { recorder, stream, chunks: [], uploading: false };
            aiAudioRecording = recording;
            recorder.ondataavailable = (event) => {
                if (event.data && event.data.size) recording.chunks.push(event.data);
            };
            recorder.onerror = (event) => {
                stream.getTracks().forEach((track) => track.stop());
                if (aiAudioRecording === recording) aiAudioRecording = null;
                micButton.setAttribute("aria-pressed", "false");
                micButton.title = "Voice input";
                setVoiceStatus(`Microphone recording failed${event.error && event.error.message ? `: ${event.error.message}` : "."} Check your microphone and try again.`, true);
            };
            recorder.onstop = async () => {
                recording.uploading = true;
                setVoiceStatus("Transcribing audio securely…");
                const audio = new Blob(recording.chunks, { type: recorder.mimeType || "audio/webm" });
                stream.getTracks().forEach((track) => track.stop());
                try {
                    if (!audio.size) throw new Error("No audio was recorded. Try speaking closer to the microphone.");
                    const base = String(CFG.GROQ_WORKER_URL || "").trim().replace(/\/+$/, "");
                    if (!base) throw new Error("Audio transcription needs the secure Groq Worker.");
                    const endpoint = new URL(`${base}/api/transcribe`);
                    if (endpoint.protocol !== "https:" && endpoint.hostname !== "localhost") {
                        throw new Error("Use the hosted HTTPS LifeTrack page for microphone transcription.");
                    }
                    const extension = audio.type.includes("mp4") ? "m4a" : "webm";
                    const form = new FormData();
                    form.set("audio", audio, `lifetrack-recording.${extension}`);
                    const language = document.getElementById("aiVoiceLanguage").value;
                    if (language !== "auto") form.set("language", language);
                    const response = await fetch(endpoint.toString(), { method: "POST", body: form });
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.error || `Audio transcription failed (HTTP ${response.status}).`);
                    if (typeof result.text !== "string" || !result.text.trim()) {
                        throw new Error("No speech was detected. Try speaking again.");
                    }
                    aiPrompt.value = [aiPrompt.value.trim(), result.text.trim()].filter(Boolean).join(" ");
                    aiPrompt.focus();
                    setVoiceStatus("Voice added to the message. Press Send when ready.");
                } catch (error) {
                    setVoiceStatus(error.message || "Audio transcription failed. Type your message instead.", true);
                } finally {
                    if (aiAudioRecording === recording) aiAudioRecording = null;
                    micButton.setAttribute("aria-pressed", "false");
                    micButton.title = "Voice input";
                }
            };
            recorder.start(250);
            micButton.setAttribute("aria-pressed", "true");
            micButton.title = "Stop recording";
            setVoiceStatus("Recording… tap the mic again to transcribe. Audio is sent to Groq through the secure Worker.");
        } catch (error) {
            if (stream) stream.getTracks().forEach((track) => track.stop());
            setVoiceStatus(error.name === "NotAllowedError"
                ? "Microphone access is blocked. Allow microphone permission for LifeTrack, then try again."
                : `Could not start microphone recording: ${error.message || error.name}.`, true);
        }
    };
    document.getElementById("aiMic").addEventListener("click", () => {
        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const status = document.getElementById("aiVoiceStatus");
        const micButton = document.getElementById("aiMic");
        const setVoiceStatus = (message, isError = false) => {
            status.textContent = message;
            status.dataset.state = isError ? "error" : "info";
        };
        const secureOrigin = location.protocol === "https:" || location.hostname === "localhost";
        if (!secureOrigin) {
            setVoiceStatus("Voice input needs the hosted HTTPS page (or localhost) and microphone permission. Open the deployed LifeTrack page to use the mic.", true);
            return;
        }
        if (aiAudioRecording) {
            if (!aiAudioRecording.uploading && aiAudioRecording.recorder.state === "recording") {
                aiAudioRecording.recorder.stop();
                micButton.title = "Transcribing audio";
            } else {
                setVoiceStatus("Transcribing audio…");
            }
            return;
        }
        if (!Recognition) {
            void startAudioTranscriptionRecording();
            return;
        }
        if (aiRecognition) {
            try {
                aiRecognition.stop();
                setVoiceStatus("Stopping voice input…");
            } catch (error) {
                aiRecognition = null;
                micButton.setAttribute("aria-pressed", "false");
                micButton.title = "Voice input";
                setVoiceStatus(`Could not stop voice input: ${error.message || error.name}.`, true);
            }
            return;
        }
        let recognition;
        try {
            recognition = new Recognition();
        } catch (error) {
            setVoiceStatus(`Could not start voice input: ${error.message || error.name}.`, true);
            return;
        }
        aiRecognition = recognition;
        const selectedVoiceLanguage = document.getElementById("aiVoiceLanguage").value;
        recognition.lang = selectedVoiceLanguage === "auto" ? navigator.language || "en-US" : selectedVoiceLanguage;
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        setVoiceStatus("Listening…");
        recognition.onstart = () => {
            micButton.setAttribute("aria-pressed", "true");
            micButton.title = "Stop voice input";
            setVoiceStatus("Listening… tap the mic again to stop.");
        };
        recognition.onresult = (event) => {
            const transcript = Array.from(event.results).map((result) => result[0].transcript).join(" ").trim();
            aiPrompt.value = [aiPrompt.value.trim(), transcript].filter(Boolean).join(" ");
            aiPrompt.focus();
            setVoiceStatus(transcript ? "Voice added to the message. Press Send when ready." : "No speech was detected.", !transcript);
        };
        recognition.onerror = (event) => {
            const messages = {
                "not-allowed": "Microphone access is blocked. Allow microphone permission for LifeTrack in your browser settings, then try again.",
                "service-not-allowed": "The browser's speech service is blocked. Try Chrome or Edge on the hosted HTTPS LifeTrack page.",
                "audio-capture": "No working microphone was found. Connect or enable a microphone, then try again.",
                network: "The browser could not reach its speech service. Check your internet connection and try again.",
                "no-speech": "No speech was detected. Check microphone permission and try speaking again."
            };
            if (event.error === "network" || event.error === "service-not-allowed") {
                aiRecognition = null;
                setVoiceStatus("Browser speech service is unavailable. Switching to LifeTrack audio transcription…");
                void startAudioTranscriptionRecording();
                return;
            }
            setVoiceStatus(messages[event.error] || `Voice input failed (${event.error || "unknown error"}). You can type your message instead.`, true);
        };
        recognition.onend = () => {
            if (aiRecognition === recognition) aiRecognition = null;
            micButton.setAttribute("aria-pressed", "false");
            micButton.title = "Voice input";
            if (status.textContent === "Stopping voice input…") setVoiceStatus("Voice input stopped.");
        };
        try {
            recognition.start();
        } catch (error) {
            aiRecognition = null;
            micButton.setAttribute("aria-pressed", "false");
            micButton.title = "Voice input";
            setVoiceStatus(`Could not start voice input: ${error.message || error.name}. Allow microphone permission and try again.`, true);
        }
    });
    document.getElementById("aiSpeak").addEventListener("click", () => {
        const lastReply = aiConversation.slice().reverse().find((message) => message.role === "assistant");
        const status = document.getElementById("aiVoiceStatus");
        if (!("speechSynthesis" in window) || !window.SpeechSynthesisUtterance) {
            status.textContent = "Text-to-speech is not supported in this browser.";
            return;
        }
        if (!lastReply) {
            status.textContent = "There is no assistant reply to read aloud yet.";
            return;
        }
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(lastReply.content);
        const selectedVoiceLanguage = document.getElementById("aiVoiceLanguage").value;
        utterance.lang = selectedVoiceLanguage === "auto" ? navigator.language || "en-US" : selectedVoiceLanguage;
        window.speechSynthesis.speak(utterance);
        status.textContent = "Reading the latest assistant reply aloud.";
    });
    document.getElementById("aiNoteForm").addEventListener("submit", (event) => {
        event.preventDefault();
        const input = document.getElementById("aiNoteInput");
        try {
            saveAINote(input.value);
            input.value = "";
            toast("Note saved on this device.");
        } catch (error) {
            toast(error.message);
        }
    });
    document.getElementById("aiNotesList").addEventListener("click", (event) => {
        const editButton = event.target.closest("[data-note-edit]");
        const deleteButton = event.target.closest("[data-note-delete]");
        if (editButton) {
            const note = aiNotes.find((item) => item.id === editButton.dataset.noteEdit);
            if (!note) return;
            const modal = openModal(`<h3>Edit note</h3><textarea id="aiEditNote" class="ai-edit-note" maxlength="1000">${esc(note.text)}</textarea><p class="modal-error" id="aiEditNoteError" hidden>Enter a note of up to 1,000 characters.</p><div class="modal-actions"><button type="button" class="secondary-button" data-cancel>Cancel</button><button type="button" class="primary-button" id="aiSaveEditedNote">Save note</button></div>`);
            modal.querySelector("#aiSaveEditedNote").addEventListener("click", () => {
                const input = modal.querySelector("#aiEditNote");
                const value = input.value.trim();
                if (!value || value.length > 1000) {
                    modal.querySelector("#aiEditNoteError").hidden = false;
                    return;
                }
                saveAINote(value, note.id);
                closeModal();
                toast("Note updated.");
            });
        } else if (deleteButton) {
            const note = aiNotes.find((item) => item.id === deleteButton.dataset.noteDelete);
            if (!note) return;
            confirmModal("Delete this note?", "This note will be removed from this device.", "Delete note", () => {
                aiNotes = aiNotes.filter((item) => item.id !== note.id);
                saveAssistantState("ai-notes", aiNotes);
                renderAINotes();
                toast("Note deleted.");
            });
        }
    });
    document.getElementById("aiProposals").addEventListener("click", (event) => {
        if (event.target.closest("[data-ai-apply]")) void applyAIProposals();
        else if (event.target.closest("[data-ai-reject]")) {
            pendingAiActions = [];
            document.getElementById("aiProposals").hidden = true;
        }
    });
    const aiReminderList = document.getElementById("aiReminderList");
    const aiReminderEnable = document.getElementById("aiReminderEnable");
    const aiReminderDisplayTest = document.getElementById("aiReminderDisplayTest");
    const aiReminderAlarmTest = document.getElementById("aiReminderAlarmTest");
    const aiReminderTest = document.getElementById("aiReminderTest");
    const aiReminderTime = document.getElementById("aiReminderTime");
    const aiReminderStatus = document.getElementById("aiReminderStatus");
    const aiReminderBadge = document.getElementById("aiReminderBadge");
    const nativeReminderBridge = window.LifeTrackNativeReminders
        && isNativeLifeTrackApp
        ? window.LifeTrackNativeReminders
        : null;
    const nativeReminderPlatformName = isNativeAndroidApp ? "Android" : "iPhone";
    const aiReminderUnreadStorageKey = `${NS}ai-reminder-unread`;
    const aiReminderReadStorageKey = `${NS}ai-reminder-read`;
    let nativeReminderUnreadKeys = [];
    function syncNativeAIReminders(reminders) {
        if (!nativeReminderBridge) return;
        const saved = nativeReminderBridge.syncReminders(JSON.stringify(reminders.map(({ id, title, time }) => ({ id, title, time }))));
        if (!saved) throw new Error(`${nativeReminderPlatformName} could not save the native reminder alarms.`);
    }
    if (nativeReminderBridge) {
        aiReminderEnable.textContent = `Enable ${nativeReminderPlatformName} reminders`;
        aiReminderDisplayTest.textContent = `Test ${nativeReminderPlatformName} system notification`;
        aiReminderAlarmTest.textContent = `Test ${nativeReminderPlatformName} reminder while closed (1 min)`;
        aiReminderAlarmTest.hidden = false;
        aiReminderTest.hidden = true;
        window.refreshNativeAIReminderBadge = () => {
            try {
                if (!aiPanel.hidden) {
                    nativeReminderBridge.clearUnreadReminders();
                    nativeReminderUnreadKeys = [];
                    renderAIReminderBadge();
                    return;
                }
                const keys = JSON.parse(nativeReminderBridge.getUnreadReminderKeys());
                const todaySuffix = `|${currentAIReminderDay()}`;
                nativeReminderUnreadKeys = Array.isArray(keys)
                    ? keys.filter((key) => typeof key === "string" && key.endsWith(todaySuffix))
                    : [];
                renderAIReminderBadge();
            } catch (error) {
                console.error("LifeTrack could not read native unread reminders.", error);
            }
        };
        window.refreshNativeAIReminderStatus = () => {
            try {
                const status = JSON.parse(nativeReminderBridge.getReminderStatus());
                const messages = [];
                if (!status.notificationsEnabled) messages.push(`${nativeReminderPlatformName} notifications are off for LifeTrack.`);
                if (isNativeAndroidApp && !status.exactAlarmsAllowed) messages.push("Exact alarms are not allowed, so reminders may be delayed.");
                if (!status.scheduledReminders) messages.push("No reminders are currently saved on this phone.");
                if (!messages.length) messages.push(isNativeAndroidApp
                    ? `${status.scheduledReminders} Android reminder${status.scheduledReminders === 1 ? "" : "s"} scheduled; notification and exact-alarm access are allowed.`
                    : `${status.scheduledReminders} iPhone reminder${status.scheduledReminders === 1 ? "" : "s"} scheduled; notification access is allowed.`);
                aiReminderStatus.textContent = messages.join(" ");
            } catch (error) {
                console.error("LifeTrack could not read Android reminder permissions.", error);
                aiReminderStatus.textContent = `${nativeReminderPlatformName} reminder permission status could not be read. Reopen LifeTrack and try again.`;
            }
        };
        window.refreshNativeAIReminderStatus();
        window.addEventListener("focus", window.refreshNativeAIReminderStatus);
        window.addEventListener("focus", window.refreshNativeAIReminderBadge);
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") {
                window.refreshNativeAIReminderStatus();
                window.refreshNativeAIReminderBadge();
            }
        });
        window.refreshNativeAIReminderBadge();
        setInterval(window.refreshNativeAIReminderBadge, 30_000);
    }
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.addEventListener("message", (event) => {
            if (event.data && event.data.type === "lifetrack-reminder-dismissed") {
                dismissAIReminderUnread(event.data.reminderKey);
                return;
            }
            if (!event.data || event.data.type !== "lifetrack-push-status") return;
            if (event.data.status === "displayed") syncBrowserAIReminderNotifications();
            aiReminderStatus.textContent = event.data.status === "displayed"
                ? "Push reached this browser and the system notification was displayed."
                : "Push reached this browser, but notification display failed. Check Android notification settings.";
        });
    }
    aiReminderTime.value = aiReminder.reminders.length
        ? aiReminder.reminders[aiReminder.reminders.length - 1].time
        : "09:00";
    function currentAIReminderDay() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    }
    function readAIReminderKeys(storageKey) {
        try {
            const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
            if (!Array.isArray(saved)) return [];
            const todaySuffix = `|${currentAIReminderDay()}`;
            return saved.filter((key) => typeof key === "string" && key.endsWith(todaySuffix));
        } catch (error) {
            console.error("LifeTrack reminder badge state could not be read.", error);
            return [];
        }
    }
    function renderAIReminderBadge() {
        const readKeys = new Set(readAIReminderKeys(aiReminderReadStorageKey));
        const unreadKeys = new Set([
            ...readAIReminderKeys(aiReminderUnreadStorageKey),
            ...nativeReminderUnreadKeys
        ]);
        readKeys.forEach((key) => unreadKeys.delete(key));
        const count = unreadKeys.size;
        aiReminderBadge.hidden = count === 0;
        aiReminderBadge.textContent = count > 99 ? "99+" : String(count);
        aiLauncher.setAttribute("aria-label", count
            ? `Open LifeTrack AI assistant, ${count} unread reminder${count === 1 ? "" : "s"}`
            : "Open LifeTrack AI assistant");
        aiLauncher.title = count ? `${count} unread reminder${count === 1 ? "" : "s"}` : "LifeTrack AI assistant";
    }
    function addAIReminderUnread(keys) {
        const readKeys = new Set(readAIReminderKeys(aiReminderReadStorageKey));
        const unreadKeys = new Set(readAIReminderKeys(aiReminderUnreadStorageKey));
        keys.forEach((key) => {
            if (typeof key !== "string") return;
            if (!aiPanel.hidden) readKeys.add(key);
            else if (!readKeys.has(key)) unreadKeys.add(key);
        });
        try {
            localStorage.setItem(aiReminderUnreadStorageKey, JSON.stringify([...unreadKeys]));
            localStorage.setItem(aiReminderReadStorageKey, JSON.stringify([...readKeys]));
        } catch (error) {
            console.error("LifeTrack unread reminders could not be saved.", error);
        }
        renderAIReminderBadge();
    }
    function dismissAIReminderUnread(key) {
        if (typeof key !== "string") return;
        const unreadKeys = new Set(readAIReminderKeys(aiReminderUnreadStorageKey));
        unreadKeys.delete(key);
        const readKeys = new Set(readAIReminderKeys(aiReminderReadStorageKey));
        readKeys.add(key);
        try {
            localStorage.setItem(aiReminderUnreadStorageKey, JSON.stringify([...unreadKeys]));
            localStorage.setItem(aiReminderReadStorageKey, JSON.stringify([...readKeys]));
        } catch (error) {
            console.error("LifeTrack reminder dismissal could not be saved.", error);
        }
        renderAIReminderBadge();
    }
    function clearAIReminderUnread() {
        const unreadKeys = new Set([
            ...readAIReminderKeys(aiReminderUnreadStorageKey),
            ...nativeReminderUnreadKeys
        ]);
        const readKeys = new Set(readAIReminderKeys(aiReminderReadStorageKey));
        unreadKeys.forEach((key) => readKeys.add(key));
        try {
            localStorage.setItem(aiReminderUnreadStorageKey, "[]");
            localStorage.setItem(aiReminderReadStorageKey, JSON.stringify([...readKeys]));
        } catch (error) {
            console.error("LifeTrack reminder badge could not be cleared.", error);
        }
        nativeReminderUnreadKeys = [];
        if (nativeReminderBridge) nativeReminderBridge.clearUnreadReminders();
        renderAIReminderBadge();
    }
    renderAIReminderBadge();
    function syncBrowserAIReminderNotifications() {
        if (!("serviceWorker" in navigator)) return;
        navigator.serviceWorker.ready
            .then((registration) => registration.getNotifications())
            .then((notifications) => {
                addAIReminderUnread(notifications
                    .map((notification) => notification.data && notification.data.reminderKey)
                    .filter((key) => typeof key === "string"));
            })
            .catch((error) => console.error("LifeTrack could not check active reminder notifications.", error));
    }
    syncBrowserAIReminderNotifications();
    function checkAIReminders() {
        if (document.visibilityState !== "visible" || !Array.isArray(aiReminder.reminders)) return;
        if (nativeReminderBridge) return;
        const now = new Date();
        const today = currentAIReminderDay();
        const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
        const notifiedKey = `${NS}ai-reminder-notified-v2`;
        let notified = {};
        try {
            const saved = JSON.parse(localStorage.getItem(notifiedKey) || "{}");
            if (saved && typeof saved === "object" && !Array.isArray(saved)) notified = saved;
        } catch (error) {
            console.error("LifeTrack reminder notification history could not be read.", error);
        }
        const due = aiReminder.reminders.filter((reminder) =>
            reminder
            && typeof reminder.id === "string"
            && typeof reminder.title === "string"
            && /^\d{2}:\d{2}$/.test(reminder.time)
            && reminder.time === currentTime
            && notified[reminder.id] !== today);
        if (!due.length) return;
        due.forEach((reminder) => { notified[reminder.id] = today; });
        try {
            localStorage.setItem(notifiedKey, JSON.stringify(notified));
        } catch (error) {
            console.error("LifeTrack reminder notification history could not be saved.", error);
        }
        addAIReminderUnread(due.map((reminder) => `${reminder.id}|${today}`));
    }
    checkAIReminders();
    setInterval(checkAIReminders, 15000);
    document.addEventListener("visibilitychange", checkAIReminders);
    function renderAIReminders() {
        aiReminderList.replaceChildren();
        aiReminderEmptyState.replaceChildren();
        if (!aiReminder.reminders.length) {
            const empty = document.createElement("p");
            empty.className = "ai-reminder-empty";
            empty.textContent = "No reminders yet. Add one in the AI Reminders tab.";
            aiReminderEmptyState.appendChild(empty);
            return;
        }
        aiReminder.reminders.forEach((reminder) => {
            const row = document.createElement("article");
            row.className = "ai-reminder-item";
            const details = document.createElement("span");
            details.className = "ai-reminder-details";
            const title = document.createElement("strong");
            title.textContent = reminder.title;
            const time = document.createElement("small");
            time.textContent = new Date(`2000-01-01T${reminder.time}:00`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
            details.append(title, time);
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "ai-reminder-remove";
            remove.dataset.reminderRemove = reminder.id;
            remove.setAttribute("aria-label", `Remove reminder: ${reminder.title}`);
            remove.title = "Remove reminder";
            remove.textContent = "Remove";
            row.append(details, remove);
            aiReminderList.appendChild(row);
        });
    }
    renderAIReminders();
    aiReminderTest.disabled = aiReminder.reminders.length === 0;
    if (nativeReminderBridge) {
        try {
            syncNativeAIReminders(aiReminder.reminders);
            aiReminderStatus.textContent = "Native Android reminders are synced to this device. Enable notifications and exact alarms below.";
        } catch (error) {
            aiReminderStatus.textContent = error.message || "Native Android reminders could not be synced.";
        }
    }
    function reminderWorkerUrl(path) {
        const base = String(CFG.GROQ_WORKER_URL || "").trim().replace(/\/+$/, "");
        if (!base) throw new Error("The secure reminder Worker is not configured.");
        const endpoint = new URL(`${base}${path}`);
        if (endpoint.protocol !== "https:") throw new Error("Background notifications require an HTTPS Worker URL.");
        return endpoint.toString();
    }
    async function reminderResponseJson(response, operation) {
        try {
            return await response.json();
        } catch (error) {
            console.error(`LifeTrack ${operation} returned invalid JSON.`, error);
            throw new Error(`${operation} returned an invalid response (HTTP ${response.status}). Reload LifeTrack and try again.`);
        }
    }
    async function postReminderRegistration(body) {
        const response = await fetch(reminderWorkerUrl("/api/push/subscription"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        const data = await reminderResponseJson(response, "Saving reminder notifications");
        if (!response.ok) throw new Error(data.error || `Could not update background reminders (HTTP ${response.status}).`);
    }
    function generateReminderClientId() {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        let binary = "";
        bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
        return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }
    function vapidApplicationServerKey(value) {
        const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
        const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
        return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    }
    async function syncAIReminderPush(reminders, forceNewSubscription = false) {
        const clientStorageKey = `${NS}ai-reminder-push-client`;
        const clientId = localStorage.getItem(clientStorageKey);
        if (!reminders.length) {
            if (clientId) {
                await postReminderRegistration({ action: "remove", clientId });
                localStorage.removeItem(clientStorageKey);
            }
            return;
        }
        if (!isSecureContext || location.protocol === "file:") {
            throw new Error("Open LifeTrack from its HTTPS site to enable background notifications.");
        }
        if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
            throw new Error("This browser does not support background push notifications.");
        }
        const keyResponse = await fetch(reminderWorkerUrl("/api/push/key"));
        const keyData = await reminderResponseJson(keyResponse, "Loading notification settings");
        if (!keyResponse.ok || typeof keyData.publicKey !== "string") {
            throw new Error(keyData.error || `Could not load push settings (HTTP ${keyResponse.status}).`);
        }
        await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
        const registration = await navigator.serviceWorker.ready;
        const applicationServerKey = vapidApplicationServerKey(keyData.publicKey);
        let subscription = await registration.pushManager.getSubscription();
        const currentApplicationServerKey = subscription && subscription.options.applicationServerKey;
        const savedApplicationServerKey = localStorage.getItem(`${NS}ai-reminder-push-vapid-key`);
        const browserKeyMismatch = currentApplicationServerKey
            && (currentApplicationServerKey.byteLength !== applicationServerKey.byteLength
                || applicationServerKey.some((byte, index) => byte !== new Uint8Array(currentApplicationServerKey)[index]));
        if (subscription && (forceNewSubscription || (savedApplicationServerKey
            ? savedApplicationServerKey !== keyData.publicKey
            : !currentApplicationServerKey || browserKeyMismatch))) {
            await subscription.unsubscribe();
            subscription = null;
        }
        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey
            });
        }
        localStorage.setItem(`${NS}ai-reminder-push-vapid-key`, keyData.publicKey);
        const registrationClientId = clientId || generateReminderClientId();
        localStorage.setItem(clientStorageKey, registrationClientId);
        await postReminderRegistration({
            action: "save",
            clientId: registrationClientId,
            subscription: subscription.toJSON(),
            reminders: reminders.map(({ id, title, time, lastSent }) => ({ id, title, time, lastSent })),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        });
    }
    async function requestReminderPermission() {
        if (!("Notification" in window)) throw new Error("Browser notifications are not supported here.");
        if (Notification.permission === "granted") return;
        if (Notification.permission === "denied") {
            throw new Error("Notifications are blocked for LifeTrack. Allow them in your browser or device settings, then try again.");
        }
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
            throw new Error("Notifications were not allowed. Allow them for LifeTrack in browser or device settings, then try again.");
        }
    }
    aiReminderEnable.disabled = aiReminder.reminders.length === 0;
    aiReminderDisplayTest.addEventListener("click", async () => {
        aiReminderDisplayTest.disabled = true;
        aiReminderStatus.textContent = "Testing Android system notification display…";
        try {
            if (nativeReminderBridge) {
                nativeReminderBridge.showTestNotification();
                aiReminderStatus.textContent = `${nativeReminderPlatformName} system test notification requested. Check the notification panel.`;
                return;
            }
            await requestReminderPermission();
            const registration = await navigator.serviceWorker.ready;
            await registration.showNotification("LifeTrack display test", {
                body: "If this appears in the Android notification panel, system notifications are working.",
                icon: "./lifetrack-logo-192.png",
                badge: "./lifetrack-logo-192.png",
                tag: `lifetrack-display-test-${Date.now()}`,
                renotify: true,
                silent: false,
                vibrate: [200, 100, 200]
            });
            aiReminderStatus.textContent = "System notification requested. Check Android's notification panel.";
        } catch (error) {
            aiReminderStatus.textContent = error.message || `${nativeReminderPlatformName} could not display the system notification.`;
        } finally {
            aiReminderDisplayTest.disabled = false;
        }
    });
    aiReminderAlarmTest.addEventListener("click", () => {
        if (!nativeReminderBridge) return;
        aiReminderAlarmTest.disabled = true;
        try {
            if (!nativeReminderBridge.scheduleTestAlarm()) {
                window.refreshNativeAIReminderStatus();
                aiReminderStatus.textContent = `${nativeReminderPlatformName} could not schedule the test reminder. Check notification permissions.`;
                return;
            }
            const status = JSON.parse(nativeReminderBridge.getReminderStatus());
            aiReminderStatus.textContent = isNativeAndroidApp
                ? status.exactAlarmsAllowed
                    ? "A one-time Android alarm is set for about one minute from now. Swipe LifeTrack away from Recents (do not force-stop it), then wait for the notification."
                    : "A one-time inexact Android alarm is set for about one minute from now, but Android may delay it because exact alarms are not allowed. Swipe LifeTrack away from Recents (do not force-stop it), then wait."
                : "A one-time iPhone notification is set for about one minute from now. Close LifeTrack and wait for the notification.";
        } catch (error) {
            console.error(`LifeTrack could not schedule the ${nativeReminderPlatformName} reminder test.`, error);
            aiReminderStatus.textContent = `${nativeReminderPlatformName} could not schedule the background reminder test. Check notification permissions.`;
        } finally {
            aiReminderAlarmTest.disabled = false;
        }
    });
    aiReminderEnable.addEventListener("click", async () => {
        if (!aiReminder.reminders.length) {
            aiReminderStatus.textContent = "Add a reminder first, then enable background notifications.";
            return;
        }
        aiReminderEnable.disabled = true;
        aiReminderStatus.textContent = "Enabling background notifications…";
        try {
            if (nativeReminderBridge) {
                syncNativeAIReminders(aiReminder.reminders);
                nativeReminderBridge.requestPermissions();
                aiReminderStatus.textContent = isNativeAndroidApp
                    ? "Native alarms are scheduled. Allow LifeTrack notifications and exact alarms in Android when prompted."
                    : "iPhone reminders are scheduled. Allow LifeTrack notifications when prompted.";
                return;
            }
            await requestReminderPermission();
            await syncAIReminderPush(aiReminder.reminders);
            aiReminderStatus.textContent = "Background notifications are enabled. Push can arrive with this tab closed while your device is online.";
        } catch (error) {
            aiReminderStatus.textContent = error.message || "Background notifications could not be enabled.";
        } finally {
            aiReminderEnable.disabled = aiReminder.reminders.length === 0;
        }
    });
    aiReminderTest.addEventListener("click", async () => {
        if (!aiReminder.reminders.length) {
            aiReminderStatus.textContent = "Add a reminder first, then send a test notification.";
            return;
        }
        aiReminderTest.disabled = true;
        aiReminderStatus.textContent = "Sending a test push notification…";
        try {
            if (nativeReminderBridge) {
                nativeReminderBridge.showTestNotification();
                aiReminderStatus.textContent = `${nativeReminderPlatformName} system test notification requested. Check the notification panel.`;
                return;
            }
            await requestReminderPermission();
            await syncAIReminderPush(aiReminder.reminders, true);
            const clientId = localStorage.getItem(`${NS}ai-reminder-push-client`);
            await postReminderRegistration({ action: "test", clientId });
            aiReminderStatus.textContent = "Test push sent. Check the Android notification panel; delivery may take a few seconds.";
        } catch (error) {
            aiReminderStatus.textContent = error.message || "The test notification could not be sent.";
        } finally {
            aiReminderTest.disabled = aiReminder.reminders.length === 0;
        }
    });
    document.getElementById("aiReminderForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const titleInput = document.getElementById("aiReminderTitle");
        const title = titleInput.value.trim();
        const time = aiReminderTime.value;
        if (!title || title.length > 60 || !/^\d{2}:\d{2}$/.test(time)) {
            aiReminderStatus.textContent = "Enter a reminder name and a valid time.";
            return;
        }
        if (aiReminder.reminders.length >= 20) {
            aiReminderStatus.textContent = "You can save up to 20 reminders.";
            return;
        }
        const nextReminders = aiReminder.reminders.concat({ id: assistantId(), title, time, enabled: true, lastSent: "" });
        aiReminderStatus.textContent = "Saving reminder and enabling push notifications…";
        try {
            if (nativeReminderBridge) {
                syncNativeAIReminders(nextReminders);
            } else {
                await requestReminderPermission();
                await syncAIReminderPush(nextReminders);
            }
        } catch (error) {
            aiReminderStatus.textContent = error.message || "The reminder could not be enabled.";
            return;
        }
        aiReminder.reminders = nextReminders;
        saveAssistantState("ai-reminder", aiReminder);
        renderAIReminders();
        aiReminderEnable.disabled = false;
        aiReminderTest.disabled = false;
        titleInput.value = "";
        aiReminderStatus.textContent = nativeReminderBridge
            ? `"${title}" added for ${new Date(`2000-01-01T${time}:00`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Native ${nativeReminderPlatformName} reminder is scheduled.`
            : `"${title}" added for ${new Date(`2000-01-01T${time}:00`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Background push is enabled.`;
    });
    aiReminderList.addEventListener("click", (event) => {
        const button = event.target.closest("[data-reminder-remove]");
        if (!button) return;
        const reminder = aiReminder.reminders.find((item) => item.id === button.dataset.reminderRemove);
        if (!reminder) return;
        const nextReminders = aiReminder.reminders.filter((item) => item.id !== reminder.id);
        button.disabled = true;
        aiReminderStatus.textContent = "Updating background reminders…";
        const updateSchedule = nativeReminderBridge
            ? Promise.resolve().then(() => syncNativeAIReminders(nextReminders))
            : syncAIReminderPush(nextReminders);
        updateSchedule.then(() => {
            aiReminder.reminders = nextReminders;
            saveAssistantState("ai-reminder", aiReminder);
            renderAIReminders();
            aiReminderEnable.disabled = aiReminder.reminders.length === 0;
            aiReminderTest.disabled = aiReminder.reminders.length === 0;
            aiReminderStatus.textContent = `"${reminder.title}" reminder removed.`;
        }).catch((error) => {
            button.disabled = false;
            aiReminderStatus.textContent = error.message || "The background reminder could not be removed.";
        });
    });
    if (nativeReminderBridge && aiReminder.reminders.length) {
        aiReminderStatus.textContent = "Native Android reminders are synced to this device. Enable notifications and exact alarms below.";
    } else if (aiReminder.reminders.length) {
        if (!("Notification" in window)) {
            aiReminderStatus.textContent = "This browser does not support background notifications. Try an up-to-date Chrome or Edge browser.";
        } else if (Notification.permission === "denied") {
            aiReminderStatus.textContent = "Notifications are blocked for LifeTrack. Allow them in browser or device settings, then tap Enable background notifications.";
        } else if (Notification.permission === "granted") {
            syncAIReminderPush(aiReminder.reminders).then(() => {
                aiReminderStatus.textContent = "Background notifications are enabled for this device.";
            }).catch((error) => {
                aiReminderStatus.textContent = `${error.message || "Background notifications could not be synced."} Tap Enable background notifications to retry.`;
            });
        } else {
            aiReminderStatus.textContent = "Reminder saved, but notifications are not enabled on this device yet. Tap Enable background notifications.";
        }
    }

    document.getElementById("fitActions").addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        if (b.id === "gSync") syncGoogle();
    });

    dailyReminder.addEventListener("click", (e) => {
        if (e.target.closest("[data-exercise-toggle]")) {
            toggleExerciseTimer();
            return;
        }
        if (e.target.closest("[data-exercise-save]")) {
            saveExerciseTimer();
            return;
        }
    });

    document.getElementById("fitBody").addEventListener("click", (e) => {
        const trendTile = e.target.closest("[data-fit-trend]");
        if (trendTile && !e.target.closest("button")) {
            openFitnessTrend(trendTile.dataset.fitTrend);
            return;
        }
        const w = e.target.closest("[data-water]");
        const mo = e.target.closest("[data-mood]");
        const iso = isoFromUTC(todayUTC());
        if (w) {
            const cur = (fitness[iso] || {}).water || 0;
            const delta = Number(w.dataset.water);
            if (delta > 0 && cur + delta > 5000) {
                toast("Daily hydration limit reached (5,000 ml). Plausibility guard active.");
                return;
            }
            setFit("water", Math.max(0, cur + delta));
        } else if (mo) {
            const f = fitness[iso] || (fitness[iso] = {});
            f.mood = f.mood === Number(mo.dataset.mood) ? undefined : Number(mo.dataset.mood);
            if (!f.mood) delete f.mood;
            saveFit();
            renderStats();
        }
    });

    document.getElementById("fitBody").addEventListener("keydown", (e) => {
        const trendTile = e.target.closest("[data-fit-trend]");
        if (!trendTile || e.target !== trendTile || !["Enter", " "].includes(e.key)) return;
        e.preventDefault();
        openFitnessTrend(trendTile.dataset.fitTrend);
    });

    document.getElementById("fitBody").addEventListener("change", (e) => {
        const inp = e.target.closest("input[data-field]");
        if (!inp) return;
        if (["steps", "sleep", "active", "activeCalories"].includes(inp.dataset.field)) {
            toast("Health readings update automatically from your connected device.");
            renderStats();
            return;
        }
        const v = parseFloat(inp.value);
        if (inp.dataset.field === "sleep" && Number.isFinite(v) && (v < 0 || v > 24)) {
            const current = (fitness[isoFromUTC(todayUTC())] || {}).sleep;
            inp.value = current ? String(current) : "";
            toast("Sleep can be from 0 to 24 hours per day.");
            return;
        }
        setFit(inp.dataset.field, Number.isFinite(v) ? v : null);
    });

    habitManageList.addEventListener("click", (e) => {
        const b = e.target.closest("[data-remove]");
        if (!b) return;
        const idx = Number(b.dataset.remove);
        const name = habits[idx];
        confirmModal(`Remove "${name}"?`, "The habit disappears from your tracker and its goals are removed. Its old check-ins stay saved in case you add the same name again.", "Remove habit", () => {
        markHabitDeleted(name);
        delete habitStarts[name];
            habits.splice(idx, 1);
            goals.filter((goal) => goal.habit === name).forEach((goal) => markGoalDeleted(goal.id));
            goals = goals.filter((g) => g.habit !== name);
            saveGoals();
            saveState();
            renderCalendar();
        });
    });

    habitManageList.addEventListener("dblclick", (event) => {
        const label = event.target.closest("[data-edit-habit]");
        if (!label) {
            const card = event.target.closest(".habit-card");
            if (!card || event.target.closest("button, input")) return;
            habitManageList.querySelectorAll(".is-reorder-selected").forEach((item) => item.classList.remove("is-reorder-selected"));
            card.classList.add("is-reorder-selected");
            card.focus();
            toast("Use the up/down arrow keys to move this habit. Press Enter when done.");
            return;
        }
        const input = document.createElement("input");
        input.type = "text";
        input.className = "hc-name-input";
        input.value = habits[Number(label.dataset.editHabit)];
        input.setAttribute("aria-label", "Edit habit name");
        label.replaceWith(input);
        input.focus();
        input.select();
    });

    habitManageList.addEventListener("keydown", (event) => {
        const input = event.target.closest(".hc-name-input");
        if (input) {
            if (event.key === "Enter") {
                event.preventDefault();
                commitHabitEdit(input, true);
            } else if (event.key === "Escape") {
                renderManageList();
            }
            return;
        }

        const card = event.target.closest(".habit-card");
        if (!card) return;
        if (event.key === "Enter" && card.classList.contains("is-reorder-selected")) {
            event.preventDefault();
            card.classList.remove("is-reorder-selected");
            return;
        }
        if (event.key === "Escape" && card.classList.contains("is-reorder-selected")) {
            card.classList.remove("is-reorder-selected");
            return;
        }
        if (!card.classList.contains("is-reorder-selected") || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
        event.preventDefault();
        const index = Number(card.dataset.habitIndex);
        moveHabit(index, index + (event.key === "ArrowUp" ? -1 : 1), true);
    });

    habitManageList.addEventListener("focusout", (event) => {
        const input = event.target.closest(".hc-name-input");
        if (!input || !input.isConnected) return;
        commitHabitEdit(input, false);
    });

    let pendingHabitDrag = null;
    habitManageList.addEventListener("pointerdown", (event) => {
        const card = event.target.closest(".habit-card");
        if (!card || !event.target.closest(".habit-card header") || event.target.closest("button, input") || event.button !== 0 || event.isPrimary === false) return;
        const index = Number(card.dataset.habitIndex);
        const drag = { pointerId: event.pointerId, from: index, to: index, card, started: false, timer: 0, startX: event.clientX, startY: event.clientY };
        pendingHabitDrag = drag;
        if (event.pointerType === "touch" || event.pointerType === "pen") return;
        drag.timer = window.setTimeout(() => {
            if (pendingHabitDrag !== drag) return;
            beginHabitDrag(drag, event, card, false);
        }, 280);
    });

    habitManageList.addEventListener("pointermove", (event) => {
        const drag = pendingHabitDrag;
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (!drag.started) {
            beginHabitDrag(drag, event, drag.card, true);
            if (!drag.started) return;
        }
        event.preventDefault();
        const target = document.elementFromPoint(event.clientX, event.clientY);
        const card = target && target.closest(".habit-card");
        habitManageList.querySelectorAll(".habit-card").forEach((item) => item.classList.remove("drop-before", "drop-after"));
        if (!card) {
            drag.to = drag.from;
            return;
        }
        const targetIndex = Number(card.dataset.habitIndex);
        const after = event.clientY > card.getBoundingClientRect().top + card.offsetHeight / 2;
        drag.to = targetIndex + (after ? 1 : 0);
        if (drag.to > drag.from) drag.to -= 1;
        drag.to = Math.max(0, Math.min(habits.length - 1, drag.to));
        if (drag.to !== drag.from) card.classList.add(after ? "drop-after" : "drop-before");
    });

    function finishHabitDrag(event, dropped) {
        const drag = pendingHabitDrag;
        if (!drag || drag.pointerId !== event.pointerId) return;
        window.clearTimeout(drag.timer);
        drag.card.classList.remove("is-dragging");
        habitManageList.querySelectorAll(".habit-card").forEach((item) => item.classList.remove("drop-before", "drop-after"));
        pendingHabitDrag = null;
        if (dropped && drag.started) moveHabit(drag.from, drag.to, false);
    }

    habitManageList.addEventListener("pointerup", (event) => finishHabitDrag(event, true));
    habitManageList.addEventListener("pointercancel", (event) => finishHabitDrag(event, false));

    document.getElementById("goalPageList").addEventListener("click", (e) => {
        const b = e.target.closest("[data-goal-remove]");
        if (!b) return;
        markGoalDeleted(b.dataset.goalRemove);
        goals = goals.filter((g) => g.id !== b.dataset.goalRemove);
        saveGoals();
        renderStats();
    });

    document.getElementById("readingGoalCard").addEventListener("change", (event) => {
        const input = event.target.closest("input[data-reading-page-count]");
        if (!input) return;
        const pageCount = Number(input.value);
        if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 5000) {
            toast("Page count must be between 1 and 5,000.");
            renderStats();
            return;
        }
        readingPlan.pageCount = pageCount;
        readingPlan.currentPage = Math.min(readingPlan.currentPage, pageCount);
        readingPlan.dailyStart = Math.min(readingPlan.dailyStart, pageCount);
        readingPlan.dailyEnd = Math.max(readingPlan.dailyStart, Math.min(readingPlan.dailyEnd, pageCount));
        saveReadingPlan();
        renderStats();
    });
    document.getElementById("readingGoalCard").addEventListener("click", (event) => {
        if (event.target.closest("[data-reading-history], [data-reading-library]")) openReadingHistory();
    });

    const goalTarget = document.getElementById("goalTarget");
    goalTarget.addEventListener("input", () => { document.getElementById("goalTargetOut").textContent = `${goalTarget.value}%`; });
    document.getElementById("goalForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const nameEl = document.getElementById("goalName");
        const selectedHabit = document.getElementById("goalHabit").value || "*";
        const difficulty = document.getElementById("goalDifficulty").value;
        const name = nameEl.value.trim() || (selectedHabit === "*" ? "All habits goal" : selectedHabit === "__create_habit__" ? "New goal habit" : `${selectedHabit} goal`);
        let habit = selectedHabit;
        if (selectedHabit === "__create_habit__") {
            habit = habits.find((item) => item.toLocaleLowerCase() === name.toLocaleLowerCase());
            if (!habit) {
                habit = name;
                restoreHabitName(habit);
                habits.push(habit);
                habitStarts[habit] = isoFromUTC(todayUTC());
                saveState();
            }
        }
        goals.push({ id: `g-${Date.now()}`, name, habit, target: Number(goalTarget.value), difficulty });
        nameEl.value = "";
        document.getElementById("goalDifficulty").value = "medium";
        saveGoals();
        renderStats();
    });

    let fitnessTrendHighlightTimer = null;

    function openFitnessTrend(metric) {
        if (!["steps", "water", "sleep"].includes(metric)) return;

        analyticsView = "month";
        document.querySelectorAll("#analyticsSeg button").forEach((button) => {
            button.classList.toggle("active", button.dataset.view === "month");
        });
        document.getElementById("anMonth").hidden = false;
        document.getElementById("anYear").hidden = true;
        navigateToSection("analytics");

        requestAnimationFrame(() => {
            const card = document.querySelector(`#fitTrend .fit-trend-card[data-fit-metric="${metric}"]`);
            if (!card) {
                console.error(`LifeTrack could not find the ${metric} analytics chart.`);
                return;
            }
            document.querySelectorAll("#fitTrend .fit-trend-card.is-targeted").forEach((item) => {
                item.classList.remove("is-targeted");
            });
            card.classList.add("is-targeted");
            card.focus({ preventScroll: true });
            card.scrollIntoView({
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
                block: "center"
            });
            if (fitnessTrendHighlightTimer) clearTimeout(fitnessTrendHighlightTimer);
            fitnessTrendHighlightTimer = setTimeout(() => {
                card.classList.remove("is-targeted");
                fitnessTrendHighlightTimer = null;
            }, 1800);
        });
    }

    document.getElementById("analyticsSeg").addEventListener("click", (e) => {
        const b = e.target.closest("button[data-view]");
        if (!b) return;
        analyticsView = b.dataset.view;
        document.querySelectorAll("#analyticsSeg button").forEach((x) => x.classList.toggle("active", x === b));
        document.getElementById("anMonth").hidden = analyticsView !== "month";
        document.getElementById("anYear").hidden = analyticsView !== "year";
    });

    async function resumeGoogleSync() {
        if (!navigator.onLine) {
            if (localStorage.getItem(NS + "lt_dirty") === "true") {
                setFitStatus("Offline: changes saved on this device", "warn");
            }
            return;
        }
        try {
            if (!await refreshPersistentGoogleSession()) return;
            await syncCloud();
            if (googleToken()) await syncGoogle();
        } catch (error) {
            console.error("LifeTrack could not resume Google sync.", error);
            setFitStatus(`Google sync could not refresh: ${error.message}`, "warn");
        }
    }

    window.addEventListener("offline", () => {
        setFitStatus("Offline: changes saved on this device", "warn");
    });
    window.addEventListener("online", () => {
        if (currentUser.provider === "google") {
            resumeGoogleSync();
        } else {
            setFitStatus("Online — your changes are saved on this device.", "good");
        }
    });
    if (!navigator.onLine) setFitStatus("Offline: changes saved on this device", "warn");

    // Retry persisted Drive edits even when the reconnect event was missed.
    setInterval(() => {
        if (navigator.onLine && currentUser.provider === "google"
            && localStorage.getItem(NS + "lt_dirty") === "true") {
            void syncCloud();
        }
    }, 60_000);

    // Refresh cloud data while the dashboard is open so other devices' changes appear promptly.
    setInterval(() => {
        if (document.visibilityState === "visible" && currentUser.provider === "google") resumeGoogleSync();
    }, 5 * 60_000);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;
        if (!dailyTaskState || dailyTaskState.date !== isoFromUTC(todayUTC())) renderDailyTask();
        if (googleToken()) syncGoogle();
        if (currentUser.provider === "google") resumeGoogleSync();
    });

    document.querySelectorAll(".sidebar .nav-item").forEach((button) => {
        button.addEventListener("click", () => {
            navigateToSection(button.dataset.section);
            button.blur();
        });
    });
    function handleDailyTaskClick(event) {
        const button = event.target.closest("[data-task-action]");
        if (!button) return;
        if (button.dataset.taskAction === "complete") {
            dailyTaskState.completed = !dailyTaskState.completed;
            store.set("daily-task", JSON.stringify(dailyTaskState));
            renderDailyTask();
            toast(dailyTaskState.completed ? "Daily task complete. Nice work!" : "Task marked as not complete.");
        } else if (button.dataset.taskAction === "reroll") {
            dailyTaskState.reroll += 1;
            dailyTaskState.completed = false;
            store.set("daily-task", JSON.stringify(dailyTaskState));
            renderDailyTask();
        }
    }
    document.getElementById("todayTaskCard").addEventListener("click", handleDailyTaskClick);
    document.getElementById("dailyTaskDetail").addEventListener("click", handleDailyTaskClick);

    let friendState = null;
    let friendLoadInProgress = false;
    let friendLastProgressSync = 0;

    function setFriendsStatus(message, kind = "") {
        const status = document.getElementById("friendsStatus");
        status.textContent = message;
        if (kind) status.dataset.kind = kind;
        else delete status.dataset.kind;
    }

    async function friendApi(path, options = {}) {
        const response = await fetch(path, {
            credentials: "same-origin",
            ...options,
            headers: {
                ...(options.body ? { "Content-Type": "application/json" } : {}),
                ...(options.headers || {})
            }
        });
        let data = {};
        try {
            data = await response.json();
        } catch {
            data = {};
        }
        if (!response.ok) {
            const error = new Error(data.error || `Request failed (${response.status}).`);
            error.status = response.status;
            throw error;
        }
        return data;
    }

    function friendDailyMetrics() {
        const today = isoFromUTC(todayUTC());
        const life = computeLifetime();
        const score = calculateWeightedLifeScore(lifeScoreCategoryValues(life), lifeScoreWeights).score;
        const todayFitness = fitness[today] && typeof fitness[today] === "object" ? fitness[today] : {};
        const streaks = buildContext(life).streaks;
        const currentStreak = Object.values(streaks).reduce((max, streak) => Math.max(max, streak.cur), 0);
        const todayDone = habits.reduce((count, habit) => count + (checks[keyFor(todayUTC(), habit)] ? 1 : 0), 0);
        const focusMinutes = Number(todayFitness.focusMinutes) || 0;
        const steps = Number(todayFitness.steps) || 0;
        return {
            date: today,
            lifeScore: score,
            habitRate: habits.length ? Math.round((todayDone / habits.length) * 100) : 0,
            focusMinutes: clamp(Math.round(focusMinutes), 0, 1440),
            streakDays: clamp(currentStreak, 0, 10000),
            steps: clamp(Math.round(steps), 0, 100000)
        };
    }

    async function syncFriendProgress(force = false) {
        if (!friendState || !friendState.enabled || document.visibilityState !== "visible") return;
        if (!force && Date.now() - friendLastProgressSync < 30 * 60_000) return;
        try {
            await friendApi("/api/friends/progress", {
                method: "POST",
                body: JSON.stringify(friendDailyMetrics())
            });
            friendLastProgressSync = Date.now();
        } catch (error) {
            console.error("Friend progress sync failed.", error);
            setFriendsStatus(error.message, "error");
        }
    }

    async function updateFriendPresence() {
        if (!friendState || !friendState.enabled || document.visibilityState !== "visible") return;
        try {
            await friendApi("/api/friends/presence", { method: "POST", body: "{}" });
        } catch (error) {
            console.error("Friend presence update failed.", error);
        }
    }

    function friendEmpty(message) {
        return `<p class="friend-empty">${esc(message)}</p>`;
    }

    function renderFriendState(state) {
        const sharingToggle = document.getElementById("friendSharingToggle");
        const workspace = document.getElementById("friendsWorkspace");
        sharingToggle.checked = state.enabled;
        sharingToggle.disabled = false;
        workspace.hidden = !state.enabled;
        if (!state.enabled) {
            setFriendsStatus("Enable sharing to appear in opted-in searches. Existing match metrics will be removed when you switch sharing off.", "");
            return;
        }

        document.getElementById("friendList").innerHTML = state.friends.length
            ? state.friends.map((friend) => `<div class="friend-row">
                <div class="friend-row-copy"><strong>${esc(friend.name || "LifeTrack user")}</strong>
                    <span class="friend-presence${friend.presence === "online" ? " is-online" : ""}">${friend.presence === "online" ? "Online" : "Offline"}${friend.sharingEnabled ? "" : " · sharing off"}</span>
                </div>
                <div class="friend-actions"><button type="button" class="friend-action is-danger" data-friend-remove="${esc(friend.user_id)}">Remove</button></div>
            </div>`).join("")
            : friendEmpty("No friends yet. Search for opted-in accounts above.");

        const requestRows = [];
        (state.incomingRequests || []).forEach((item) => {
            requestRows.push(`<div class="friend-row"><div class="friend-row-copy"><strong>${esc(item.name || "LifeTrack user")}</strong><small>Wants to connect</small></div>
                <div class="friend-actions"><button type="button" class="friend-action is-primary" data-request-id="${esc(item.id)}" data-request-action="accept">Accept</button><button type="button" class="friend-action" data-request-id="${esc(item.id)}" data-request-action="decline">Decline</button></div></div>`);
        });
        (state.outgoingRequests || []).forEach((item) => {
            requestRows.push(`<div class="friend-row"><div class="friend-row-copy"><strong>${esc(item.name || "LifeTrack user")}</strong><small>Request sent · waiting for response</small></div></div>`);
        });
        document.getElementById("friendRequests").innerHTML = requestRows.join("") || friendEmpty("No pending friend requests.");

        document.getElementById("friendChallengeInvites").innerHTML = state.challengeInvites.length
            ? state.challengeInvites.map((invite) => `<div class="friend-row"><div class="friend-row-copy"><strong>${esc(invite.creator_name || "A friend")} invited you</strong><small>Join their 90-day group match</small></div>
                <div class="friend-actions"><button type="button" class="friend-action is-primary" data-challenge-id="${esc(invite.id)}" data-challenge-action="accept">Accept</button><button type="button" class="friend-action" data-challenge-id="${esc(invite.id)}" data-challenge-action="decline">Decline</button></div></div>`).join("")
            : friendEmpty("No match invitations.");

        const eligibleFriends = state.friends.filter((friend) => friend.sharingEnabled);
        document.getElementById("friendChallengeChoices").innerHTML = eligibleFriends.length
            ? eligibleFriends.map((friend) => `<div class="friend-choice"><label><input type="checkbox" data-challenge-friend="${esc(friend.user_id)}"><span>${esc(friend.name || "LifeTrack user")}</span></label></div>`).join("")
            : friendEmpty("Friends with sharing enabled will appear here.");
        const updateCreateButton = () => {
            document.getElementById("createFriendChallenge").disabled =
                !document.querySelector('[data-challenge-friend]:checked');
        };
        document.getElementById("friendChallengeChoices").querySelectorAll("[data-challenge-friend]").forEach((checkbox) => {
            checkbox.addEventListener("change", updateCreateButton);
        });
        updateCreateButton();

        document.getElementById("friendChallenges").innerHTML = state.challenges.length
            ? state.challenges.map((challenge) => {
                const remaining = Math.max(0, Math.ceil((Date.parse(challenge.endsAt) - Date.now()) / 86_400_000));
                const members = challenge.members.slice().sort((left, right) =>
                    (right.averageLifeScore ?? -1) - (left.averageLifeScore ?? -1));
                const rows = members.map((member, index) => `<div class="friend-leaderboard-row">
                    <span>${index + 1}. ${esc(member.name)}</span>
                    <span>${member.averageLifeScore == null ? "—" : `${member.averageLifeScore}/100`}</span>
                    <span>${member.habitRate == null ? "—" : `${member.habitRate}%`}</span>
                    <span>${member.focusMinutes == null ? "—" : `${member.focusMinutes}m`}</span>
                    <span>${member.streakDays == null ? "—" : `${member.streakDays}d`}</span>
                    <span>${member.steps == null ? "—" : Number(member.steps).toLocaleString()}</span>
                </div>`).join("");
                return `<article class="friend-challenge-card">
                    <header><div><h3>90-day group match</h3><p>${challenge.status === "completed" ? "Complete" : `${remaining} days remaining`} · Ends ${esc(new Date(challenge.endsAt).toLocaleDateString())}</p></div></header>
                    <div class="friend-leaderboard">
                        <div class="friend-leaderboard-row is-heading"><span>Friend</span><span>Avg. Life Score</span><span>Habits</span><span>Focus</span><span>Streak</span><span>Steps</span></div>
                        ${rows || friendEmpty("No accepted participants yet.")}
                    </div>
                </article>`;
            }).join("")
            : friendEmpty("Create a group match with your friends to start competing.");
        setFriendsStatus("Your presence is visible only to accepted friends. Match metrics are shared only with accepted match members.", "success");
    }

    async function loadFriends() {
        if (friendLoadInProgress) return;
        friendLoadInProgress = true;
        setFriendsStatus("Loading friend data…");
        try {
            friendState = await friendApi("/api/friends/state", { method: "POST", body: "{}" });
            renderFriendState(friendState);
            if (friendState.enabled) {
                await updateFriendPresence();
                await syncFriendProgress();
            }
        } catch (error) {
            friendState = null;
            document.getElementById("friendsWorkspace").hidden = true;
            const sharingToggle = document.getElementById("friendSharingToggle");
            sharingToggle.checked = false;
            sharingToggle.disabled = error.status === 401;
            setFriendsStatus(
                error.status === 401
                    ? /expired|revoked/i.test(error.message)
                        ? "Your sign-in session expired. Open the profile menu, log out, then sign in again."
                        : "Sign in with Google or a password account to use Friends. Guest mode cannot search; use the profile menu to switch accounts."
                    : error.message,
                "error"
            );
        } finally {
            friendLoadInProgress = false;
        }
    }

    document.getElementById("friendSharingToggle").addEventListener("change", async (event) => {
        const toggle = event.currentTarget;
        if (!toggle.checked && !window.confirm("Turn off friend discovery and remove your saved match metrics?")) {
            toggle.checked = true;
            return;
        }
        toggle.disabled = true;
        try {
            await friendApi("/api/friends/settings", {
                method: "PUT",
                body: JSON.stringify({ enabled: toggle.checked })
            });
            friendLastProgressSync = 0;
            await loadFriends();
        } catch (error) {
            toggle.checked = !toggle.checked;
            setFriendsStatus(error.message, "error");
        } finally {
            toggle.disabled = false;
        }
    });

    document.getElementById("friendSearchForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const query = document.getElementById("friendSearchInput").value.trim();
        const results = document.getElementById("friendSearchResults");
        results.innerHTML = friendEmpty("Searching…");
        try {
            const data = await friendApi("/api/friends/search", {
                method: "POST",
                body: JSON.stringify({ query })
            });
            results.innerHTML = data.users.length
                ? data.users.map((user) => `<div class="friend-row"><div class="friend-row-copy"><strong>${esc(user.name)}</strong></div>
                    <button type="button" class="friend-action is-primary" data-friend-request="${esc(user.id)}">Add friend</button></div>`).join("")
                : friendEmpty("No opted-in accounts found.");
        } catch (error) {
            results.innerHTML = friendEmpty(error.message);
        }
    });

    document.getElementById("friendsWorkspace").addEventListener("click", async (event) => {
        const requestButton = event.target.closest("[data-friend-request]");
        const requestDecision = event.target.closest("[data-request-id]");
        const challengeDecision = event.target.closest("[data-challenge-action]");
        const removeButton = event.target.closest("[data-friend-remove]");
        try {
            if (requestButton) {
                await friendApi("/api/friends/requests", {
                    method: "POST",
                    body: JSON.stringify({ userId: requestButton.dataset.friendRequest })
                });
                setFriendsStatus("Friend request sent.", "success");
                document.getElementById("friendSearchForm").requestSubmit();
                await loadFriends();
            } else if (requestDecision) {
                await friendApi(`/api/friends/requests/${encodeURIComponent(requestDecision.dataset.requestId)}`, {
                    method: "POST",
                    body: JSON.stringify({ action: requestDecision.dataset.requestAction })
                });
                await loadFriends();
            } else if (challengeDecision) {
                await friendApi(`/api/friends/challenges/${encodeURIComponent(challengeDecision.dataset.challengeId)}/respond`, {
                    method: "POST",
                    body: JSON.stringify({ action: challengeDecision.dataset.challengeAction })
                });
                await loadFriends();
            } else if (removeButton) {
                const friendName = removeButton.closest(".friend-row").querySelector("strong").textContent;
                if (!window.confirm(`Remove ${friendName} from your friends? They will no longer see your match metrics.`)) return;
                await friendApi(`/api/friends/${encodeURIComponent(removeButton.dataset.friendRemove)}`, { method: "DELETE" });
                await loadFriends();
            }
        } catch (error) {
            setFriendsStatus(error.message, "error");
        }
    });

    document.getElementById("createFriendChallenge").addEventListener("click", async () => {
        const friendIds = Array.from(document.querySelectorAll("[data-challenge-friend]:checked"))
            .map((checkbox) => checkbox.dataset.challengeFriend);
        if (!friendIds.length) return;
        if (!window.confirm("The 90-day clock starts now. Friends who accept later are scored from their join date. Start this group match?")) return;
        try {
            await friendApi("/api/friends/challenges", {
                method: "POST",
                body: JSON.stringify({ friendIds })
            });
            setFriendsStatus("Your 90-day match has started. Invited friends must accept to join.", "success");
            await loadFriends();
        } catch (error) {
            setFriendsStatus(error.message, "error");
        }
    });

    setInterval(() => {
        if (document.visibilityState === "visible" && friendState && friendState.enabled) {
            void updateFriendPresence();
            void syncFriendProgress();
        }
    }, 60_000);

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && friendState && friendState.enabled) {
            void updateFriendPresence();
            void syncFriendProgress();
        }
    });

    function navigateToSection(sectionId) {
        if (focusLockActive && sectionId !== "dashboard") return;
        const section = document.getElementById(sectionId);
        if (!section || !section.classList.contains("section")) return;
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        document.querySelectorAll(".section").forEach((item) => item.classList.toggle("active-section", item === section));
        document.querySelectorAll(".sidebar .nav-item").forEach((item) => {
            const isCurrent = item.dataset.section === sectionId;
            item.classList.toggle("active", isCurrent);
            if (isCurrent) item.setAttribute("aria-current", "page");
            else item.removeAttribute("aria-current");
        });
        updateNativeAdSuppression();
        document.getElementById("pageTitle").textContent = ({
            dashboard: "Dashboard",
            habits: "Habits",
            goals: "Goals",
            analytics: "Analytics",
            friends: "Friends",
            tasks: "Task"
        })[sectionId];
        if (sectionId === "dashboard") renderCalendar();
        else if (sectionId === "tasks") renderDailyTask();
        else if (sectionId === "friends") loadFriends();
        else renderStats();
    }

    document.getElementById("addHabitBtn").addEventListener("click", () => {
        const input = document.getElementById("newHabitInput");
        const habit = input.value.trim();
        if (!habit || habits.includes(habit)) return;

        restoreHabitName(habit);
        habits.push(habit);
        habitStarts[habit] = isoFromUTC(todayUTC());
        input.value = "";
        saveState();
        renderCalendar();
    });

    document.getElementById("newHabitInput").addEventListener("keydown", (event) => {
        if (event.key === "Enter") document.getElementById("addHabitBtn").click();
    });

    document.getElementById("resetBtn").addEventListener("click", () => {
        const days = getDaysInSelectedMonth();

        habits.forEach((habit) => {
            for (let day = 1; day <= days; day += 1) {
                delete checks[storageKey(day, habit)];
            }
        });

        saveState();
        renderCalendar();
    });

    const systemColorScheme = window.matchMedia("(prefers-color-scheme: dark)");

    function applyTheme(themeMode) {
        const isDark = themeMode === "dark" || (themeMode === "system" && systemColorScheme.matches);
        document.body.classList.toggle("dark", isDark);
        document.documentElement.style.colorScheme = isDark ? "dark" : "light";
        document.querySelector('meta[name="theme-color"]').content = isDark ? "#09090b" : "#f8f9fa";
        themeToggle.setAttribute("aria-pressed", String(isDark));
        themeToggle.querySelector(".nav-icon").textContent = isDark ? "☀" : "🌙";
        themeToggle.querySelector(".nav-text").textContent = isDark ? "Light Mode" : "Dark Mode";
        androidThemeSettings.querySelectorAll("[data-theme-mode]").forEach((button) => {
            button.setAttribute("aria-pressed", String(button.dataset.themeMode === themeMode));
        });
        document.querySelectorAll("[data-theme-icon]").forEach((icon) => {
            icon.media = icon.dataset.themeIcon === (isDark ? "dark" : "light") ? "all" : "not all";
        });
        if (isNativeAndroidApp && typeof nativeAndroidBridge.setSystemTheme === "function") {
            nativeAndroidBridge.setSystemTheme(isDark ? "dark" : "light", document.querySelector('meta[name="theme-color"]').content);
        }
    }

    function setTheme(preference) {
        const themeMode = typeof preference === "boolean" ? (preference ? "dark" : "light") : preference;
        if (!["light", "dark", "system"].includes(themeMode)) {
            throw new Error(`Unsupported LifeTrack theme: ${themeMode}`);
        }
        applyTheme(themeMode);
        localStorage.setItem("lifetrack-theme", themeMode);
    }

    function refreshSystemTheme() {
        if (localStorage.getItem("lifetrack-theme") === "system") applyTheme("system");
    }

    systemColorScheme.addEventListener("change", refreshSystemTheme);
    window.addEventListener("focus", refreshSystemTheme);
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) refreshSystemTheme();
    });

    themeToggle.addEventListener("click", () => {
        setTheme(!document.body.classList.contains("dark"));
        themeToggle.blur();
    });
    androidThemeSettings.addEventListener("click", (event) => {
        const option = event.target.closest("[data-theme-mode]");
        if (option) setTheme(option.dataset.themeMode);
    });

    document.getElementById("bodyEditBtn").addEventListener("click", () => {
        editingBody = !editingBody;
        renderDailyReminder(lastLife || computeLifetime());
    });

    const updateFocusDuration = () => {
        const hours = Number(document.getElementById("focusHours").value || 0);
        const minutes = Number(document.getElementById("focusMinutes").value || 0);
        const value = hours * 60 + minutes;
        if (!Number.isInteger(hours) || hours < 0 || hours > 24 || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
            document.getElementById("focusHours").value = String(Math.floor(focusDuration / 60));
            document.getElementById("focusMinutes").value = String(focusDuration % 60);
            renderFocusTimer();
            toast("Set a duration from 1 minute to 24 hours.");
            return;
        }
        if (value < 1 || value > 1440) {
            focusDurationValid = false;
            renderFocusTimer();
            return;
        }
        focusDurationValid = true;
        focusDuration = value;
        focusRemaining = focusDuration * 60;
        if (focusSessionDate) saveFocusTimerState();
        renderFocusTimer();
    };
    document.getElementById("focusHours").addEventListener("change", updateFocusDuration);
    document.getElementById("focusMinutes").addEventListener("change", updateFocusDuration);
    document.getElementById("focusSoundToggle").addEventListener("click", () => {
        focusSoundMuted = !focusSoundMuted;
        localStorage.setItem(`lifetrack:${currentUser.uid}:focus-sound-muted`, String(focusSoundMuted));
        if (focusSoundMuted) stopFocusCompletionSound();
        else prepareFocusAudio();
        renderFocusTimer();
    });

    document.getElementById("focusToggle").addEventListener("click", () => {
        prepareFocusAudio();
        if (focusEndsAt) {
            focusRemaining = Math.max(0, Math.ceil((focusEndsAt - Date.now()) / 1000));
            if (focusRemaining === 0) { tickFocusTimer(); return; }
            focusEndsAt = null;
            clearInterval(focusInterval);
            focusInterval = null;
            saveFocusTimerState();
            renderFocusTimer();
            return;
        }
        if (focusRemaining <= 0) focusRemaining = focusDuration * 60;
        focusEndsAt = Date.now() + focusRemaining * 1000;
        if (!focusSessionDate) focusSessionDate = isoFromUTC(todayUTC());
        saveFocusTimerState();
        focusInterval = setInterval(tickFocusTimer, 1000);
        setFocusLock(true, true);
        renderFocusTimer();
    });

    document.getElementById("focusReset").addEventListener("click", () => {
        clearInterval(focusInterval);
        focusInterval = null;
        focusEndsAt = null;
        focusRemaining = focusDuration * 60;
        clearFocusTimerState();
        renderFocusTimer();
    });

    dailyReminder.addEventListener("click", (event) => {
        if (event.target.closest("[data-reading-history], [data-reading-library]")) {
            openReadingHistory();
            return;
        }
        const openReadingButton = event.target.closest("[data-reading-open]");
        if (openReadingButton) {
            openReadingBook(openReadingButton.dataset.readingOpen);
            return;
        }
        const pageButton = event.target.closest("button[data-reading-page]");
        const completeButton = event.target.closest("button[data-reading-complete]");
        if (pageButton) {
            prepareReadingDay();
            readingPlan.currentPage = clamp(readingPlan.currentPage + Number(pageButton.dataset.readingPage), readingPlan.dailyStart - 1, readingPlan.pageCount);
            saveReadingPlan();
            renderStats();
            return;
        }
        if (completeButton) {
            if (readingPlan.currentPage < readingPlan.dailyEnd) {
                openReadingBook(readingPlan.bookId);
                return;
            }
            const bookFinished = completeReadingGoal();
            if (bookFinished === null) {
                toast("Today's reading goal is already complete.");
                return;
            }
            renderStats();
            renderCalendar();
            toast(bookFinished ? `${currentReadingBook().title} is ready. Your previous book is saved to history.` : "Reading goal complete. Next pages are ready.");
            return;
        }
        const button = event.target.closest("button[data-plan-habit]");
        if (!button || !habits.includes(button.dataset.planHabit)) return;
        const key = keyFor(todayUTC(), button.dataset.planHabit);
        checks[key] = !checks[key];
        saveState();
        renderStats();
        renderCalendar();
    });

    // Keep the selected year in the second row, with 2025 as the earliest year.
    function ensureYearOptions() {
        const nowYear = new Date().getFullYear();
        setYearOptions(nowYear);
    }

    function setYearOptions(selectedYear) {
        const firstVisibleYear = Math.max(2025, selectedYear - 1);
        yearSelect.replaceChildren();
        for (let year = firstVisibleYear; year <= firstVisibleYear + 4; year += 1) {
            yearSelect.add(new Option(String(year), String(year)));
        }
        yearSelect.value = String(Math.max(2025, selectedYear));
    }

    // when midnight passes, unlock the new day and refresh the daily plan
    setInterval(() => {
        if (renderedDay !== null && todayUTC() !== renderedDay) renderCalendar();
    }, 60000);

    monthSelect.addEventListener("change", renderCalendar);
    yearSelect.addEventListener("change", () => {
        setYearOptions(Number(yearSelect.value));
        renderCalendar();
    });

    document.querySelectorAll("[data-score-weight]").forEach((input) => {
        const category = input.dataset.scoreWeight;
        input.value = String(lifeScoreWeights[category]);
        const output = document.getElementById(`lifeScoreWeight${category[0].toUpperCase()}${category.slice(1)}Value`);
        if (output) output.value = `${lifeScoreWeights[category]}%`;
        input.addEventListener("input", () => updateLifeScoreWeights(false));
        input.addEventListener("change", () => updateLifeScoreWeights(true));
    });

    const lifeScoreDialog = document.getElementById("lifeScoreDialog");
    document.getElementById("lifeScoreDetailsButton").addEventListener("click", () => lifeScoreDialog.showModal());
    document.getElementById("lifeScoreDialogClose").addEventListener("click", () => lifeScoreDialog.close());
    lifeScoreDialog.addEventListener("click", (event) => {
        if (event.target === lifeScoreDialog) lifeScoreDialog.close();
    });

    paintUser();
    ensureYearOptions();
    setLiveMonthAndYear();
    const savedTheme = localStorage.getItem("lifetrack-theme");
    const initialTheme = ["light", "dark", "system"].includes(savedTheme)
        ? savedTheme
        : "dark";
    setTheme(initialTheme);
    renderCalendar();
    if (currentUser.provider === "google") resumeGoogleSync();
    else if (driveToken()) syncCloud().then(() => { if (googleToken()) syncGoogle(); });
    else if (googleToken()) syncGoogle();
    else if (currentUser.provider === "google") {
        setFitStatus("LifeTrack account is still signed in. Reconnect Google sync from the profile menu to access Drive again.", "warn");
    }

})();
