# LifeTrack D1 user administration

LifeTrack already has the Cloudflare D1 database `lifetrack-monetization`. The
Worker keeps its existing `LIFETRACK_DB` binding and also exposes the same
database as `DB` for account administration. Do not create a replacement
database for this change.

Migration `worker/migrations/0008_user_admin.sql` adds the user, session, and
login-event tables without dropping or rewriting existing tables. It also
backfills existing password-account records using their PBKDF2 salt and hash;
plaintext passwords are never stored. Existing Google and Apple users are
registered on their next successful sign-in.

## Local test

Run these commands from the `worker` directory. Wrangler uses local SQLite/KV
storage here; `--local` does not read or modify the production D1 database:

```powershell
npx wrangler d1 migrations apply lifetrack-monetization --local --config wrangler.toml
node --test index.test.mjs user-admin.test.mjs
npm run dev:local
```

Open `http://127.0.0.1:8000/` for the local app,
`http://127.0.0.1:8000/dashboard` for the dashboard, or
`http://127.0.0.1:8000/admin` for admin. Local browser requests use the local
Worker instead of the deployed Worker. The server binds to loopback only and
is not exposed as a public/tunnel link.

For local admin access, put the following in `worker/.dev.vars` (do not commit
this file):

```text
ADMIN_EMAIL=your-verified-google-email@example.com
```

Sign in using that verified Google account, then open
`http://127.0.0.1:8000/admin`. Password accounts are not eligible for admin
access because LifeTrack does not currently verify email ownership for those
accounts. Google OAuth credentials and the token-encryption key must also be
configured locally to test the complete OAuth flow. For Google sign-in, add
`http://127.0.0.1:8000/api/auth/google/callback` to the OAuth client's
authorized redirect URIs. Local Apple sign-in also requires a provider setup
that permits the local callback; otherwise use email/password or guest mode.

## Production rollout

The database is already configured in `wrangler.toml`. If setting up a
different environment with no D1 database, create one and copy its returned
`database_id` into both D1 binding entries before continuing:

```powershell
npx wrangler d1 create lifetrack-monetization
```

After local tests pass, run these commands from `worker`:

```powershell
npx wrangler d1 migrations apply lifetrack-monetization --remote --config wrangler.toml
npx wrangler secret put ADMIN_EMAIL --config wrangler.toml
npx wrangler deploy --config wrangler.toml
```

Enter the admin's verified Google email when Wrangler prompts for the secret.
The deployment command publishes the Worker and web assets. The old Android
auto-updater metadata remains on version `1.1.8` so devices signed with the
previous release key are not offered an incompatible update.

The Android APK includes the `/admin` page for online use in the app. Build it
after testing the Worker deployment with the existing local signing setup. A
new signing key can install/update only builds signed with that same key.

## Admin behavior and data scope

- Admin authorization requires an active D1 session and a verified Google or
  Apple identity whose email exactly matches the `ADMIN_EMAIL` Worker secret.
- Suspending a user revokes all their active sessions. Unsuspending also
  requires a fresh sign-in.
- Deletion removes the user's D1 profile, sessions, login events, password
  account, and account-linked monetization data. It cannot erase copies in the
  user's browser storage or their personal Google Drive.
- Admin user responses never include `password_hash`. Login logs store country
  and a bounded user-agent string, not an IP address or password.
