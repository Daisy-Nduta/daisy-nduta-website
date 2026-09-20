#!/bin/bash
# Double-click this ONCE, the very first time, before using
# "Start Content Manager.command". It installs everything the
# Content Manager needs (git, Node.js, and this project's own setup files),
# then starts the Content Manager for you.
#
# If you ever need to set this up again on a different Mac, just
# double-click this file again — it's safe to re-run.

cd "$(dirname "$0")"

echo "Daisy Nduta Content Manager — First-Time Setup"
echo "================================================"
echo ""

# 1. git (needed for the Publish button to work)
#
# A fresh Mac already has a placeholder /usr/bin/git on disk — it exists,
# but actually running it pops up a slow "install developer tools" dialog.
# So we can't just check `command -v git`; we check for a real install instead.
git_is_ready() {
    if xcode-select -p >/dev/null 2>&1; then
        return 0
    fi
    if [ -x /usr/local/bin/git ] || [ -x /opt/homebrew/bin/git ]; then
        return 0
    fi
    return 1
}

if git_is_ready; then
    echo "git is already installed ($(git --version)). Skipping."
else
    echo "git isn't installed yet — it's required so the Publish button can send"
    echo "changes to GitHub."
    echo ""
    echo "Opening the official Git download page in your browser."
    echo "Download and run the standalone Git installer (the .dmg/.pkg one) — not the"
    echo "full Xcode Command Line Tools that page also mentions, which is a much bigger"
    echo "download and isn't needed just for this. Then come back here."
    open "https://git-scm.com/download/mac"
    echo ""
    read -p "Press Return once the Git installer has finished... "

    if ! git_is_ready; then
        echo ""
        echo "git still isn't found by this window."
        echo "Close this window, then double-click this file again to continue setup."
        read -p "Press Return to close this window... "
        exit 1
    fi
fi

echo ""
echo "git: $(git --version)"
echo ""

# 2. Node.js
if command -v node >/dev/null 2>&1; then
    echo "Node.js is already installed ($(node -v)). Skipping."
else
    echo "Node.js isn't installed yet — it's required to run the Content Manager."
    echo ""
    if command -v brew >/dev/null 2>&1; then
        echo "Homebrew was found — using it to install Node.js..."
        brew install node
    else
        echo "Opening the official Node.js download page in your browser."
        echo "Download and run the installer (choose the LTS version), then come back here."
        open "https://nodejs.org/en/download/"
        echo ""
        read -p "Press Return once the Node.js installer has finished... "
    fi

    # Re-check — a freshly installed Node.js may need a new terminal session to be found.
    if ! command -v node >/dev/null 2>&1; then
        echo ""
        echo "Node.js still isn't found by this window."
        echo "Close this window, then double-click this file again to continue setup."
        read -p "Press Return to close this window... "
        exit 1
    fi
fi

echo ""
echo "Node.js: $(node -v)"
echo ""

# 3. This project's own setup files
echo "Installing this project's setup files (first time only, can take a minute)..."
npm install
echo ""

echo "Setup complete!"
echo "Starting the Content Manager now — next time, just double-click 'Start Content Manager.command'."
echo ""

exec "$(dirname "$0")/Start Content Manager.command"
