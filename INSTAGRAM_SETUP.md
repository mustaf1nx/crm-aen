# AEN CRM v2 — Instagram test setup

## What is implemented
- Signed Meta webhook verification (`GET /api/webhooks/instagram`) and HMAC SHA256 POST validation.
- Automatically creates a customer, lead and conversation on first incoming message.
- Subsequent messages from the same sender/account reuse the conversation.
- External message IDs deduplicated.
- Conversations and message history in the CRM; replies through Meta API when credentials are configured.
- Optional authenticated admin-only local demo endpoint.

## Important
The integration is **not yet connected to Meta**. Real Instagram traffic requires correct tokens, app permissions, webhook subscription and a publicly reachable HTTPS URL. No token is included. The existing CRM stays local-only.

1. Keep the existing `.env` file and add new variables from `.env.example`. Do NOT overwrite the existing passwords.
2. Set `IG_VERIFY_TOKEN` to a new long random secret. Set `META_APP_SECRET` from Meta App Settings (do not share).
3. Set `IG_ACCOUNT_ID` to the Instagram business ID and `IG_PAGE_ID` to the linked Facebook Page ID.
4. Set `IG_ACCESS_TOKEN` to a valid access token appropriate to the Facebook Login integration. Use a Page access token with required permissions, not an expired Explorer user token.
5. For local demonstration, set `ENABLE_DEMO_INGEST=true`, then run `docker compose up -d --build --force-recreate`. Log in as admin and use the demo form in Messages. It does not contact Instagram. Set it back to `false` after the test.
6. For actual Meta delivery, expose the local port via a trusted HTTPS tunnel. The public callback URL should end in `/api/webhooks/instagram`. Use the same `IG_VERIFY_TOKEN` in the Meta webhook setup and subscribe the Instagram messaging events. Do not expose your CRM login publicly for a test without authentication and HTTPS.
7. Send a DM from an authorized tester account, then open Messages and click Refresh. In Meta development mode, app roles and permissions limit eligible accounts.

### Caveats
- Facebook Login and Instagram Login APIs differ. This build uses Facebook Login (`IG_AUTH_MODE=facebook`) by default.
- Meta message API behavior and supported events vary by app configuration. Verify against the current Meta documentation before production use.
- Media messages are represented by a placeholder; attachments are not downloaded.
- The demo uses a fixed `IG_CITY_NAME` for the first connected account; 3-city routing needs account-specific mapping in a later version.
- Do not expose this development build to the public internet without hardening, rate limiting, migrations and backups.
- If a token appeared in screenshots, revoke it and issue a new one.
