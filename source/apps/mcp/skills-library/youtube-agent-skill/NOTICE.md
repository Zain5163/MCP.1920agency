# Licence notice

Source: https://github.com/Jakeschincariol/youtube-agent-skill, commit
`a2feb2104981a375ffd4f87ee04f4f5344ac43c6` (2026-09-16), fetched 2026-10-10.
Licence: MIT, Copyright (c) 2026 Jake Schincariol. The upstream `LICENSE` is kept
unchanged beside this file.

Copied unmodified, at their upstream paths:

- `skills/`: all eleven skills (`yt-audit`, `yt-chapters`, `yt-comment`, `yt-edit`,
  `yt-package`, `yt-plan`, `yt-retention`, `yt-script`, `yt-seo`, `yt-shorts`,
  `yt-viral`) with the six Python helpers beside them (`chapters.py`, `deadair.py`,
  `title.py`, `retention.py`, `hookscore.py` with its `hooks.json`, `swipe.py`).
- `templates/voice.md`: the voice-profile template.

Not copied: the upstream `README.md` (install instructions, never served),
`.claude-plugin/` (Claude Code plugin manifests) and `.gitignore`.

How it is served (`src/skills-library.ts`): every SKILL.md through `get_skill`; the
helpers and `hooks.json` as text between marker lines through
`get_skill { name, reference: "<file>" }` (the source declares them as `helpers`);
`templates/voice.md` as a reference of every yt-* skill (declared as `shared`).
The server never runs a helper. The upstream text is not edited: where it assumes
Claude Code (`python3 hookscore.py`, `~/.claude/youtube/voice.md`, `/yt-…`
commands), the reading note served above each skill says how to read it here.

Added 2026-10-10 at the owner's request. Scanned on arrival (instruction-override
phrases, fetch-and-run code, network calls, subprocess or eval, secrets, hidden
Unicode): clean. Every file is plain ASCII; the helpers import only `json`, `os`,
`re`, `sys`, `csv` and `statistics`, and read only the files named on their command
line plus `hooks.json` and `yt-edit/deadair.py` beside them. The only hits were the
word "secret" in two lists of vague title words.

This file is ours, not upstream's.
