# docs — the shelves

Every document in this repo lives on one of these shelves (decision 0011, 2026-10-10).
The shelf names do not change. The root keeps only the living files: `START-HERE.md`
(the map), `STATUS.md` (the one status), `RULES.md`, `SETUP.md`, `PROJECT-LOG.md`,
`PROJECT-CONTEXT.md` (a pointer) and, until it is folded into `STATUS.md`,
`WAITING-LIST.md`.

| Shelf | What goes there | Naming |
|---|---|---|
| `product/` | What the product is and does: `capabilities.md` (full built / proven matrix), `roadmap.md` (everything planned, build order), `ideas.md` (backlog), `glossary.md` (names) | lowercase-kebab |
| `decisions/` | Decision records (ADR): context, decision, rejected options | `NNNN-short-title.md`; header Status (Proposed / Accepted / Superseded by NNNN) and Date |
| `architecture/` | Designs and build plans, with a status line at the top | `YYYY-MM-DD-topic.md` |
| `runbooks/` | How to operate it: release and rollback, backups and restore, accounts, the gate, a new PC | `README.md` indexes the procedures, which stay beside their scripts |
| `research/` | What was checked, when, against what source, how sure we are (`research/README.md` has the rule) | `YYYY-MM-DD-topic.md` |
| `reviews/` | Review reports and evidence. History: never rewritten | `YYYY-MM-DD-topic/` |
| `policies/` | Policies we answer to others with (data requests, privacy) | lowercase-kebab |
| `reference/` | Third-party material, licensed and pinned; source material only, never served | as received |
| `brand/` | The product's own brand: name research, voice, its design system | lowercase-kebab |
| `archive/` | Superseded documents, kept and never deleted | `YYYY-MM-DD-<name>.md` |

Rules:

- A new document goes on a shelf, never at the repo root.
- Paths in documents are written from the repo root (`docs/decisions/0003-ads-domain-model.md`).
- `PROJECT-LOG.md`, `reviews/` and `archive/` are history: they are not rewritten
  when files move. Entries before 2026-10-10 use the old layout, where the shelves
  sat at the root (`architecture/` is now `docs/architecture/`, and so on).
- `release.sh` ships `source` and `deploy` only, so nothing here reaches the server.
