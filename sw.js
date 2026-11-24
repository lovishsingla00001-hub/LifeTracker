const CACHE = "lt-v31";
const APP_SHELL = [
    "./",
    "./index.html",
    "./dashboard",
    "./dashboard.html",
    "./install.html",
    "./privacy.html",
    "./terms.html",
    "./dashboard.css",
    "./dashboard.css?v=93",
    "./auth.css",
    "./auth.css?v=87",
    "./dashboard.js",
    "./dashboard.js?v=140",
    "./qrcode.js",
    "./pwa.js",
    "./config.js",
    "./app-redirect.js",
    "./manifest.webmanifest",
    "./manifest-dark.webmanifest",
    "./lifetrack-logo.png",
    "./lifetrack-logo-dark.png",
    "./lifetrack-logo-192.png",
    "./lifetrack-logo-512.png",
    "./lifetrack-logo-dark-192.png",
    "./lifetrack-logo-dark-512.png",
    "./lifetrack-logo.png?v=2",
    "./lifetrack-logo-dark.png?v=2",
    "./lifetrack-logo-192.png?v=2",
    "./lifetrack-logo-512.png?v=2",
    "./lifetrack-logo-dark-192.png?v=2",
    "./lifetrack-logo-dark-512.png?v=2"
];

// Reuse the existing notification handlers without registering a second worker.
importScripts("./service-worker.js");

self.addEventListener("install", (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        await cache.addAll(APP_SHELL);
        await self.skipWaiting();
    })());
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames
            .filter((name) => name !== CACHE && (name.startsWith("lt-") || name.startsWith("lifetrack-shell-")))
            .map((name) => caches.delete(name)));
        await self.clients.claim();
    })());
});

function isExcludedRequest(url) {
    return url.origin !== self.location.origin
        || url.pathname.startsWith("/api/")
        || /(^|\.)googleapis\.com$/i.test(url.hostname)
        || /(^|\.)google\.com$/i.test(url.hostname);
}

function isAppAsset(request, url) {
    return request.mode === "navigate"
        || request.destination === "script"
        || request.destination === "style"
        || /\.(?:html?|css|js)$/i.test(url.pathname);
}

function isCacheableStaticAsset(url) {
    return /\.(?:png|svg|ico|webmanifest)$/i.test(url.pathname);
}

// Cache only app assets; API and external requests pass directly to the network.
self.addEventListener("fetch", (event) => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== "GET" || isExcludedRequest(url)
        || (!isAppAsset(request, url) && !isCacheableStaticAsset(url))) return;

    event.respondWith((async () => {
        const cache = await caches.open(CACHE);
        if (!isAppAsset(request, url) && isCacheableStaticAsset(url)) {
            const cached = await cache.match(request);
            if (cached) return cached;
            const response = await fetch(request);
            if (response.ok) await cache.put(request, response.clone());
            return response;
        }

        try {
            const response = await fetch(request);
            if (response.ok) await cache.put(request, response.clone());
            return response;
        } catch (error) {
            const cached = await cache.match(request);
            if (cached) return cached;
            if (request.mode === "navigate") {
                const dashboard = await cache.match(new URL("./dashboard.html", self.registration.scope));
                if (dashboard) return dashboard;
                const index = await cache.match(new URL("./index.html", self.registration.scope));
                if (index) return index;
            }
            throw error;
        }
    })());
});
