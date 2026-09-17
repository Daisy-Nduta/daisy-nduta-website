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
import { createAdminApi } from './scripts/admin-api.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;

function runBuild(reason) {
    try {
        build();
    } catch (error) {
        console.error(`Build failed (${reason}):`, error.message);
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
                    output: [nothingToCommit ? 'Nothing new to commit.' : commitOut, pushOut || pushErrOut].filter(Boolean).join('\n')
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
