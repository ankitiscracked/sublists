// Lists live alongside Substack's filters. Native cards remain mounted so React
// retains their menus, bookmarks and engagement handlers.
(() => {
  if (globalThis.__substackLists) return;
  globalThis.__substackLists = true;
  let state, scheduled;
  const svg = (path, size = 20) => `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  const folderIcon = svg('<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>');
  const searchIcon = svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>');
  const chevron = svg('<path d="m9 5 7 7-7 7"/>', 16);
  const refreshIcon = svg('<path d="M20 11a8 8 0 1 0-2.3 6.7M20 4v7h-7"/>', 18);
  const trashIcon = svg('<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>', 18);
  const backIcon = svg('<path d="m15 5-7 7 7 7"/>', 14);
  function el(tag, cls = '', text) {
    const node = document.createElement(tag); node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(cls, text, action) {
    const node = el('button', cls, text); node.type = 'button'; node.addEventListener('click', action); return node;
  }
  function icon(cls, html) { const node = el('span', cls); node.innerHTML = html; return node; }
  function count(n) { return `${n} saved ${n === 1 ? 'item' : 'items'}`; }
  function emptyState(folder) {
    const box = el('div', 'sf-empty');
    const copy = el('div', 'sf-empty-copy');
    const heading = el('h3', '', folder ? 'Nothing saved here yet' : 'No lists yet');
    const description = el('p');
    description.append(document.createTextNode(folder ? `Save a post or Note and choose “${folder.name}”.` : 'Save a post or Note, then create a list.'), el('br'),
      document.createTextNode(folder ? 'Your saved items will appear here.' : 'It will appear here and in Apple Notes.'));
    copy.setAttribute('role', 'status'); copy.append(heading, description);
    const browse = el('a', 'sf-browse', 'Browse Substack'); browse.href = 'https://substack.com/home';
    box.append(icon('sf-empty-icon', folderIcon), copy, browse);
    return box;
  }
  function focusIndex(s) {
    const search = s.panel.querySelector('.sf-lists-search');
    (search?.checkVisibility() ? search : s.panel.querySelector('.sf-browse'))?.focus({preventScroll: true});
  }
  function route() {
    if (['#lists', '#sf-lists'].includes(location.hash)) return {mode: 'index'};
    try {
      if (location.hash.startsWith('#list=')) return {mode: 'items', slug: decodeURIComponent(location.hash.slice(6))};
      if (location.hash.startsWith('#sf-list=')) return {mode: 'items', folderId: decodeURIComponent(location.hash.slice(9))};
    } catch { /* Malformed links leave the native Saved view available. */ }
    return null;
  }
  function idSuffix(id) {
    let hash = 2166136261;
    for (const char of id) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
    return (hash >>> 0).toString(36);
  }
  function listRoutes(folders) {
    const base = folder => folder.name.normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'list';
    const counts = new Map(), byId = new Map(), bySlug = new Map();
    for (const folder of folders) counts.set(base(folder), (counts.get(base(folder)) || 0) + 1);
    for (const folder of [...folders].sort((a, b) => a.id.localeCompare(b.id))) {
      const name = base(folder), suffix = idSuffix(folder.id);
      let slug = counts.get(name) > 1 ? `${name}-${suffix}` : name;
      while (bySlug.has(slug)) slug += `-${suffix}`;
      byId.set(folder.id, slug); bySlug.set(slug, folder.id);
    }
    return {byId, bySlug};
  }
  function resolveRoute(s, selected) {
    if (!selected || selected.mode === 'index') return selected;
    const routes = listRoutes(s.data?.folders || []);
    // Remember resolved links during this page visit so renamed lists and old
    // browser-history entries continue to target the same Notes folder.
    const oldDuplicate = s.data?.folders.find(folder => selected.slug?.endsWith('-' + idSuffix(folder.id)));
    const folderId = selected.folderId || s.routeAliases.get(selected.slug) || routes.bySlug.get(selected.slug) || oldDuplicate?.id;
    return {...selected, folderId};
  }
  function canonicalizeRoute(s) {
    if (!s.mode) return;
    if (!s.folderId && s.routeSlug) s.folderId = resolveRoute(s, {mode: 'items', slug: s.routeSlug}).folderId;
    const slug = listRoutes(s.data?.folders || []).byId.get(s.folderId);
    if (slug) {
      if (s.routeSlug) s.routeAliases.set(s.routeSlug, s.folderId);
      s.routeAliases.set(slug, s.folderId); s.routeSlug = slug;
    }
    const hash = s.mode === 'index' ? '#lists' : slug ? '#list=' + encodeURIComponent(slug) : null;
    if (hash && location.hash !== hash) history.replaceState(history.state, '', location.pathname + location.search + hash);
  }
  const viewKey = s => s.mode ? `${s.mode}:${s.folderId || s.routeSlug || ''}` : 'native';
  function scroller(s) {
    for (let node = s.feed.parentElement; node && node !== document.body; node = node.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
    }
    return document.scrollingElement;
  }
  function rememberScroll(s) { s.scrollPositions.set(viewKey(s), scroller(s).scrollTop); }
  function restoreScroll(s) {
    if (s.pendingScroll === undefined) return;
    const top = s.pendingScroll; s.pendingScroll = undefined;
    // This is route restoration, so it must not inherit page smooth scrolling.
    scroller(s).scrollTo({top, behavior: 'instant'});
  }
  function go(folderId) {
    const slug = folderId && listRoutes(state.data?.folders || []).byId.get(folderId);
    if (folderId && !slug) return;
    if (slug) state.routeAliases.set(slug, folderId);
    history.pushState(history.state, '', `${location.pathname}${location.search}${slug ? '#list=' + encodeURIComponent(slug) : '#lists'}`);
    activate();
  }
  async function request(message) {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) throw Error(result?.error || 'Apple Notes is unavailable. Try again.');
    return result;
  }
  function resetCards(s) {
    s.feed.classList.remove('sf-original-hidden', 'sf-items-feed');
    for (const [card, tabindex] of s.cards) {
      card.classList.remove('sf-filtered-out', 'sf-list-item');
      delete card.dataset.sfUrl;
      if (tabindex === null) card.removeAttribute('tabindex'); else card.setAttribute('tabindex', tabindex);
    }
    s.cards.clear();
  }
  function deactivate(s) {
    s.closeDelete?.();
    rememberScroll(s); s.mode = null; s.folderId = undefined; s.routeSlug = undefined; s.renderedView = null; s.loadSeq++;
    s.panel.hidden = true; s.fallbacks.hidden = true;
    s.tabs.classList.remove('sf-lists-active');
    s.tab.setAttribute('aria-selected', 'false'); s.tab.tabIndex = -1;
    for (const [tab, attrs] of s.nativeTabs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value === null) tab.removeAttribute(key); else tab.setAttribute(key, value);
      }
    }
    s.nativeTabs.clear(); resetCards(s);
    s.pendingScroll = s.scrollPositions.get('native') || 0; restoreScroll(s);
  }
  function cleanup() {
    if (!state) return;
    const s = state; deactivate(s);
    s.tabs.classList.remove('sf-tabs');
    s.tabs.removeEventListener('click', s.onNativeClick, true);
    s.tabs.removeEventListener('keydown', s.onKey, true);
    s.panel.remove(); s.fallbacks.remove(); s.tab.remove(); state = null;
  }
  function selectSegment(s) {
    s.tabs.classList.add('sf-lists-active');
    for (const tab of s.tabs.querySelectorAll('[role="tab"]')) {
      if (tab === s.tab) continue;
      if (!s.nativeTabs.has(tab)) s.nativeTabs.set(tab, {'aria-selected': tab.getAttribute('aria-selected'), 'data-state': tab.getAttribute('data-state'), tabindex: tab.getAttribute('tabindex')});
      tab.setAttribute('aria-selected', 'false'); tab.setAttribute('data-state', 'inactive'); tab.tabIndex = -1;
    }
    s.tab.setAttribute('aria-selected', 'true'); s.tab.tabIndex = 0;
  }
  function status(s, text, retry = false) {
    s.panel.replaceChildren(); s.panel.hidden = false;
    s.feed.classList.add('sf-original-hidden'); s.fallbacks.hidden = true;
    const box = el('div', 'sf-library-status'); box.setAttribute('role', retry ? 'alert' : 'status');
    box.append(el('p', '', text));
    if (retry) box.append(button('sf-retry', 'Retry', () => refresh(s, true)));
    s.panel.append(box);
  }
  function showRefreshError(s, message) {
    s.panel.querySelector('.sf-library-warning')?.remove();
    const warning = el('div', 'sf-library-warning'); warning.setAttribute('role', 'status');
    warning.append(el('span', '', message), button('sf-retry', 'Retry', () => refresh(s, true)));
    s.panel.append(warning);
  }
  async function refresh(s, force = false) {
    if (state !== s || !s.mode || s.loading) return s.loading;
    if (!s.data) status(s, 'Loading lists…');
    const dataRevision = s.dataRevision;
    s.loading = (async () => {
      try {
        const data = await request({action: 'snapshot', ...(force ? {refresh: true} : {})});
        if (state !== s) return;
        if (s.dataRevision === dataRevision) s.data = data;
        if (s.mode) render(s);
      } catch (error) {
        if (state === s && s.mode) {
          if (s.data) showRefreshError(s, error.message); else status(s, error.message, true);
        }
      } finally { s.loading = null; updateRefreshButton(s); }
    })();
    updateRefreshButton(s);
    return s.loading;
  }
  function updateRefreshButton(s) {
    const control = s.panel.querySelector('.sf-refresh');
    if (control) { control.disabled = !!s.loading; control.setAttribute('aria-busy', String(!!s.loading)); }
  }
  function refreshButton(s) {
    const control = button('sf-refresh', '', () => refresh(s, true));
    control.innerHTML = refreshIcon; control.title = 'Refresh lists'; control.setAttribute('aria-label', 'Refresh lists');
    return control;
  }
  function deleteButton(s) {
    const control = button('sf-refresh sf-delete-list', '', () => confirmDelete(s, control));
    control.innerHTML = trashIcon; control.title = 'Delete list'; control.setAttribute('aria-label', 'Delete list');
    control.setAttribute('aria-haspopup', 'dialog');
    return control;
  }
  function confirmDelete(s, anchor) {
    const folder = s.data.folders.find(f => f.id === s.folderId);
    if (!folder || s.closeDelete) return;
    const accountId = s.data.accountId, dialog = el('dialog', 'sf-delete-dialog');
    const title = el('h3', '', `Delete “${folder.name}”?`); title.id = 'sf-delete-title';
    const description = el('p', '', 'This removes the list and all its items from Apple Notes. Your Substack saves are kept.'); description.id = 'sf-delete-description';
    dialog.setAttribute('aria-labelledby', title.id); dialog.setAttribute('aria-describedby', description.id);
    const error = el('p', 'sf-delete-error'); error.setAttribute('role', 'alert'); error.hidden = true;
    let busy = false;
    const close = () => {
      dialog.close(); dialog.remove(); s.closeDelete = null;
      window.removeEventListener('resize', position); document.removeEventListener('scroll', position, true);
      if (anchor.isConnected) anchor.focus({preventScroll: true});
    };
    function position() {
      const rect = anchor.getBoundingClientRect(), width = dialog.offsetWidth, height = dialog.offsetHeight;
      dialog.style.left = `${Math.max(8, Math.min(rect.right - width, innerWidth - width - 8))}px`;
      dialog.style.top = `${Math.max(8, Math.min(rect.bottom + 8, innerHeight - height - 8))}px`;
    }
    const cancel = button('sf-delete-cancel', 'Cancel', close);
    const confirm = button('sf-delete-confirm', 'Delete list', async () => {
      if (busy) return;
      busy = true; cancel.disabled = confirm.disabled = true; confirm.textContent = 'Deleting…'; error.hidden = true;
      dialog.setAttribute('aria-busy', 'true');
      try {
        const result = await request({action: 'deleteFolder', accountId, folderId: folder.id});
        if (state !== s) return;
        s.dataRevision++;
        s.data = result.snapshot || {...s.data, folders: s.data.folders.filter(f => f.id !== folder.id)};
        document.dispatchEvent(new CustomEvent('sf-library-changed', {detail: {snapshot: s.data}}));
        if (s.folderId === folder.id && s.mode === 'items') {
          close(); go();
          const notice = el('p', 'sf-delete-success', `“${folder.name}” deleted.`); notice.setAttribute('role', 'status');
          s.panel.querySelector('.sf-library-toolbar').after(notice);
          focusIndex(s);
        }
      } catch (failure) {
        error.textContent = failure.message; error.hidden = false;
        confirm.textContent = 'Retry'; position();
      } finally {
        busy = false; cancel.disabled = confirm.disabled = false; dialog.setAttribute('aria-busy', 'false');
      }
    });
    const actions = el('div', 'sf-delete-actions'); actions.append(cancel, confirm);
    dialog.append(title, description, error, actions); s.panel.append(dialog); s.closeDelete = close;
    dialog.addEventListener('cancel', event => { event.preventDefault(); if (!busy) close(); });
    window.addEventListener('resize', position); document.addEventListener('scroll', position, true);
    dialog.showModal(); position(); cancel.focus({preventScroll: true});
  }
  function renderIndex(s) {
    resetCards(s); s.feed.classList.add('sf-original-hidden'); s.fallbacks.hidden = true;
    const search = el('div', 'sf-list-search'); search.innerHTML = searchIcon;
    const input = el('input', 'sf-lists-search'); input.type = 'search'; input.placeholder = 'Search lists'; input.setAttribute('aria-label', 'Search lists'); input.value = s.query;
    const clear = button('sf-clear', '', () => { input.value = ''; s.query = ''; rows(); input.focus({preventScroll: true}); });
    clear.setAttribute('aria-label', 'Clear search'); clear.innerHTML = svg('<path d="m7 7 10 10M17 7 7 17"/>', 14);
    const list = el('div', 'sf-folder-rows'); list.setAttribute('aria-label', 'Lists');
    const empty = el('div', 'sf-library-status'); empty.setAttribute('role', 'status');
    const noLists = emptyState();
    const existing = new Map();
    function rows() {
      const hasLists = !!s.data.folders.length;
      search.hidden = !hasLists; list.hidden = !hasLists; noLists.hidden = hasLists;
      toolbar.classList.toggle('sf-no-lists', !hasLists);
      if (!hasLists) { s.query = ''; input.value = ''; }
      clear.hidden = !s.query;
      const folders = s.data.folders.filter(f => f.name.toLocaleLowerCase().includes(s.query.toLocaleLowerCase().trim()));
      const visible = new Set(folders.map(f => f.id));
      for (const row of [...list.children]) if (!visible.has(row.dataset.folderId)) row.remove();
      folders.forEach((f, index) => {
        let row = existing.get(f.id);
        if (!row) {
          row = button('sf-folder-row', '', () => go(f.id)); row.dataset.folderId = f.id;
          const label = el('span', 'sf-folder-label'); label.append(el('span', 'sf-folder-name'), el('span', 'sf-folder-count'));
          row.append(icon('sf-folder-icon', folderIcon), label, icon('sf-chevron', chevron)); existing.set(f.id, row);
        }
        row.setAttribute('aria-label', `${f.name}, ${count(f.posts.length)}`);
        if (row.querySelector('.sf-folder-name').textContent !== f.name) row.querySelector('.sf-folder-name').textContent = f.name;
        if (row.querySelector('.sf-folder-count').textContent !== count(f.posts.length)) row.querySelector('.sf-folder-count').textContent = count(f.posts.length);
        if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null);
      });
      empty.hidden = !hasLists || !!folders.length;
      empty.textContent = 'No lists found.';
    }
    s.renderRows = rows;
    input.addEventListener('input', () => { s.query = input.value; rows(); });
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); clear.click(); }
      if (event.key === 'ArrowDown') { event.preventDefault(); list.querySelector('button')?.focus(); }
    });
    search.append(input, clear);
    const toolbar = el('div', 'sf-library-toolbar'); toolbar.append(search, refreshButton(s));
    s.panel.append(toolbar, list, empty, noLists); rows();
  }
  function storedCard(post) {
    const url = SubstackPosts.canonical(post.url);
    if (!url) return null;
    const note = new URL(url).pathname.includes('/note/');
    const card = el('article', 'sf-stored-item'); card.setAttribute('aria-label', note ? 'Note' : 'Post'); card.dataset.sfUrl = url;
    const source = new URL(url).hostname.replace(/\.substack\.com$/, '');
    const label = note ? new URL(url).pathname.split('/')[1] : source;
    const avatar = el('span', 'sf-item-avatar', label.replace('@', '').slice(0, 1).toUpperCase()); avatar.setAttribute('aria-hidden', 'true');
    const content = el('div', 'sf-item-content'); content.append(el('div', 'sf-item-byline', label));
    const link = el('a', note ? 'sf-item-link sf-note-link' : 'sf-item-link'); link.href = url;
    if (post.thumbnail) {
      try {
        const src = new URL(post.thumbnail);
        if (src.protocol === 'https:' && ['substackcdn.com', 'substack-post-media.s3.amazonaws.com'].includes(src.hostname)) {
          const img = el('img', 'sf-item-image'); img.src = src.href; img.alt = ''; img.loading = 'lazy'; img.addEventListener('error', () => { img.style.visibility = 'hidden'; }, {once:true}); link.append(img);
        }
      } catch { /* A broken thumbnail must not hide the saved link. */ }
    }
    link.append(el('div', note ? '' : 'sf-item-caption', post.title)); content.append(link);
    card.append(avatar, content); return card;
  }
  function filterCards(s) {
    const folder = s.data?.folders.find(f => f.id === s.folderId);
    if (s.mode !== 'items' || !folder) return;
    const scroll = scroller(s), viewportTop = scroll === document.scrollingElement ? 0 : scroll.getBoundingClientRect().top;
    // Replace placeholders as soon as native cards load, keeping the item being
    // read at the same screen position instead of pinning incomplete cards.
    const anchor = s.pendingScroll === undefined && s.panel.getBoundingClientRect().bottom <= viewportTop
      ? [...s.feed.querySelectorAll('.sf-list-item'), ...s.fallbacks.children]
        .map(card => ({url: card.dataset.sfUrl, rect: card.getBoundingClientRect()}))
        .find(item => item.rect.bottom > viewportTop) : null;
    const focusedFallback = document.activeElement?.closest('.sf-stored-item');
    const visible = new Map();
    const wanted = new Set(folder.posts.map(p => SubstackPosts.canonical(p.url))), shown = new Set();
    s.feed.classList.remove('sf-original-hidden'); s.feed.classList.add('sf-items-feed');
    for (const card of s.feed.querySelectorAll(':scope > [role="article"], :scope > article')) {
      if (!s.cards.has(card)) s.cards.set(card, card.getAttribute('tabindex'));
      let posts = s.identities.get(card);
      if (!posts) {
        // A quoted post inside a Note is not the Note's own saved identity.
        const ownNote = card.getAttribute('aria-label') === 'Note' ? SubstackPosts.note(card.querySelector('[data-entity-key^="c-"]')) : null;
        posts = ownNote ? [ownNote] : SubstackPosts.extract(card); s.identities.set(card, posts);
      }
      const match = posts.find(p => wanted.has(p.url) && !shown.has(p.url));
      card.classList.toggle('sf-filtered-out', !match); card.classList.toggle('sf-list-item', !!match);
      if (match) { shown.add(match.url); card.dataset.sfUrl = match.url; visible.set(match.url, card); }
      else { const original = s.cards.get(card); if (original === null) card.removeAttribute('tabindex'); else card.setAttribute('tabindex', original); }
    }
    const missing = folder.posts.filter(p => !shown.has(SubstackPosts.canonical(p.url)));
    const missingUrls = new Set(missing.map(p => SubstackPosts.canonical(p.url)));
    for (const card of [...s.fallbacks.children]) if (!missingUrls.has(card.dataset.sfUrl)) card.remove();
    for (const p of missing) {
      const url = SubstackPosts.canonical(p.url);
      let card = [...s.fallbacks.children].find(n => n.dataset.sfUrl === url);
      if (!card) { card = storedCard(p); if (card) s.fallbacks.append(card); }
      if (card) visible.set(url, card);
    }
    s.fallbacks.hidden = !missing.length;
    if (focusedFallback && !focusedFallback.isConnected) {
      const replacement = visible.get(focusedFallback.dataset.sfUrl);
      [...(replacement?.querySelectorAll('a[href]') || [])].find(a => SubstackPosts.canonical(a.href) === focusedFallback.dataset.sfUrl)?.focus({preventScroll: true});
    }
    if (anchor && visible.has(anchor.url)) {
      const delta = visible.get(anchor.url).getBoundingClientRect().top - anchor.rect.top;
      if (Math.abs(delta) > 0.5) scroll.scrollTo({top: scroll.scrollTop + delta, behavior: 'instant'});
    }
  }
  function render(s) {
    if (!s.mode || !s.data) return;
    canonicalizeRoute(s);
    s.panel.querySelector('.sf-library-warning')?.remove();
    const key = viewKey(s), changed = s.renderedView !== key;
    if (changed) { s.closeDelete?.(); s.panel.replaceChildren(); s.renderedView = key; }
    s.panel.hidden = false;
    if (s.mode === 'index') {
      if (changed) renderIndex(s); else s.renderRows();
      updateRefreshButton(s); restoreScroll(s); return;
    }
    if (changed) {
      const back = button('sf-back', '', () => { go(); focusIndex(s); });
      back.append(icon('', backIcon), document.createTextNode('Lists'));
      const actions = el('div', 'sf-list-actions'); actions.append(refreshButton(s), deleteButton(s));
      const toolbar = el('div', 'sf-library-toolbar'); toolbar.append(back, actions); s.panel.append(toolbar);
      const heading = el('div', 'sf-list-heading'); heading.append(el('h2'), el('span', 'sf-folder-count')); s.panel.append(heading);
      s.panel.append(el('p', 'sf-library-status'));
    }
    updateRefreshButton(s);
    const folder = s.data.folders.find(f => f.id === s.folderId);
    s.panel.querySelector('.sf-delete-list').hidden = !folder;
    const heading = s.panel.querySelector('.sf-list-heading'), message = s.panel.querySelector('.sf-library-status');
    heading.hidden = !folder;
    if (!folder) {
      s.panel.querySelector('.sf-empty')?.remove();
      resetCards(s); s.feed.classList.add('sf-original-hidden'); s.fallbacks.hidden = true;
      message.hidden = false; message.textContent = 'This list was moved or deleted in Apple Notes.'; restoreScroll(s); return;
    }
    if (heading.querySelector('h2').textContent !== folder.name) heading.querySelector('h2').textContent = folder.name;
    if (heading.querySelector('.sf-folder-count').textContent !== count(folder.posts.length)) heading.querySelector('.sf-folder-count').textContent = count(folder.posts.length);
    message.hidden = true;
    let empty = s.panel.querySelector('.sf-empty');
    if (folder.posts.length) empty?.remove();
    else if (!empty || empty.dataset.folderName !== folder.name) {
      const next = emptyState(folder); next.dataset.folderName = folder.name;
      if (empty) empty.replaceWith(next); else s.panel.append(next);
    }
    filterCards(s); restoreScroll(s);
  }
  function activate() {
    if (!state) return;
    const s = state, selected = resolveRoute(s, route());
    if (!selected) { if (s.mode) deactivate(s); return; }
    if (s.mode === selected.mode && s.folderId === selected.folderId && (selected.folderId || s.routeSlug === selected.slug)) { canonicalizeRoute(s); return; }
    rememberScroll(s);
    if (!s.mode) {
      const all = [...s.tabs.querySelectorAll('[role="tab"]')].find(t => t.textContent.trim() === 'All');
      if (all?.getAttribute('aria-selected') === 'false') { s.switching = true; all.click(); s.switching = false; }
    }
    s.mode = selected.mode; s.folderId = selected.folderId; s.routeSlug = selected.slug;
    canonicalizeRoute(s);
    s.fallbacks.replaceChildren();
    s.pendingScroll = s.scrollPositions.get(viewKey(s)) || 0;
    selectSegment(s);
    if (s.data) render(s);
    if (!s.data) refresh(s);
  }
  function mount() {
    if (location.pathname.replace(/\/$/, '') !== '/saved') { cleanup(); return; }
    const feed = document.querySelector('[aria-label="Saved items"]');
    const tabs = [...document.querySelectorAll('[role="tablist"]')].find(n => ['All','Posts','Notes'].every(label => [...n.querySelectorAll('[role="tab"]')].some(t => t.textContent.trim() === label)));
    if (!feed || !tabs) { if (state && (!state.feed.isConnected || !state.tabs.isConnected)) cleanup(); return; }
    if (state?.feed === feed && state.tabs === tabs && state.tab.isConnected) {
      if (state.mode) { selectSegment(state); filterCards(state); }
      return;
    }
    cleanup();
    const tab = button('sf-lists-tab', 'Lists', () => go());
    tab.className = `${tabs.querySelector('[role="tab"]').className} sf-lists-tab`;
    tab.id = 'sf-lists-tab'; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected','false'); tab.setAttribute('aria-controls','sf-library'); tab.tabIndex = -1;
    const panel = el('section', 'sf-library'); panel.id='sf-library'; panel.setAttribute('role','tabpanel'); panel.setAttribute('aria-labelledby',tab.id); panel.hidden=true;
    const fallbacks = el('div', 'sf-library-fallbacks'); fallbacks.hidden=true;
    tabs.append(tab); tabs.classList.add('sf-tabs'); feed.before(panel); feed.after(fallbacks);
    const s = state = {tabs,feed,tab,panel,fallbacks,mode:null,data:null,query:'',loadSeq:0,routeAliases:new Map(),dataRevision:0,loading:null,renderedView:null,cards:new Map(),nativeTabs:new Map(),identities:new WeakMap(),scrollPositions:new Map()};
    s.onNativeClick = event => {
      if (s.switching) return;
      const target = event.target.closest('[role="tab"]');
      if (target && target !== tab && s.mode) {
        deactivate(s);
        if (route()) history.replaceState(history.state, '', location.pathname + location.search);
      }
    };
    s.onKey = event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key) || !event.target.closest('[role="tab"]')) return;
      event.preventDefault(); event.stopPropagation();
      const buttons = [...tabs.querySelectorAll('[role="tab"]')], index = buttons.indexOf(event.target.closest('[role="tab"]'));
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length-1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus(); buttons[next].click();
    };
    tabs.addEventListener('click',s.onNativeClick,true); tabs.addEventListener('keydown',s.onKey,true);
    activate();
  }
  function schedule(records) {
    let relevant = false;
    for (const record of records) {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (target?.closest('.sf-library,.sf-library-fallbacks,.sf-popover,.sf-lists-tab')) continue;
      const nodes = [...record.addedNodes, ...record.removedNodes];
      if (nodes.length && nodes.every(n => n.nodeType === 1 && n.matches('.sf-library,.sf-library-fallbacks,.sf-popover,.sf-lists-tab'))) continue;
      if (state?.feed.contains(target)) {
        let card = target;
        while (card && card.parentElement !== state.feed) card = card.parentElement;
        if (card) state.identities.delete(card);
      }
      relevant = true;
    }
    if (relevant && !scheduled) scheduled = setTimeout(() => { scheduled = null; mount(); }, 40);
  }
  new MutationObserver(schedule).observe(document.body, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'data-entity-key']});
  const onRoute = () => { mount(); activate(); };
  window.addEventListener('popstate', onRoute);
  window.addEventListener('hashchange', onRoute);
  document.addEventListener('sf-library-changed', event => {
    if (!state) return;
    if (event.detail?.snapshot?.ok) {
      state.dataRevision++;
      state.data = event.detail.snapshot;
      if (state.mode) render(state);
    } else if (state.mode) refresh(state);
  });
  mount();
})();
