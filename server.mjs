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

// Publish pulls the latest from GitHub, which can bring in new server/build
// code this process has already loaded. Rebuilding with the old code in
// memory would regenerate the pages the old way, and the next Publish would
// push that. So builds wait while a pull is in progress; if the pull
// brought code, the process quits for Start Content Manager to relaunch it
// on the new code (EXIT_FOR_UPDATE), and never builds again before that.
const EXIT_FOR_UPDATE = 75;
const RESTART_PATHS = /^(server\.mjs$|scripts\/|package(-lock)?\.json$)/;
let pulling = false;
let buildDeferred = false;
let restartPending = false;

async function runBuild(reason) {
    if (restartPending) return;
    if (pulling) {
        buildDeferred = true;
        return;
    }
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

// git with its output captured whether it succeeds or not, so each step
// below can report exactly what went wrong.
function git(args) {
    return new Promise(resolve => {
        execFile('git', args, { cwd: ROOT }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
    });
}

app.post('/api/publish', async (req, res) => {
    const message = (req.body && req.body.message) || `Content update — ${new Date().toISOString()}`;

    const add = await git(['add', '-A']);
    if (add.error) return res.status(500).json({ success: false, step: 'add', output: add.error.message });

    const commit = await git(['commit', '-m', message]);
    const nothingToCommit = /nothing to commit/i.test(commit.stdout + commit.stderr);
    if (commit.error && !nothingToCommit) {
        return res.status(500).json({ success: false, step: 'commit', output: commit.stderr || commit.error.message });
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
    // Builds are held off during the pull (see runBuild), and what it
    // brought in decides what happens next: new code means a restart,
    // content alone means an ordinary rebuild.
    pulling = true;
    const before = (await git(['rev-parse', 'HEAD'])).stdout.trim();
    // scripts/sync.mjs rather than a bare `git pull`: it also settles the
    // conflicts a person would settle in seconds (generated pages, and
    // content files where each side changed different fields), then
    // rebuilds from the combined content with the newest code on disk.
    const pull = await new Promise(resolve => {
        execFile(process.execPath, [path.join(ROOT, 'scripts', 'sync.mjs')], { cwd: ROOT }, (error, stdout, stderr) =>
            resolve({ error, output: `${stdout}${stderr}`.trim() })
        );
    });

    if (pull.error) {
        // sync.mjs has already backed out any half-finished merge, so
        // this copy is exactly as it was, local commit included.
        finishPull(false);
        return res.status(500).json({
            success: false,
            step: 'pull',
            output: pull.output || pull.error.message,
            hint: pull.error.code === 2
                ? "Your edit is safely saved on this Mac, but it changed the same thing as something published elsewhere, so it needs a person to choose. Contact your developer to finish publishing this one."
                : "Your edit is safely saved on this Mac, but it couldn't be combined with what's on GitHub right now (are you online?). Try Publish again in a moment; if it keeps failing, contact your developer."
        });
    }

    const changed = (await git(['diff', '--name-only', before, 'HEAD'])).stdout.split('\n').filter(Boolean);
    const restarting = changed.some(file => RESTART_PATHS.test(file));
    finishPull(restarting);

    const push = await git(['push']);
    if (push.error) {
        res.status(500).json({
            success: false,
            step: 'push',
            output: push.stderr || push.error.message,
            hint: 'Make sure this repo has a GitHub remote configured (git remote add origin ...) and that you can push to it.',
            restarting
        });
    } else {
        res.json({
            success: true,
            output: [nothingToCommit ? 'Nothing new to commit.' : commit.stdout, pull.output, push.stdout || push.stderr].filter(Boolean).join('\n'),
            restarting
        });
    }

    if (restarting) {
        // Give the response a moment to reach the browser first.
        console.log('\nPublish brought in an update to the Content Manager itself — restarting to use it...');
        // A launcher that started before it was itself updated can't
        // relaunch (bash is still running the old copy it read at startup),
        // so say what to do if nothing happens.
        console.log("(It comes back by itself in a few seconds. If this window says the process has ended instead, close it and double-click Start Content Manager again.)\n");
        setTimeout(() => process.exit(EXIT_FOR_UPDATE), 500);
    }
});

// Ends the pull's hold on builds: either run the build that was waiting
// (content-only pull), or stop building altogether until the restart.
function finishPull(restarting) {
    if (restarting) restartPending = true;
    pulling = false;
    if (buildDeferred && !restartPending) {
        buildDeferred = false;
        runBuild('pulled changes');
    }
}

app.listen(PORT, () => {
    console.log(`\nDaisy Nduta CMS running:`);
    console.log(`  Site preview   http://localhost:${PORT}/`);
    console.log(`  Edit content   http://localhost:${PORT}/admin/`);
    console.log(`  Publish        http://localhost:${PORT}/publish.html\n`);
});
