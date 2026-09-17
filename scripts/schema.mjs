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
    { key: 'theatre', label: 'Sound → Theatre', shape: 'item' },
    { key: 'broadcast', label: 'Sound → Broadcast', shape: 'item' },
    { key: 'live', label: 'Sound → Live', shape: 'item' },
    { key: 'studio', label: 'Sound → Studio', shape: 'item' },
    { key: 'curation', label: 'Curation & Production', shape: 'item' },
    { key: 'cultural', label: 'Cultural Projects', shape: 'item' },
    { key: 'pages', label: 'Pages', shape: 'page' }
];

// Only "cultural" currently has items that guest-appear on another page
// (Kaya/Assimilate -> Sound -> Theatre) -- these advanced fields are only
// shown in the admin form for collections listed here.
export const CROSS_LINK_COLLECTIONS = ['cultural'];

// New pages can't take these slugs -- they're the core site's own generated
// filenames, and a same-named page would silently overwrite one of them.
export const RESERVED_PAGE_SLUGS = new Set(['index', 'sound', 'curation-production', 'cultural-projects', 'about', 'contact']);

export const FILE_COLLECTIONS = [
    { key: 'home', label: 'Home Page', file: 'content/pages/home.json' },
    { key: 'about', label: 'About Page', file: 'content/pages/about.json' },
    { key: 'contact', label: 'Contact Page', file: 'content/pages/contact.json' }
];

export function isFolderCollection(key) {
    return FOLDER_COLLECTIONS.some(c => c.key === key);
}

export function isFileCollection(key) {
    return FILE_COLLECTIONS.some(c => c.key === key);
}
