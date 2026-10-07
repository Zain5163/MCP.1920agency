Feasibility confirmed: headless Chrome 154 renders the brand HTML to an exact 1080x1350 PNG and a 3-page PDF, with real Geist and Geist Mono (checked in the page itself, against a fallback render, and by eye). No npm dependencies, and no project files were changed. I only wrote files inside `render-test`, and I deleted the throwaway browser profile folders I created there.

## 1. Browsers
- `C:\Program Files\Google\Chrome\Application\chrome.exe`, version 154.0.8037.58. Works.
- `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, version 154.0.4258.48. Works with the same flags for PNG and PDF.
- Missing: `C:\Program Files (x86)\Google\Chrome\...` and `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`.
- Both exes are Windows GUI programs (checked in the file header). This matters for the PowerShell commands in section 4.
- Also available: Node v22.19.0 (has a built-in WebSocket), Python 3.14 with PIL and PyMuPDF, and ffmpeg.

## 2. Geist font files
There is no `geist` package in `node_modules`. `layout.tsx` loads the fonts with `next/font/google` (`Geist`, `Geist_Mono`, `subsets: ["latin"]`), so the usable files are in the build output. I decoded each file with Node's built-in brotli.

**Main source:** `D:\My AI Works\Websites\Zain-Personal-Branding\source\.next\static\media\` (identical copies in `.next\dev\static\media\`). The mapping comes from `.next\static\chunks\3jvdjdn-bwqi5.css`.
- **Geist v1.800**, variable weight 100–900 (default 400, named weights Thin through Black):
  - latin: `caa3a2e1cccd8315-s.p.0wgildi0cnwt9.woff2`
  - latin-ext: `7178b3e590c64307-s.21jp631_3pja2.woff2`
  - vietnamese: `53b9e256198e5412-s.390ncx5urfkfu.woff2`
  - cyrillic: `8a480f0b521d4e75-s.1qq4vpdcun5oj.woff2`
  - cyrillic-ext: `fef07dbb0973bf53-s.3p2_lha1f2xer.woff2`
- **Geist Mono v1.701**, variable weight 100–900:
  - latin: `797e433ab948586e-s.p.0r6juujl39pe6.woff2`
  - latin-ext: `bbc41e54d2fcbd21-s.1rgnod-3esatf.woff2`
  - vietnamese: `7d817b4c03b0c5f1-s.1uyisp29ctx0d.woff2`
  - cyrillic: `4fa387ec64143e14-s.2tuy5pz7dlieh.woff2`
  - cyrillic-ext: `5ce348bf30bf5439-s.31988l_ccedte.woff2`
  - symbols / box-drawing: `6306c77e7c8268e4-s.2dbetqa9o8jxf.woff2`
- These filenames are content hashes and change on a rebuild or clean. I copied the four latin and latin-ext files to stable names in `...\render-test\fonts\` (`Geist-Latin.woff2`, `Geist-LatinExt.woff2`, `GeistMono-Latin.woff2`, `GeistMono-LatinExt.woff2`). The real pipeline should do the same in its own assets folder.

**Other copies:**
- `source\node_modules\next\dist\next-devtools\server\font\geist-latin.woff2`, `geist-latin-ext.woff2`, `geist-mono-latin.woff2`, `geist-mono-latin-ext.woff2`. These are an older Geist v1.401, variable 100–900, with stable names.
- `source\node_modules\next\dist\compiled\@vercel\og\Geist-Regular.ttf`. Geist v1.800, Regular 400 only (not variable). It covers more characters, including the arrows → ← ↗.

**Missing characters:** the Geist and Geist Mono latin files have no → ← ↗ ✓ ₨. Use inline SVG icons, as the site does with Lucide, or a fallback font list.

## 3. Design system, verbatim

**Tokens** (`globals.css` lines 3–29):
```css
:root {
  --brand-teal: #14d1c8;
  --brand-aqua: #44e0fa;
  --brand-sky: #60a5fa;
  --brand-lilac: #c084fc;
  --brand-orchid: #f472b6;
  --brand-white: #ffffff;
  --brand-mist: #aeb6c7;
  --brand-navy: #081b2d;
  --brand-slate: #0b1d33;
  --surface: #0d2238;
  --surface-light: #112b45;
  --line: rgba(255, 255, 255, 0.12);
  --line-bright: rgba(125, 235, 242, 0.28);
  --gradient-brand: linear-gradient(110deg, #14d1c8 0%, #44e0fa 28%, #60a5fa 50%, #c084fc 77%, #f472b6 100%);
  --gradient-glass: linear-gradient(135deg, rgba(255,255,255,.18), rgba(255,255,255,.055));
  --shadow-glass: inset 0 1px 0 rgba(255,255,255,.2), 0 22px 70px rgba(1,12,25,.24);
  --radius-sm: 12px;
  --radius-md: 20px;
  --radius-lg: 28px;
  --shell: 1180px;
}

@theme inline {
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}
```

**Font variables and fallback faces** that `next/font` adds (from the compiled CSS):
```
--font-geist-sans:"Geist", "Geist Fallback"
--font-geist-mono:"Geist Mono", "Geist Mono Fallback"
@font-face{font-family:Geist Fallback;src:local(Arial);ascent-override:95.94%;descent-override:28.16%;line-gap-override:0.0%;size-adjust:104.76%}
@font-face{font-family:Geist Mono Fallback;src:local(Arial);ascent-override:74.67%;descent-override:21.92%;line-gap-override:0.0%;size-adjust:134.59%}
```

**Base and primitives** (lines 31–43, 54, 62–64, 77–78, 85, 87–95, 131, 192):
```css
* { box-sizing: border-box; }
html { scroll-behavior: smooth; background: var(--brand-navy); }
body {
  margin: 0;
  background:
    radial-gradient(circle at 40% -10%, rgba(20,209,200,.11), transparent 28rem),
    var(--brand-navy);
  color: var(--brand-white);
  font-family: var(--font-geist-sans), Inter, Arial, sans-serif;
  font-weight: 420;
  line-height: 1.6;
  overflow-x: hidden;
}
.gradient-text { background: var(--gradient-brand); background-clip: text; -webkit-background-clip: text; color: transparent; }
.brand-mark { display: grid; grid-template-columns: repeat(3, 5px); gap: 2px; align-items: end; width: 20px; height: 22px; transform: skewX(-13deg); }
.brand-mark span { display: block; border-radius: 6px; background: var(--gradient-brand); box-shadow: 0 0 13px rgba(68,224,250,.32); }
.brand-mark span:nth-child(1) { height: 11px; }.brand-mark span:nth-child(2) { height: 20px; }.brand-mark span:nth-child(3) { height: 15px; }
.eyebrow { display: flex; align-items: center; gap: .65rem; margin: 0; color: #98f3ee; font-family: var(--font-geist-mono); font-size: clamp(.66rem, 1vw, .76rem); font-weight: 550; letter-spacing: .16em; text-transform: uppercase; }
.eyebrow::before { content: ""; width: 28px; height: 1px; background: var(--brand-teal); box-shadow: 0 0 8px var(--brand-aqua); }
.service-chip { display: inline-flex; padding: .48rem .78rem; border-radius: 999px; border: 1px solid rgba(255,255,255,.13); background: rgba(255,255,255,.055); color: #cad7df; font-size: .7rem; white-space: nowrap; box-shadow: inset 0 1px 0 rgba(255,255,255,.08); }
.atmosphere { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.atmosphere--compact { border-radius: inherit; }
.glow { position: absolute; filter: blur(40px); border-radius: 50%; opacity: .75; }
.glow--teal { width: 38rem; height: 26rem; left: -14rem; top: 3rem; background: radial-gradient(circle, rgba(20,209,200,.18), transparent 68%); }
.glow--lilac { width: 34rem; height: 28rem; right: -10rem; top: 8rem; background: radial-gradient(circle, rgba(192,132,252,.15), rgba(244,114,182,.06) 42%, transparent 70%); }
.ribbon { position: absolute; border: 1px solid rgba(130,241,240,.26); background: linear-gradient(135deg, rgba(68,224,250,.13), rgba(192,132,252,.08), rgba(255,255,255,.02)); box-shadow: inset 0 1px 0 rgba(255,255,255,.28), 0 0 55px rgba(68,224,250,.08); backdrop-filter: blur(12px); }
.ribbon--one { width: 62vw; height: 23rem; left: -24vw; top: 18%; border-radius: 50%; transform: rotate(-28deg); }
.ribbon--two { width: 60vw; height: 8rem; right: -26vw; bottom: 13%; border-radius: 50%; transform: rotate(21deg); border-color: rgba(192,132,252,.2); }
.orb { position: absolute; width: 10rem; height: 10rem; right: 9%; top: 22%; border-radius: 50%; background: radial-gradient(circle at 30% 25%, rgba(255,255,255,.35), rgba(68,224,250,.1) 30%, rgba(96,165,250,.08) 55%, transparent 70%); border: 1px solid rgba(255,255,255,.15); box-shadow: inset -20px -20px 45px rgba(192,132,252,.08), 0 20px 70px rgba(8,25,49,.4); }
.glass-card { background: var(--gradient-glass); border: 1px solid rgba(255,255,255,.13); box-shadow: var(--shadow-glass); backdrop-filter: blur(22px) saturate(125%); }
.mini-card-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 1rem; }.mini-card-grid .glass-card { padding: 1.5rem; border-radius: var(--radius-md); }.mini-card-grid svg { color: #70e7e3; }.mini-card-grid h3 { margin: 1.7rem 0 .4rem; }.mini-card-grid p { margin: 0; color: #8fa2b1; font-size: .85rem; }
```

**"Atmospheric field" background** (line 190):
```css
.gradient-sample--soft { background: radial-gradient(circle at 15% 20%, rgba(68,224,250,.3), transparent 38%), radial-gradient(circle at 85% 15%, rgba(244,114,182,.18), transparent 34%), linear-gradient(135deg,#0b1d33,#153a62 48%,#6a5aa8); }
```

**Social templates** (line 193 is one line in the source; I only added line breaks between rules):
```css
.social-system { overflow: hidden; }.social-system > .atmosphere { opacity: .7; }.social-system .shell { position: relative; z-index: 2; }
.social-grid { display: grid; grid-template-columns: 1.4fr .8fr .65fr; gap: 1rem; align-items: stretch; }
.linkedin-cover,.social-square,.social-story { position: relative; overflow: hidden; border: 1px solid rgba(255,255,255,.15); border-radius: var(--radius-md); background: linear-gradient(135deg,#0d2c46,#174b68 50%,#6a5a9b); }
.linkedin-cover { min-height: 300px; padding: 1.4rem; display: flex; align-items: flex-end; justify-content: flex-end; }
.linkedin-cover > div:last-child { position: relative; z-index: 2; width: 57%; }
.linkedin-cover h3 { margin: .5rem 0 1rem; font-size: 1.65rem; line-height: 1.05; letter-spacing: -.045em; }
.linkedin-cover small,.social-square small,.social-story small { color: #8ff1ed; font: .55rem var(--font-geist-mono); letter-spacing: .1em; }
.social-cta { position: absolute; left: 1rem; top: 1rem; padding: .35rem .55rem; border: 1px solid rgba(255,255,255,.2); border-radius: 999px; font-size: .47rem; }
.social-ribbon { position: absolute; width: 80%; height: 72%; left: -42%; top: 18%; border: 2px solid rgba(122,241,240,.4); border-radius: 50%; transform: rotate(-24deg); box-shadow: inset 0 0 40px rgba(68,224,250,.13),0 0 40px rgba(192,132,252,.12); }
.social-chips { display: flex; flex-wrap: wrap; gap: .3rem; }
.social-chips span { padding: .25rem .45rem; border: 1px solid rgba(255,255,255,.17); border-radius: 999px; font-size: .42rem; }
.social-square { aspect-ratio: 1; padding: 1.4rem; display: flex; flex-direction: column; justify-content: space-between; }
.social-square h3 { font-size: 1.6rem; line-height: 1.04; letter-spacing: -.045em; }
.social-square > span { width: 38px; height: 38px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.18); border-radius: 50%; }
.social-story { padding: 1rem; display: flex; flex-direction: column; justify-content: space-between; }
.social-story h3 { z-index: 2; font-size: 1.5rem; line-height: 1; letter-spacing: -.045em; }
.story-orb { position: absolute; width: 180px; height: 180px; right: -80px; bottom: -20px; border-radius: 50%; background: radial-gradient(circle at 30% 20%,rgba(255,255,255,.35),rgba(68,224,250,.2) 25%,rgba(192,132,252,.15) 55%,transparent 70%); }
/* responsive pieces (from lines 204/208/212) */
@media (max-width:1024px){ .social-grid { grid-template-columns: 1.3fr .7fr; }.social-story { min-height: 360px; grid-column: 1 / -1; } }
@media (max-width:760px){ .social-grid { grid-template-columns: 1fr; }.linkedin-cover { min-height: 280px; }.linkedin-cover > div:last-child { width: 62%; }.social-square { max-width: 100%; } }
@media (max-width:480px){ .linkedin-cover > div:last-child { width: 70%; }.linkedin-cover h3 { font-size: 1.3rem; }.social-cta { font-size: .4rem; } }
```

**Inherited reset that changes how the templates look:** `globals.css` imports Tailwind 4.3.3, whose base reset sits in `@layer base`. It sets `*{margin:0;padding:0;border:0 solid}` and `h1..h6{font-size:inherit;font-weight:inherit}`. The brand rules have no layer, so they win, but no social rule sets a weight. As a result, every template `h3` renders at **weight 420**, inherited from `body`. The compiled CSS also adds the `-webkit-backdrop-filter` prefix.

**Markup** (`design-system/page.tsx` line 33, JSX verbatim):
```tsx
<section className="section-pad social-system"><Atmosphere compact/><div className="shell"><Reveal className="section-intro"><SectionEyebrow>05 · Social templates</SectionEyebrow><h2>One visual family, <GradientText>many formats.</GradientText></h2></Reveal><div className="social-grid"><article className="linkedin-cover"><div className="social-ribbon"/><span className="social-cta">Book a call in my Featured section</span><div><small>ZAIN USMAN</small><h3>Helping brands build <GradientText>growth systems</GradientText> that scale.</h3><div className="social-chips"><span>Paid Ads</span><span>SEO & AI Search</span><span>Automation</span></div></div></article><article className="social-square"><small>GROWTH SYSTEMS / 01</small><h3>A campaign is an event.<br/><GradientText>A system remembers.</GradientText></h3><span><ArrowUpRight size={18}/></span></article><article className="social-story"><small>STRATEGY · SYSTEMS · SCALE</small><h3>Build the<br/><GradientText>feedback loop.</GradientText></h3><div className="story-orb"/></article></div></div></section>
```

**Components:**
- Atmosphere: `<div className={compact ? "atmosphere atmosphere--compact" : "atmosphere"} aria-hidden="true"><div className="glow glow--teal" /><div className="glow glow--lilac" /><div className="ribbon ribbon--one" /><div className="ribbon ribbon--two" /><div className="orb" /></div>`
- GradientText: `<span className="gradient-text">{children}</span>`
- GlassCard: `<div className={cn("glass-card", className)} {...props} />`
- BrandMark: `<span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>`
- SectionEyebrow: `<p className="eyebrow">`
- ServiceChip: `<span className={cn("service-chip", className)}>`
- Glass card usage: `<GlassCard><Sparkles/><h3>Premium restraint</h3><p>One luminous direction, soft bloom, and deliberate depth.</p></GlassCard>`
- Lucide ArrowUpRight as plain SVG: `<path d="M7 7h10v10"/><path d="M7 17 17 7"/>` (24 viewBox, stroke 2).
- A plain-HTML conversion of all three templates is in `templates-verbatim.html`.

**`brand-tokens.ts`:** colors teal `#14D1C8`, aqua `#44E0FA`, sky `#60A5FA`, lilac `#C084FC`, orchid `#F472B6`, navy `#081B2D`, slate `#0B1D33`, mist `#AEB6C7`, white `#FFFFFF`. Radius sm 12, md 20, lg 28, pill 999. Blur glass 22, strong 40. Shadow glass `"0 18px 60px rgba(1,12,25,.22)"`. Brand gradient is the same as CSS. Glass gradient is `"linear-gradient(135deg, rgba(255,255,255,.18), rgba(255,255,255,.06))"`.

**The glass values disagree in three places:**
- `globals.css` (what the site actually renders): `.18 → .055`, border `.13`.
- `brand-tokens.ts`: `.18 → .06`.
- Blueprint `.glass` recipe: `.18 → .06`, border `rgba(255,255,255,.22)`, shadow `inset 0 1px 0 rgba(255,255,255,.28), 0 18px 60px rgba(1,12,25,.22)`. The blueprint's `--gradient-glass` token itself is `.22 → .06`.

**Written brand rules:**
- **Site Do:** "Lead with outcomes and useful verbs." / "Use whitespace, large type, and a few deliberate shapes." / "Keep teal and aqua visually dominant." / "Make motion subtle and purposeful."
- **Site Don't:** "Fill empty space with badges and decoration." / "Turn the palette into purple neon or cyberpunk." / "Lead with generic job titles or agency slogans." / "Scatter one-off values through the codebase."
- **Color roles:** teal Primary energy, aqua Highlight, sky Cool depth, lilac Premium bridge, orchid Rare accent, navy Deep background, slate Dark surface, mist Supporting copy, white Primary type.
- **Type roles:** Display/650, Heading/620, Body/420, Mono/520.
- **Blueprint social sizes:**
  - LinkedIn square 1080x1080: "Eyebrow -> hook -> one supporting line -> subtle brand shape."
  - LinkedIn carousel 1080x1350: "Hook -> problem -> mechanism -> example/proof -> takeaway -> CTA."
  - Instagram post 1080x1080: "One strong idea; no more than 20-35 words on creative."
  - Story/Reel cover 1080x1920: "2-6 word hook; large type; one gradient object."
  - YouTube thumbnail 1280x720: "1-3 words maximum; strong curiosity; clean image treatment."
  - Presentation 16:9: "Large headline + single idea per slide + brand ribbon/arc."
- **LinkedIn cover:** 1584x396. The left ~42% is a low-information area because the profile photo covers it; the CTA pill goes upper-left. The right ~58% holds the headline, chips and proof line. "Keep all business messaging on the right."
- **Headline:** "Highlight only the key phrase with the brand gradient… Avoid gradient on every word."
- **Colour:** "Do not make the entire background bright cyan, purple, or pink."
- **Lighting:** "One primary luminous direction per composition… soft bloom rather than neon tubes… Avoid heavy black shadows."
- **Copy:** "Lead with the outcome, not the tool… Avoid hollow phrases such as 'unlock your potential'… Prefer verbs such as build, scale, automate, simplify, measure, improve, connect, and grow."
- **Approved lines:** "Helping brands build growth systems that scale." / "Growth systems, not just ad campaigns." / CTA "Book a call in my Featured section" / "Let's build growth." / "Strategy. Systems. Scale."
- **Content limits** (PROJECT-CONTEXT): "Do not invent client names, logos, results, metrics, testimonials… booking links, social URLs, or a production domain."

## 4. Pipeline proof: exact working commands (PowerShell, tested)
```powershell
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$rt = "C:\Users\RANAZA~1\AppData\Local\Temp\claude\d--My-AI-Works\2e482ace-b0b2-4185-962b-a49ffb3bed17\scratchpad\render-test"
$flags = @("--headless=new","--disable-gpu","--hide-scrollbars","--force-device-scale-factor=1","--user-data-dir=$rt\chrome-profile","--no-first-run","--no-default-browser-check","--disable-extensions","--log-level=3","--virtual-time-budget=5000")
$url = ([System.Uri]"$rt\carousel-test.html").AbsoluteUri    # encodes spaces as %20
& $chrome @flags --window-size=1080,1350 "--screenshot=$rt\carousel-slide-1.png" "$url`?slide=1" | Out-String
& $chrome @flags --no-pdf-header-footer "--print-to-pdf=$rt\carousel.pdf" $url | Out-String
```
The page CSS uses `@page { size: 1080px 1350px; margin: 0 }` and `.slide { width:1080px; height:1350px; break-after: page }`. The CLI respects that page size, and backgrounds print without `print-color-adjust` (kept anyway).

**What each flag is for:**
- `--window-size` plus `--force-device-scale-factor=1` give the exact pixel size. A scale factor of 2 gives 2160x2700.
- `--hide-scrollbars` is needed when the file is taller than the viewport.
- `--virtual-time-budget` did not change the static PNG (identical pixels with and without). It is required for anything async: without it, `--dump-dom` showed my script's `document.fonts.ready` result was not set yet.
- `--run-all-compositor-stages-before-draw` made no difference (identical pixels). Not needed.
- `--disable-gpu` makes output repeatable. With the GPU on, a fresh profile and a reused profile gave slightly different pixels in blurred areas (max channel difference 32). With `--disable-gpu`, fresh and reused profiles gave identical files.
- Plain `--headless` behaves the same as `--headless=new` in Chrome 154.
- Timing: about 3–5 s per PNG launch and 9–10 s per PDF.

**Results checked:**
- PNG: System.Drawing reports 1080 x 1350, 96 dpi, 24-bit; PIL reports (1080, 1350) RGB.
- PDF: PyMuPDF reports 3 pages; the raw bytes contain `/Count 3` and `/MediaBox [0 0 810 1013.03998]` on each page.
- Per-slide PNGs made with `?slide=N` are 1080x1350.

**Geist really rendered:**
- The page's own font status, read with `--dump-dom` from Git Bash, was `faces=Geist|100 900|loaded;…;Geist Mono|100 900|loaded`. Measured headline width was 1792.8 px.
- With the font file deliberately missing, the width became 1924.3 px, the eyebrow turned into proportional Arial, and the headline line breaks changed. About 607,000 pixels differed.
- The font loads the same three ways, with pixel-identical results: a relative path, an absolute `file:///D:/My%20AI%20Works/...` path on another drive, and base64 embedded in the HTML. There is no cross-origin block for local fonts.

**What the PNG looks like** (viewed): dark navy canvas with a soft teal glow top-left and lilac lower-right, faint aqua ribbon arcs and a glass orb.
- The brand mark and "Zain Usman / GROWTH SYSTEMS" sit top-left, with "01 / 01" in monospaced Geist Mono top-right.
- A teal mono eyebrow sits above the 116 px Geist 650 headline, which has tight tracking; "growth systems" carries the teal→aqua→sky→lilac→orchid gradient.
- Below it is a glass card that visibly blurs the orb behind it, with a gradient second line, then five pill chips.
- In the PDF, Geist is embedded as Type3 fonts and the text can still be selected and searched.

**One launch, many renders:** `render-cdp.mjs` (Node built-ins only) uses the DevTools protocol. It waits on `document.fonts.ready`. It produced 3 PNGs and 2 PDFs in 17.6 s, and its PNGs are pixel-identical to the command-line ones.

## 5. Failures and workarounds
1. **PowerShell doesn't wait for Chrome** because it is a GUI program. `$x = & chrome --dump-dom` came back empty, and so did `> file`, `Start-Process -RedirectStandardOutput` and `cmd /c … > file` (0 bytes). The next run then exited with code 21 because the first one was still holding the profile. Fix: always pipe, e.g. `& $chrome … | Out-String`, or use Git Bash with `> file`, or the DevTools script.
2. **Two runs sharing one `--user-data-dir` at the same time:** the second exits with code 21 and writes nothing. Fix: one profile folder per parallel worker, or run them one after another.
3. **The PDF ignores `backdrop-filter`.** On slide 2 the ribbon shows through the glass cards in the PDF, while the PNG blurs it. Blurred glows are also turned into large images, making the PDF 3.0 MB. Fix: build the PDF from the PNGs. `carousel-from-png.html` produces a 1.23 MB PDF whose pages are identical to the PNGs.
4. **PDF page height is 1013.04 pt instead of 1012.5 pt**, because Chrome rounds up to 1/100 inch. The same happens through the DevTools route with paper size in inches. Fix without dependencies: replace `/MediaBox [0 0 810 1013.03998]` with `/MediaBox [0 .54 810 1013.04 ]`, which is the same length so the PDF stays valid. Verified: exactly 810 x 1012.5 pt and identical to the PNGs. PyMuPDF `set_mediabox` also works.
5. **Missing arrow character:** "→" fell back to Times New Roman Bold in the PDF. Fix: inline SVG arrows, and always end font lists with `"Geist Fallback", Arial, sans-serif` and `"Geist Mono Fallback", ui-monospace, monospace`.
6. **The site's social templates are small previews**, not real sizes (a cover box of about 565x300, not 4:1). Using the verbatim CSS with `zoom: 3` on a 360 px box gives a clean 1080x1080 square. `zoom: 2` on a 792x198 box gives a clean 1584x396 cover. The 1080x1920 story renders correctly but the hook is far too small for that size and needs a larger `h3`.
7. **Minor:** in a 1x PyMuPDF raster of the vector PDF, a faint hairline appears under gradient text. It is gone at 4x zoom and absent in the PNG. A cold profile prints harmless extension and registry errors; `--disable-extensions --log-level=3` hides them.

## Files
All in `C:\Users\RANAZA~1\AppData\Local\Temp\claude\d--My-AI-Works\2e482ace-b0b2-4185-962b-a49ffb3bed17\scratchpad\render-test\`:
- Test pages: `social-test.html`, `carousel-test.html`, `carousel-from-png.html`, `templates-verbatim.html`
- PNG renders: `social-test-vtb.png`, `run-nogpu-freshprofile.png`, `carousel-slide-1.png` to `carousel-slide-3.png`, `tpl-square.png`, `tpl-story.png`, `tpl-cover.png`, `compare-geist-vs-fallback.png`
- PDFs: `carousel.pdf`, `carousel-image.pdf`, `carousel-image-patched.pdf`
- Scripts: `render-cdp.mjs`, `inspect-fonts.js`, `check-glyphs.js`, `make-variants.js`
- Fonts: `fonts\Geist-Latin.woff2`, `fonts\Geist-LatinExt.woff2`, `fonts\GeistMono-Latin.woff2`, `fonts\GeistMono-LatinExt.woff2`