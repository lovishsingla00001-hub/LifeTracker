# LifeTrack AI V2 Monetization and Life Coach Roadmap

**Status:** D1 is provisioned, migrations 0001-0006 are applied, and the Worker is deployed with AdMob IDs configured. Ads/rewards, paid billing, refunds, and per-user AI metering remain disabled; AdMob review, consent, SSV callback, owner authorization, and payment setup remain incomplete.
**Release rule:** Keep ads, rewards, and paid entitlements disabled until the backend,
provider accounts, consent flows, and production verification have been tested.

## Architecture found in the repository

- **Web:** Vanilla HTML, CSS, and JavaScript. `worker/site/` is the hosted source;
  `worker/public/` is generated. Root dashboard copies support the GitHub Pages
  entry point.
- **Backend:** Cloudflare Worker in `worker/index.js`. It serves assets, Google
  OAuth, push reminders, audio transcription, and the assistant API.
- **Persistence:** The deployed Worker is bound to D1, which stores the
  monetization, AI session, payment, rewarded-ad, and Google OAuth record schema.
  Existing Cloudflare KV sessions remain readable during migration; KV also keeps
  push reminders and the aggregate assistant request counter.
  Tracker records and conversation history live in account-scoped browser storage
  and sync through Google Drive app-data for connected Google accounts.
- **Authentication:** Server-side Google OAuth sessions are available through an
  HttpOnly cookie. The dashboard also supports local/device accounts; those do not
  provide a server-verifiable identity for credit or subscription enforcement.
- **AI:** A Groq-backed `/api/assistant` endpoint already exists. Its D1-backed
  metering and conversation-history path is implemented and deployed but remains
  inactive until its budget configuration is reviewed and explicitly enabled.
  The browser sends recent chat messages and a summary built from local tracker
  data. The assistant
  supports Hindi/Hinglish and proposes a limited set of tracker changes for user
  review. The existing non-D1 path still uses input validation, an IP rate limit,
  and a shared daily request cap.
- **Android:** Native Java/Kotlin WebView wrapper with Health Connect and reminders.
  Google Mobile Ads and UMP SDKs provide a consent-gated adaptive banner and
  voluntary rewarded flow. Debug builds can use Google's official test IDs only;
  real ads require explicit release configuration. Server-authoritative
  entitlement and remote ad switches gate production ads, and active Pro users
  do not see ads.
- **Web advertising:** AdSense is disabled by default and limited to an install-page
  slot when valid publisher and slot IDs are configured. It checks server entitlement
  before loading and suppresses ads for active Pro accounts; dashboard/analytics
  ads and web consent gating are not implemented.
- **Payments and plans:** No billing SDK, payment gateway, subscription database,
  or server-side entitlement verification is configured.
- **Admin and reporting:** Owner-only ad switches and per-account reward status
  are implemented and deployed, but the owner identity is not yet configured.
  Other payment, refund, and subscription administration is not implemented.

## Important safety and data boundaries

- The AI should receive only the signed-in user's selected LifeTrack records needed
  for the request—not the repository source code. Current context is assembled on
  the device and includes habits, today's check-ins and fitness, goals, focus state,
  reading, daily task, reminders, recent check-in totals, and custom plan tasks.
  It does not currently include complete task deadlines, full fitness history, or
  a database-backed analytics history.
- Do not treat KV as an atomic credit ledger. It cannot safely prevent concurrent
  duplicate rewards or enforce per-user daily caps. A transactional datastore and
  verified identity are prerequisites.
- Existing tracker records must remain in browser storage/Google Drive; introduce
  monetization tables without migrating or rewriting tracker data.
- Google Play Billing and a web payment gateway must be verified server-side.
  Client purchase state must never grant Pro by itself.
- AdSense is not a rewarded-video implementation. Keep web rewarded ads out of
  scope until an eligible provider and its server-verification model are approved.
- Groq is the existing provider; Cloudflare Workers AI neuron quotas do not apply
  to these direct Groq API calls. Usage controls therefore reserve against
  configured Groq token pricing and a global daily budget, while Worker request
  limits remain a separate infrastructure concern.

## Proposed phases

1. **Foundation and account identity (implemented locally):** Add a transactional
   server datastore with versioned migrations for account plans, entitlements,
   credit ledger, reward claims, subscriptions, provider configuration, and
   privacy-aware aggregate events. Link rows only to a server-verified identity.
   Keep existing tracker data in place.
2. **AI Coach sessions and usage (backend foundation implemented locally):** Keep
   the existing Groq provider. When D1 is deliberately bound, require a verified
   Google session, reserve per-user Free/Pro daily credits and a global Groq cost
   budget before a model call, reserve a Pro share of that budget, record actual
   token use, release reservations after failure, and pause on cost/configuration
   anomalies. Store successful chat turns by account/conversation for continuity,
   with configurable limits and scheduled retention. Improve the coach prompt to
   avoid generic praise and repeated advice. The explicit `AI_USAGE_CONTROL_ENABLED`
   flag remains false, preserving the existing AI request path.
3. **AI Coach privacy and capability:** Add explicit context/history consent and
   deletion controls, conversation management, grounded daily/weekly summaries,
   and planner suggestions. Keep edits as review-before-apply proposals. Report
   unavailable history honestly. Surface daily remaining credits in the UI.
4. **Server-authoritative rewards (deployed, disabled):** Android
   uses official test IDs in debug builds and sends short-lived, one-use reward
   challenges to the Worker. The Worker verifies AdMob's signed SSV callback,
   checks the configured unit, user, amount, and challenge, and prevents duplicate
   transactions. The default policy is five temporary AI credits, once per seven
   days, expiring after 24 hours. Skipped, failed, replayed, or unverified ads earn
   nothing. AdMob app review, UMP consent configuration, SSV callback setup, and
   owner authorization are still prerequisites for enabling production ads.
5. **Subscriptions and entitlements:** Integrate Google Play Billing and Razorpay
   subscriptions. Verify purchases/webhooks on the Worker, store entitlement
   transitions, and provide one authoritative entitlement response to all clients.
   Expiration restores Free behavior without deleting data.
6. **Cancellation, refunds, and policies:** Publish reviewed policy pages, display
   links and auto-renew terms before checkout, accept account-bound requests,
   require an authorized administrator's decision, and only then call the original
   provider's refund API with idempotency and webhook reconciliation. The policy
   must be reviewed for current Indian legal and provider requirements; no refund
   promise or timeline is invented.
7. **Ads and privacy (partially implemented locally):** Native banner and rewarded
   ads are consent-gated and use server-verified Free/Pro state plus remote owner
   switches. Web AdSense remains a separate install-page-only integration. Keep
   production ads disabled until AdMob review, published consent messaging, SSV,
   and owner authorization are verified. Web consent and broader account data
   controls remain open work.
8. **Admin, observability, and rollout:** Add administrator-only settings and
   aggregate reporting, concurrency/replay/security tests, desktop/mobile/offline
   checks, Android build/install checks, and a staged rollout plan. Do not deploy
   production credentials or enable monetization without account-owner approval.

## Confirmed implementation choices

- **Transactional datastore:** Cloudflare D1 with versioned SQL migrations.
- **Web subscriptions:** Razorpay, subject to merchant onboarding and available
  subscription APIs; Google Play Billing remains separate for Android.
- **Identity:** Require server-verified Google sign-in for AI credits, rewarded
  credits, and paid subscriptions. Existing local/offline tracking remains
  available to guests.
- **Plans:** Free ₹0; Pro Monthly ₹99/month; Pro Yearly ₹699/year. Show INR and
  billing frequency, and disclose auto-renewal and the next charge before the
  user confirms payment.
- **Revenue accounting:** Allocate 10% of each verified gross payment to the
  internal AI/Groq cost budget (₹9.90 from ₹99/month; ₹69.90 from ₹699/year).
  This is not a user wallet or a payment routed to Groq; Groq bills the account
  owner separately. Razorpay settles eligible proceeds to the merchant bank
  account configured in Razorpay after provider fees, taxes, refunds, and other
  applicable adjustments. AdMob does not receive subscription payments.
- **Refund operations:** Manual review and admin approval are required before
  requesting any provider refund. Eligibility text, statutory rights, and timelines
  must be reviewed/configured before checkout is enabled.

Provider accounts, credentials, product identifiers, and production approval are
not present in the workspace and must not be fabricated.

## Initial rollout status

- Audit and implementation plan: complete.
- Phase 1 migration: `worker/migrations/0001_monetization_core.sql` creates the
  isolated monetization settings, verified-account/entitlement, credit ledger,
  daily AI usage, reward claim, subscription, webhook-idempotency, and aggregate
  analytics tables. It does not move or rewrite tracker records.
- Phase 2 migration: `worker/migrations/0002_ai_sessions_and_payments.sql` adds
  account-scoped conversation history, usage/model/cost tracking, global daily
  budget accounting, payment/cancellation/refund records, and manual-approval
  defaults.
- Phase 3 migration: `worker/migrations/0003_admob_rewards.sql` adds disabled
  ad switches, configurable reward credits/cooldown, and reward-credit expiry.
- `GET /api/monetization/status` now requires the existing server-verified Google
  session, initializes a Free account idempotently in a D1 batch, exposes only
  plan/active-state/credit balance, and fails expired or undated Pro entitlements
  closed to Free. Android uses this endpoint before loading AdMob banners and
  hides the banner for verified active Pro accounts.
- The Groq assistant now has a less repetitive, data-grounded style. When a D1
  binding is configured, its metered path requires Google authentication, enforces
  the configured Free/Pro limits and global budget, reserves 25% of global
  capacity for Pro by default, records Groq token usage/cost, persists successful
  chat turns, and releases failed reservations. Stale reservations and expired
  conversation history are cleaned up by the Worker schedule.
- Metering settings start disabled with zero global budget and zero Groq pricing.
  The D1 path fails closed until an operator configures the budget, pricing, and
  `ai_usage_control_enabled`. Do not bind D1 before applying all three migrations and
  setting these values. The user-facing chat history controls and explicit
  personalization consent still need implementation before production rollout.
- The production Worker is bound to D1. Per-user AI metering remains disabled,
  so the existing 40-chat shared daily allowance remains active; its counter is
  now atomically stored in D1 instead of writing to KV for every chat. The
  current day's legacy KV count is carried forward when D1 first initializes it.
- The existing Groq API key and configured model remain shared; the usage controller
  applies separate per-account Free/Pro daily allowances. No individual Groq keys
  or alternate provider are created for subscribers.
- The Android banner and public install-page AdSense slot consult the
  server-authoritative entitlement and suppress ads for active Pro users. Unknown
  signed-in status fails closed for ad display.
- AdMob reward challenges, signed SSV verification, duplicate prevention, owner
  ad toggles, and the seven-day/24-hour reward policy are deployed. D1 and real
  AdMob IDs are configured, but the ad switches remain off pending owner
  authorization, account review, consent configuration, and the SSV callback.
- Android debug builds use Google's official test IDs only when
  `ENABLE_ADMOB_TEST_ADS=true`; test-ad completion never credits an account.
- Razorpay, Google Play Billing, server-side payment verification, checkout UI,
  refund/cancel workflows, and subscription activation are not production-ready
  or activated. Provider setup and complete account-facing flows remain
  outstanding.
- Cloudflare D1 `lifetrack-monetization` is provisioned and bound to the Worker;
  migrations 0001-0006 are applied remotely. OAuth transient state and refreshed
  sessions now use expiring D1 records rather than daily-limited KV writes.
- `AI_USAGE_CONTROL_ENABLED` is false in production so binding D1 for monetization
  does not activate per-user charging. Enable metering only after configuring and
  reviewing daily limits, global budget, and Groq cost rates.
- No monetization or subscription status has been activated.
- No production ads or reward credits are issued: both remote ad switches are off.
  The AdMob app currently requires review; consent, SSV callback, and owner
  authorization are not configured.
- Existing production AI assistant continues using its shared daily request
  allowance. D1 now manages that allowance even while per-user metering is off.
- The Worker deployment is active. No Android APK build has been performed for
  this plan.
