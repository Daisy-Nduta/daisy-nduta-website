/**
 * Collection metadata shared by the admin API (admin-api.mjs), the build
 * (build.mjs) and, through the API, the admin UI (admin/app.js).
 *
 * The site's sections -- nav pages like Sound, each with one or more
 * subsections holding the credits/projects -- aren't fixed in code: Daisy
 * manages them from the CMS's Sections page, stored in SECTIONS_FILE. Each
 * subsection ("group") is a folder of entries, content/sections/<key>/.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const SECTIONS_FILE = 'content/pages/sections.json';

// The background animations script.js can draw (<body data-bg="...">).
export const BACKGROUNDS = [
    { key: 'puddles', label: 'Water ripples' },
    { key: 'sound', label: 'Waveforms' },
    { key: 'curation', label: 'Orbits' },
    { key: 'cultural', label: 'Network' },
    { key: 'work', label: 'Fingerprint' }
];

export function readSections() {
    try {
        return JSON.parse(fs.readFileSync(path.join(ROOT, SECTIONS_FILE), 'utf8')).sections || [];
    } catch {
        return [];
    }
}

// How a subsection is named in the CMS: just the section's name when it's
// the section's only subsection (its heading isn't shown on the site then).
export function groupLabel(section, group) {
    return section.groups.length > 1 ? `${section.title} → ${group.title}` : section.title;
}

// `shape` distinguishes the two content models a folder collection can
// hold: "item" is the card/credit schema (cardLabel, cardSummary, details,
// cross-linking) used by every section's subsections; "page" is a bare
// top-level page (title, image, body) that also gets its own nav link --
// the fixed "pages" collection.
export function folderCollections() {
    const groups = readSections().flatMap(section =>
        section.groups.map(group => ({ key: group.key, label: groupLabel(section, group), shape: 'item', section: section.key }))
    );
    return [...groups, { key: 'pages', label: 'Pages', shape: 'page' }];
}

export function isFolderCollection(key) {
    return folderCollections().some(c => c.key === key);
}

// Generic dual-listing mechanism (a card can also appear on another
// section's grid) -- unused today (Kaya/Assimilate's old Sound -> Theatre
// cross-listing was removed along with the Theatre subsection itself, see
// AGENTS.md), kept available for a future project that genuinely belongs
// in two places. These advanced fields are only shown in the admin form
// for collections listed here.
export const CROSS_LINK_COLLECTIONS = ['cultural'];

// Page filenames that aren't sections: the fixed pages, plus the CMS's own.
export const CORE_PAGE_SLUGS = new Set(['index', 'about', 'contact', 'publish']);

// Every generated page's filename is taken by exactly one thing -- a fixed
// page, a section, a client Page, or a credit/project -- since a clash would
// make one silently overwrite the other. This lists all of them.
export function takenPageSlugs() {
    const taken = new Set([...CORE_PAGE_SLUGS, ...readSections().map(s => s.slug)]);
    folderCollections().forEach(c => {
        const dir = path.join(ROOT, 'content', 'sections', c.key);
        if (!fs.existsSync(dir)) return;
        fs.readdirSync(dir).filter(f => f.endsWith('.md')).forEach(f => taken.add(f.replace(/\.md$/, '')));
    });
    return taken;
}

export const FILE_COLLECTIONS = [
    { key: 'home', label: 'Home Page', file: 'content/pages/home.json' },
    { key: 'about', label: 'About Page', file: 'content/pages/about.json' },
    { key: 'contact', label: 'Contact Page', file: 'content/pages/contact.json' },
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

export function isFileCollection(key) {
    return FILE_COLLECTIONS.some(c => c.key === key);
}
