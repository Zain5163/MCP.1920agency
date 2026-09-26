# Research notes

What was checked, when, against what source, and how confident we are.

This folder exists because platform research kept ending up only in commit
messages and code comments. Those are fine for explaining a line of code and
useless for answering "did we ever check whether Threads uses the Graph API" six
weeks later.

## The rule these notes follow

Every claim is one of three things, and the note says which:

- **Verified** — confirmed against official documentation or the platform's own
  console, with the source and the date.
- **Reported** — found in a secondary source and plausible, but not confirmed.
  Never acted on as if it were verified.
- **Assumed** — reasoning from how similar platforms behave. The weakest, and the
  category that produced the Threads mistake (see `RULES.md` R7).

Platform limits and behaviours change quietly, so a note is a snapshot with a
date, not a permanent fact. `verified` dates also appear next to the numbers
themselves in `source/packages/core/src/adapters/capabilities.ts`.

## Index

| Note | Covers | Status |
|---|---|---|
| `2026-09-25-meta.md` | Facebook Pages, Instagram | Verified against live docs |
| `2026-09-25-threads.md` | Threads | Corrects an earlier wrong assumption |
| `2026-09-25-pinterest.md` | Pinterest | Trial vs Standard access |
| `2026-09-26-linkedin.md` | LinkedIn | Verified against the real app console |
| `2026-09-26-mcp-landscape.md` | Whether LinkedIn ships an official MCP | Answers an owner question |

## Adding a note

One file per platform or question, named `YYYY-MM-DD-topic.md`. Include the
source URL, mark every claim with its confidence, and state plainly what was
**not** checked. A gap that is written down is a much smaller problem than one
that is not.
