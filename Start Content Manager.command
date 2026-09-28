#!/bin/bash
# Double-click this file to start Daisy's Content Manager.
#
# It checks for the latest updates from GitHub (design/feature changes
# your developer has published), starts the local site + editor, then
# opens your browser to the site preview and the editor. Leave this
# window open while you're editing — closing it (or pressing Ctrl+C)
# stops the Content Manager. Nothing you edit goes live on
# daisynduta.com until you click "Publish to GitHub" inside the editor.

cd "$(dirname "$0")"

# Pull the latest updates before starting, so this Mac always has your
# developer's latest changes without you needing to touch git yourself.
# Tries the simple, no-surprises route first (--ff-only: only updates if
# nothing local conflicts) and only falls back to an actual merge if that's
# not possible -- e.g. a previous Publish attempt committed locally here but
# couldn't push because this Mac's copy had fallen behind in the meantime.
# Never blocks startup: on a real conflict (the same line edited both here
# and elsewhere) it cleanly backs out and starts with what's already here,
# same as if there were no internet at all.
echo "Checking for updates..."
if git rev-parse --is-inside-work-tree >/dev/null 2>&1 && git remote get-url origin >/dev/null 2>&1; then
    if git pull --ff-only >/dev/null 2>&1; then
        echo "Up to date."
    elif git pull --no-rebase --no-edit >/dev/null 2>&1; then
        echo "Up to date (combined with an edit already saved on this Mac)."
    else
        git merge --abort >/dev/null 2>&1
        echo "Couldn't check for updates right now — continuing with what's already on this Mac."
    fi
else
    echo "Skipping (not connected to GitHub yet)."
fi
echo ""

if ! command -v node >/dev/null 2>&1; then
    echo "Node.js isn't installed yet."
    echo "Install it from https://nodejs.org/ (choose the LTS version), then double-click this file again."
    echo ""
    read -p "Press Return to close this window..."
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "Setting up (first time only, this can take a minute)..."
    npm install
    echo ""
fi

echo "Starting the Content Manager..."
echo ""

(
    sleep 2
    open "http://localhost:8080/" >/dev/null 2>&1
    open "http://localhost:8080/admin/" >/dev/null 2>&1
) &

# Keep everything above this point byte-for-byte unchanged: the update
# check above can rewrite this very file while it's running, and bash then
# carries on reading from the same position in the new version.
#
# The Content Manager exits with code 75 when a Publish brought in an
# update to its own code -- relaunch it on the new code (installing any new
# packages first) instead of closing.
while true; do
    npm run cms
    if [ $? -ne 75 ]; then
        break
    fi
    echo ""
    echo "Updating the Content Manager..."
    npm install --no-audit --no-fund >/dev/null 2>&1
    echo "Restarting..."
    echo ""
done
