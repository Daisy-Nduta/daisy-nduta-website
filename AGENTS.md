# AGENTS.md

## Scope and architecture

- This is a dependency-free static HTML site. There is no `package.json`, build step, test suite, environment configuration, or deployment configuration.
- `index.html` is the primary landing page. It is self-contained: inline CSS + inline JavaScript provide the five-card 3D carousel and its detailed canvas background. Do not add `script.js` to this file.
- `index2.html` is an unlinked alternative/legacy landing variant. Its intended role is unknown. It duplicates the carousel/background implementation and has different header/logo positioning; avoid modifying or deleting it without explicit direction.
- `about.html`, `partners.html`, `projects.html`, and all five project-detail pages share `style.css` and deferred `script.js`.
- `script.js` creates `#topographic` itself and animates the interior-page canvas. It must be loaded once per interior page.
- Navigation and project metadata are hand-authored and repeated. Landing `.project-card` elements are direct project links. Update every related card/link, detail page, navigation link, browser title, alt text, and carousel entry when changing a project.

## Commands

```sh
# Serve static files locally
python3 -m http.server 8000

# Syntax-check the shared JavaScript, if Node.js is available
node --check script.js
```

No documented build, test, lint, or deployment command exists. Hosting/deployment workflow is unknown; the site only needs static-file hosting with relative paths preserved.

## Visual system: preserve unless explicitly asked to change

- **Font:** Anton everywhere; loaded from Google Fonts. `fonts/Kubeon.otf` and `fonts/Vaelia.otf` are unused local assets.
- **Colour:** body `#fff`, primary text `#201e1f`, supporting text `rgba(32, 30, 31, .68)`, footer via `.58` opacity. There are no CSS variables.
- **Header:** shared interior pages use 52px/32px desktop padding, 170px logo, and 26px nav with a 20px downward offset. Mobile breakpoint is 700px (30px/18px header, 110px logo, 15px nav).
- **Components:** 12px radii, subtle borders, soft shadows; white partner cards; pale-peach image panels; two-column grids that become one column at 700px.
- **Project detail:** desktop image on left, title/description/detail list on right; mobile stacks.
- **Motion:** retain the fixed, pointer-responsive string/topographic canvas background; interior `script.js` is intentionally lighter/denser than the landing’s inline background. The landing carousel has 5-second autoplay, drag/swipe, arrow-key controls, and 2px progress bar.
- **Carousel settings:** preserve the current relative card scale (`sideScale: .82`, `farScale: .62`) unless a carousel design change is requested.

## Content and asset conventions

- Project image mapping: `01` Calotropis, `02` Munyu, `03` Calotropis Archive, `04` unfoldmen II, `05` Sana Sana.
- `placeholder-project-01.html` and `placeholder-project-02.html` are legacy filenames for unfoldmen II and Sana Sana. Keep paths until links are deliberately migrated.
- Existing prompts such as “Tell us about…” are client-facing copy placeholders, not developer notes. Preserve that voice when adding placeholder content.
- Images are large JPEGs displayed with `object-fit: cover`; retain landscape, high-resolution replacements where possible. `logo.png` is transparent and CSS-sized.

## Implementation cautions

- Do not try to centralize landing and interior styles/animation without an explicit refactor request: landing code is intentionally embedded and differs from `style.css`/`script.js`.
- Do not add a second element with `id="topographic"` to interior HTML; `script.js` inserts it.
- Do not use external dependencies for ordinary edits.
- Preserve `aria-current="page"`, image `alt` text, relative URLs, and the manually linked previous/next project sequence.
- The project detail files are currently minified into very long HTML lines, while other files use mixed formatting. Do not reformat unrelated files merely for style.
