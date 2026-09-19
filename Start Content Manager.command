#!/bin/bash
# Double-click this file to start Daisy's Content Manager.
#
# It starts the local site + editor, then opens your browser to the
# site preview and the editor. Leave this window open while you're
# editing — closing it (or pressing Ctrl+C) stops the Content Manager.
# Nothing you edit goes live on daisynduta.com until you click
# "Publish to GitHub" inside the editor.

cd "$(dirname "$0")"

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

npm run cms
