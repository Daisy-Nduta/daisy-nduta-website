/**
 * REST API backing the custom admin UI (admin/app.js). Reads and writes
 * content/ directly (via gray-matter for the Markdown item files, plain
 * JSON for the three singleton pages) and images/uploads/ for media.
 * Mounted at /api by server.mjs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import matter from 'gray-matter';
import { FOLDER_COLLECTIONS, FILE_COLLECTIONS, CROSS_LINK_COLLECTIONS, RESERVED_PAGE_SLUGS, isFolderCollection, isFileCollection } from './schema.mjs';

// Uploaded photos get resized/re-encoded before they ever touch disk --
// portfolio photos routinely come out of a phone/camera at several MB and
// several thousand pixels wide, far more than any card or image-panel on
// the site displays (all under ~900px, even at 2x for retina). Capping the
// longest edge and re-encoding as JPEG keeps the repo (and the eventual
// GitHub Pages payload) small without a visible quality loss at the sizes
// this site actually renders images.
const UPLOAD_MAX_DIMENSION = 2000;
const UPLOAD_JPEG_QUALITY = 82;

export function createAdminApi(ROOT) {
    const router = express.Router();
    const CONTENT = path.join(ROOT, 'content');
    const UPLOADS = path.join(ROOT, 'images', 'uploads');
    fs.mkdirSync(UPLOADS, { recursive: true });

    function folderPath(key) {
        return path.join(CONTENT, 'sections', key);
    }

    function slugify(title) {
        return String(title)
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'entry';
    }

    function uniqueSlug(key, base) {
        const dir = folderPath(key);
        let slug = base;
        let n = 2;
        while (fs.existsSync(path.join(dir, `${slug}.md`))) {
            slug = `${base}-${n}`;
            n += 1;
        }
        return slug;
    }

    function readEntry(key, slug) {
        const filePath = path.join(folderPath(key), `${slug}.md`);
        if (!fs.existsSync(filePath)) return null;
        const { data, content } = matter(fs.readFileSync(filePath, 'utf8'));
        return { slug, ...data, body: content.trim() };
    }

    function writeEntry(key, slug, fields) {
        const { body, slug: _ignoredSlug, ...data } = fields;
        const dir = folderPath(key);
        fs.mkdirSync(dir, { recursive: true });
        const out = matter.stringify(body || '', data);
        fs.writeFileSync(path.join(dir, `${slug}.md`), out);
    }

    // ---- collections ----

    router.get('/collections', (req, res) => {
        const folders = FOLDER_COLLECTIONS.map(c => {
            const dir = folderPath(c.key);
            const count = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.md')).length : 0;
            return { ...c, kind: 'folder', count, crossLink: CROSS_LINK_COLLECTIONS.includes(c.key) };
        });
        const files = FILE_COLLECTIONS.map(c => ({ key: c.key, label: c.label, kind: 'file' }));
        res.json({ collections: [...files, ...folders] });
    });

    router.get('/collections/:key/entries', (req, res) => {
        const { key } = req.params;
        if (!isFolderCollection(key)) return res.status(404).json({ error: 'Unknown collection' });
        const dir = folderPath(key);
        const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.md')) : [];
        const entries = files
            .map(f => {
                const slug = f.replace(/\.md$/, '');
                const entry = readEntry(key, slug);
                return { slug, title: entry.title || slug, order: entry.order ?? 99 };
            })
            .sort((a, b) => a.order - b.order);
        res.json({ entries });
    });

    router.get('/collections/:key/entries/:slug', (req, res) => {
        const { key, slug } = req.params;
        if (!isFolderCollection(key)) return res.status(404).json({ error: 'Unknown collection' });
        const entry = readEntry(key, slug);
        if (!entry) return res.status(404).json({ error: 'Entry not found' });
        res.json({ entry });
    });

    router.post('/collections/:key/entries', (req, res) => {
        const { key } = req.params;
        if (!isFolderCollection(key)) return res.status(404).json({ error: 'Unknown collection' });
        const fields = req.body || {};
        if (!fields.title || !fields.title.trim()) return res.status(400).json({ error: 'Title is required' });

        const collectionMeta = FOLDER_COLLECTIONS.find(c => c.key === key);
        const slug = uniqueSlug(key, slugify(fields.title));

        if (collectionMeta.shape === 'page') {
            if (RESERVED_PAGE_SLUGS.has(slug)) {
                return res.status(400).json({ error: `"${fields.title}" collides with one of the site's core pages -- choose a different title.` });
            }
            writeEntry(key, slug, {
                title: fields.title,
                order: fields.order ?? 99,
                images: Array.isArray(fields.images) ? fields.images : [],
                body: fields.body || ''
            });
            return res.json({ slug });
        }

        writeEntry(key, slug, {
            title: fields.title,
            order: fields.order ?? 99,
            cardLabel: fields.cardLabel || '',
            cardSummary: fields.cardSummary || '',
            link: fields.link || '',
            details: fields.details || [],
            images: Array.isArray(fields.images) ? fields.images : [],
            ...(CROSS_LINK_COLLECTIONS.includes(key)
                ? {
                      ...(fields.alsoShowOn ? { alsoShowOn: fields.alsoShowOn } : {}),
                      ...(fields.crossListedLabel ? { crossListedLabel: fields.crossListedLabel } : {}),
                      ...(fields.crossListedHref ? { crossListedHref: fields.crossListedHref } : {}),
                      ...(fields.crossListedText ? { crossListedText: fields.crossListedText } : {})
                  }
                : {}),
            body: fields.body || ''
        });
        res.json({ slug });
    });

    router.put('/collections/:key/entries/:slug', (req, res) => {
        const { key, slug } = req.params;
        if (!isFolderCollection(key)) return res.status(404).json({ error: 'Unknown collection' });
        if (!fs.existsSync(path.join(folderPath(key), `${slug}.md`))) return res.status(404).json({ error: 'Entry not found' });

        const collectionMeta = FOLDER_COLLECTIONS.find(c => c.key === key);
        if (collectionMeta.shape === 'page') {
            const fields = req.body || {};
            writeEntry(key, slug, {
                title: fields.title,
                order: fields.order ?? 99,
                images: Array.isArray(fields.images) ? fields.images : [],
                body: fields.body || ''
            });
            return res.json({ ok: true });
        }

        writeEntry(key, slug, req.body || {});
        res.json({ ok: true });
    });

    router.delete('/collections/:key/entries/:slug', (req, res) => {
        const { key, slug } = req.params;
        if (!isFolderCollection(key)) return res.status(404).json({ error: 'Unknown collection' });
        const filePath = path.join(folderPath(key), `${slug}.md`);
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Entry not found' });
        fs.unlinkSync(filePath);
        res.json({ ok: true });
    });

    // ---- singleton pages ----

    router.get('/pages/:key', (req, res) => {
        const { key } = req.params;
        const collection = FILE_COLLECTIONS.find(c => c.key === key);
        if (!collection) return res.status(404).json({ error: 'Unknown page' });
        const data = JSON.parse(fs.readFileSync(path.join(ROOT, collection.file), 'utf8'));
        res.json({ data });
    });

    router.put('/pages/:key', (req, res) => {
        const { key } = req.params;
        const collection = FILE_COLLECTIONS.find(c => c.key === key);
        if (!collection) return res.status(404).json({ error: 'Unknown page' });
        fs.writeFileSync(path.join(ROOT, collection.file), JSON.stringify(req.body || {}, null, 2) + '\n');
        res.json({ ok: true });
    });

    // ---- media ----

    // Memory storage, not disk: the raw upload never gets written as-is --
    // it goes through sharp first (see the /media POST handler below).
    const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 20 * 1024 * 1024 }
    });

    function uniqueUploadName(base, ext) {
        let name = `${base}${ext}`;
        let n = 2;
        while (fs.existsSync(path.join(UPLOADS, name))) {
            name = `${base}-${n}${ext}`;
            n += 1;
        }
        return name;
    }

    router.get('/media', (req, res) => {
        const files = fs
            .readdirSync(UPLOADS)
            .filter(f => !f.startsWith('.'))
            .map(f => ({ name: f, path: `images/uploads/${f}` }));
        res.json({ files });
    });

    router.post('/media', upload.single('file'), async (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        try {
            const originalExt = path.extname(req.file.originalname);
            const base = slugify(path.basename(req.file.originalname, originalExt));

            // GIFs are left alone so animation survives; everything else
            // (JPEG, PNG, HEIC, WebP, ...) is normalized to a compressed
            // JPEG, which is what every image slot on this site actually
            // needs (opaque photos, no transparency).
            const isGif = req.file.mimetype === 'image/gif';
            const name = uniqueUploadName(base, isGif ? '.gif' : '.jpg');
            const destPath = path.join(UPLOADS, name);

            if (isGif) {
                fs.writeFileSync(destPath, req.file.buffer);
            } else {
                const originalSize = req.file.buffer.length;
                const compressed = await sharp(req.file.buffer)
                    .rotate() // apply EXIF orientation, then the tag itself is stripped below
                    .resize(UPLOAD_MAX_DIMENSION, UPLOAD_MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: UPLOAD_JPEG_QUALITY, mozjpeg: true })
                    .toBuffer();
                fs.writeFileSync(destPath, compressed);
                console.log(`Compressed upload ${req.file.originalname}: ${(originalSize / 1024).toFixed(0)}KB -> ${(compressed.length / 1024).toFixed(0)}KB`);
            }

            res.json({ path: `images/uploads/${name}` });
        } catch (error) {
            res.status(500).json({ error: `Could not process image: ${error.message}` });
        }
    });

    router.delete('/media/:name', (req, res) => {
        const filePath = path.join(UPLOADS, req.params.name);
        if (!filePath.startsWith(UPLOADS)) return res.status(400).json({ error: 'Invalid filename' });
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        res.json({ ok: true });
    });

    // ---- git status ----

    router.get('/git-status', (req, res) => {
        execFile('git', ['branch', '--show-current'], { cwd: ROOT }, (branchErr, branchOut) => {
            const branch = branchErr ? null : branchOut.trim();
            execFile('git', ['status', '--porcelain'], { cwd: ROOT }, (statusErr, statusOut) => {
                const clean = !statusErr && statusOut.trim() === '';
                execFile('git', ['remote', 'get-url', 'origin'], { cwd: ROOT }, remoteErr => {
                    res.json({ branch, clean, hasRemote: !remoteErr });
                });
            });
        });
    });

    return router;
}
