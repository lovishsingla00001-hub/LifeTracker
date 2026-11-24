(async function () {
    "use strict";

    if (window.LifeTrackNativeReminders
        && typeof window.LifeTrackNativeReminders.isNativeApp === "function"
        && window.LifeTrackNativeReminders.isNativeApp()) return;
    const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
    const isInstallPage = pathname === "/install.html" || pathname === "/install";
    const isDashboardPage = pathname === "/dashboard.html" || pathname === "/dashboard";
    if (!isInstallPage && !isDashboardPage) return;

    const config = window.LT_CONFIG || {};
    const clientId = String(config.ADSENSE_CLIENT_ID || "").trim();
    const slotId = String((isDashboardPage
        ? config.ADSENSE_DASHBOARD_SLOT_ID
        : config.ADSENSE_INSTALL_SLOT_ID) || "").trim();
    if (!/^ca-pub-\d{16}$/.test(clientId || "") || !/^\d+$/.test(slotId || "")) return;

    try {
        const workerBase = String(config.GROQ_WORKER_URL || "").trim();
        if (!workerBase) return;
        const adConfigResponse = await fetch(new URL("/api/monetization/ads/config", workerBase), {
            method: "GET",
            credentials: "include",
            headers: { Accept: "application/json" }
        });
        if (!adConfigResponse.ok || (await adConfigResponse.json()).adsEnabled !== true) return;
        const entitlementResponse = await fetch(new URL("/api/monetization/status", workerBase), {
            method: "GET",
            credentials: "include",
            headers: { Accept: "application/json" }
        });
        if (entitlementResponse.status === 401) {
            if (isDashboardPage || window.localStorage.getItem("lifetrack-user")) return;
        } else {
            if (!entitlementResponse.ok) return;
            const entitlement = await entitlementResponse.json();
            if (entitlement.entitlementActive === true
                && ["pro_monthly", "pro_yearly"].includes(entitlement.plan)) return;
            if (entitlement.plan !== "free" || entitlement.entitlementActive !== false
                || entitlement.adsEnabled !== true) return;
        }
    } catch (error) {
        console.error("LifeTrack could not verify subscription status; the website ad was withheld.", error);
        return;
    }

    const container = document.getElementById(isDashboardPage ? "dashboardAdContainer" : "installAdContainer");
    const slot = document.getElementById(isDashboardPage ? "dashboardAdSlot" : "installAdSlot");
    if (!container || !slot) return;

    slot.dataset.adClient = clientId;
    slot.dataset.adSlot = slotId;
    container.hidden = false;

    const script = document.createElement("script");
    script.async = true;
    script.crossOrigin = "anonymous";
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(clientId)}`;
    script.addEventListener("load", () => {
        try {
            (window.adsbygoogle = window.adsbygoogle || []).push({});
        } catch (error) {
            container.hidden = true;
            console.error("LifeTrack could not initialize its website ad slot.", error);
        }
    }, { once: true });
    script.addEventListener("error", () => {
        container.hidden = true;
        console.error("LifeTrack could not load the website advertising script.");
    }, { once: true });
    document.head.appendChild(script);
})();
