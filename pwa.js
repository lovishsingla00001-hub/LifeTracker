(function () {
    "use strict";

    let deferredInstallPrompt = null;
    window.LifeTrackPwaInstall = {
        isAvailable: () => Boolean(deferredInstallPrompt),
        async prompt() {
            if (!deferredInstallPrompt) return "unavailable";
            const installPrompt = deferredInstallPrompt;
            deferredInstallPrompt = null;
            await installPrompt.prompt();
            return (await installPrompt.userChoice).outcome;
        }
    };
    window.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        deferredInstallPrompt = event;
    });
    window.addEventListener("appinstalled", () => {
        deferredInstallPrompt = null;
    });

})();