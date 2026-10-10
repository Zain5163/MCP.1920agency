I built the renderer, rendered all five drafts' visuals, wired them into the drafts, and updated the approval script. Every image passed visual QA. Nothing was published, uploaded, posted or scheduled, and no OAuth or platform API was touched.

**Results**
- **Social-Render tests:** 22 of 22 pass (6 suites), including real Chrome renders at all three sizes and a check that an overflowing spec writes nothing.
- **Syntax and specs:** 12 of 12 JS files pass `node --check`. All 8 specs (the 5 drafts plus 3 examples) validate.
- **Approval-script harness:** 234 checks passed, 0 failed, in Windows PowerShell 5.1. It loads only the script's functions and runs them against all 18 real drafts; the interactive script was never run.
  - The script parses and is ASCII-only.
  - Every text post is exactly what the old script would have sent.
  - Extracted post lengths match the visual spec: 1254, 1132, 683, 959, 1013.
  - An echo script standing in for post.ts showed the image path (with spaces) reaches node intact.
  - All 22 draft, POSTS-LOG and log files are unchanged.
- **PDFs:** checked with PyMuPDF. 19 pages, each exactly 810 x 1012.5 pt and pixel-identical to its PNG (max difference 0). Titles are set.
- **Text check:** all 21 slides use only words from their draft. The only dropped words are "and" and "plus" on 10-03-pm slide 3, which the visual spec allows.
- **Visual QA:** I opened all 21 final PNGs. Nothing overflows or clips. The smallest body text is 37.8 px (the gradient tile numbers on 10-03-pm slides 2 and 3 are the one exception). Each slide's gradient sits on its intended phrase. Series share one layout: the gates at the same height, the questions likewise, the catches likewise. There are no ticks, UI mock-ups, logos, IDs or CTAs.

**Final file sizes** (all PNGs are 1080x1350 RGB)
| Draft | Files |
|---|---|
| 2026-10-02-pm | image.png 465,688 B |
| 2026-10-05-am | image.png 408,419 B |
| 2026-10-03-pm | slides 434,360 / 322,432 / 315,533 / 389,098 / 334,235 / 385,366 B; carousel.pdf 1,672,687 B |
| 2026-10-05-pm | slides 423,241 / 296,534 / 300,348 / 314,947 / 319,806 / 315,611 / 369,181 B; carousel.pdf 1,795,973 B |
| 2026-10-07-pm | slides 438,614 / 298,477 / 332,287 / 324,231 / 346,812 / 361,542 B; carousel.pdf 1,620,286 B |

**Files created**
- `D:\My AI Works\AI-Automation\Social-Render\`
  - `PROJECT-CONTEXT.md`, `render.mjs`, `package.json`, `config.json` (refuses the product's working name on any image)
  - `lib\`: `chrome.mjs`, `document.mjs`, `glyphs.mjs`, `pdf.mjs`, `png.mjs`, `render.mjs`, `spec.mjs`, `text.mjs`
  - `templates\`: `brand.css`, `fonts.css`, `page.js`, `slides.mjs`
  - `fonts\README.md` (licence and source)
  - `examples\`: `all-types-portrait.json`, `square-quote.json`, `story-cover.json`
  - `test\render.test.mjs`
- The four woff2 files were already in `fonts\`. I checked they are byte-identical to the site build rather than copying again.
- `D:\My AI Works\Marketing-and-Content\LinkedIn-Content-System\assets\<draft>\` for the five drafts: 5 `spec.json`, 21 PNGs and 3 `carousel.pdf`.
- `D:\My AI Works\AI-Automation\LinkedIn-Content-Ops\archive\Approve-LinkedInPosts.2026-10-02-before-image-support.ps1` (rollback copy of the old script).

**Files changed**
- **The five drafts:** frontmatter lines added, nothing else (checked with diff and a YAML parser).
  - `2026-10-02-pm.md` and `2026-10-05-am.md` got `image:`.
  - `2026-10-03-pm.md`, `2026-10-05-pm.md` and `2026-10-07-pm.md` got `document:` and `document_title:`.
- **`Approve-LinkedInPosts.ps1`:**
  - (a) A draft whose format starts with `text + image` and whose image file exists is scheduled with `--image`. The review screen shows the image path and size.
  - (b) When the body has a `## Post text` heading, only that section is posted.
  - (c) Documents stay "post by hand" but the screen now shows the PDF path, the title and the post length.
  - `[OWNER` gaps anywhere in the body, and headings inside the post text, are still refused.
- **`LinkedIn-Content-Ops\PROJECT-CONTEXT.md`:** describes image support.
- **Two extra files, following the workspace rule to update context after material work:** `LinkedIn-Content-System\PROJECT-CONTEXT.md` (assets folder, next action 3 marked done) and `WORKSPACE-INDEX.md` (one line for Social-Render).

**Decisions where the spec was silent**
- **Allowed text changes:** headline colons dropped and the first letter of the body capitalised. 10-05-pm slide 2 is not capitalised because it starts with the code chip.
- **Line breaks only, no words changed:**
  - Forced breaks in the series headlines, such as "Gate 1," then "validation".
  - Three sentences on separate lines on 10-05-pm slide 7.
  - The closing sentence set as a large takeaway line on 10-03-pm slide 6 and 10-07-pm slide 6.
  - One-letter words ("a", "I") never end a line.
- **Layout:**
  - 10-03-pm slide 4 is split at the middle dots into three tiles, with plain frames drawn at 4:5, 1:1, 9:16 and 1.91:1.
  - 10-05-pm slide 6 is a 4-step flow with drawn arrows.
  - The 10-05-am checklist uses numbered markers, not ticks.
- **Code and error text:**
  - The Meta error strings are set in a softer mono.
  - "confirm: true" is set as a chip.
- **Decoration:** ribbons and orbs move automatically, or are hidden, so they never cross text.
- **YAML quoting:** the 10-07-pm `document_title` uses single quotes because the title contains double quotes. It is valid YAML and reads correctly in the script.
- **Script additions beyond (a) to (c):**
  - **Fixed a bug:** under Windows PowerShell 5.1, any stderr line from the CLI used to end the whole review session. The CLI call now runs under a local `Continue`, so a refusal is shown as "NOT scheduled" and the review moves on. I confirmed the old pattern throws and the new one doesn't.
  - **Shows `check_before_posting`:** 10-05-am can now be scheduled from the review, and its Ads Manager warning would otherwise have been invisible there. The parser now reads YAML `>` blocks, which it previously read as just `>`.
  - **Smaller additions:**
    - An `o` option opens the image before you answer.
    - An empty post text is refused.
    - A relative `image:` path resolves against the draft's folder.
    - A file that isn't an image type is refused.

**Not done or UNVERIFIED**
- **Scheduling with `--image` is unproven.** Pressing y on an image post (the CLI uploads the file to the media bucket, then the worker posts it later) has not been run. What's proven is an immediate LinkedIn image post from local disk on 2026-09-26. It also needs the Supabase media hosting set up, which I didn't check because that would mean reading the `.env`. If it isn't set up, the CLI refuses and the draft stays unchanged.
- **The `o` loop and the rest of the interactive flow were not run.**
- **The owner hasn't approved the designed cards** in place of the drafts' optional real screenshots. His "y" in the review would be that approval. The 10-02-pm slot is tonight at 22:00 PKT.
- **LinkedIn's acceptance of the PDFs is untested,** because nothing was uploaded.
- **I left two stale lines** ("Nothing is scheduled", "All 18 drafts await review") in the content system's PROJECT-CONTEXT.md, since they aren't mine.

Scratch-only verification files (the harness and its output, the text check, the PDF check, backups of the edited files) are in `C:\Users\RANAZA~1\AppData\Local\Temp\claude\d--My-AI-Works\2e482ace-b0b2-4185-962b-a49ffb3bed17\scratchpad\sr-work\`.