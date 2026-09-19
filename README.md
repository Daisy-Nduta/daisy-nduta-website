# Daisy Nduta — Portfolio Site

The personal portfolio site for **Daisy Nduta**, a Nairobi-based sound designer, location recordist, and cultural producer, working across Sound (Film, Theatre, Broadcast, Live, Studio), Curation & Production, and Cultural Projects.

The public site is plain static HTML/CSS/JS, hosted on **GitHub Pages** with a custom domain. Content (project credits, bios, images) is managed through a **local content management system** so Daisy can add, edit, or remove projects and photos herself, without touching code.

## Editing the site (for Daisy / non-technical use)

1. **The very first time**, double-click **`First-Time Setup`** (the app with the DN icon) in this folder. It installs Node.js if you don't already have it (or asks you to run the official installer if Homebrew isn't available), sets up this project's files, and then starts the Content Manager for you. This can take a few minutes.
2. **Every time after that**, double-click **`Start Content Manager`** (the other DN-icon app) instead. A terminal window opens, starts the Content Manager, and opens your browser automatically.
3. Your browser opens two tabs: the **site preview** (`http://localhost:8080/`) and the **editor** (`http://localhost:8080/admin/`). Edit any page or project, add new ones, or upload images in the editor. Changes save automatically as you go.
4. When you're happy with your changes, click **Publish to GitHub** in the editor's top bar. Your live site updates automatically within a minute or two.
5. When you're done editing, close the terminal window (or press Ctrl+C in it) to stop the Content Manager.

Nothing you do in step 3 is public until you complete step 4.

## For developers

There is no application server or database. The published site is a set of static HTML files generated from structured content by a small Node build script — see **`AGENTS.md`** for the full architecture (content schema, build pipeline, CMS configuration, visual system, and the history of design decisions on this project). That file is the source of truth for how the site is put together; this README is just the quick-start.

```sh
npm install         # one-time
npm run build         # regenerate the .html files from content/ once
npm run cms            # full local CMS (custom admin app + auto-rebuild + publish button)
python3 -m http.server 8000   # quick read-only static preview, no editing
```

Project structure at a glance:

```text
.
├── content/              # All editable content (JSON pages + Markdown project entries)
├── admin/                 # Custom Content Manager app (vanilla JS, no framework)
├── scripts/build.mjs       # content/ -> the static .html files
├── server.mjs               # Local CMS host: static server + auto-rebuild + publish endpoint
├── publish.html              # One-click "Publish to GitHub" dashboard
├── First-Time Setup.app      # One-time double-click setup (installs Node.js + deps), custom icon
├── Start Content Manager.app # Everyday double-click launcher, custom icon (macOS)
├── First-Time Setup.command  # The actual setup script — the .app above is a thin icon/name wrapper around it
├── Start Content Manager.command  # The actual launcher script — the .app above is a thin icon/name wrapper around it
├── style.css, script.js       # Shared styling and the pointer-reactive canvas backgrounds
├── images/uploads/             # Photos uploaded via the CMS land here
└── *.html                       # Generated output — do not hand-edit, see AGENTS.md
```

Do not hand-edit the generated `.html` files in the repo root — edit `content/` (directly or via the CMS) and rebuild. See `AGENTS.md` for why, and for everything else about how this site is built.
