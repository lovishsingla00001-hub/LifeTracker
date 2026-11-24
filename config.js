/* LifeTrack settings. Edit only this file.
   1) Keep GOOGLE_CLIENT_ID as the public OAuth Web application Client ID. The
      matching client ID and its secret must also be set on the Cloudflare Worker.
   2) Enable Google Drive API and allow drive.appdata for Google account cross-device data sync.
   3) Health data is read only from Android Health Connect or Apple Health in the
      native apps after the user opts in from Additional features.
   4) LIFETRACK_APP_URL is the same-origin Cloudflare-hosted app used for secure
      persistent Google sync. Set it to the deployed Worker URL.
   5) AdSense IDs are public identifiers, not secrets. Leave them empty until
      Google approves the site and provides a publisher ID and page slot IDs.
   6) Never put a Google client secret, refresh token, or Groq API key here. */
window.LT_CONFIG = {
    GOOGLE_CLIENT_ID: "962104658585-rc3pe5st455kn9fia2dhq9s221f1fof4.apps.googleusercontent.com",
    LIFETRACK_APP_URL: "https://lifetrack.surajshukla22051.workers.dev",
    GROQ_WORKER_URL: "https://lifetrack.surajshukla22051.workers.dev",
    ADSENSE_CLIENT_ID: "",
    ADSENSE_INSTALL_SLOT_ID: "",
    ADSENSE_DASHBOARD_SLOT_ID: ""
};
