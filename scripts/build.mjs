#!/usr/bin/env node
/**
 * Reads content/ (Decap-CMS-managed data) and writes every static HTML
 * page in the repo root. Run via `npm run build`, or automatically by
 * `server.mjs` while `npm run cms` is running. Do not hand-edit the
 * generated .html files -- edit content/ (via the CMS or directly) and
 * rebuild instead. See AGENTS.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { RESERVED_PAGE_SLUGS, DEFAULT_ACCENT_COLOR, GOATCOUNTER_SITE } from './schema.mjs';
import { ensureImageVariants, readImageManifest } from './images.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CONTENT = path.join(ROOT, 'content');

// Recomputed at the top of build() once client-added pages (content/sections/pages/)
// are known, so it includes them between Art & Culture Projects and About. header()
// reads this module-level binding, so it must be set before any page is generated.
let NAV_ITEMS = [
    ['sound.html', 'Sound'],
    ['curation-production.html', 'Production & Curation'],
    ['cultural-projects.html', 'Art & Culture Projects'],
    ['about.html', 'About'],
    ['contact.html', 'Contact']
];

// The site's highlight/hover color -- editable from the CMS (Site Settings)
// via content/pages/settings.json, read fresh at the top of build() below.
// head() reads this module-level binding the same way it reads NAV_ITEMS.
let ACCENT_COLOR = DEFAULT_ACCENT_COLOR;

// The live site's address -- used for absolute URLs in link-preview tags,
// canonical links, and sitemap.xml (all of which need full URLs).
const SITE_URL = 'https://daisynduta.com';

// Resized copies of uploaded photos (scripts/images.mjs), read fresh at the
// top of build(), plus the fallback link-preview image (the first Home card
// photo) for pages that have no photo of their own.
let IMAGE_MANIFEST = {};
let DEFAULT_SHARE_IMAGE = '';
let HOME_CARDS = [];

// A Home card's photo (single `image`, or the first of `images`), used as
// the link-preview picture for the section page that card leads to.
function homeCardImage(key) {
    const card = HOME_CARDS.find(c => c.key === key);
    if (!card) return '';
    return Array.isArray(card.images) ? card.images.filter(Boolean)[0] || '' : card.image || '';
}

// How wide each kind of image slot is actually displayed, so the browser
// can pick the smallest resized copy that still looks sharp.
const IMAGE_SIZES = {
    itemCard: '(max-width: 700px) 100vw, 400px',
    entryCard: '(max-width: 700px) 92vw, 560px',
    gallery: '(max-width: 700px) 82vw, 680px',
    portrait: '(max-width: 700px) 100vw, 600px'
};

// folder key (content/sections/<key>/) -> where it lives on the site
const TOP_SECTIONS = {
    film: { page: 'sound.html', breadcrumb: 'Sound → Film', backHref: 'sound.html#film', backLabel: 'Sound → Film', bg: 'sound' },
    broadcast: { page: 'sound.html', breadcrumb: 'Sound → Broadcast', backHref: 'sound.html#broadcast', backLabel: 'Sound → Broadcast', bg: 'sound' },
    live: { page: 'sound.html', breadcrumb: 'Sound → Live', backHref: 'sound.html#live', backLabel: 'Sound → Live', bg: 'sound' },
    studio: { page: 'sound.html', breadcrumb: 'Sound → Studio', backHref: 'sound.html#studio', backLabel: 'Sound → Studio', bg: 'sound' },
    curation: { page: 'curation-production.html', breadcrumb: 'Production & Curation', backHref: 'curation-production.html', backLabel: 'Production & Curation', bg: 'curation' },
    cultural: { page: 'cultural-projects.html', breadcrumb: 'Art & Culture Projects', backHref: 'cultural-projects.html', backLabel: 'Art & Culture Projects', bg: 'cultural' }
};

const SOUND_SUBSECTIONS = [
    ['film', 'Film'],
    ['broadcast', 'Broadcast'],
    ['live', 'Live'],
    ['studio', 'Studio']
];

// The card "go to" arrow used to be a plain "↗" character. Some mobile
// browsers substitute an unrelated character (or their own default glyph,
// e.g. a generic blue icon) for arrow symbols instead of using the site's
// own type/colors -- an inline SVG with stroke="currentColor" always
// renders identically and always tracks the element's own CSS color
// (including the accent-on-hover rules), regardless of platform/font.
const ARROW_ICON =
    '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"></line><polyline points="7 7 17 7 17 17"></polyline></svg>';

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Baked-in accent highlight for card titles: wraps the last word of any
// multi-word title in <span class="accent">. Single-word titles are left
// alone -- that's deliberate (see AGENTS.md), not every card should get
// the highlight, only ones where "last word" reads naturally.
function accentLastWord(rawTitle) {
    const words = String(rawTitle ?? '').trim().split(/\s+/);
    if (words.length < 2) return escapeHtml(rawTitle);
    const last = words.pop();
    return `${escapeHtml(words.join(' '))} <span class="accent">${escapeHtml(last)}</span>`;
}

// Subheadings (.section h2 across Sound's subsections, About, Contact) get
// the full heading accented, not just the last word -- they're short
// category labels, not sentences, and this is what gives the accent real
// presence "across the pages" rather than being confined to hero lines.
function accentFull(text) {
    return `<span class="accent">${escapeHtml(text)}</span>`;
}

// Baked-in accent highlight for select phrases within a longer body-copy
// string (e.g. About's bio paragraphs). Only wraps the FIRST occurrence of
// each phrase, so a repeated word doesn't get highlighted every time.
// Operates on the raw text and escapes segments individually (rather than
// escaping first and then substring-matching) so phrases containing "&"
// still match correctly.
function applyAccents(rawText, phrases) {
    let segments = [{ text: String(rawText ?? ''), accent: false }];
    (phrases || []).forEach(phrase => {
        const next = [];
        segments.forEach(seg => {
            if (seg.accent) {
                next.push(seg);
                return;
            }
            const idx = seg.text.indexOf(phrase);
            if (idx === -1) {
                next.push(seg);
                return;
            }
            const before = seg.text.slice(0, idx);
            const match = seg.text.slice(idx, idx + phrase.length);
            const after = seg.text.slice(idx + phrase.length);
            if (before) next.push({ text: before, accent: false });
            next.push({ text: match, accent: true });
            if (after) next.push({ text: after, accent: false });
        });
        segments = next;
    });
    return segments.map(seg => (seg.accent ? `<span class="accent">${escapeHtml(seg.text)}</span>` : escapeHtml(seg.text))).join('');
}

function readJson(relPath) {
    return JSON.parse(fs.readFileSync(path.join(CONTENT, relPath), 'utf8'));
}

function readFolder(key) {
    const dir = path.join(CONTENT, 'sections', key);
    if (!fs.existsSync(dir)) return [];
    return fs
        .readdirSync(dir)
        .filter(name => name.endsWith('.md'))
        .map(name => {
            const slug = name.replace(/\.md$/, '');
            const { data, content } = matter(fs.readFileSync(path.join(dir, name), 'utf8'));
            return { ...data, slug, folder: key, copy: content.trim() };
        })
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function chain(items) {
    const n = items.length;
    items.forEach((item, i) => {
        item.prev = n > 1 ? items[(i - 1 + n) % n] : null;
        item.next = n > 1 ? items[(i + 1) % n] : null;
    });
}

// `page` is the generated file's name ('' for the home page); `image` is an
// optional images/uploads/... path used as that page's link-preview picture.
function head(title, description, page = '', image = '') {
    const url = `${SITE_URL}/${page}`;
    const shareImage = shareImageUrl(image || DEFAULT_SHARE_IMAGE);
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  <title>${escapeHtml(title)}</title>
  <link rel="canonical" href="${escapeHtml(url)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Daisy Nduta">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(url)}">${shareImage ? `
  <meta property="og:image" content="${escapeHtml(shareImage)}">` : ''}
  <meta name="twitter:card" content="${shareImage ? 'summary_large_image' : 'summary'}">
  <link rel="icon" href="images/favicon.ico" sizes="any">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&display=swap">
  <link rel="stylesheet" href="style.css">
  <style>:root{--accent:${ACCENT_COLOR};}</style>
  <script src="script.js" defer></script>
  <script data-goatcounter="${GOATCOUNTER_SITE}/count" async src="https://gc.zgo.at/count.js"></script>
</head>
`;
}

function header(currentHref) {
    const links = NAV_ITEMS.map(([href, label]) => {
        const current = href === currentHref ? ' aria-current="page"' : '';
        return `      <a href="${href}"${current}>${escapeHtml(label)}</a>`;
    }).join('\n');
    return `<header class="site-header">
    <a class="site-title" href="index.html" aria-label="Daisy Nduta home">Daisy<br>${accentFull('Nduta')}</a>
    <nav class="site-nav" aria-label="Primary navigation">
${links}
    </nav>
  </header>`;
}

// Year is computed at build time, not hardcoded -- rebuilding the site next
// year (or any year after) picks up the current year automatically.
const FOOTER = `<footer class="page-footer">Daisy Nduta ${new Date().getFullYear()}</footer>`;

function detailList(details) {
    const rows = (details || [])
        .map(({ label, value }) => `        <li><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></li>`)
        .join('\n');
    return `      <ul class="detail-list">\n${rows}\n      </ul>`;
}

// srcset/sizes for an uploaded photo, from its resized copies (see
// scripts/images.mjs). Photos without copies (GIFs, or ones smaller than
// the smallest copy) just get a plain src.
function srcsetFor(src) {
    const entry = IMAGE_MANIFEST[String(src).replace(/^images\/uploads\//, '')];
    if (!entry || !Object.keys(entry.variants).length) return '';
    return [...Object.entries(entry.variants).map(([w, rel]) => `${rel} ${w}w`), `${src} ${entry.width}w`].join(', ');
}

// Attributes for one <img>. Images that start off-screen get
// loading="lazy" so they're only fetched as the visitor scrolls to them.
function imgAttrs(src, alt, sizes, { lazy = true } = {}) {
    const srcset = srcsetFor(src);
    return `src="${escapeHtml(src)}"${srcset ? ` srcset="${escapeHtml(srcset)}" sizes="${sizes}"` : ''} alt="${escapeHtml(alt)}"${lazy ? ' loading="lazy"' : ''} decoding="async"`;
}

// Absolute URL for a link-preview image -- the 1400px copy when there is
// one (plenty for previews, much lighter than the original).
function shareImageUrl(src) {
    if (!src) return '';
    const entry = IMAGE_MANIFEST[String(src).replace(/^images\/uploads\//, '')];
    const rel = (entry && (entry.variants[1400] || entry.variants[800])) || src;
    return `${SITE_URL}/${rel}`;
}

// Plain-text page description for search results and link previews: the
// start of the item's own write-up, unless it's still the "Tell us
// about..." placeholder, in which case the card summary.
function describe(copy, fallback) {
    const text = String(copy || '').replace(/\s+/g, ' ').trim();
    if (!text || /^Tell us about/i.test(text)) return fallback;
    if (text.length <= 160) return text;
    return `${text.slice(0, 157).replace(/\s+\S*$/, '')}…`;
}

function mediaBlock(className, image, alt, sizes, options) {
    if (image) {
        return `<div class="${className}"><img ${imgAttrs(image, alt, sizes, options)}></div>`;
    }
    return `<div class="${className}"><p>Image — pending</p></div>`;
}

// Home's About/Contact cards can carry several client-uploaded images
// instead of the single fixed hero shot the other 3 cards use -- one is
// picked at random client-side (script.js) on each page load, via a
// data-images attribute baked in here whenever there's more than one.
// Falls back to a plain mediaBlock() for cards still using the older
// single `image` string field.
function entryCardMedia(card) {
    if (!Array.isArray(card.images)) {
        return mediaBlock('entry-card__media', card.image, card.title, IMAGE_SIZES.entryCard, { lazy: false });
    }
    const list = card.images.filter(Boolean);
    if (list.length === 0) {
        return `<div class="entry-card__media"><p>Image — pending</p></div>`;
    }
    // Each option carries its own srcset, so script.js can swap both.
    const options = list.map(src => ({ src, srcset: srcsetFor(src) }));
    const dataAttr = list.length > 1 ? ` data-images="${escapeHtml(JSON.stringify(options))}"` : '';
    return `<div class="entry-card__media"><img ${imgAttrs(list[0], card.title, IMAGE_SIZES.entryCard, { lazy: false })}${dataAttr}></div>`;
}

// A credit/project or client-added page can carry several images now (a
// simple side-scrolling row, not a click-to-swap gallery -- see AGENTS.md).
// Card grids still only ever show one representative thumbnail per item
// (mediaBlock() above, fed the first image) -- this is only for the
// item/page's own detail page, where all of them are shown.
function imageGallery(images, alt, pendingText) {
    const list = (images || []).filter(Boolean);
    if (list.length === 0) {
        return `<figure class="image-panel"><p>${escapeHtml(pendingText)}</p></figure>`;
    }
    // The first photo is at the top of the page; the rest are further along
    // the side-scrolling row, so they can wait until needed.
    const imgs = list.map((src, i) => `<img ${imgAttrs(src, alt, IMAGE_SIZES.gallery, { lazy: i > 0 })}>`).join('\n        ');
    return `<div class="image-gallery">\n        ${imgs}\n      </div>`;
}

function itemCard(item) {
    return `      <a class="item-card" href="${item.slug}.html">
        ${mediaBlock('item-card__media', (item.images || [])[0], item.title, IMAGE_SIZES.itemCard)}
        <div class="item-card__body">
          <p class="label">${escapeHtml(item.cardLabel)}</p>
          <h3>${accentLastWord(item.title)}</h3>
          <p class="item-card__meta">${escapeHtml(item.cardSummary)}</p>
        </div>
        <span class="item-card__arrow" aria-hidden="true">${ARROW_ICON}</span>
      </a>`;
}

function itemPage(item) {
    const section = TOP_SECTIONS[item.folder];
    const figure = imageGallery(item.images, item.title, 'Image / reel — pending');

    let crossHtml = '';
    if (item.crossListedHref) {
        crossHtml = `\n      <p class="cross-listed">${escapeHtml(item.crossListedLabel)} <a class="placeholder" href="${item.crossListedHref}"${externalAttrs(item.crossListedHref)}>${escapeHtml(item.crossListedText)}</a></p>`;
    }

    // Optional link out to the finished work itself, wherever it's actually
    // hosted (Vimeo, YouTube, an article, etc.) -- client: "the ones that
    // are online can be linked." Only rendered when set; nothing changes
    // for items that don't have one yet.
    const linkHtml = item.link
        ? `\n    <p class="project-link"><a class="placeholder" href="${escapeHtml(item.link)}"${externalAttrs(item.link)}>View online →</a></p>`
        : '';

    const navLinks = [`<a href="${section.backHref}">← ${escapeHtml(section.backLabel)}</a>`];
    if (item.prev) navLinks.push(`<a href="${item.prev.slug}.html">← ${escapeHtml(item.prev.title)}</a>`);
    if (item.next) navLinks.push(`<a href="${item.next.slug}.html">${escapeHtml(item.next.title)} →</a>`);

    return (
        head(
            `${item.title} — Daisy Nduta`,
            describe(item.copy, item.cardSummary ? `${item.title} — ${item.cardSummary}` : `${item.title} — ${section.breadcrumb} — Daisy Nduta.`),
            `${item.slug}.html`,
            (item.images || [])[0]
        ) +
        `<body data-bg="${section.bg}">
  ${header(section.page)}
  <main class="page project-page">
    <p class="eyebrow">${escapeHtml(section.breadcrumb)}</p>
    <h1>${escapeHtml(item.title)}</h1>
    ${figure}
    <div class="project-copy">
${projectParagraphs(item.copy)}
    </div>${linkHtml}
${detailList(item.details)}${crossHtml}
    <nav class="project-navigation" aria-label="Project navigation">
        ${navLinks.join('\n        ')}
    </nav>
    ${FOOTER}
  </main>
</body>
</html>
`
    );
}

/** Items whose card belongs on `key`'s grid: native to that folder, or opted in via alsoShowOn. */
function gatherCards(allFoldersData, key) {
    const native = allFoldersData[key] || [];
    const guests = [];
    const guestGroups = new Map(); // target page href -> { label, page, titles: [] }

    Object.entries(allFoldersData).forEach(([folderKey, items]) => {
        if (folderKey === key) return;
        items.forEach(item => {
            if (item.alsoShowOn !== key) return;
            guests.push(item);
            const home = TOP_SECTIONS[folderKey];
            const bucket = guestGroups.get(home.page) || { label: home.breadcrumb, page: home.page, titles: [] };
            bucket.titles.push(item.title);
            guestGroups.set(home.page, bucket);
        });
    });

    const cards = [...native, ...guests].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    let note = '';
    if (guestGroups.size > 0) {
        const sentences = [...guestGroups.values()].map(({ label, page, titles }) => {
            const names = titles.length > 1 ? `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}` : titles[0];
            const verb = titles.length > 1 ? 'also appear' : 'also appears';
            return `${escapeHtml(names)} ${verb} under <a class="placeholder" href="${page}">${escapeHtml(label)}</a>.`;
        });
        note = `\n      <p class="cross-listed">${sentences.join(' ')}</p>`;
    }

    return { cards, note };
}

// Client-authored pages store body copy as one plain-text blob (not an
// array of paragraphs like About's structured JSON) -- split on blank
// lines so a page can still read as more than one paragraph.
// A project description is split on *any* line break, not just blank lines
// (unlike client Pages below) -- the client separates paragraphs with a
// single Enter in the admin textarea as often as with a blank line.
function projectParagraphs(text) {
    return String(text ?? '')
        .split(/\n+/)
        .map(p => p.trim())
        .filter(Boolean)
        .map(p => `        <p>${escapeHtml(p)}</p>`)
        .join('\n');
}

// Client-entered links to other sites open in a new tab so visitors don't
// lose their place on the portfolio. Internal .html links and mailto:/tel:
// stay as normal same-tab links.
function externalAttrs(url) {
    return /^https?:\/\//i.test(String(url ?? '').trim())
        ? ' target="_blank" rel="noopener noreferrer"'
        : '';
}

function paragraphsFromBody(text) {
    return String(text ?? '')
        .split(/\n\s*\n/)
        .map(p => p.trim())
        .filter(Boolean)
        .map(p => `        <p class="copy">${escapeHtml(p)}</p>`)
        .join('\n');
}

function customPageHtml(page) {
    const images = (page.images || []).filter(Boolean);
    const figure = images.length ? imageGallery(images, page.title, '') : '';
    const body = paragraphsFromBody(page.copy) || '        <p class="copy">Content coming soon.</p>';
    return (
        head(`${page.title} — Daisy Nduta`, describe(page.copy, `${page.title} — Daisy Nduta.`), `${page.slug}.html`, images[0]) +
        `<body>
  ${header(`${page.slug}.html`)}
  <main class="page">
    <h1>${escapeHtml(page.title)}</h1>
    ${figure}
${body}
    ${FOOTER}
  </main>
</body>
</html>
`
    );
}

function write(relPath, content) {
    fs.writeFileSync(path.join(ROOT, relPath), content);
}

// Tracks which item-detail pages *this script* generated, so that deleting
// a content file (e.g. from the CMS) removes its stale .html output too,
// instead of leaving an orphaned, unlinked-but-still-live page behind.
// Only ever touches files this manifest itself listed -- never anything
// else in the repo root.
const MANIFEST_PATH = path.join(ROOT, '.build-manifest.json');

function cleanupOrphans(currentSlugs) {
    let previous = [];
    try {
        previous = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')).generatedFiles || [];
    } catch {
        previous = [];
    }

    const current = new Set(currentSlugs.map(slug => `${slug}.html`));
    previous.forEach(file => {
        if (current.has(file)) return;
        const filePath = path.join(ROOT, file);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`Removed orphaned page: ${file}`);
        }
    });

    fs.writeFileSync(MANIFEST_PATH, JSON.stringify({ generatedFiles: [...current] }, null, 2));
}

function build() {
    // Site-wide highlight color, editable from the CMS (Site Settings).
    // Falls back to the built-in default if the file's missing (a fresh
    // checkout before the first build) or its value isn't a valid 6-digit
    // hex -- a bad value here would otherwise silently break the accent
    // color across every generated page.
    let settings = {};
    try {
        settings = readJson('pages/settings.json');
    } catch {
        settings = {};
    }
    ACCENT_COLOR = /^#[0-9a-fA-F]{6}$/.test(settings.accentColor || '') ? settings.accentColor : DEFAULT_ACCENT_COLOR;

    IMAGE_MANIFEST = readImageManifest(ROOT);
    HOME_CARDS = readJson('pages/home.json').cards || [];
    DEFAULT_SHARE_IMAGE = HOME_CARDS.map(c => homeCardImage(c.key)).find(Boolean) || '';

    // Client-added top-level pages (content/sections/pages/) -- a plain
    // folder collection like film/broadcast/etc, just with a different field
    // shape (see schema.mjs). Reserved slugs are skipped defensively: the
    // admin API already blocks creating one, but hand-edited content could
    // still introduce one, and silently overwriting sound.html etc. would
    // be a much worse failure than just dropping the offending page.
    const customPages = readFolder('pages').filter(page => {
        if (RESERVED_PAGE_SLUGS.has(page.slug)) {
            console.warn(`Skipping custom page "${page.title}" -- slug "${page.slug}" collides with a core page.`);
            return false;
        }
        return true;
    });

    NAV_ITEMS = [
        ['sound.html', 'Sound'],
        ['curation-production.html', 'Production & Curation'],
        ['cultural-projects.html', 'Art & Culture Projects'],
        ...customPages.map(p => [`${p.slug}.html`, p.title]),
        ['about.html', 'About'],
        ['contact.html', 'Contact']
    ];

    const allFoldersData = {};
    Object.keys(TOP_SECTIONS).forEach(key => {
        allFoldersData[key] = readFolder(key);
    });

    // Chain prev/next within each folder independently (Kaya/Assimilate
    // live only in "cultural" now -- see AGENTS.md on Sound -> Theatre's
    // removal -- so they chain with Frequency Shift / mau from nowhere
    // there like everything else in that folder).
    Object.values(allFoldersData).forEach(chain);

    let itemCount = 0;
    const allSlugs = [];
    Object.values(allFoldersData).forEach(items => {
        items.forEach(item => {
            write(`${item.slug}.html`, itemPage(item));
            allSlugs.push(item.slug);
            itemCount += 1;
        });
    });

    customPages.forEach(page => {
        write(`${page.slug}.html`, customPageHtml(page));
        allSlugs.push(page.slug);
    });

    cleanupOrphans(allSlugs);

    // ---- sound.html ----
    const soundSections = SOUND_SUBSECTIONS.map(([key, heading]) => {
        const { cards, note } = gatherCards(allFoldersData, key);
        return `
    <section class="section" id="${key}">
      <h2>${accentFull(heading)}</h2>
      <div class="item-grid">
${cards.map(itemCard).join('\n')}
      </div>${note}
    </section>
`;
    }).join('');

    write(
        'sound.html',
        head('Sound — Daisy Nduta', 'Sound design, location recording, and audio engineering by Daisy Nduta.', 'sound.html', homeCardImage('sound')) +
            `<body data-bg="sound">
  ${header('sound.html')}
  <main class="page">
    <p class="eyebrow">Sound</p>
    <h1 class="hero-lede"><span class="accent">Sound design</span>, location recording, and audio engineering across film, broadcast, live, and studio work.</h1>
${soundSections}
    ${FOOTER}
  </main>
</body>
</html>
`
    );

    // ---- curation-production.html ----
    const { cards: curationCards } = gatherCards(allFoldersData, 'curation');
    write(
        'curation-production.html',
        head('Production & Curation — Daisy Nduta', 'Production and curation work by Daisy Nduta.', 'curation-production.html', homeCardImage('curation')) +
            `<body data-bg="curation">
  ${header('curation-production.html')}
  <main class="page">
    <p class="eyebrow">Production &amp; Curation</p>
    <h1 class="hero-lede">Producing, programming, and curating <span class="accent">live experiences</span> — from venue seasons to festival showcases.</h1>
    <section class="section" aria-label="Production and curation credits">
      <div class="item-grid">
${curationCards.map(itemCard).join('\n')}
      </div>
    </section>
    ${FOOTER}
  </main>
</body>
</html>
`
    );

    // ---- cultural-projects.html ----
    const { cards: culturalCards } = gatherCards(allFoldersData, 'cultural');
    write(
        'cultural-projects.html',
        head('Art & Culture Projects — Daisy Nduta', 'Longer-term, multidisciplinary, and community-rooted work by Daisy Nduta.', 'cultural-projects.html', homeCardImage('cultural')) +
            `<body data-bg="cultural">
  ${header('cultural-projects.html')}
  <main class="page">
    <p class="eyebrow">Art &amp; Culture Projects</p>
    <h1 class="hero-lede">Longer-term, multidisciplinary, and <span class="accent">community-rooted</span> work.</h1>
    <section class="section" aria-label="Art and culture project credits">
      <div class="item-grid">
${culturalCards.map(itemCard).join('\n')}
      </div>
    </section>
    ${FOOTER}
  </main>
</body>
</html>
`
    );

    // ---- index.html ----
    // The 5 entry cards auto-rotate through a single focal position, rather
    // than sitting in a static grid -- client-requested, referencing another
    // site's 3D card carousel but scoped down to a flat rotation using this
    // site's existing card markup/visual system (see AGENTS.md).
    const home = readJson('pages/home.json');
    const entryCards = home.cards
        .map(
            (card, i) => `        <a class="entry-card" href="${card.href}" data-index="${i}">
        ${entryCardMedia(card)}
        <div class="entry-card__body">
          <p class="label">${escapeHtml(card.label)}</p>
          <h2>${accentLastWord(card.title)}</h2>
          <p>${escapeHtml(card.summary)}</p>
        </div>
        <span class="entry-card__arrow" aria-hidden="true">${ARROW_ICON}</span>
      </a>`
        )
        .join('\n');

    const entryDots = home.cards
        .map((card, i) => `        <button type="button" class="entry-carousel__dot" data-index="${i}" aria-label="Show ${escapeHtml(card.title)}"></button>`)
        .join('\n');

    const homeTagline = home.tagline
        ? `\n    <p class="home-wordmark__tagline">${escapeHtml(home.tagline)}</p>`
        : '';

    write(
        'index.html',
        head('Daisy Nduta', home.tagline ? `Daisy Nduta — ${home.tagline}` : 'Daisy Nduta — Nairobi-based sound designer, location recordist, and cultural producer.', '') +
            `<body>
  <main class="page page--home">
    <h1 class="home-wordmark">${accentLastWord('Daisy Nduta')}</h1>${homeTagline}
    <section class="entry-carousel" aria-roledescription="carousel" aria-label="Explore the work">
      <div class="entry-carousel__track">
${entryCards}
      </div>
      <div class="entry-carousel__controls">
        <div class="entry-carousel__dots">
${entryDots}
        </div>
      </div>
    </section>
    ${FOOTER}
  </main>
</body>
</html>
`
    );

    // ---- about.html ----
    const about = readJson('pages/about.json');
    // One curated phrase (or, for the paragraph that lists her four
    // practice areas, all four) picked by hand per paragraph -- not every
    // paragraph needs one, see AGENTS.md. Indexed by position, not content,
    // so it silently goes fully out of sync if a paragraph is ever added or
    // removed above it -- exactly what happened when the client deleted the
    // original opening paragraph (2026-09-22): every remaining paragraph
    // shifted up one slot, so every phrase here was being checked against
    // the wrong paragraph and nothing accented at all. Re-synced 2026-09-23
    // to the current 3-paragraph structure; the old opening paragraph's
    // 'sound-first' accent has no home anymore and was dropped.
    const ABOUT_PARAGRAPH_ACCENTS = [
        ['cultural producer'],
        ['Sound', 'Film', 'Production & Curation', 'Art & Culture Projects'],
        []
    ];
    const paragraphs = about.paragraphs
        .map((p, i) => `        <p class="copy">${applyAccents(p, ABOUT_PARAGRAPH_ACCENTS[i])}</p>`)
        .join('\n');
    const portraitFigure = about.portraitImage
        ? `<figure class="image-panel"><img ${imgAttrs(about.portraitImage, 'Daisy Nduta', IMAGE_SIZES.portrait, { lazy: false })}></figure>`
        : `<figure class="image-panel"><p>${escapeHtml(about.portraitPlaceholder)}</p></figure>`;
    const awardsRows = about.awards.map(a => `        <li><span>${escapeHtml(a.year)}</span><span>${escapeHtml(a.text)}</span></li>`).join('\n');
    const residencyRows = about.residencies.map(r => `        <li><span>${escapeHtml(r.year)}</span><span>${escapeHtml(r.text)}</span></li>`).join('\n');
    // Client-authored: a centered, wrapping cluster of names, not a
    // location/name table -- each entry links out to its own URL (accent
    // color) when the client supplies one, and renders as plain text
    // otherwise (see AGENTS.md "Trusted by").
    const clientCloud = about.clients
        .filter(c => c.name)
        .map(c =>
            c.url
                ? `<a class="client-cloud__item" href="${escapeHtml(c.url)}"${externalAttrs(c.url)}>${escapeHtml(c.name)}</a>`
                : `<span class="client-cloud__item">${escapeHtml(c.name)}</span>`
        )
        .join('\n        ');

    write(
        'about.html',
        head(`About — Daisy Nduta`, 'About Daisy Nduta — sound designer, location recordist, and cultural producer.', 'about.html', about.portraitImage || homeCardImage('about')) +
            `<body>
  ${header('about.html')}
  <main class="page">
    <p class="eyebrow">${escapeHtml(about.eyebrow)}</p>
    <h1>${escapeHtml(about.heading)}</h1>
    <div class="intro-grid">
      <div>
${paragraphs}
      </div>
      ${portraitFigure}
    </div>

    <section class="section" aria-labelledby="awards">
      <p class="label">${escapeHtml(about.awardsLabel)}</p>
      <h2 id="awards">${accentFull(about.awardsHeading)}</h2>
      <ul class="detail-list detail-list--columns">
${awardsRows}
      </ul>
    </section>

    <section class="section" aria-labelledby="residencies">
      <p class="label">${escapeHtml(about.residenciesLabel)}</p>
      <h2 id="residencies">${accentFull(about.residenciesHeading)}</h2>
      <ul class="detail-list detail-list--columns">
${residencyRows}
      </ul>
    </section>

    <section class="section" aria-labelledby="clients">
      <p class="label">${escapeHtml(about.clientsLabel)}</p>
      <h2 id="clients">${accentFull(about.clientsHeading)}</h2>
      <div class="client-cloud">
        ${clientCloud}
      </div>
    </section>

    ${FOOTER}
  </main>
</body>
</html>
`
    );

    // ---- contact.html ----
    const contact = readJson('pages/contact.json');
    const contactRows = contact.details
        .map(
            d =>
                `        <li><span>${escapeHtml(d.label)}</span><span><a class="placeholder" href="${escapeHtml(d.href)}"${externalAttrs(d.href)}>${escapeHtml(d.linkText)}</a> <em>${escapeHtml(d.note)}</em></span></li>`
        )
        .join('\n');

    write(
        'contact.html',
        head('Contact — Daisy Nduta', 'Get in touch with Daisy Nduta.', 'contact.html', homeCardImage('contact')) +
            `<body>
  ${header('contact.html')}
  <main class="page">
    <p class="eyebrow">${escapeHtml(contact.eyebrow)}</p>
    <h1>${escapeHtml(contact.heading)}</h1>
    <p class="copy">${escapeHtml(contact.intro)}</p>

    <section class="section" aria-labelledby="reach">
      <p class="label">${escapeHtml(contact.reachLabel)}</p>
      <h2 id="reach">${accentFull(contact.reachHeading)}</h2>
      <ul class="detail-list">
${contactRows}
      </ul>
    </section>

    ${FOOTER}
  </main>
</body>
</html>
`
    );

    // ---- sitemap.xml + robots.txt ----
    // Every public page, so search engines can find each project directly.
    // admin/ and publish.html are the local Content Manager's own pages --
    // useless on the live site, so crawlers are asked to skip them.
    const sitemapPages = ['', 'sound.html', 'curation-production.html', 'cultural-projects.html', 'about.html', 'contact.html', ...allSlugs.map(slug => `${slug}.html`)];
    write(
        'sitemap.xml',
        `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapPages.map(page => `  <url><loc>${SITE_URL}/${page}</loc></url>`).join('\n')}
</urlset>
`
    );
    write(
        'robots.txt',
        `User-agent: *
Disallow: /admin/
Disallow: /publish.html

Sitemap: ${SITE_URL}/sitemap.xml
`
    );

    console.log(`Built ${itemCount} item pages + ${customPages.length} custom page(s) + 6 core pages.`);
}

export { build };

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
    await ensureImageVariants(ROOT);
    build();
}
