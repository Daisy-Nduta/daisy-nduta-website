/**
 * Smaller copies of every uploaded photo the site actually uses, so
 * visitors download an image close to the size it's displayed at instead
 * of the full 2000px upload. Writes images/uploads/sized/<name>-<width>.jpg
 * plus a manifest (images/uploads/sized/manifest.json) recording each
 * source's own dimensions and which copies exist -- build.mjs reads that
 * manifest synchronously to write srcset/sizes attributes.
 *
 * Runs before every build (server.mjs, and `npm run build`). Only touches
 * images referenced somewhere in content/; copies whose source is no
 * longer referenced are removed. GIFs are skipped (resizing would drop
 * their animation). Existing copies are never regenerated, so a normal
 * rebuild with no new photos does no image work at all.
 */

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export const IMAGE_WIDTHS = [800, 1400];
const JPEG_QUALITY = 78;

function walk(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [full];
    });
}

// Every images/uploads/<name> path mentioned anywhere in content/.
function referencedUploads(ROOT) {
    const names = new Set();
    walk(path.join(ROOT, 'content')).forEach(file => {
        const text = fs.readFileSync(file, 'utf8');
        for (const match of text.matchAll(/images\/uploads\/([^"'\s)\]]+)/g)) names.add(match[1]);
    });
    return names;
}

export function readImageManifest(ROOT) {
    try {
        return JSON.parse(fs.readFileSync(path.join(ROOT, 'images', 'uploads', 'sized', 'manifest.json'), 'utf8'));
    } catch {
        return {};
    }
}

export async function ensureImageVariants(ROOT) {
    const uploads = path.join(ROOT, 'images', 'uploads');
    const sizedDir = path.join(uploads, 'sized');
    fs.mkdirSync(sizedDir, { recursive: true });

    const manifest = readImageManifest(ROOT);
    const referenced = referencedUploads(ROOT);
    let changed = false;

    for (const name of referenced) {
        const source = path.join(uploads, name);
        if (/\.gif$/i.test(name) || name.includes('/') || !fs.existsSync(source)) continue;

        const base = name.replace(/\.[^.]+$/, '');
        const entry = manifest[name];
        const complete = entry && Object.values(entry.variants).every(rel => fs.existsSync(path.join(ROOT, rel)));
        if (complete) continue;

        try {
            const meta = await sharp(source).rotate().metadata();
            // .rotate() applies EXIF orientation; swap for 90/270 degrees.
            const rotated = (meta.orientation || 1) >= 5;
            const width = rotated ? meta.height : meta.width;
            const height = rotated ? meta.width : meta.height;
            const variants = {};
            for (const w of IMAGE_WIDTHS) {
                if (w >= width) continue;
                const rel = `images/uploads/sized/${base}-${w}.jpg`;
                const out = path.join(ROOT, rel);
                if (!fs.existsSync(out)) {
                    await sharp(source)
                        .rotate()
                        .resize({ width: w, withoutEnlargement: true })
                        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
                        .toFile(out);
                }
                variants[w] = rel;
            }
            manifest[name] = { width, height, variants };
            changed = true;
            console.log(`Resized copies ready: ${name}`);
        } catch (error) {
            console.error(`Couldn't make resized copies of ${name}:`, error.message);
        }
    }

    // Drop copies of photos no longer used anywhere on the site.
    for (const name of Object.keys(manifest)) {
        if (referenced.has(name)) continue;
        Object.values(manifest[name].variants || {}).forEach(rel => fs.rmSync(path.join(ROOT, rel), { force: true }));
        delete manifest[name];
        changed = true;
    }

    if (changed) {
        const sorted = Object.fromEntries(Object.keys(manifest).sort().map(k => [k, manifest[k]]));
        fs.writeFileSync(path.join(sizedDir, 'manifest.json'), `${JSON.stringify(sorted, null, 2)}\n`);
    }
}
