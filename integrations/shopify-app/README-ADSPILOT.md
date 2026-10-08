# 1920 Agency Store Connector (Shopify app record)

The Shopify app AdsPilot uses to connect stores. Created 2026-10-08 with the Shopify
CLI in the owner's developer organisation (id 239616792); client id in `shopify.app.toml`.

- No web code lives here: AdsPilot handles the store connection itself. This folder holds
  the app's configuration (name, scopes, redirect URLs), pushed with `shopify app deploy`.
- The client secret is never stored here. It lives in `~/.social-publisher/.env`.
- Practice store: `1920-agency-test-store.myshopify.com` (development store, test data).
- Plan and safety rules: `../../architecture/2026-10-08-shopify-connector-plan.md`.
