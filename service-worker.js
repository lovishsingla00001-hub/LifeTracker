async function reportPushStatus(status) {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    clients.forEach((client) => client.postMessage({ type: "lifetrack-push-status", status }));
}

async function reportReminderDismissed(reminderKey) {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    clients.forEach((client) => client.postMessage({ type: "lifetrack-reminder-dismissed", reminderKey }));
}

self.addEventListener("push", (event) => {
    event.waitUntil((async () => {
        try {
            let payload;
            try {
                payload = event.data ? event.data.json() : {};
            } catch (error) {
                console.error("LifeTrack received an unreadable push notification.", error);
                await reportPushStatus("failed");
                return;
            }
            const reminders = Array.isArray(payload.reminders) ? payload.reminders : [];
            if (!reminders.length) {
                await self.registration.showNotification("LifeTrack", {
                    body: "You have a reminder.",
                    icon: "./lifetrack-logo-192.png",
                    badge: "./lifetrack-logo-192.png",
                    tag: "lifetrack-reminder"
                });
            } else {
                await Promise.all(reminders.map((reminder) => {
                    const time = typeof reminder.time === "string" && /^\d{2}:\d{2}$/.test(reminder.time)
                        ? new Date(`2000-01-01T${reminder.time}:00`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                        : "";
                    return self.registration.showNotification(
                        "LifeTrack reminder",
                        {
                            body: time ? `${reminder.title}\n${time}` : reminder.title,
                            icon: "./lifetrack-logo-192.png",
                            badge: "./lifetrack-logo-192.png",
                            tag: `lifetrack-reminder-${reminder.id}`,
                            data: {
                                reminderKey: `${reminder.id}|${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`
                            },
                            timestamp: Date.now(),
                            renotify: true,
                            silent: false,
                            vibrate: [200, 100, 200]
                        }
                    );
                }));
            }
            await reportPushStatus("displayed");
        } catch (error) {
            console.error("LifeTrack could not display a push notification.", error);
            await reportPushStatus("failed");
        }
    })());
});

self.addEventListener("notificationclose", (event) => {
    const reminderKey = event.notification.data && event.notification.data.reminderKey;
    if (reminderKey) event.waitUntil(reportReminderDismissed(reminderKey));
});

self.addEventListener("notificationclick", (event) => {
    const reminderKey = event.notification.data && event.notification.data.reminderKey;
    event.notification.close();
    event.waitUntil((async () => {
        if (reminderKey) await reportReminderDismissed(reminderKey);
        const target = new URL("dashboard.html", self.registration.scope);
        const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const client of windows) {
            if (new URL(client.url).origin !== self.location.origin) continue;
            await client.focus();
            if ("navigate" in client && client.url !== target.href) await client.navigate(target.href);
            return;
        }
        await self.clients.openWindow(target.href);
    })());
});
