/**
 * Collection metadata for the custom admin UI (admin/app.js + admin-api.mjs).
 * Kept separate from build.mjs's TOP_SECTIONS (which carries HTML-specific
 * breadcrumb/backHref/data-bg fields) to avoid entangling the CMS layer
 * with page-rendering concerns -- if you add/rename a folder collection,
 * update both this file and build.mjs's TOP_SECTIONS/SOUND_SUBSECTIONS.
 */

// `shape` distinguishes the two content models a folder collection can
// hold: "item" is the existing card/credit schema (cardLabel, cardSummary,
// details, cross-linking), "page" is a bare top-level page (title, image,
// body) that also gets its own nav link -- see the "pages" entry below.
export const FOLDER_COLLECTIONS = [
    { key: 'film', label: 'Sound → Film', shape: 'item' },
    { key: 'broadcast', label: 'Sound → Broadcast', shape: 'item' },
    { key: 'live', label: 'Sound → Live', shape: 'item' },
    { key: 'studio', label: 'Sound → Studio', shape: 'item' },
    { key: 'curation', label: 'Production & Curation', shape: 'item' },
    { key: 'cultural', label: 'Cultural Projects', shape: 'item' },
    { key: 'work', label: 'Work (Daisy the Artist)', shape: 'item' },
    { key: 'pages', label: 'Pages', shape: 'page' }
];

// Generic dual-listing mechanism (a card can also appear on another
// section's grid) -- unused today (Kaya/Assimilate's old Sound -> Theatre
// cross-listing was removed along with the Theatre subsection itself, see
// AGENTS.md), kept available for a future project that genuinely belongs
// in two places. These advanced fields are only shown in the admin form
// for collections listed here.
export const CROSS_LINK_COLLECTIONS = ['cultural'];

// New pages can't take these slugs -- they're the core site's own generated
// filenames, and a same-named page would silently overwrite one of them.
export const RESERVED_PAGE_SLUGS = new Set(['index', 'sound', 'curation-production', 'cultural-projects', 'work', 'about', 'contact']);

export const FILE_COLLECTIONS = [
    { key: 'home', label: 'Home Page', file: 'content/pages/home.json' },
    { key: 'about', label: 'About Page', file: 'content/pages/about.json' },
    { key: 'contact', label: 'Contact Page', file: 'content/pages/contact.json' },
    { key: 'subtitles', label: 'Section Subtitles', file: 'content/pages/subtitles.json' },
    { key: 'settings', label: 'Site Settings', file: 'content/pages/settings.json' }
];

// Fallback used by build.mjs whenever content/pages/settings.json is missing
// or its accentColor isn't a valid 6-digit hex -- keeps a bad/blank value
// from breaking the highlight color across the whole site.
export const DEFAULT_ACCENT_COLOR = '#a22106';

// GoatCounter site (visitor analytics). build.mjs puts its counting script
// on every public page; admin-api.mjs reads stats back from its API for the
// CMS's "Site Visits" page.
export const GOATCOUNTER_SITE = 'https://daisynduta.goatcounter.com';

// Bandcamp's player needs the album/track's internal number, which isn't in
// the link people share. The admin API looks it up when a Bandcamp link is
// saved and records it in this file; build.mjs reads it (the build itself
// never goes online). Keyed by bandcampPageKey().
export const EMBED_LOOKUPS_FILE = 'content/embed-lookups.json';

// A Bandcamp album/track page link reduced to a stable key (no query string
// or trailing slash), or null if it isn't one.
export function bandcampPageKey(rawUrl) {
    let url;
    try {
        url = new URL(String(rawUrl ?? '').trim());
    } catch {
        return null;
    }
    const parts = url.pathname.split('/').filter(Boolean);
    if (!url.hostname.endsWith('.bandcamp.com') || !['album', 'track'].includes(parts[0]) || !parts[1]) return null;
    return `https://${url.hostname}/${parts[0]}/${parts[1]}`;
}

export function isFolderCollection(key) {
    return FOLDER_COLLECTIONS.some(c => c.key === key);
}

export function isFileCollection(key) {
    return FILE_COLLECTIONS.some(c => c.key === key);
}
