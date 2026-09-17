# Frequency Shift

Frequency Shift is a static portfolio website for an online radio platform and creative community based at The Mall, Westlands, Nairobi, Kenya. It presents the organisation, cultural partners, and a small project archive through an animated landing carousel and content-focused interior pages.

There is no application server, database, package manager, build step, or framework. The site is plain HTML, CSS, and browser JavaScript, so it can be hosted as static files.

## Features

- Full-screen landing page with a five-project 3D carousel whose cards link directly to their project pages.
- Pointer drag, touch swipe, keyboard-arrow, and five-second autoplay carousel controls.
- Animated canvas background on every page. The background resembles moving vertical strings/topographic contours and responds subtly to pointer position.
- About, Partners, project archive, and five individual project-detail pages.
- Responsive layouts for screens at or below 700px wide.
- Shared top navigation, project navigation, accessible image alt text, page titles, and mailto links.

## Project structure

```text
.
├── index.html                     # Main landing page; carousel and its own inline CSS/JS
├── index2.html                    # Unlinked alternate landing-page variant
├── about.html                     # About page
├── partners.html                  # Partners page
├── projects.html                  # Two-column project archive
├── calotropis.html                # Project detail page
├── munyu.html                     # Project detail page
├── calotropis-archive.html        # Project detail page
├── placeholder-project-01.html    # Detail page for unfoldmen II (legacy filename)
├── placeholder-project-02.html    # Detail page for Sana Sana (legacy filename)
├── style.css                      # Shared styling for all non-landing pages
├── script.js                      # Shared animated canvas background for non-landing pages
├── fonts/
│   ├── Kubeon.otf                 # Local asset; not currently referenced by CSS
│   └── Vaelia.otf                 # Local asset; not currently referenced by CSS
└── images/
    ├── logo.png                   # Primary logo image
    ├── favicon.ico                # Favicon
    └── 01.jpg … 05.jpg            # Project imagery
```

## Pages and content

The primary navigation links to:

- `index.html` — landing page
- `about.html` — organisation overview and contact information
- `projects.html` — project archive
- `partners.html` — cultural partners and enquiry contact

The project archive manually maps images and destination pages as follows:

| Image | Project | Detail page |
| --- | --- | --- |
| `images/01.jpg` | Calotropis | `calotropis.html` |
| `images/02.jpg` | Munyu | `munyu.html` |
| `images/03.jpg` | Calotropis Archive | `calotropis-archive.html` |
| `images/04.jpg` | unfoldmen II | `placeholder-project-01.html` |
| `images/05.jpg` | Sana Sana | `placeholder-project-02.html` |

Some partner and project-detail copy intentionally remains as client-facing prompts (for example, “Tell us about…”). These are content placeholders, not runtime-generated fields.

## Technology and dependencies

- HTML5
- CSS3, including Grid, Flexbox, `clamp()`, media queries, transforms, and transitions
- Vanilla browser JavaScript
- Canvas 2D API and `requestAnimationFrame()`
- Google Fonts: Anton, loaded from `fonts.googleapis.com`

There are no npm dependencies, lockfiles, build scripts, package manifests, test runners, or configuration files in the repository. The local `fonts/Kubeon.otf` and `fonts/Vaelia.otf` files are available assets but are not currently loaded or used; all visible site typography uses Anton with `Impact, sans-serif` as its CSS fallback.

## Run locally

No installation is required. Open `index.html` directly in a browser, or serve the directory with any static HTTP server. For example, with Python 3:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000/`.

Using a local server is preferable when checking browser behavior and cross-page navigation. There is no automated test suite. A basic JavaScript syntax check for the shared background script is available when Node.js is installed:

```sh
node --check script.js
```

## Visual system

### Typography and colour

- Anton is the site-wide display and body typeface.
- Primary text is `#201e1f` on white (`#fff`).
- Supporting copy, labels, project metadata, and email links use `rgba(32, 30, 31, .68)`; footer text is slightly lighter through `opacity: .58`.
- Large page headings are uppercase, `font-weight: 400`, with a tight `.83` line-height and `font-size: clamp(52px, 10vw, 142px)`.
- Desktop navigation is uppercase Anton at `26px`; mobile navigation is `15px`.
- Small labels use uppercase text at `11px` with `.08em` letter spacing.

### Layout and spacing

- The shared header has `52px 32px` desktop padding, a `170px` logo, and navigation offset by `20px` to sit lower without moving the logo. On mobile it uses `30px 18px`, a `110px` logo, and a `10px` navigation offset.
- Non-landing content is constrained to `min(1200px, calc(100% - 64px))`; the mobile inset is 18px per side.
- Interior layouts switch at `700px` to a single column.
- Rounded panels/cards use a `12px` radius, subtle border, and soft `0 18px 45px rgba(0, 0, 0, .08)` shadow. Partner cards are intentionally white; image panels retain a pale peach `#fff0e7` background.

### Major components

- **Landing carousel:** A fixed, full-height 3D turntable of project cards. The active card is frontmost; nearby cards are scaled, rotated, dimmed, and placed behind it. A two-pixel progress bar sits at the bottom.
- **Projects archive:** A two-column grid of linked image cards that stacks on mobile. Card images use a 1.16:1 aspect ratio and scale slightly on hover.
- **Project detail:** On desktop, the image occupies the left column while title, description, metadata, and credits sit in the right column. It stacks on mobile.
- **Partners:** A two-column grid of white cultural-partner cards with top-aligned label, name, and description.
- **Background:** Every page has fixed, non-interactive canvas strings behind page content. Interior pages create this canvas through `script.js`; the landing page has a separate, more elaborate inline canvas implementation.

### Assets

Project images are large JPEG source files. `01.jpg` is 3680×2760; `02.jpg` through `05.jpg` are 6000×3376. They are displayed with `object-fit: cover`, so replacing them with similarly high-resolution landscape images will preserve the intended crop. `logo.png` is a large transparent PNG (7431×4831) and is sized through CSS rather than resized on disk.

There are no CSS custom properties (`--*` variables) in the current codebase; visual values are explicit in `style.css` and, separately, in the inline landing styles.

## Important implementation details

### Landing page

`index.html` is self-contained: its CSS and JavaScript are embedded directly in the file. It does **not** load `style.css` or `script.js`.

Its carousel is driven by the inline `projects` array and by the five `.glide__slide` elements. Each `.project-card` is also a direct link to its project-detail page. Keep card links, the slides, and the `projects` array in the same order and count when adding, removing, or reordering landing projects. The current turntable settings are:

```js
{ spread: 200, depth: 240, rotation: 34,
  sideScale: 0.82, farScale: 0.62,
  sideOpacity: 0.72, verticalCurve: 18 }
```

The carousel supports pointer drag, touch swipe, left/right arrow keys, and a five-second interval. Its inline canvas animation intentionally differs from the shared interior background: it uses more points and a more complex moving contour field.

`index2.html` is a separate, unlinked alternate version of the landing page. It duplicates the inline carousel and background code but has different header/logo treatment and a few layout differences. Its intended production role is not documented in the repository; treat it as an alternate/prototype unless the project owner specifies otherwise.

### Interior pages

All non-landing pages load `style.css` and defer `script.js`. The script creates a `<canvas id="topographic">` at the beginning of the body, sizes it for the device pixel ratio (capped at 2), and continuously redraws the animated lines. Do not also load `script.js` on `index.html` or `index2.html`: each already owns a canvas and a separate animation loop.

Navigation, project cards, and individual project pages are hand-authored HTML. There is no data source or templating layer, so changing a project title, URL, year, location, image, or sequence requires updating each relevant page manually.

## Configuration and deployment

No runtime configuration, environment variables, build configuration, or deployment configuration is present.

The project can be deployed to any static-file host by publishing the repository contents while preserving the relative `images/`, `fonts/`, `style.css`, and `script.js` paths. The actual hosting provider and deployment workflow are unknown from this repository.

## Working on the site

- Preserve the direct relative paths; all navigation and assets depend on them.
- Keep `aria-current="page"` on the active navigation link when adding or editing pages.
- Maintain the established visual system unless a design change is requested, especially the Anton-only typography, generous header placement, muted supporting text, white partner cards, rounded project cards, and animated string background.
- Do not rename the two legacy `placeholder-project-*.html` files without updating links in `projects.html` and adjacent project navigation.
- Avoid adding tooling or a framework only to make a small content or styling edit; the existing site is deliberately static.
