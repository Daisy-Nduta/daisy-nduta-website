#!/usr/bin/env node
/**
 * Local CMS host: serves the site + the custom /admin app, rebuilds the
 * static HTML automatically whenever content/ changes, and exposes the
 * admin REST API (scripts/admin-api.mjs) plus a one-click "Publish to
 * GitHub" action for publish.html.
 *
 * Run via `npm run cms`.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import express from 'express';
import chokidar from 'chokidar';
import { build } from './scripts/build.mjs';
import { ensureImageVariants } from './scripts/images.mjs';
import { createAdminApi } from './scripts/admin-api.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;

// Makes any missing resized photo copies (scripts/images.mjs), then
// rebuilds. Resizing is async, so runs are queued: a change arriving
// mid-build triggers exactly one more build afterwards, never two at once.
let building = false;
let buildAgain = false;

async function runBuild(reason) {
    if (building) {
        buildAgain = true;
        return;
    }
    building = true;
    try {
        await ensureImageVariants(ROOT);
        build();
    } catch (error) {
        console.error(`Build failed (${reason}):`, error.message);
    } finally {
        building = false;
        if (buildAgain) {
            buildAgain = false;
            runBuild('queued change');
        }
    }
}

runBuild('startup');

let rebuildTimer = null;
chokidar
    .watch(path.join(ROOT, 'content'), { ignoreInitial: true })
    .on('all', (event, changedPath) => {
        clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(() => {
            console.log(`content changed (${event}: ${path.relative(ROOT, changedPath)}) — rebuilding...`);
            runBuild('content change');
        }, 200);
    });

const app = express();
app.use(express.json());
app.use('/api', createAdminApi(ROOT));
app.use(express.static(ROOT));

app.post('/api/publish', (req, res) => {
    const message = (req.body && req.body.message) || `Content update — ${new Date().toISOString()}`;

    execFile('git', ['add', '-A'], { cwd: ROOT }, addErr => {
        if (addErr) return res.status(500).json({ success: false, step: 'add', output: addErr.message });

        execFile('git', ['commit', '-m', message], { cwd: ROOT }, (commitErr, commitOut, commitErrOut) => {
            const nothingToCommit = /nothing to commit/i.test(commitOut + commitErrOut);
            if (commitErr && !nothingToCommit) {
                return res.status(500).json({ success: false, step: 'commit', output: commitErrOut || commitErr.message });
            }

            // Pull (plain merge, not rebase -- no history rewriting to reason
            // about) before pushing, so Publish can never fail just because
            // someone else -- the developer, or this same site open on a
            // second Mac -- published something in the meantime. Without
            // this, `git push` alone would reject with a raw git error no
            // non-technical user could act on.
            // --no-rebase is required, not just the default: a fresh git
            // install (exactly what First-Time Setup.command sets up) has no
            // pull.rebase preference configured, and a modern git refuses to
            // guess when the branches have actually diverged -- confirmed by
            // testing this exact scenario, where a bare `git pull --no-edit`
            // fails outright asking which strategy to use.
            execFile('git', ['pull', '--no-rebase', '--no-edit'], { cwd: ROOT }, (pullErr, pullOut, pullErrOut) => {
                if (pullErr) {
                    // Most likely a genuine merge conflict (the same line of
                    // the same file changed both here and elsewhere) -- abort
                    // any half-finished merge so the working tree is left
                    // clean rather than stuck, and surface a plain-language
                    // message instead of the raw git wall of text. The
                    // ignored callback here is deliberate: if there was no
                    // merge in progress to abort, that failure is expected
                    // and irrelevant -- we still report the original pull
                    // failure either way.
                    execFile('git', ['merge', '--abort'], { cwd: ROOT }, () => {
                        res.status(500).json({
                            success: false,
                            step: 'pull',
                            output: pullErrOut || pullErr.message,
                            hint: "Your edit is safely saved on this Mac, but it couldn't be combined automatically with something published elsewhere. Contact your developer to finish publishing this one."
                        });
                    });
                    return;
                }

                execFile('git', ['push'], { cwd: ROOT }, (pushErr, pushOut, pushErrOut) => {
                    if (pushErr) {
                        return res.status(500).json({
                            success: false,
                            step: 'push',
                            output: pushErrOut || pushErr.message,
                            hint: 'Make sure this repo has a GitHub remote configured (git remote add origin ...) and that you can push to it.'
                        });
                    }
                    res.json({
                        success: true,
                        output: [nothingToCommit ? 'Nothing new to commit.' : commitOut, pullOut, pushOut || pushErrOut].filter(Boolean).join('\n')
                    });
                });
            });
        });
    });
});

app.listen(PORT, () => {
    console.log(`\nDaisy Nduta CMS running:`);
    console.log(`  Site preview   http://localhost:${PORT}/`);
    console.log(`  Edit content   http://localhost:${PORT}/admin/`);
    console.log(`  Publish        http://localhost:${PORT}/publish.html\n`);
});
