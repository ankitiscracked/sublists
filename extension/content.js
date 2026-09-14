(() => {
  if (globalThis.__substackFolders) return;
  globalThis.__substackFolders = true;
  let active, pending, latestSnapshot;
  function libraryChanged(snapshot) {
    if (!snapshot?.folders) return;
    latestSnapshot = snapshot;
    active?.update(snapshot);
    document.dispatchEvent(new CustomEvent("sf-library-changed", {detail: {snapshot}}));
  }
  chrome.runtime.onMessage?.addListener(message => {
    if (message?.action === "librarySnapshot") libraryChanged(message.snapshot);
  });
  // Warm the shared cache while the user browses, before they press Save.
  chrome.runtime.sendMessage({action: "snapshot"}).then(result => {
    if (result?.ok) libraryChanged(result);
  }).catch(() => {});
  const icon = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>';
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(text, action, cls = "sf-choice") {
    const b = el("button", cls, text);
    b.type = "button";
    b.addEventListener("click", action);
    return b;
  }
  async function request(message) {
    const res = await chrome.runtime.sendMessage(message);
    if (!res?.ok) throw Error(res?.error || "Connection interrupted. Please retry.");
    return res;
  }
  function pick(entry) {
    if (active?.entry.button === entry.button) { active.close(); return; }
    active?.close();
    const {post, button: trigger} = entry;
    const pop = el("div", "sf-popover");
    pop.id = "sf-folder-picker";
    pop.popover = "auto";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Save to Apple Notes");
    const search = el("input", "sf-search");
    search.type = "search";
    search.placeholder = "Search or create list";
    search.setAttribute("aria-label", search.placeholder);
    search.maxLength = 100;
    search.autocomplete = "off";
    const list = el("div", "sf-choices");
    const message = el("p", "sf-message", "Loading folders…");
    message.setAttribute("role", "status");
    const searchBox = el("div", "sf-picker-search");
    searchBox.innerHTML = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>';
    searchBox.append(search);
    pop.append(searchBox, list, message);
    // Stay outside the post link so picker interactions cannot navigate the card.
    const link = trigger.closest("a");
    (link || trigger).after(pop);
    let snapshot = latestSnapshot, busy = false, closed = false, dismissTimer, completed = false;
    function close() { if (pop.matches(":popover-open")) pop.hidePopover(); cleanup(); }
    function position(event) {
      if (closed || (event?.target instanceof Node && pop.contains(event.target))) return;
      const r = trigger.getBoundingClientRect();
      if (!trigger.isConnected || r.bottom < 0 || r.top > innerHeight) { close(); return; }
      const below = innerHeight - r.bottom - 12, above = r.top - 12;
      const up = below < Math.min(pop.scrollHeight, 320) && above > below;
      pop.style.maxHeight = `${Math.max(0, up ? above : below)}px`;
      pop.style.left = `${Math.max(8, Math.min(r.right - pop.offsetWidth, innerWidth - pop.offsetWidth - 8))}px`;
      pop.style.top = `${up ? r.top - pop.offsetHeight - 4 : r.bottom + 4}px`;
    }
    function say(text, error = false) {
      message.textContent = text;
      message.classList.toggle("sf-error", error);
      position();
    }
    function lock(value) {
      busy = value;
      pop.setAttribute("aria-busy", String(value));
      for (const control of pop.querySelectorAll("input,button")) control.disabled = value;
    }
    function success(folder, created) {
      completed = true;
      pop.setAttribute("aria-busy", "false");
      pop.classList.add("sf-success");
      searchBox.hidden = true;
      list.replaceChildren();
      message.classList.remove("sf-error");
      message.replaceChildren();
      const check = el("span", "sf-success-icon");
      check.innerHTML = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/></svg>';
      const copy = el("span", "sf-success-copy");
      copy.append(el("span", "sf-success-title", created ? `Created “${folder.name}”` : `Saved to ${folder.name}`));
      if (created) copy.append(el("span", "sf-success-detail", "Item saved to this list"));
      message.append(check, copy);
      trigger.focus({preventScroll: true});
      position();
      dismissTimer = setTimeout(close, 2600);
      document.dispatchEvent(new CustomEvent("sf-library-changed", {detail: {snapshot: latestSnapshot || snapshot}}));
    }
    async function save(folder, name) {
      if (busy || !snapshot || closed) return;
      lock(true);
      say("Saving to Apple Notes…");
      try {
        const {anchor, ...payload} = post;
        // Creating a list and saving its first item share one Notes request.
        const res = await request({action: "save", accountId: snapshot.accountId,
          ...(folder ? {folderId: folder.id} : {folderName: name}), ...payload});
        folder = {id: res.folderId, name: res.folderName};
        if (res.snapshot) libraryChanged(res.snapshot);
        if (closed) return;
        if (res.warning) {
          if (!snapshot.folders.some(f => f.id === folder.id)) snapshot.folders.push({...folder, posts: []});
          render(); say(res.warning, true); return;
        }
        success(folder, res.createdFolder);
      } catch (error) { if (!closed) say(error.message, true); }
      finally { if (!closed && !completed) lock(false); }
    }
    function render() {
      const previousScroll = pop.scrollTop, focusedName = list.contains(document.activeElement) ? document.activeElement.dataset.folderId || document.activeElement.textContent : null;
      list.replaceChildren();
      const query = search.value.trim(), folded = query.toLocaleLowerCase();
      for (const folder of snapshot.folders.filter(f => f.name.toLocaleLowerCase().includes(folded))) {
        const b = button("", () => save(folder));
        b.dataset.folderId = folder.id;
        b.innerHTML = icon;
        b.append(el("span", "sf-name", folder.name));
        if (folder.posts.some(p => SubstackPosts.canonical(p.url) === post.url)) {
          b.append(el("span", "sf-check", "✓"));
          b.title = "Already saved. Select to check or retry the thumbnail.";
        }
        list.append(b);
      }
      if (query && !snapshot.folders.some(f => f.name.toLocaleLowerCase() === folded)) {
        const create = button("", () => save(null, query));
        create.append(el("span", "sf-plus", "+"), el("span", "sf-name", `Create “${query}”`));
        list.append(create);
      }
      say(snapshot.folders.length || query ? "" : "Type a name to create your first folder.");
      if (focusedName) [...list.children].find(b => (b.dataset.folderId || b.textContent) === focusedName)?.focus({preventScroll: true});
      pop.scrollTop = previousScroll;
    }
    function update(data) {
      if (closed || completed || busy) return;
      const key = value => JSON.stringify(value?.folders.map(f => [f.id, f.name, f.posts.some(p => SubstackPosts.canonical(p.url) === post.url)]));
      const changed = key(snapshot) !== key(data);
      snapshot = data;
      if (changed || !list.children.length) render();
      lock(false);
    }
    async function load() {
      // Opening or dismissing the chooser never writes anything to Apple Notes.
      if (snapshot) { render(); lock(false); search.focus({preventScroll: true}); }
      else { lock(true); say("Loading folders…"); }
      try {
        // Cached immediately; only an uncached library needs a Notes read.
        const data = await request({action: "snapshot"});
        if (!closed && !busy) update(data);
        else if (!closed && pop.querySelector('.sf-search')?.disabled && !list.children.length) {
          snapshot = data;
          render(); lock(false); search.focus({preventScroll: true});
        }
      } catch (error) {
        if (closed || completed || busy && list.children.length) return;
        lock(false); say(error.message, true);
        list.append(button("Retry", load), button("Open setup", async () => {
          try { await request({action: "setup"}); } catch (e) { say(e.message, true); }
        }));
      }
    }
    search.addEventListener("input", render);
    pop.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); close(); trigger.focus({preventScroll: true}); return; }
      if (event.key === "Enter" && event.target === search) { event.preventDefault(); list.querySelector("button:not(:disabled)")?.click(); }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const choices = [search, ...list.querySelectorAll("button:not(:disabled)")];
      const index = choices.indexOf(document.activeElement), direction = event.key === "ArrowDown" ? 1 : -1;
      choices[(index + direction + choices.length) % choices.length].focus();
    });
    function cleanup() {
      if (closed) return;
      closed = true;
      clearTimeout(dismissTimer);
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      pop.remove();
      if (active?.pop === pop) active = null;
    }
    pop.addEventListener("toggle", event => { if (event.newState === "closed") cleanup(); });
    active = {entry, pop, close, update, path: location.pathname};
    pop.showPopover(); position();
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    load();
  }
  // Observe the click without cancelling Substack's own save/unsave handler.
  document.addEventListener("click", event => {
    if (!(event.target instanceof Element) || event.target.closest(".sf-popover")) return;
    const item = event.target.closest('[role="menuitem"]');
    const direct = event.target.closest('button[aria-label="Save"]');
    let trigger, post;
    if (SubstackPosts.isSaveItem(item)) {
      const menu = item.closest('[role="menu"]');
      trigger = document.getElementById(menu?.getAttribute("aria-labelledby"));
      if (!trigger) return;
      const card = trigger.closest('[role="article"], article');
      const entity = trigger.closest('[data-entity-key]');
      if (entity?.getAttribute('data-entity-key').startsWith('c-') || card?.getAttribute('aria-label') === 'Note') {
        post = SubstackPosts.note(trigger);
      } else {
        post = (card && SubstackPosts.extract(card)[0]) || SubstackPosts.postPage();
      }
    } else if (direct && !direct.disabled && !SubstackPosts.isSaved(direct)) {
      trigger = direct;
      const card = direct.closest('[role="article"], article') || direct.closest('a')?.parentElement;
      post = card && SubstackPosts.extract(card).find(post => post.anchor.contains(direct));
      if (!post) post = SubstackPosts.note(direct);
      if (!post && (!card || card.matches('article.post-viewer-post, article.post'))) post = SubstackPosts.postPage();
    }
    if (!post || !trigger || trigger.disabled) return;
    clearTimeout(pending);
    const path = location.pathname;
    // Let native menus dismiss and restore focus before opening our popover.
    pending = setTimeout(() => {
      if (location.pathname === path && trigger.isConnected && post.anchor.isConnected) pick({post, button: trigger});
    }, 60);
  }, true);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && active) {
      active.close();
      // The success confirmation already restored focus to the save button.
    }
  });
  function checkAnchor() {
    if (active && (location.pathname !== active.path || !active.entry.button.isConnected || !active.entry.post.anchor.isConnected)) active.close();
  }
  new MutationObserver(checkAnchor).observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ["href"]});
  window.addEventListener("popstate", checkAnchor);
})();
