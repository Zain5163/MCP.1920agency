# Runbooks — how to operate AdsPilot

Each procedure stays next to the scripts it drives, so this page is the index.
Anything that publishes, spends, deploys or deletes needs the owner's approval first
(`D:\My AI Works\AGENTS.md`).

| Task | Where the steps are |
|---|---|
| Release new code to the server, and roll back | `deploy/README.md` "Day to day"; `deploy/scripts/release.sh` (`--rollback`, `--upload-only`) |
| Nightly backups, PC copies, restore | `deploy/README.md` (Stage A, backups); `deploy/scripts/backup.sh`, `pc-backups.sh`, `restore.sh` |
| Move the database onto the server (Stage B) | `deploy/README.md` "Stage B"; `deploy/scripts/move-to-local-db.sh`; decision 0010 |
| First-time server setup | `deploy/scripts/setup.sh`; `deploy/README.md` Part 2 |
| OAuth over https (provider consoles, redirect URIs) | `deploy/README.md` "OAuth over https: the owner checklist" |
| Our site on the server's front gate | `deploy/scripts/caddy-site.sh --upload`; the gate itself: `AI-Automation\Server-Gate` |
| Connect or reconnect accounts | `connect-accounts.cmd`; `SETUP.md` (Meta, Google, Shopify, Threads) |
| Rename the product or move the domain | `START-HERE.md` "Where settings live"; `docs/architecture/2026-10-10-central-config.md` |
| Back up everything outside this repo | `bash ../MCP-Tooling/sync.sh` (secret scan, commit, push); `../MCP-Tooling/README.md` |
| Restore on a new PC | `../MCP-Tooling/README.md` "Restoring on a new PC", then `SETUP.md` |
| Moves that touch running automation (quiet windows) | `docs/architecture/2026-10-10-workspace-organisation-plan.md` §4 |
