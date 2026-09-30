# Skills library

Third-party marketing skills, **served by the MCP server** to AI clients through
`list_skills` and `get_skill` (see `src/skills-library.ts`).

Different from `reference/ad-skills/`, which is source material nobody is served.
This folder **is** served, so what goes in it matters more.

## Contents

| Folder | Source | Licence | Commit | Skills |
|---|---|---|---|---|
| `marketingskills/` | github.com/coreyhaines31/marketingskills | MIT | `5b2c0007766c6a1cf1d53fd8fc73e979e0821022` | 50 |

Fetched 2026-09-30, at the owner's request, so future SEO, WordPress and Google
work starts from this knowledge rather than from new research.

## Checked on arrival

Every file was scanned before being committed:

- phrases that try to override instructions ("ignore previous…", "you are now…")
- code that fetches and runs (`curl … | sh` and similar)
- hard-coded secrets
- hidden and direction-override Unicode characters

Result: **clean.** The only hits were an `rm -rf` in the upstream README's install
instructions (the README is not served) and a variable named `api_key` in a code
example.

## Rules for this folder

- **Never edit files in place.** It is a faithful copy of a known commit.
- **Updating means:** fetch at a new commit, re-run the scan, read what changed,
  update the commit here and in `src/skills-library.ts`, commit.
- **Never add an unlicensed source.** A repository with no licence gives no
  permission to copy, however public it is. Read such sources for knowledge and
  write our own; do not copy their text.
- **Every skill is served under a framing note** telling the AI it is advice, not
  a control, and how to read references to files that only exist upstream.
