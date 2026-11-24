# Preview LifeTrack files from GitHub

GitHub's `blob` view is for reading source files; it does not run the app. To open the uploaded LifeTrack page in a browser, use one of these options:

## Run the complete app locally

The app needs its Cloudflare Worker API, so a static preview such as VS Code Live Server is not enough. Follow the [local development steps in README](./README.md#run-locally-on-windows), then open `http://127.0.0.1:8000/`.

## Open a hosted preview

The project is configured to use its Cloudflare Worker as the app host. Open the deployed site at:

https://lifetrack.surajshukla22051.workers.dev/

If you only want to inspect the uploaded HTML source on GitHub, open [`index.html`](./index.html). The GitHub file page shows the code, not a live preview.

GitHub Pages is not a complete preview for this app: its static hosting does not provide the Worker API or local D1 database. Use the Worker URL or run the local Worker instead.
