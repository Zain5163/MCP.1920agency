# Glossary — one product, many names

All of these are the same product. The **internal codename is `adspilot`** (decision
0011): it is permanent, and the public name, when the owner chooses it
(`WAITING-LIST.md` #14), is added as a label only. Do not rename the items below to
make them match: tool names, task names, folders and server paths are cited by
running automation and by code.

| Where | Name used | Why it stays |
|---|---|---|
| Internal codename (docs, server, Docker, systemd, skills folder) | `adspilot` | Already the server's, Docker's and the skills' name |
| Working product name | AdsPilot | Taken by other products; public name not chosen |
| Folder on the PC | `AI-Automation\Social-Publisher` | Moving it is phase 6 of the organisation plan (decision D1), later |
| GitHub | `Zain5163/MCP.1920agency` (code), `Zain5163/MCP.1920agency-Tooling` (backups) | Renaming is optional after the public name (GitHub redirects) |
| Backup folder | `AI-Automation\MCP-Tooling` | As above |
| Local MCP key and tool prefix | `social-publisher`, `mcp__social-publisher__*` | Listed in the Muzaree automation's allowed tools and in saved permissions |
| Hosted MCP key | `adspilot-hosted` | User-level Claude Code setting |
| Packages | `@social-publisher/*` | Imports across the monorepo |
| Secrets folder | `~/.social-publisher` | `CONFIG_DIR` in code; must stay outside the workspace |
| Server, containers, timers, network, backup key | `/opt/adspilot`, `adspilot-*`, `adspilot_edge`, gpg "AdsPilot backups" | `release.sh`, rollback, backups and the gate depend on them |
| Scheduled tasks | `AdsPilot-*`, `Social-Publisher-Keepalive` | Cited in `resolutions.ts` and `monitor.ts` |
| Skills folder | `source/apps/mcp/skills-library/adspilot` | Served to AI clients |
| Domain (temporary) | `mcp.1920agency.com` | Registered with Meta, Google, LinkedIn and Shopify; set once in `deploy/site.env` |
| SSH key | `raptor_hetzner` | Shared with Raptor; set once in `deploy/site.env` |
| Meta app | `Mysmadspilot` | Same App ID as the ads token |
| Shopify app | "1920 Agency Store Connector" | Company name, set in `shopify.app.toml` |
