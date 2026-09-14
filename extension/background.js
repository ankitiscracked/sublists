// One shared, durable cache for every Substack tab. Notes remains the source of truth.
const HOST = "com.substackfolders.notes", QUEUE_ALARM = "sf-thumbnails";
let libraries = {}, defaultAccountId, revision = 0, journal = [], queue = {}, draining;
const reads = new Map();
const ready = chrome.storage.local.get(["libraries", "defaultAccountId", "thumbnailQueue"]).then(saved => {
  libraries = saved.libraries || {}; defaultAccountId = saved.defaultAccountId; queue = saved.thumbnailQueue || {};
});
async function native(message) {
  try { return await chrome.runtime.sendNativeMessage(HOST, message); }
  catch (error) {
    const missing = /specified native messaging host not found/i.test(error.message || "");
    return {ok: false, code: missing ? "COMPANION_MISSING" : "CONNECTION_FAILED",
      error: missing ? "Install the Sublists helper to connect Apple Notes." : "Couldn’t connect to Apple Notes."};
  }
}
function patch(data, message, result) {
  if (data.accountId !== result.accountId) return;
  if (message.action === "attachThumbnail") {
    // Image completion never moves or reorders a card: filing can finish while it downloads.
    const existing = data.folders.flatMap(f => f.posts).find(p => p.noteId === result.noteId);
    if (existing) Object.assign(existing, {hasThumbnail: result.hasThumbnail, duplicateThumbnail: result.duplicateThumbnail, thumbnailPending: false});
    return;
  }
  let folder = data.folders.find(f => f.id === (result.folderId || result.id));
  if (!folder) {
    folder = {id: result.folderId || result.id, name: result.folderName || result.name, posts: []};
    data.folders.push(folder);
  }
  if (message.action === "createFolder") { folder.name = result.name; return; }
  if (!result.noteId) return;
  // A move preserves the note's identity. Copies in other lists have distinct IDs.
  for (const f of data.folders) f.posts = f.posts.filter(p => p.noteId !== result.noteId);
  const {noteId, title, url, thumbnail, hasThumbnail, duplicateThumbnail, thumbnailPending} = result;
  folder.posts.push({noteId, title, url, thumbnail, hasThumbnail, duplicateThumbnail, thumbnailPending});
}
async function publish(data) {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.map(tab => chrome.tabs.sendMessage(tab.id, {action: "librarySnapshot", snapshot: data})));
}
async function persistLibraries() { await chrome.storage.local.set({libraries, defaultAccountId}); }
async function record(message, result) {
  revision++;
  if (reads.size) journal.push({revision, message, result});
  const entry = libraries[result.accountId];
  if (entry) { patch(entry.data, message, result); await persistLibraries(); void publish(entry.data).catch(() => {}); }
}
async function refresh(accountId) {
  const key = accountId || defaultAccountId || "default";
  if (reads.has(key)) return reads.get(key);
  const started = revision;
  const pending = (async () => {
    const result = await native({action: "snapshot", ...(accountId ? {accountId} : {})});
    if (!result.ok) return result;
    for (const change of journal) if (change.revision > started) patch(result, change.message, change.result);
    if (!accountId) defaultAccountId = result.accountId;
    libraries[result.accountId] = {data: result};
    await persistLibraries(); void publish(result).catch(() => {});
    return result;
  })();
  reads.set(key, pending);
  try { return await pending; }
  finally { reads.delete(key); if (!reads.size) journal = []; }
}
async function snapshot(message) {
  await ready;
  const entry = libraries[message.accountId || defaultAccountId];
  // Extension writes keep the library current. Read Notes only for the first
  // load or an explicit refresh, never because cached data has reached an age.
  if (entry && !message.refresh) return {...entry.data, cached: true};
  return refresh(message.accountId);
}
async function saveQueue() {
  await chrome.storage.local.set({thumbnailQueue: queue});
  if (Object.keys(queue).length) await chrome.alarms.create(QUEUE_ALARM, {delayInMinutes: 1});
  else await chrome.alarms.clear(QUEUE_ALARM);
}
async function enqueue(message, result) {
  if (!result.thumbnailPending) return;
  queue[result.noteId] = {
    action: "attachThumbnail", accountId: result.accountId, folderId: result.folderId,
    noteId: result.noteId, url: result.url, thumbnail: result.thumbnail || message.thumbnail
  };
  // Persist before returning success so a service-worker restart cannot lose the image.
  await saveQueue();
}
function drain() {
  if (draining) return draining;
  draining = (async () => {
    await ready;
    // One attempt per pending image per pass. Failures retry after the next alarm.
    for (const [id, job] of Object.entries(queue)) {
      const result = await native(job);
      if (result.permanent) { if (queue[id] === job) delete queue[id]; }
      else if (result.ok && !result.warning) {
        // A newer save may replace this job while its network request is running.
        if (queue[id] === job) delete queue[id];
        await record(job, result);
      }
      await saveQueue();
    }
  })().finally(() => { draining = null; });
  return draining;
}
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === QUEUE_ALARM) void drain(); });
chrome.runtime.onStartup.addListener(() => { void drain(); });
chrome.runtime.onInstalled.addListener(() => { void drain(); });
chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({url: "https://substack.com/saved#lists"});
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  let url; try { url = sender.url ? new URL(sender.url) : null; } catch { return; }
  const publication = url?.protocol === "https:" && (url.hostname === "substack.com" || url.hostname.endsWith(".substack.com"));
  const internal = sender.url?.startsWith(chrome.runtime.getURL(""));
  if (sender.id !== chrome.runtime.id || (!internal && !publication)) return;
  (async () => {
    await ready;
    if (message?.action === "setup") { await chrome.tabs.create({url: "https://github.com/ankitiscracked/sublists#install"}); return {ok: true}; }
    if (message?.action === "snapshot") return snapshot(message);
    if (!["ping", "createFolder", "save", "show"].includes(message?.action)) return {ok: false, error: "Unknown action."};
    const result = await native(message.action === "save" ? {...message, deferThumbnail: true} : message);
    if (result.ok && ["save", "createFolder"].includes(message.action)) {
      await Promise.all([record(message, result), enqueue(message, result)]);
      if (libraries[result.accountId]) result.snapshot = libraries[result.accountId].data;
      // Let the confirmed save response reach the picker before downloading images.
      setTimeout(() => { void drain(); }, 0);
    }
    return result;
  })().then(respond).catch(error => respond({ok: false, error: error.message || "Connection interrupted. Please retry."}));
  return true;
});
