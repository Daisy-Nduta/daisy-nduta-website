#!/usr/bin/env node
/**
 * Brings this copy of the site up to date with GitHub, combining it with
 * anything published elsewhere, then rebuilds the pages from the combined
 * content. Used by Publish (server.mjs) and at startup (Start Content
 * Manager.command); can also be run by hand: `node scripts/sync.mjs`.
 *
 * A plain `git pull` gives up whenever both sides touched neighbouring
 * lines, even when the edits don't really clash -- e.g. the developer
 * renamed a Home card's title while Daisy changed that card's photo. This
 * resolves those the way a person would:
 *
 *  - Generated files (the site's .html pages, sitemap.xml, robots.txt, the
 *    resized photo copies): take GitHub's version. The rebuild at the end
 *    regenerates them all from the combined content anyway.
 *  - Content files (content/**.json, content/**.md): combine field by
 *    field. Only a field changed differently on both sides is a real
 *    conflict.
 *  - Anything else conflicting is a real conflict.
 *
 * On a real conflict the merge is backed out, leaving this copy exactly as
 * it was (local commits included), and it exits with code 2. The rebuild
 * runs as a separate `node scripts/build.mjs`, so it always uses the
 * newest code on disk, never code an already-running server loaded earlier.
 *
 * Exit codes: 0 done (or nothing to do), 2 real conflict, 3 unpublished
 * edits in the way (startup only), 1 anything else (e.g. offline).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import matter from 'gray-matter';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function git(...args) {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function tryGit(...args) {
    const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
    return { ok: result.status === 0, out: `${result.stdout || ''}${result.stderr || ''}` };
}

// Root-level pages are all generated, except publish.html (hand-written).
function isGenerated(file) {
    if (/^[^/]+\.html$/.test(file)) return file !== 'publish.html';
    return file === 'sitemap.xml' || file === 'robots.txt' || file.startsWith('images/uploads/sized/');
}

const MISSING = Symbol('missing');

function same(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

// Three-way merge of plain data: keep whichever side changed something,
// descending into objects and equal-length arrays; throw if both sides
// changed the same value differently.
function merge3(base, ours, theirs, where) {
    if (same(ours, theirs)) return ours;
    if (same(base, ours)) return theirs;
    if (same(base, theirs)) return ours;
    const isObj = v => v && typeof v === 'object' && !Array.isArray(v) && v !== MISSING;
    if (isObj(base) && isObj(ours) && isObj(theirs)) {
        const out = {};
        new Set([...Object.keys(ours), ...Object.keys(theirs)]).forEach(key => {
            const value = merge3(
                key in base ? base[key] : MISSING,
                key in ours ? ours[key] : MISSING,
                key in theirs ? theirs[key] : MISSING,
                `${where}.${key}`
            );
            if (value !== MISSING) out[key] = value;
        });
        return out;
    }
    if ([base, ours, theirs].every(Array.isArray) && base.length === ours.length && ours.length === theirs.length) {
        return ours.map((_, i) => merge3(base[i], ours[i], theirs[i], `${where}[${i}]`));
    }
    throw new Error(`both sides changed ${where}`);
}

function stage(n, file) {
    const result = tryGit('show', `:${n}:${file}`);
    return result.ok ? result.out : null;
}

function mergeContentFile(file) {
    const [base, ours, theirs] = [1, 2, 3].map(n => stage(n, file));
    if (ours === null || theirs === null) throw new Error('deleted on one side, changed on the other');
    let merged;
    if (file.endsWith('.json')) {
        merged = JSON.stringify(merge3(base === null ? {} : JSON.parse(base), JSON.parse(ours), JSON.parse(theirs), ''), null, 2) + '\n';
    } else {
        const parse = text => {
            const { data, content } = matter(text);
            return { data, body: content.trim() };
        };
        const b = base === null ? { data: {}, body: '' } : parse(base);
        const o = parse(ours);
        const t = parse(theirs);
        const data = merge3(b.data, o.data, t.data, '');
        const body = merge3(b.body, o.body, t.body, ' description');
        merged = matter.stringify(body, data);
    }
    fs.writeFileSync(path.join(ROOT, file), merged);
    git('add', '--', file);
}

function resolveGenerated(file) {
    if (stage(3, file) === null) git('rm', '-q', '--', file);
    else {
        git('checkout', '--theirs', '--', file);
        git('add', '--', file);
    }
}

function main() {
    const startup = process.argv.includes('--startup');

    if (git('status', '--porcelain', '--untracked-files=no').trim()) {
        // Saved-but-unpublished edits: Publish commits them first, so this
        // only happens at startup -- leave them alone until then.
        console.log('Unpublished edits on this Mac -- they will be combined with any updates when you next Publish.');
        return 3;
    }

    const fetched = tryGit('fetch', '--quiet', 'origin');
    if (!fetched.ok) {
        console.log("Couldn't reach GitHub right now -- continuing with what's on this Mac.");
        return 1;
    }
    const branch = git('rev-parse', '--abbrev-ref', 'HEAD').trim();
    const upstream = `origin/${branch}`;
    if (git('rev-list', '--count', `HEAD..${upstream}`).trim() === '0') return 0;

    const merge = tryGit('merge', '--no-edit', upstream);
    if (!merge.ok) {
        const conflicted = git('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);
        if (!conflicted.length) {
            tryGit('merge', '--abort');
            console.error(merge.out.trim());
            return 1;
        }
        const unresolved = [];
        conflicted.forEach(file => {
            try {
                if (isGenerated(file)) resolveGenerated(file);
                else if (/^content\/.+\.(json|md)$/.test(file)) mergeContentFile(file);
                else throw new Error('not a file that can be combined automatically');
            } catch (error) {
                unresolved.push(`${file} (${error.message})`);
            }
        });
        if (unresolved.length) {
            tryGit('merge', '--abort');
            console.error(`Real conflict, nothing changed:\n  ${unresolved.join('\n  ')}`);
            return 2;
        }
        git('commit', '--no-edit', '-q');
        console.log(`Combined with published changes (auto-resolved: ${conflicted.join(', ')}).`);
    } else if (!startup) {
        console.log('Combined with published changes.');
    }

    // Rebuild from the combined content with the newest code, and record
    // the result, so what gets pushed always matches the content.
    const build = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')], { cwd: ROOT, encoding: 'utf8' });
    if (build.status !== 0) {
        console.error(`Rebuild failed:\n${build.stderr || build.stdout}`);
        return 1;
    }
    git('add', '-A', '--', '*.html', 'sitemap.xml', 'robots.txt', 'images/uploads/sized');
    if (git('diff', '--cached', '--name-only').trim()) {
        git('commit', '-q', '-m', 'Rebuild pages after combining with published changes');
    }
    return 0;
}

try {
    process.exitCode = main();
} catch (error) {
    tryGit('merge', '--abort');
    console.error(error.message);
    process.exitCode = 1;
}
