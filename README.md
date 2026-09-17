# Daisy Nduta — Portfolio Site

The personal portfolio site for **Daisy Nduta**, a Nairobi-based sound designer, location recordist, and cultural producer, working across Sound (Film, Theatre, Broadcast, Live, Studio), Curation & Production, and Cultural Projects.

The public site is plain static HTML/CSS/JS, hosted on **GitHub Pages** with a custom domain. Content (project credits, bios, images) is managed through a **local content management system** so Daisy can add, edit, or remove projects and photos herself, without touching code.

## Editing the site (for Daisy / non-technical use)

1. Install [Node.js](https://nodejs.org/) once, if it isn't already installed.
2. Open a terminal in this folder and run, once:
   ```sh
   npm install
   ```
3. Each time you want to make changes, run:
   ```sh
   npm run cms
   ```
4. Open **http://localhost:8080/admin/** in your browser — this is the Content Manager. Edit any page or project, add new ones, or upload images. Changes save automatically as you go, and you can preview the live site at **http://localhost:8080/**.
5. When you're happy with your changes, open **http://localhost:8080/publish.html** and click **Publish to GitHub**. Your live site updates automatically within a minute or two.

Nothing you do in step 4 is public until you complete step 5.

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
├── style.css, script.js       # Shared styling and the pointer-reactive canvas backgrounds
├── images/uploads/             # Photos uploaded via the CMS land here
└── *.html                       # Generated output — do not hand-edit, see AGENTS.md
```

Do not hand-edit the generated `.html` files in the repo root — edit `content/` (directly or via the CMS) and rebuild. See `AGENTS.md` for why, and for everything else about how this site is built.
