/* LifeTrack settings. Edit only this file.
   1) Keep GOOGLE_CLIENT_ID as the public OAuth Web application Client ID. The
      matching client ID and its secret must also be set on the Cloudflare Worker.
   2) Enable Google Drive API and allow drive.appdata for Google account cross-device data sync.
   3) Health data is read only from Android Health Connect or Apple Health in the
      native apps after the user opts in from Additional features.
   4) App and API requests stay on the current origin; use the local Worker
      runner for a complete local experience.
   5) AdSense IDs are public identifiers, not secrets. Leave them empty until
      Google approves the site and provides a publisher ID and page slot IDs.
   6) Never put a Google client secret, refresh token, or Groq API key here.    */
   const appOrigin = ["http:", "https:"].includes(location.protocol) ? location.origin : "";
   window.LT_CONFIG = {
    GOOGLE_CLIENT_ID: "962104658585-rc3pe5st455kn9fia2dhq9s221f1fof4.apps.googleusercontent.com",
       LIFETRACK_APP_URL: appOrigin,
       GROQ_WORKER_URL: appOrigin,
    ADSENSE_CLIENT_ID: "",
    ADSENSE_INSTALL_SLOT_ID: "",
    ADSENSE_DASHBOARD_SLOT_ID: ""
};
