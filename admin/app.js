(() => {
  const app = document.getElementById('app');
  const state = { collections: [], activeKey: null, activeKind: null, entries: [], activeSlug: null, entry: null, dirty: false };

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
      .join('');
    list.addEventListener('click', e => {
      const btn = e.target.closest('[data-key]');
      if (btn) selectCollection(btn.dataset.key);
    });
  }

  function setActiveSidebarItem(key) {
    document.querySelectorAll('.sidebar__item').forEach(el => {
      el.classList.toggle('active', el.dataset.key === key);
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

  function renderItemForm(key, entry, collection) {
    if (collection && collection.shape === 'page') {
      renderPageEntryForm(key, entry, collection);
      return;
    }

    const slot = document.getElementById('editor-slot');
    const isNew = !entry;
    const data = entry || { title: '', order: 99, cardLabel: '', cardSummary: '', details: [], image: '', body: '', alsoShowOn: '', crossListedLabel: '', crossListedHref: '', crossListedText: '' };

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
        <label class="field__label">Details (role/year/credit facts shown on the project page)</label>
        <div id="details-rows">${detailsRowsHtml(data.details)}</div>
        <button type="button" class="btn btn--small" id="add-detail-btn">+ Add detail</button>
      </div>

      <div class="field">
        <label class="field__label">Image</label>
        <div class="image-field">
          <div class="image-field__preview" id="image-preview" style="${data.image ? `background-image:url('/${data.image}')` : ''}"></div>
          <div>
            <button type="button" class="btn btn--small" id="upload-btn">Upload image</button>
            <button type="button" class="btn btn--small" id="remove-image-btn" ${data.image ? '' : 'style="display:none"'}>Remove image</button>
            <input type="file" id="file-input" accept="image/*" style="display:none">
          </div>
        </div>
        <input type="hidden" id="f-image" value="${escapeHtml(data.image)}">
      </div>

      <div class="field">
        <label class="field__label">Description</label>
        <textarea id="f-body">${escapeHtml(data.body)}</textarea>
      </div>

      ${
        collection && collection.crossLink
          ? `
      <div class="field">
        <label class="field__label">Also show this card under (advanced — leave blank normally; e.g. "theatre" to also list it in Sound → Theatre)</label>
        <input type="text" id="f-alsoShowOn" value="${escapeHtml(data.alsoShowOn)}">
      </div>
      <div class="field">
        <label class="field__label">Cross-listed note (advanced — e.g. "Also listed under" / "sound.html#theatre" / "Sound → Theatre")</label>
        <input type="text" id="f-crossListedLabel" placeholder="Label" value="${escapeHtml(data.crossListedLabel)}" style="margin-bottom:8px">
        <input type="text" id="f-crossListedHref" placeholder="Link (e.g. sound.html#theatre)" value="${escapeHtml(data.crossListedHref)}" style="margin-bottom:8px">
        <input type="text" id="f-crossListedText" placeholder="Link text (e.g. Sound → Theatre)" value="${escapeHtml(data.crossListedText)}">
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

    document.getElementById('upload-btn').addEventListener('click', () => document.getElementById('file-input').click());
    document.getElementById('file-input').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('file', file);
      try {
        const res = await fetch('/api/media', { method: 'POST', body: formData });
        const uploaded = await res.json();
        if (!res.ok) throw new Error(uploaded.error || 'Upload failed');
        document.getElementById('f-image').value = uploaded.path;
        document.getElementById('image-preview').style.backgroundImage = `url('/${uploaded.path}')`;
        document.getElementById('remove-image-btn').style.display = '';
        toast('Image uploaded.', 'ok');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
    document.getElementById('remove-image-btn').addEventListener('click', () => {
      document.getElementById('f-image').value = '';
      document.getElementById('image-preview').style.backgroundImage = '';
      document.getElementById('remove-image-btn').style.display = 'none';
    });

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
      details,
      image: document.getElementById('f-image').value,
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
  // between Cultural Projects and About.)
  // ---------------------------------------------------------------------

  function renderPageEntryForm(key, entry, collection) {
    const slot = document.getElementById('editor-slot');
    const isNew = !entry;
    const data = entry || { title: '', order: 99, image: '', body: '' };

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

      <div class="field">
        <label class="field__label">Image (optional)</label>
        <div class="image-field">
          <div class="image-field__preview" id="image-preview" style="${data.image ? `background-image:url('/${data.image}')` : ''}"></div>
          <div>
            <button type="button" class="btn btn--small" id="upload-btn">Upload image</button>
            <button type="button" class="btn btn--small" id="remove-image-btn" ${data.image ? '' : 'style="display:none"'}>Remove image</button>
            <input type="file" id="file-input" accept="image/*" style="display:none">
          </div>
        </div>
        <input type="hidden" id="f-image" value="${escapeHtml(data.image)}">
      </div>

      <div class="field">
        <label class="field__label">Body copy (leave a blank line between paragraphs)</label>
        <textarea id="f-body" style="min-height:220px">${escapeHtml(data.body)}</textarea>
      </div>
    `;

    document.getElementById('upload-btn').addEventListener('click', () => document.getElementById('file-input').click());
    document.getElementById('file-input').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('file', file);
      try {
        const res = await fetch('/api/media', { method: 'POST', body: formData });
        const uploaded = await res.json();
        if (!res.ok) throw new Error(uploaded.error || 'Upload failed');
        document.getElementById('f-image').value = uploaded.path;
        document.getElementById('image-preview').style.backgroundImage = `url('/${uploaded.path}')`;
        document.getElementById('remove-image-btn').style.display = '';
        toast('Image uploaded.', 'ok');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
    document.getElementById('remove-image-btn').addEventListener('click', () => {
      document.getElementById('f-image').value = '';
      document.getElementById('image-preview').style.backgroundImage = '';
      document.getElementById('remove-image-btn').style.display = 'none';
    });

    document.getElementById('save-btn').addEventListener('click', () => savePageEntry(key, isNew ? null : data.slug, collection));
    if (!isNew) {
      document.getElementById('delete-btn').addEventListener('click', () => deleteItem(key, data.slug));
    }
  }

  function collectPageEntryFields() {
    return {
      title: document.getElementById('f-title').value,
      order: Number(document.getElementById('f-order').value) || 99,
      image: document.getElementById('f-image').value,
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
    else renderContactForm(data);
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

  function renderHomeForm(data) {
    const slot = document.getElementById('editor-slot');
    slot.innerHTML = `
      <div class="editor__header"><span class="editor__title">Home Page Cards</span><div class="editor__actions"><button class="btn btn--primary" id="save-btn">Save</button></div></div>
      <p style="font-size:13px;color:rgba(32,30,31,.6);max-width:640px;margin-bottom:24px;">The 5 large cards on the home page. Order here is left-to-right, top-to-bottom.</p>
      ${data.cards
        .map(
          (card, i) => `
        <div class="field" style="border:1px solid rgba(32,30,31,.12);border-radius:8px;padding:18px;max-width:640px;">
          <label class="field__label">Card ${i + 1} — Title</label>
          <input type="text" class="home-title" value="${escapeHtml(card.title)}" style="margin-bottom:14px;">
          <label class="field__label">Small label above the title</label>
          <input type="text" class="home-label" value="${escapeHtml(card.label)}" style="margin-bottom:14px;">
          <label class="field__label">One-line summary</label>
          <textarea class="home-summary">${escapeHtml(card.summary)}</textarea>
        </div>`
        )
        .join('')}
    `;
    document.getElementById('save-btn').addEventListener('click', async () => {
      const titles = document.querySelectorAll('.home-title');
      const labels = document.querySelectorAll('.home-label');
      const summaries = document.querySelectorAll('.home-summary');
      const cards = data.cards.map((card, i) => ({
        ...card,
        title: titles[i].value,
        label: labels[i].value,
        summary: summaries[i].value
      }));
      try {
        await api('/pages/home', { method: 'PUT', body: JSON.stringify({ cards }) });
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
        <div id="clients-rows">${listFieldHtml('clients', data.clients, [{ key: 'label', placeholder: 'Location' }, { key: 'value', placeholder: 'Client name' }])}</div>
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
    wireListField('clients', [{ key: 'label', placeholder: 'Location' }, { key: 'value', placeholder: 'Client name' }], { label: '', value: '' });

    document.getElementById('upload-btn').addEventListener('click', () => document.getElementById('file-input').click());
    document.getElementById('file-input').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('file', file);
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
        clients: collectListField('clients', [{ key: 'label' }, { key: 'value' }])
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
