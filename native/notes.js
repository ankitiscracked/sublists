// JXA calls Notes' scripting dictionary, not UI keystrokes or the private database.
function run(argv) {
  const req = JSON.parse(argv[0]);
  const app = Application("Notes");
  let cache = req._cache || {};
  if (req._cachePath) {
    ObjC.import("Foundation");
    const raw = $.NSString.stringWithContentsOfFileEncodingError(req._cachePath, $.NSUTF8StringEncoding, null);
    if (!raw.isNil()) { try { cache = JSON.parse(ObjC.unwrap(raw)); } catch (_) {} }
  }
  const now = Date.now();
  // Cached values contain link metadata only, never note bodies or annotations.
  const nextCache = {};
  function cached(n, metadata) {
    const id = metadata?.id || n.id();
    const modified = metadata?.modified ?? n.modificationDate().getTime();
    return {id, modified, previous: cache[id]};
  }
  function privateNotes(f) {
    // Collection properties use four Apple events instead of four per note.
    try {
      const ids = f.notes.id(), modified = f.notes.modificationDate(), locked = f.notes.passwordProtected(), shared = f.notes.shared();
      return ids.map((id, i) => ({id, modified: modified[i].getTime(), index: i, locked: locked[i], shared: shared[i]}))
        .filter(item => !item.locked && !item.shared).map(item => ({note: f.notes[item.index], metadata: item}));
    } catch (error) {
      // Deleted Notes objects can poison a bulk read. Retain precise ghost filtering.
      if (error.errorNumber !== -1728 && !(error instanceof TypeError)) throw error;
      return available(f.notes()).filter(n => !n.passwordProtected() && !n.shared()).map(note => ({note}));
    }
  }
  // Notes can retain deleted objects in its scripting collections. Ignore only
  // that specific missing-object error, never permission or account failures.
  function available(items) {
    return items.filter(item => {
      try { item.id(); return true; }
      catch (error) { if (error.errorNumber === -1728) return false; throw error; }
    });
  }
  const accounts = app.accounts();
  if (!accounts.length) throw Error("Open Apple Notes and set up an account first.");
  const account = req.accountId ? accounts.find(a => a.id() === req.accountId) : app.defaultAccount();
  if (!account) throw Error("Notes account no longer exists. Refresh folders.");
  const candidates = account.folders.whose ? account.folders.whose({name: "Substack"})() : account.folders();
  const roots = available(candidates).filter(f => f.name() === "Substack" && f.container().id() === account.id());
  if (roots.length > 1) throw Error("Multiple Substack folders exist in this account. Rename one in Notes.");
  let root = roots[0], folderCache;
  function ensureRoot() {
    if (!root) { root = app.Folder({name: "Substack"}); account.folders.push(root); }
    if (root.shared()) throw Error("Choose a private Substack folder; shared folders are not supported.");
    return root;
  }
  function folders() {
    if (!folderCache) {
      const rootId = root?.id();
      folderCache = root ? available(root.folders()).filter(f => f.container().id() === rootId && !f.shared()) : [];
    }
    return folderCache;
  }
  function namedFolder(name) {
    ensureRoot();
    let f = folders().find(item => item.name().toLowerCase() === name.toLowerCase());
    const created = !f;
    if (!f) { f = app.Folder({name}); root.folders.push(f); folderCache.push(f); }
    return {folder: f, created};
  }
  function folder() {
    const result = folders().find(f => f.id() === req.folderId);
    if (!result) throw Error("Folder missing or shared. Refresh folders and choose again.");
    return result;
  }
  function unescape(s) { return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">"); }
  function post(n, force = false, metadata) {
    const entry = cached(n, metadata);
    if (!force && entry.previous?.modified === entry.modified && now - entry.previous.checkedAt < 30000) {
      nextCache[entry.id] = entry.previous;
      return entry.previous.post;
    }
    const body = n.body();
    const link = body.match(/<a\b[^>]*href="([^"]+)"[^>]*>(?:Read|Open) on Substack<\/a>/i);
    let value = null;
    if (link) {
      const thumb = body.match(/<a\b[^>]*href="([^"]+)"[^>]*>Thumbnail source<\/a>/i);
      const attachments = available(n.attachments());
      const duplicateThumbnail = attachments.length === 2 && attachments[0].id() === attachments[1].id() && attachments[0].name() === "thumbnail.jpg";
      value = {noteId: entry.id, title: n.name(), url: unescape(link[1]), thumbnail: thumb ? unescape(thumb[1]) : "", hasThumbnail: attachments.length > 0, duplicateThumbnail};
    }
    nextCache[entry.id] = {modified: entry.modified, checkedAt: now, post: value};
    return value;
  }
  let matchedPost;
  function findPost(f) {
    if (!f) return null;
    for (const item of privateNotes(f)) {
      const entry = cached(item.note, item.metadata);
      // Only current collection members can use the index. Modification dates
      // invalidate edited notes. Avoid same-second ambiguity in Notes timestamps.
      // Unlike thumbnail display freshness, unchanged URL index entries do
      // not expire while an article is being read. Snapshot TTL remains separate.
      const reusable = entry.previous?.modified === entry.modified && entry.previous.checkedAt >= entry.modified + 1000;
      if (reusable && entry.previous.post?.url !== req.url) continue;
      // Matches, new notes and edits get one full persisted read. Reuse this
      // readback in the response so an existing save does not read the body twice.
      const current = post(item.note, true, item.metadata);
      if (current?.url === req.url) { matchedPost = current; return item.note; }
    }
    return null;
  }
  if (root && root.shared()) throw Error("The Substack folder is shared. Use a private folder.");
  let result;
  if (req.action === "snapshot") {
    result = {accounts: accounts.map(a => ({id: a.id(), name: a.name()})), accountId: account.id(), accountName: account.name(), folders: folders().map(f => ({id: f.id(), name: f.name(), posts: privateNotes(f).map(item => post(item.note, false, item.metadata)).filter(Boolean)})).sort((a, b) => a.name.localeCompare(b.name))};
  } else if (req.action === "createFolder") {
    const selected = namedFolder(req.name), f = selected.folder;
    result = {id: f.id(), name: f.name(), accountId: account.id(), posts: [], createdFolder: selected.created};
  } else if (req.action === "save") {
    if (!!req.folderId === !!req.folderName) throw Error("Choose a list or provide a new list name before saving.");
    const selected = req.folderId ? {folder: folder(), created: false} : namedFolder(req.folderName);
    const f = selected.folder;
    let n = findPost(f);
    const existed = !!n;
    if (!n) { n = app.Note({body: req.body}); f.notes.push(n); }
    result = {...(matchedPost || post(n, true)), existed, moved: false, createdFolder: selected.created, folderId: f.id(), folderName: f.name(), accountId: account.id()};
  } else if (req.action === "verify" || req.action === "show") {
    let f, n;
    if (req.action === "verify" && req.followNote) {
      for (const candidate of folders()) {
        n = available(candidate.notes()).find(item => item.id() === req.noteId);
        if (n) { f = candidate; break; }
      }
    } else {
      f = folder();
      n = req.noteId ? available(f.notes()).find(n => n.id() === req.noteId) : null;
    }
    if (req.noteId && !n) throw Error("Note moved or deleted. Refresh folders.");
    if (n && (n.passwordProtected() || n.shared())) throw Error("Note is now locked or shared.");
    if (req.action === "show") { app.show(n || f); app.activate(); result = {}; }
    else result = {...post(n, true), folderId: f.id(), folderName: f.name(), accountId: account.id()};
  } else throw Error("Unknown Notes action.");
  // Snapshot replaces the cache, removing entries for deleted/moved-out notes.
  if (req._cachePath || req._cache) result._metadataCache = req.action === "snapshot" ? nextCache : {...cache, ...nextCache};
  return JSON.stringify(result);
}
