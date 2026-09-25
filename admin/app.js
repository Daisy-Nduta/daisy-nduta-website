(() => {
  const app = document.getElementById('app');
  const state = { collections: [], activeKey: null, activeKind: null, entries: [], activeSlug: null, entry: null, dirty: false, currentImages: [] };

  // ---------------------------------------------------------------------
  // API helper
  // ---------------------------------------------------------------------

  async function api(path, options) {
    const res = await fetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---------------------------------------------------------------------
  // Toast + confirm
  // ---------------------------------------------------------------------

  function toast(message, kind) {
    const el = document.createElement('div');
    el.className = `toast toast--${kind === 'error' ? 'err' : 'ok'}`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  function confirmDialog(message) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = `
        <div class="confirm-box">
          <p>${escapeHtml(message)}</p>
          <div class="confirm-box__actions">
            <button class="btn" data-action="cancel">Cancel</button>
            <button class="btn btn--danger" data-action="confirm">Delete</button>
          </div>
        </div>`;
      overlay.addEventListener('click', e => {
        if (e.target === overlay || e.target.dataset.action === 'cancel') {
          overlay.remove();
          resolve(false);
        } else if (e.target.dataset.action === 'confirm') {
          overlay.remove();
          resolve(true);
        }
      });
      document.body.appendChild(overlay);
    });
  }

  // ---------------------------------------------------------------------
  // Image crop -- every "Upload image" button runs the chosen photo through
  // this before it ever reaches /api/media, so the person controls what
  // part of the photo fills the (always 4:3) card/thumbnail slot instead of
  // getting whatever object-fit: cover happens to center on. Pan (drag) +
  // zoom only, no free-shape corner resize -- keeps the crop math (and the
  // UI) simple and hard to get into a broken state. GIFs skip this
  // entirely and upload untouched, since a canvas re-draw would kill the
  // animation (see the server's own isGif branch in admin-api.mjs).
  // ---------------------------------------------------------------------

  const CROP_VIEWPORT = { w: 480, h: 360 }; // 4:3, matches .entry-card__media / .item-card__media

  function openCropModal(file) {
    return new Promise(resolve => {
      if (!file.type || file.type === 'image/gif') {
        resolve(file);
        return;
      }

      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const { w: vw, h: vh } = CROP_VIEWPORT;
        const baseScale = Math.max(vw / img.naturalWidth, vh / img.naturalHeight);
        let zoom = 1;
        let offsetX = 0;
        let offsetY = 0;

        function displayScale() {
          return baseScale * zoom;
        }

        function clampOffset() {
          const s = displayScale();
          const dw = img.naturalWidth * s;
          const dh = img.naturalHeight * s;
          offsetX = Math.min(0, Math.max(offsetX, vw - dw));
          offsetY = Math.min(0, Math.max(offsetY, vh - dh));
        }

        function centerOffset() {
          const s = displayScale();
          offsetX = (vw - img.naturalWidth * s) / 2;
          offsetY = (vh - img.naturalHeight * s) / 2;
          clampOffset();
        }

        centerOffset();

        const overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.innerHTML = `
          <div class="confirm-box crop-box">
            <p>Drag the photo to reposition it, use the slider to zoom, then apply the crop.</p>
            <div class="crop-stage" style="width:${vw}px;height:${vh}px;">
              <img src="${url}" class="crop-stage__img" draggable="false">
            </div>
            <input type="range" class="crop-zoom" min="1" max="3" step="0.01" value="1">
            <div class="confirm-box__actions">
              <button class="btn" data-action="original">Use original</button>
              <button class="btn" data-action="cancel">Cancel</button>
              <button class="btn btn--primary" data-action="apply">Apply crop</button>
            </div>
          </div>`;
        document.body.appendChild(overlay);

        const stage = overlay.querySelector('.crop-stage');
        const imgEl = overlay.querySelector('.crop-stage__img');
        const zoomInput = overlay.querySelector('.crop-zoom');

        function paint() {
          const s = displayScale();
          imgEl.style.width = `${img.naturalWidth * s}px`;
          imgEl.style.height = `${img.naturalHeight * s}px`;
          imgEl.style.left = `${offsetX}px`;
          imgEl.style.top = `${offsetY}px`;
        }
        paint();

        let drag = null;
        stage.addEventListener('pointerdown', e => {
          drag = { startX: e.clientX, startY: e.clientY, origX: offsetX, origY: offsetY };
          stage.setPointerCapture(e.pointerId);
        });
        stage.addEventListener('pointermove', e => {
          if (!drag) return;
          offsetX = drag.origX + (e.clientX - drag.startX);
          offsetY = drag.origY + (e.clientY - drag.startY);
          clampOffset();
          paint();
        });
        stage.addEventListener('pointerup', () => {
          drag = null;
        });
        zoomInput.addEventListener('input', () => {
          // Zoom around the viewport's center so the point already framed
          // stays roughly framed, rather than drifting toward the image's
          // top-left corner as the scale changes.
          const before = displayScale();
          const cx = vw / 2 - offsetX;
          const cy = vh / 2 - offsetY;
          zoom = Number(zoomInput.value);
          const after = displayScale();
          offsetX = vw / 2 - cx * (after / before);
          offsetY = vh / 2 - cy * (after / before);
          clampOffset();
          paint();
        });

        function finish(result) {
          URL.revokeObjectURL(url);
          overlay.remove();
          resolve(result);
        }

        overlay.addEventListener('click', e => {
          const action = e.target.dataset.action;
          if (e.target === overlay || action === 'cancel') {
            finish(null);
          } else if (action === 'original') {
            finish(file);
          } else if (action === 'apply') {
            const s = displayScale();
            const nx = -offsetX / s;
            const ny = -offsetY / s;
            const nw = vw / s;
            const nh = vh / s;
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(nw);
            canvas.height = Math.round(nh);
            canvas.getContext('2d').drawImage(img, nx, ny, nw, nh, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(blob => finish(blob), 'image/jpeg', 0.92);
          }
        });
      };
      img.src = url;
    });
  }

  // ---------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------

  function renderShell() {
    app.innerHTML = `
      <header class="topbar">
        <a class="topbar__logo" href="/" target="_blank" rel="noopener" aria-label="Open the live site home page">Daisy Nduta</a>
        <span class="topbar__meta" id="git-meta">Local Content Manager</span>
        <div class="topbar__actions">
          <a class="btn" href="/" target="_blank" rel="noopener">Open preview</a>
          <button class="btn btn--primary" id="publish-btn">Publish to GitHub</button>
        </div>
      </header>
      <div class="layout">
        <aside class="sidebar">
          <div class="sidebar__group-label">Content</div>
          <div class="sidebar__list" id="sidebar-list"></div>
          <div class="git-status" id="git-status"></div>
        </aside>
        <main class="main" id="main">
          <div class="main__empty">Choose a page on the left, then create or edit an entry.</div>
        </main>
      </div>`;

    document.getElementById('publish-btn').addEventListener('click', handlePublish);
  }

  async function handlePublish() {
    const btn = document.getElementById('publish-btn');
    btn.disabled = true;
    btn.textContent = 'Publishing…';
    try {
      const res = await fetch('/api/publish', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        toast('Published to GitHub.', 'ok');
      } else {
        toast(`Publish failed (${data.step}): ${data.output || ''} ${data.hint || ''}`, 'error');
      }
    } catch (error) {
      toast(`Could not reach the local server: ${error.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Publish to GitHub';
      loadGitStatus();
    }
  }

  async function loadGitStatus() {
    const el = document.getElementById('git-status');
    const meta = document.getElementById('git-meta');
    if (!el) return;
    try {
      const status = await api('/git-status');
      meta.textContent = status.branch ? `Branch: ${status.branch}` : 'Local Content Manager';
      el.innerHTML = `
        <div class="git-status__label">Git connection</div>
        <div class="git-status__row"><span class="git-status__dot ${status.clean ? 'clean' : 'dirty'}"></span>${status.clean ? 'No local changes' : 'Unsaved local changes'}</div>
        <div class="git-status__row">${status.hasRemote ? 'GitHub remote connected' : 'No GitHub remote yet'}</div>
        ${!status.hasRemote ? '<div class="git-status__warning">Publish won’t work until a GitHub remote is added to this repo.</div>' : ''}
      `;
    } catch {
      el.innerHTML = '<div class="git-status__label">Git connection</div><div class="git-status__row">Unavailable</div>';
    }
  }

  // ---------------------------------------------------------------------
  // Sidebar / collections
  // ---------------------------------------------------------------------

  async function loadCollections() {
    const { collections } = await api('/collections');
    state.collections = collections;
    const list = document.getElementById('sidebar-list');
    list.innerHTML = collections
      .map(c => `<button class="sidebar__item" data-key="${c.key}">${escapeHtml(c.label)}</button>`)
      .join('') +
      `<div class="sidebar__group-label">Insights</div>
      <button class="sidebar__item" data-view="analytics">Site Visits</button>`;
    list.addEventListener('click', e => {
      const btn = e.target.closest('[data-key]');
      if (btn) selectCollection(btn.dataset.key);
      else if (e.target.closest('[data-view="analytics"]')) renderAnalytics();
    });
  }

  function setActiveSidebarItem(key) {
    document.querySelectorAll('.sidebar__item').forEach(el => {
      el.classList.toggle('active', (el.dataset.key || el.dataset.view) === key);
    });
  }

  async function selectCollection(key) {
    const collection = state.collections.find(c => c.key === key);
    if (!collection) return;
    state.activeKey = key;
    state.activeKind = collection.kind;
    state.activeSlug = null;
    setActiveSidebarItem(key);

    if (collection.kind === 'file') {
      await renderPageEditor(key);
    } else {
      await renderFolderCollection(key, collection);
    }
  }

  // ---------------------------------------------------------------------
  // Folder collections (repeatable items)
  // ---------------------------------------------------------------------

  async function renderFolderCollection(key, collection) {
    const isPage = collection.shape === 'page';
    const main = document.getElementById('main');
    main.innerHTML = `
      <div class="entry-list">
        <button class="btn btn--primary entry-list__new" id="new-entry-btn">${isPage ? '+ New page' : '+ New entry'}</button>
        <div id="entry-list-items"></div>
      </div>
      <div class="main__empty" id="editor-slot">${isPage ? 'Choose a page on the left, or create a new one.' : 'Choose an entry on the left, or create a new one.'}</div>
    `;
    document.getElementById('new-entry-btn').addEventListener('click', () => renderItemForm(key, null, collection));

    const { entries } = await api(`/collections/${key}/entries`);
    state.entries = entries;
    const listEl = document.getElementById('entry-list-items');
    listEl.innerHTML = entries.length
      ? entries.map(e => `<button class="entry-list__item" data-slug="${escapeHtml(e.slug)}">${escapeHtml(e.title)}</button>`).join('')
      : `<p style="font-size:13px;color:rgba(32,30,31,.5);padding:0 12px;">${isPage ? 'No pages yet.' : 'No entries yet.'}</p>`;
    listEl.addEventListener('click', e => {
      const btn = e.target.closest('[data-slug]');
      if (btn) openEntry(key, btn.dataset.slug, collection);
    });
  }

  async function openEntry(key, slug, collection) {
    state.activeSlug = slug;
    document.querySelectorAll('.entry-list__item').forEach(el => el.classList.toggle('active', el.dataset.slug === slug));
    const { entry } = await api(`/collections/${key}/entries/${encodeURIComponent(slug)}`);
    renderItemForm(key, entry, collection);
  }

  function detailsRowsHtml(details) {
    return (details || [])
      .map(
        (d, i) => `
        <div class="detail-row" data-index="${i}">
          <input type="text" class="detail-label" placeholder="Label (e.g. Role)" value="${escapeHtml(d.label)}">
          <input type="text" class="detail-value" placeholder="Value" value="${escapeHtml(d.value)}">
          <button type="button" class="detail-row__remove" title="Remove">&times;</button>
        </div>`
      )
      .join('');
  }

  // ---------------------------------------------------------------------
  // Multiple-images field (item detail pages + client-added Pages) --
  // state.currentImages holds the array for whichever form is open, since
  // only one form is ever open at a time in this app.
  // ---------------------------------------------------------------------

  function imagesFieldHtml() {
    return `
      <div class="field">
        <label class="field__label">Images (shown as a scrolling row on the page)</label>
        <div class="image-gallery-field" id="images-list"></div>
        <button type="button" class="btn btn--small" id="add-image-btn">+ Add image</button>
        <input type="file" id="image-file-input" accept="image/*" style="display:none">
      </div>`;
  }

  function renderImagesList() {
    const list = document.getElementById('images-list');
    if (!list) return;
    list.innerHTML = state.currentImages
      .map(
        (src, i) => `
      <div class="image-gallery-field__item">
        <div class="image-field__preview" style="background-image:url('/${escapeHtml(src)}')"></div>
        <button type="button" class="image-gallery-field__remove" data-index="${i}" title="Remove">&times;</button>
      </div>`
      )
      .join('');
  }

  function wireImagesField(initialImages) {
    state.currentImages = [...(initialImages || [])];
    renderImagesList();
    document.getElementById('add-image-btn').addEventListener('click', () => {
      document.getElementById('image-file-input').click();
    });
    document.getElementById('image-file-input').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      const cropped = await openCropModal(file);
      e.target.value = '';
      if (!cropped) return;
      const formData = new FormData();
      formData.append('file', cropped, cropped.name || 'crop.jpg');
      try {
        const res = await fetch('/api/media', { method: 'POST', body: formData });
        const uploaded = await res.json();
        if (!res.ok) throw new Error(uploaded.error || 'Upload failed');
        state.currentImages.push(uploaded.path);
        renderImagesList();
        toast('Image uploaded.', 'ok');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
    document.getElementById('images-list').addEventListener('click', e => {
      const btn = e.target.closest('.image-gallery-field__remove');
      if (!btn) return;
      state.currentImages.splice(Number(btn.dataset.index), 1);
      renderImagesList();
    });
  }

  function renderItemForm(key, entry, collection) {
    if (collection && collection.shape === 'page') {
      renderPageEntryForm(key, entry, collection);
      return;
    }

    const slot = document.getElementById('editor-slot');
    const isNew = !entry;
    const data = entry || { title: '', order: 99, cardLabel: '', cardSummary: '', details: [], images: [], body: '', link: '', alsoShowOn: '', crossListedLabel: '', crossListedHref: '', crossListedText: '' };

    slot.className = 'editor';
    slot.innerHTML = `
      <div class="editor__header">
        <span class="editor__title">${isNew ? 'New Entry' : escapeHtml(data.title)}</span>
        <div class="editor__actions">
          ${isNew ? '' : '<button class="btn btn--danger" id="delete-btn">Delete</button>'}
          <button class="btn btn--primary" id="save-btn">${isNew ? 'Create' : 'Save'}</button>
        </div>
      </div>

      <div class="field">
        <label class="field__label">Title</label>
        <input type="text" id="f-title" value="${escapeHtml(data.title)}">
      </div>

      <div class="field">
        <label class="field__label">Order (controls position on the page — lower numbers first)</label>
        <input type="number" id="f-order" value="${escapeHtml(data.order)}">
      </div>

      <div class="field">
        <label class="field__label">Card label (short tag shown on the card, e.g. a year)</label>
        <input type="text" id="f-cardLabel" value="${escapeHtml(data.cardLabel)}">
      </div>

      <div class="field">
        <label class="field__label">Card summary (one line shown on the card)</label>
        <textarea id="f-cardSummary">${escapeHtml(data.cardSummary)}</textarea>
      </div>

      <div class="field">
        <label class="field__label">Link (optional — if this is online, e.g. Vimeo/YouTube/an article, shown as "View online" on the project page)</label>
        <input type="text" id="f-link" placeholder="https://…" value="${escapeHtml(data.link)}">
      </div>

      <div class="field">
        <label class="field__label">Details (role/year/credit facts shown on the project page)</label>
        <div id="details-rows">${detailsRowsHtml(data.details)}</div>
        <button type="button" class="btn btn--small" id="add-detail-btn">+ Add detail</button>
      </div>

      ${imagesFieldHtml()}

      <div class="field">
        <label class="field__label">Description</label>
        <textarea id="f-body">${escapeHtml(data.body)}</textarea>
      </div>

      ${
        collection && collection.crossLink
          ? `
      <div class="field">
        <label class="field__label">Also show this card under (advanced — leave blank normally; enter another section's key, e.g. "curation", to also list it there)</label>
        <input type="text" id="f-alsoShowOn" value="${escapeHtml(data.alsoShowOn)}">
      </div>
      <div class="field">
        <label class="field__label">Cross-listed note (advanced — e.g. "Also listed under" / "curation-production.html" / "Production & Curation")</label>
        <input type="text" id="f-crossListedLabel" placeholder="Label" value="${escapeHtml(data.crossListedLabel)}" style="margin-bottom:8px">
        <input type="text" id="f-crossListedHref" placeholder="Link (e.g. curation-production.html)" value="${escapeHtml(data.crossListedHref)}" style="margin-bottom:8px">
        <input type="text" id="f-crossListedText" placeholder="Link text (e.g. Production & Curation)" value="${escapeHtml(data.crossListedText)}">
      </div>`
          : ''
      }
    `;

    document.getElementById('add-detail-btn').addEventListener('click', () => {
      document.getElementById('details-rows').insertAdjacentHTML('beforeend', detailsRowsHtml([{ label: '', value: '' }]));
    });
    document.getElementById('details-rows').addEventListener('click', e => {
      if (e.target.classList.contains('detail-row__remove')) e.target.closest('.detail-row').remove();
    });

    wireImagesField(data.images);

    document.getElementById('save-btn').addEventListener('click', () => saveItem(key, isNew ? null : data.slug, collection));
    if (!isNew) {
      document.getElementById('delete-btn').addEventListener('click', () => deleteItem(key, data.slug));
    }
  }

  function collectItemFields() {
    const details = Array.from(document.querySelectorAll('#details-rows .detail-row')).map(row => ({
      label: row.querySelector('.detail-label').value,
      value: row.querySelector('.detail-value').value
    }));
    const fields = {
      title: document.getElementById('f-title').value,
      order: Number(document.getElementById('f-order').value) || 99,
      cardLabel: document.getElementById('f-cardLabel').value,
      cardSummary: document.getElementById('f-cardSummary').value,
      link: document.getElementById('f-link').value,
      details,
      images: [...state.currentImages],
      body: document.getElementById('f-body').value
    };
    const alsoShowOn = document.getElementById('f-alsoShowOn');
    if (alsoShowOn) {
      fields.alsoShowOn = alsoShowOn.value;
      fields.crossListedLabel = document.getElementById('f-crossListedLabel').value;
      fields.crossListedHref = document.getElementById('f-crossListedHref').value;
      fields.crossListedText = document.getElementById('f-crossListedText').value;
    }
    return fields;
  }

  async function saveItem(key, slug, collection) {
    const fields = collectItemFields();
    if (!fields.title.trim()) {
      toast('Title is required.', 'error');
      return;
    }
    try {
      if (slug) {
        await api(`/collections/${key}/entries/${encodeURIComponent(slug)}`, { method: 'PUT', body: JSON.stringify(fields) });
        toast('Saved.', 'ok');
        openEntry(key, slug, collection);
      } else {
        const created = await api(`/collections/${key}/entries`, { method: 'POST', body: JSON.stringify(fields) });
        toast('Entry created.', 'ok');
        await renderFolderCollection(key, collection);
        openEntry(key, created.slug, collection);
      }
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function deleteItem(key, slug) {
    const ok = await confirmDialog(`Delete this entry? This can’t be undone here (though it can be recovered from GitHub history once published).`);
    if (!ok) return;
    try {
      await api(`/collections/${key}/entries/${encodeURIComponent(slug)}`, { method: 'DELETE' });
      toast('Deleted.', 'ok');
      const collection = state.collections.find(c => c.key === key);
      await renderFolderCollection(key, collection);
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  // ---------------------------------------------------------------------
  // Custom pages (a plain folder collection, but a simpler field shape --
  // title + order + optional image + body, no card/detail-list/cross-link
  // fields. Each one gets its own nav link, in creation/order sequence,
  // between Art & Culture Projects and About.)
  // ---------------------------------------------------------------------

  function renderPageEntryForm(key, entry, collection) {
    const slot = document.getElementById('editor-slot');
    const isNew = !entry;
    const data = entry || { title: '', order: 99, images: [], body: '' };

    slot.className = 'editor';
    slot.innerHTML = `
      <div class="editor__header">
        <span class="editor__title">${isNew ? 'New Page' : escapeHtml(data.title)}</span>
        <div class="editor__actions">
          ${isNew ? '' : '<button class="btn btn--danger" id="delete-btn">Delete</button>'}
          <button class="btn btn--primary" id="save-btn">${isNew ? 'Create' : 'Save'}</button>
        </div>
      </div>

      <div class="field">
        <label class="field__label">Title (also becomes the nav link and the page heading)</label>
        <input type="text" id="f-title" value="${escapeHtml(data.title)}">
      </div>

      <div class="field">
        <label class="field__label">Order (controls position in the nav — lower numbers first)</label>
        <input type="number" id="f-order" value="${escapeHtml(data.order)}">
      </div>

      ${imagesFieldHtml()}

      <div class="field">
        <label class="field__label">Body copy (leave a blank line between paragraphs)</label>
        <textarea id="f-body" style="min-height:220px">${escapeHtml(data.body)}</textarea>
      </div>
    `;

    wireImagesField(data.images);

    document.getElementById('save-btn').addEventListener('click', () => savePageEntry(key, isNew ? null : data.slug, collection));
    if (!isNew) {
      document.getElementById('delete-btn').addEventListener('click', () => deleteItem(key, data.slug));
    }
  }

  function collectPageEntryFields() {
    return {
      title: document.getElementById('f-title').value,
      order: Number(document.getElementById('f-order').value) || 99,
      images: [...state.currentImages],
      body: document.getElementById('f-body').value
    };
  }

  async function savePageEntry(key, slug, collection) {
    const fields = collectPageEntryFields();
    if (!fields.title.trim()) {
      toast('Title is required.', 'error');
      return;
    }
    try {
      if (slug) {
        await api(`/collections/${key}/entries/${encodeURIComponent(slug)}`, { method: 'PUT', body: JSON.stringify(fields) });
        toast('Saved.', 'ok');
        openEntry(key, slug, collection);
      } else {
        const created = await api(`/collections/${key}/entries`, { method: 'POST', body: JSON.stringify(fields) });
        toast('Page created.', 'ok');
        await renderFolderCollection(key, collection);
        openEntry(key, created.slug, collection);
      }
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  // ---------------------------------------------------------------------
  // Singleton pages (home / about / contact)
  // ---------------------------------------------------------------------

  async function renderPageEditor(key) {
    const main = document.getElementById('main');
    main.innerHTML = '<div class="editor" id="editor-slot"></div>';
    const { data } = await api(`/pages/${key}`);
    if (key === 'home') renderHomeForm(data);
    else if (key === 'about') renderAboutForm(data);
    else if (key === 'contact') renderContactForm(data);
    else renderSettingsForm(data);
  }

  function listFieldHtml(idPrefix, items, columns) {
    return items
      .map(
        (item, i) => `
      <div class="detail-row" data-index="${i}">
        ${columns
          .map(
            col =>
              `<input type="text" class="${idPrefix}-${col.key}" placeholder="${escapeHtml(col.placeholder)}" value="${escapeHtml(item[col.key] || '')}">`
          )
          .join('')}
        <button type="button" class="detail-row__remove" title="Remove">&times;</button>
      </div>`
      )
      .join('');
  }

  function collectListField(idPrefix, columns) {
    return Array.from(document.querySelectorAll(`#${idPrefix}-rows .detail-row`)).map(row => {
      const obj = {};
      columns.forEach(col => {
        obj[col.key] = row.querySelector(`.${idPrefix}-${col.key}`).value;
      });
      return obj;
    });
  }

  function wireListField(idPrefix, columns, emptyItem) {
    document.getElementById(`${idPrefix}-add`).addEventListener('click', () => {
      document.getElementById(`${idPrefix}-rows`).insertAdjacentHTML('beforeend', listFieldHtml(idPrefix, [emptyItem], columns));
    });
    document.getElementById(`${idPrefix}-rows`).addEventListener('click', e => {
      if (e.target.classList.contains('detail-row__remove')) e.target.closest('.detail-row').remove();
    });
  }

  // About/Contact don't have one fixed hero photo the way Sound/Production &
  // Curation/Art & Culture Projects do -- these two instead take a batch of images, and
  // the site shows a different one at random each visit (build.mjs +
  // script.js). Everything else on this form is one card = one set of
  // fields; these two need their own small multi-image gallery in the
  // middle of that shared form, so their image lists live in this
  // closure (keyed by card index) rather than in the shared `state`
  // object the single-gallery item/page forms use.
  const GALLERY_CARD_KEYS = ['about', 'contact'];

  function renderHomeForm(data) {
    const slot = document.getElementById('editor-slot');
    const cardImages = {};
    data.cards.forEach((card, i) => {
      if (GALLERY_CARD_KEYS.includes(card.key)) cardImages[i] = [...(card.images || [])];
    });

    function renderCardGallery(i) {
      const list = document.getElementById(`home-gallery-${i}`);
      if (!list) return;
      list.innerHTML = cardImages[i]
        .map(
          (src, gi) => `
        <div class="image-gallery-field__item">
          <div class="image-field__preview" style="background-image:url('/${escapeHtml(src)}')"></div>
          <button type="button" class="image-gallery-field__remove" data-index="${i}" data-image-index="${gi}" title="Remove">&times;</button>
        </div>`
        )
        .join('');
    }

    slot.innerHTML = `
      <div class="editor__header"><span class="editor__title">Home Page Cards</span><div class="editor__actions"><button class="btn btn--primary" id="save-btn">Save</button></div></div>

      <div class="field" style="max-width:640px;">
        <label class="field__label">One-line tagline (below your name)</label>
        <input type="text" id="f-tagline" value="${escapeHtml(data.tagline || '')}">
      </div>

      <p style="font-size:13px;color:rgba(32,30,31,.6);max-width:640px;margin-bottom:24px;">The 5 large cards on the home page. Order here is left-to-right, top-to-bottom.</p>
      ${data.cards
        .map((card, i) => {
          const isGallery = GALLERY_CARD_KEYS.includes(card.key);
          const mediaField = isGallery
            ? `
          <label class="field__label">Images (one is shown at random each visit)</label>
          <div class="image-gallery-field" id="home-gallery-${i}"></div>
          <button type="button" class="btn btn--small home-gallery-add" data-index="${i}">+ Add image</button>
          <input type="file" class="home-gallery-file-input" data-index="${i}" accept="image/*" style="display:none">`
            : `
          <label class="field__label">Image</label>
          <div class="image-field">
            <div class="image-field__preview" id="home-image-preview-${i}" style="${card.image ? `background-image:url('/${card.image}')` : ''}"></div>
            <div>
              <button type="button" class="btn btn--small home-upload-btn" data-index="${i}">Upload image</button>
              <button type="button" class="btn btn--small home-remove-image-btn" data-index="${i}" ${card.image ? '' : 'style="display:none"'}>Remove image</button>
              <input type="file" class="home-file-input" data-index="${i}" accept="image/*" style="display:none">
            </div>
          </div>
          <input type="hidden" class="home-image" data-index="${i}" value="${escapeHtml(card.image || '')}">`;
          return `
        <div class="field" style="border:1px solid rgba(32,30,31,.12);border-radius:8px;padding:18px;max-width:640px;">
          <label class="field__label">Card ${i + 1} — Title</label>
          <input type="text" class="home-title" value="${escapeHtml(card.title)}" style="margin-bottom:14px;">
          <label class="field__label">Small label above the title</label>
          <input type="text" class="home-label" value="${escapeHtml(card.label)}" style="margin-bottom:14px;">
          <label class="field__label">One-line summary</label>
          <textarea class="home-summary" style="margin-bottom:14px;">${escapeHtml(card.summary)}</textarea>
          ${mediaField}
        </div>`;
        })
        .join('')}
    `;

    Object.keys(cardImages).forEach(i => renderCardGallery(i));

    slot.querySelectorAll('.home-upload-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        slot.querySelector(`.home-file-input[data-index="${btn.dataset.index}"]`).click();
      });
    });
    slot.querySelectorAll('.home-file-input').forEach(input => {
      input.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        const i = input.dataset.index;
        const cropped = await openCropModal(file);
        e.target.value = '';
        if (!cropped) return;
        const formData = new FormData();
        formData.append('file', cropped, cropped.name || 'crop.jpg');
        try {
          const res = await fetch('/api/media', { method: 'POST', body: formData });
          const uploaded = await res.json();
          if (!res.ok) throw new Error(uploaded.error || 'Upload failed');
          slot.querySelector(`.home-image[data-index="${i}"]`).value = uploaded.path;
          document.getElementById(`home-image-preview-${i}`).style.backgroundImage = `url('/${uploaded.path}')`;
          slot.querySelector(`.home-remove-image-btn[data-index="${i}"]`).style.display = '';
          toast('Image uploaded.', 'ok');
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    });
    slot.querySelectorAll('.home-remove-image-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = btn.dataset.index;
        slot.querySelector(`.home-image[data-index="${i}"]`).value = '';
        document.getElementById(`home-image-preview-${i}`).style.backgroundImage = '';
        btn.style.display = 'none';
      });
    });

    slot.querySelectorAll('.home-gallery-add').forEach(btn => {
      btn.addEventListener('click', () => {
        slot.querySelector(`.home-gallery-file-input[data-index="${btn.dataset.index}"]`).click();
      });
    });
    slot.querySelectorAll('.home-gallery-file-input').forEach(input => {
      input.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        const i = input.dataset.index;
        const cropped = await openCropModal(file);
        e.target.value = '';
        if (!cropped) return;
        const formData = new FormData();
        formData.append('file', cropped, cropped.name || 'crop.jpg');
        try {
          const res = await fetch('/api/media', { method: 'POST', body: formData });
          const uploaded = await res.json();
          if (!res.ok) throw new Error(uploaded.error || 'Upload failed');
          cardImages[i].push(uploaded.path);
          renderCardGallery(i);
          toast('Image uploaded.', 'ok');
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    });
    slot.addEventListener('click', e => {
      const btn = e.target.closest('.image-gallery-field__remove');
      if (!btn) return;
      const i = btn.dataset.index;
      cardImages[i].splice(Number(btn.dataset.imageIndex), 1);
      renderCardGallery(i);
    });

    document.getElementById('save-btn').addEventListener('click', async () => {
      const titles = document.querySelectorAll('.home-title');
      const labels = document.querySelectorAll('.home-label');
      const summaries = document.querySelectorAll('.home-summary');
      const cards = data.cards.map((card, i) => {
        const base = { ...card, title: titles[i].value, label: labels[i].value, summary: summaries[i].value };
        if (GALLERY_CARD_KEYS.includes(card.key)) {
          delete base.image;
          base.images = cardImages[i];
        } else {
          base.image = slot.querySelector(`.home-image[data-index="${i}"]`).value;
        }
        return base;
      });
      const tagline = document.getElementById('f-tagline').value;
      try {
        await api('/pages/home', { method: 'PUT', body: JSON.stringify({ tagline, cards }) });
        toast('Saved.', 'ok');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  function renderAboutForm(data) {
    const slot = document.getElementById('editor-slot');
    slot.innerHTML = `
      <div class="editor__header"><span class="editor__title">About Page</span><div class="editor__actions"><button class="btn btn--primary" id="save-btn">Save</button></div></div>

      <div class="field"><label class="field__label">Small label above the heading</label><input type="text" id="f-eyebrow" value="${escapeHtml(data.eyebrow)}"></div>
      <div class="field"><label class="field__label">Heading</label><input type="text" id="f-heading" value="${escapeHtml(data.heading)}"></div>

      <div class="field">
        <label class="field__label">Bio paragraphs</label>
        <div id="para-rows">${data.paragraphs.map((p, i) => `<div class="detail-row" data-index="${i}"><textarea class="para-text" style="flex:1">${escapeHtml(p)}</textarea><button type="button" class="detail-row__remove">&times;</button></div>`).join('')}</div>
        <button type="button" class="btn btn--small" id="para-add">+ Add paragraph</button>
      </div>

      <div class="field">
        <label class="field__label">Portrait photo</label>
        <div class="image-field">
          <div class="image-field__preview" id="image-preview" style="${data.portraitImage ? `background-image:url('/${data.portraitImage}')` : ''}"></div>
          <div>
            <button type="button" class="btn btn--small" id="upload-btn">Upload image</button>
            <button type="button" class="btn btn--small" id="remove-image-btn" ${data.portraitImage ? '' : 'style="display:none"'}>Remove image</button>
            <input type="file" id="file-input" accept="image/*" style="display:none">
          </div>
        </div>
        <input type="hidden" id="f-portraitImage" value="${escapeHtml(data.portraitImage)}">
      </div>
      <div class="field"><label class="field__label">Placeholder text shown until a portrait photo is set</label><input type="text" id="f-portraitPlaceholder" value="${escapeHtml(data.portraitPlaceholder)}"></div>

      <div class="field"><label class="field__label">Awards — small label</label><input type="text" id="f-awardsLabel" value="${escapeHtml(data.awardsLabel)}"></div>
      <div class="field"><label class="field__label">Awards — heading</label><input type="text" id="f-awardsHeading" value="${escapeHtml(data.awardsHeading)}"></div>
      <div class="field">
        <label class="field__label">Awards</label>
        <div id="awards-rows">${listFieldHtml('awards', data.awards, [{ key: 'year', placeholder: 'Year' }, { key: 'text', placeholder: 'Award' }])}</div>
        <button type="button" class="btn btn--small" id="awards-add">+ Add award</button>
      </div>

      <div class="field"><label class="field__label">Residencies — small label</label><input type="text" id="f-residenciesLabel" value="${escapeHtml(data.residenciesLabel)}"></div>
      <div class="field"><label class="field__label">Residencies — heading</label><input type="text" id="f-residenciesHeading" value="${escapeHtml(data.residenciesHeading)}"></div>
      <div class="field">
        <label class="field__label">Residencies &amp; Programs</label>
        <div id="residencies-rows">${listFieldHtml('residencies', data.residencies, [{ key: 'year', placeholder: 'Year' }, { key: 'text', placeholder: 'Program' }])}</div>
        <button type="button" class="btn btn--small" id="residencies-add">+ Add residency</button>
      </div>

      <div class="field"><label class="field__label">Clients — small label</label><input type="text" id="f-clientsLabel" value="${escapeHtml(data.clientsLabel)}"></div>
      <div class="field"><label class="field__label">Clients — heading</label><input type="text" id="f-clientsHeading" value="${escapeHtml(data.clientsHeading)}"></div>
      <div class="field">
        <label class="field__label">Selected Clients</label>
        <p style="font-size:13px;color:rgba(32,30,31,.6);margin-bottom:8px;">Renders as a centered cluster of names. A client with a link is highlighted in the site's accent color; leave the link blank to show a name in plain text.</p>
        <div id="clients-rows">${listFieldHtml('clients', data.clients, [{ key: 'name', placeholder: 'Client name' }, { key: 'url', placeholder: 'Link (optional) — https://…' }])}</div>
        <button type="button" class="btn btn--small" id="clients-add">+ Add client</button>
      </div>
    `;

    document.getElementById('para-add').addEventListener('click', () => {
      document.getElementById('para-rows').insertAdjacentHTML('beforeend', `<div class="detail-row"><textarea class="para-text" style="flex:1"></textarea><button type="button" class="detail-row__remove">&times;</button></div>`);
    });
    document.getElementById('para-rows').addEventListener('click', e => {
      if (e.target.classList.contains('detail-row__remove')) e.target.closest('.detail-row').remove();
    });
    wireListField('awards', [{ key: 'year', placeholder: 'Year' }, { key: 'text', placeholder: 'Award' }], { year: '', text: '' });
    wireListField('residencies', [{ key: 'year', placeholder: 'Year' }, { key: 'text', placeholder: 'Program' }], { year: '', text: '' });
    wireListField('clients', [{ key: 'name', placeholder: 'Client name' }, { key: 'url', placeholder: 'Link (optional) — https://…' }], { name: '', url: '' });

    document.getElementById('upload-btn').addEventListener('click', () => document.getElementById('file-input').click());
    document.getElementById('file-input').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      const cropped = await openCropModal(file);
      e.target.value = '';
      if (!cropped) return;
      const formData = new FormData();
      formData.append('file', cropped, cropped.name || 'crop.jpg');
      try {
        const res = await fetch('/api/media', { method: 'POST', body: formData });
        const uploaded = await res.json();
        if (!res.ok) throw new Error(uploaded.error || 'Upload failed');
        document.getElementById('f-portraitImage').value = uploaded.path;
        document.getElementById('image-preview').style.backgroundImage = `url('/${uploaded.path}')`;
        document.getElementById('remove-image-btn').style.display = '';
        toast('Image uploaded.', 'ok');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
    document.getElementById('remove-image-btn').addEventListener('click', () => {
      document.getElementById('f-portraitImage').value = '';
      document.getElementById('image-preview').style.backgroundImage = '';
      document.getElementById('remove-image-btn').style.display = 'none';
    });

    document.getElementById('save-btn').addEventListener('click', async () => {
      const payload = {
        eyebrow: document.getElementById('f-eyebrow').value,
        heading: document.getElementById('f-heading').value,
        paragraphs: Array.from(document.querySelectorAll('.para-text')).map(t => t.value),
        portraitImage: document.getElementById('f-portraitImage').value,
        portraitPlaceholder: document.getElementById('f-portraitPlaceholder').value,
        awardsLabel: document.getElementById('f-awardsLabel').value,
        awardsHeading: document.getElementById('f-awardsHeading').value,
        awards: collectListField('awards', [{ key: 'year' }, { key: 'text' }]),
        residenciesLabel: document.getElementById('f-residenciesLabel').value,
        residenciesHeading: document.getElementById('f-residenciesHeading').value,
        residencies: collectListField('residencies', [{ key: 'year' }, { key: 'text' }]),
        clientsLabel: document.getElementById('f-clientsLabel').value,
        clientsHeading: document.getElementById('f-clientsHeading').value,
        clients: collectListField('clients', [{ key: 'name' }, { key: 'url' }])
      };
      try {
        await api('/pages/about', { method: 'PUT', body: JSON.stringify(payload) });
        toast('Saved.', 'ok');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  function renderContactForm(data) {
    const slot = document.getElementById('editor-slot');
    slot.innerHTML = `
      <div class="editor__header"><span class="editor__title">Contact Page</span><div class="editor__actions"><button class="btn btn--primary" id="save-btn">Save</button></div></div>

      <div class="field"><label class="field__label">Small label above the heading</label><input type="text" id="f-eyebrow" value="${escapeHtml(data.eyebrow)}"></div>
      <div class="field"><label class="field__label">Heading</label><input type="text" id="f-heading" value="${escapeHtml(data.heading)}"></div>
      <div class="field"><label class="field__label">Intro line</label><textarea id="f-intro">${escapeHtml(data.intro)}</textarea></div>
      <div class="field"><label class="field__label">Small label above the details</label><input type="text" id="f-reachLabel" value="${escapeHtml(data.reachLabel)}"></div>
      <div class="field"><label class="field__label">Details heading</label><input type="text" id="f-reachHeading" value="${escapeHtml(data.reachHeading)}"></div>

      <div class="field">
        <label class="field__label">Contact details</label>
        <div id="details-rows">${listFieldHtml(
          'details',
          data.details,
          [
            { key: 'label', placeholder: 'Label (e.g. Email)' },
            { key: 'linkText', placeholder: 'Text to display' },
            { key: 'href', placeholder: 'Link URL' },
            { key: 'note', placeholder: 'Note (optional)' }
          ]
        )}</div>
        <button type="button" class="btn btn--small" id="details-add">+ Add detail</button>
      </div>
    `;
    wireListField(
      'details',
      [
        { key: 'label', placeholder: 'Label (e.g. Email)' },
        { key: 'linkText', placeholder: 'Text to display' },
        { key: 'href', placeholder: 'Link URL' },
        { key: 'note', placeholder: 'Note (optional)' }
      ],
      { label: '', linkText: '', href: '', note: '' }
    );

    document.getElementById('save-btn').addEventListener('click', async () => {
      const payload = {
        eyebrow: document.getElementById('f-eyebrow').value,
        heading: document.getElementById('f-heading').value,
        intro: document.getElementById('f-intro').value,
        reachLabel: document.getElementById('f-reachLabel').value,
        reachHeading: document.getElementById('f-reachHeading').value,
        details: collectListField('details', [{ key: 'label' }, { key: 'linkText' }, { key: 'href' }, { key: 'note' }])
      };
      try {
        await api('/pages/contact', { method: 'PUT', body: JSON.stringify(payload) });
        toast('Saved.', 'ok');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  function renderSettingsForm(data) {
    const DEFAULT_ACCENT = '#a22106';
    const slot = document.getElementById('editor-slot');
    const current = /^#[0-9a-fA-F]{6}$/.test(data.accentColor || '') ? data.accentColor : DEFAULT_ACCENT;

    slot.innerHTML = `
      <div class="editor__header"><span class="editor__title">Site Settings</span><div class="editor__actions"><button class="btn btn--primary" id="save-btn">Save</button></div></div>

      <div class="field">
        <label class="field__label">Highlight color (used sparingly across the site — hover states, the active nav link, card arrows)</label>
        <div style="display:flex;align-items:center;gap:12px;">
          <input type="color" id="f-accent-picker" value="${escapeHtml(current)}" style="width:48px;height:40px;padding:0;border:1px solid rgba(32,30,31,.2);border-radius:6px;cursor:pointer;">
          <input type="text" id="f-accent-hex" value="${escapeHtml(current)}" style="max-width:140px;" maxlength="7">
          <button type="button" class="btn btn--small" id="accent-reset-btn">Reset to default</button>
        </div>
        <p style="font-size:13px;color:rgba(32,30,31,.55);margin-top:10px;max-width:520px;">This is a highlight color, not a background fill — pick something that reads clearly against white and near-black text. Changes apply the next time the site rebuilds (automatic while the Content Manager is running).</p>
      </div>
    `;

    const picker = document.getElementById('f-accent-picker');
    const hexInput = document.getElementById('f-accent-hex');
    picker.addEventListener('input', () => { hexInput.value = picker.value; });
    hexInput.addEventListener('input', () => {
      if (/^#[0-9a-fA-F]{6}$/.test(hexInput.value)) picker.value = hexInput.value;
    });
    document.getElementById('accent-reset-btn').addEventListener('click', () => {
      picker.value = DEFAULT_ACCENT;
      hexInput.value = DEFAULT_ACCENT;
    });

    document.getElementById('save-btn').addEventListener('click', async () => {
      const value = hexInput.value.trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
        toast('Enter a color as a 6-digit hex code, e.g. #a22106.', 'error');
        return;
      }
      try {
        await api('/pages/settings', { method: 'PUT', body: JSON.stringify({ accentColor: value }) });
        toast('Saved.', 'ok');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  // ---------------------------------------------------------------------
  // Site Visits (GoatCounter stats, fetched via /api/analytics/* so the API
  // key stays on the local server -- see admin-api.mjs)
  // ---------------------------------------------------------------------

  const ANALYTICS_RANGES = [7, 30, 90];
  let analyticsDays = 30;

  function formatCount(n) {
    return Number(n || 0).toLocaleString('en');
  }

  // Page titles come through as "MPavilion — Daisy Nduta"; the suffix is
  // the same on every page, so drop it.
  function pageName(page) {
    if (page.path === '/' || page.path === '/index.html') return 'Home';
    const title = String(page.title || '').replace(/\s+—\s+Daisy Nduta$/, '').trim();
    return title || page.path;
  }

  async function renderAnalytics() {
    state.activeKey = 'analytics';
    state.activeKind = null;
    setActiveSidebarItem('analytics');
    const main = document.getElementById('main');
    main.innerHTML = '<div class="editor" id="editor-slot"><p class="stats-note">Loading…</p></div>';
    const status = await api('/analytics/status');
    if (state.activeKey !== 'analytics') return;
    if (status.connected) renderAnalyticsStats(status, false);
    else renderAnalyticsConnect(status);
  }

  function renderAnalyticsConnect(status, message) {
    const slot = document.getElementById('editor-slot');
    slot.innerHTML = `
      <div class="editor__header"><span class="editor__title">Site Visits</span></div>
      ${message ? `<p class="stats-error">${escapeHtml(message)}</p>` : ''}
      <div class="field" style="max-width:560px;">
        <p class="stats-note" style="margin-top:0;">To show visitor numbers here, the Content Manager needs a read-only key from GoatCounter. This is a one-time step:</p>
        <ol class="stats-steps">
          <li>Open <a href="${escapeHtml(status.dashboardUrl)}" target="_blank" rel="noopener">your GoatCounter dashboard</a> and log in.</li>
          <li>Click your username in the top menu, then <strong>API</strong>.</li>
          <li>Create a new key with only the <strong>Read statistics</strong> permission ticked, and copy it.</li>
          <li>Paste it below and click Connect.</li>
        </ol>
        <label class="field__label" for="f-gc-token">GoatCounter API key</label>
        <div style="display:flex;gap:10px;">
          <input type="password" id="f-gc-token" autocomplete="off" spellcheck="false" style="flex:1;">
          <button class="btn btn--primary" id="gc-connect-btn">Connect</button>
        </div>
        <p class="stats-note">The key is stored in this Mac’s Keychain — not in the project folder — and is never published to the website or GitHub.</p>
      </div>`;

    const input = document.getElementById('f-gc-token');
    const btn = document.getElementById('gc-connect-btn');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Checking…';
      try {
        await api('/analytics/token', { method: 'PUT', body: JSON.stringify({ token: input.value }) });
        toast('Connected to GoatCounter.', 'ok');
        renderAnalyticsStats(status, false);
      } catch (error) {
        toast(error.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Connect';
      }
    });
  }

  async function renderAnalyticsStats(status, refresh) {
    const slot = document.getElementById('editor-slot');
    const rangeButtons = ANALYTICS_RANGES
      .map(d => `<button class="btn btn--small${d === analyticsDays ? ' btn--primary' : ''}" data-days="${d}">${d} days</button>`)
      .join('');
    slot.innerHTML = `
      <div class="editor__header">
        <span class="editor__title">Site Visits</span>
        <div class="editor__actions">
          ${rangeButtons}
          <button class="btn btn--small" id="gc-refresh-btn">Refresh</button>
          <a class="btn btn--small" href="${escapeHtml(status.dashboardUrl)}" target="_blank" rel="noopener">Full dashboard ↗</a>
        </div>
      </div>
      <div id="stats-body"><p class="stats-note">Loading…</p></div>`;

    slot.querySelectorAll('[data-days]').forEach(b => b.addEventListener('click', () => {
      analyticsDays = Number(b.dataset.days);
      renderAnalyticsStats(status, false);
    }));
    document.getElementById('gc-refresh-btn').addEventListener('click', () => renderAnalyticsStats(status, true));

    const requestedDays = analyticsDays;
    let data;
    try {
      data = await api(`/analytics/summary?days=${requestedDays}${refresh ? '&refresh=1' : ''}`);
    } catch (error) {
      if (state.activeKey !== 'analytics' || requestedDays !== analyticsDays) return;
      if (/didn’t accept the API key/.test(error.message)) {
        renderAnalyticsConnect(status, error.message);
        return;
      }
      document.getElementById('stats-body').innerHTML = `<p class="stats-error">${escapeHtml(error.message)}</p>`;
      return;
    }
    // Ignore a slow response for a range the person has since switched away from.
    if (state.activeKey !== 'analytics' || requestedDays !== analyticsDays) return;

    const body = document.getElementById('stats-body');
    const peak = Math.max(1, ...data.daily.map(d => d.count));
    const bars = data.daily.map(d => {
      const pct = (d.count / peak) * 100;
      const label = `${new Date(`${d.day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}: ${formatCount(d.count)} ${d.count === 1 ? 'visit' : 'visits'}`;
      return `<div class="stats-chart__col" data-label="${escapeHtml(label)}"><div class="stats-chart__bar" style="height:${d.count ? Math.max(pct, 2) : 0}%"></div></div>`;
    }).join('');
    const first = data.daily[0];
    const last = data.daily[data.daily.length - 1];
    const fmtDay = d => new Date(`${d.day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

    const table = (title, rows, nameOf) => `
      <section class="stats-panel">
        <h3 class="stats-panel__title">${title}</h3>
        ${rows.length ? `<table class="stats-table">
          ${rows.map(r => `<tr><td>${escapeHtml(nameOf(r))}</td><td>${formatCount(r.count)}</td></tr>`).join('')}
        </table>` : '<p class="stats-note">Nothing yet for this period.</p>'}
      </section>`;

    body.innerHTML = `
      <div class="stats-hero">
        <div class="stats-hero__number">${formatCount(data.total)}</div>
        <div class="stats-hero__label">${data.total === 1 ? 'visit' : 'visits'} in the last ${data.days} days</div>
      </div>
      ${data.daily.length ? `
      <section class="stats-panel">
        <h3 class="stats-panel__title">Visits per day</h3>
        <div class="stats-chart" role="img" aria-label="Visits per day over the last ${data.days} days, peaking at ${formatCount(peak)}">
          <div class="stats-chart__peak">${formatCount(peak)}</div>
          <div class="stats-chart__bars">${bars}</div>
          <div class="stats-chart__tip" hidden></div>
        </div>
        <div class="stats-chart__axis"><span>${fmtDay(first)}</span><span>${fmtDay(last)}</span></div>
      </section>` : ''}
      <div class="stats-grid">
        ${table('Most viewed pages', data.pages, pageName)}
        ${table('Where visitors came from', data.referrers, r => r.name)}
        ${table('Countries', data.locations, r => r.name)}
      </div>
      <p class="stats-note">Counts are unique visits, from GoatCounter. Visits from this computer while previewing in the Content Manager aren’t counted. Updated ${new Date(data.fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.</p>
      <p class="stats-note"><button class="linklike" id="gc-disconnect-btn">Disconnect GoatCounter</button></p>`;

    const chart = body.querySelector('.stats-chart');
    if (chart) {
      const tip = chart.querySelector('.stats-chart__tip');
      chart.addEventListener('mousemove', e => {
        const col = e.target.closest('.stats-chart__col');
        if (!col) { tip.hidden = true; return; }
        tip.textContent = col.dataset.label;
        tip.hidden = false;
        const box = chart.getBoundingClientRect();
        const colBox = col.getBoundingClientRect();
        const x = colBox.left - box.left + colBox.width / 2;
        tip.style.left = `${Math.min(Math.max(x, 70), box.width - 70)}px`;
      });
      chart.addEventListener('mouseleave', () => { tip.hidden = true; });
    }

    document.getElementById('gc-disconnect-btn').addEventListener('click', async () => {
      await api('/analytics/token', { method: 'DELETE' });
      toast('Disconnected from GoatCounter.', 'ok');
      renderAnalyticsConnect(status);
    });
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  async function init() {
    renderShell();
    await loadCollections();
    loadGitStatus();
  }

  init();
})();
