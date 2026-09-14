// Shared by the content script and the browser fixture; no Substack private API.
globalThis.SubstackPosts = (() => {
  function metadata(region) {
    const date = region.querySelector('time[datetime]')?.getAttribute('datetime') || "";
    return {
      author: region.querySelector('[data-author], .byline a, .byline-names a')?.textContent.trim() || "",
      publishedAt: /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : ""
    };
  }
  function canonical(value) {
    try {
      const u = new URL(value);
      if (u.protocol !== "https:" || u.username || u.password || u.port) return "";
      const note = /^(www\.)?substack\.com$/.test(u.hostname) && /^\/@[\w-]+\/note\/c-\d+\/?$/.test(u.pathname);
      if (!note && !/^\/(p\/[^/]+\/?|home\/post\/p-\d+\/?)$/.test(u.pathname)) return "";
      if (note) u.hostname = "substack.com";
      return u.origin + u.pathname.replace(/\/$/, "");
    } catch { return ""; }
  }
  function note(trigger) {
    const root = trigger?.closest('[data-entity-key]');
    if (!root?.getAttribute('data-entity-key').startsWith('c-')) return null;
    // A quoted Note/post has its own entity; use only the selected Note's content.
    const own = selector => [...root.querySelectorAll(selector)].filter(n => n.closest('[data-entity-key]') === root);
    const permalink = own('a[href*="/note/c-"]').find(a => canonical(a.href));
    if (!permalink) return null;
    const url = canonical(permalink.href), profile = new URL(url).pathname.split('/note/')[0];
    const author = own('a[href]').find(a => new URL(a.href).pathname === profile && a.textContent.trim())?.textContent.trim() || "";
    const prose = own('.FeedProseMirror, .ProseMirror')[0]?.textContent.replace(/\s+/g, ' ').trim() || "";
    const thumbnail = own('img').find(img => !/avatar/i.test(img.alt) && img.width > 80 && !/\/p\//.test(img.closest('a')?.href || ""));
    return {url, title: prose ? (prose.length > 160 ? prose.slice(0, 157) + '…' : prose) : `Note${author ? ' by ' + author : ''}`,
      publication: author, author, publishedAt: own('time[datetime]')[0]?.getAttribute('datetime')?.slice(0, 10) || "", thumbnail: thumbnail?.src || "", anchor: root};
  }
  function extract(region) {
    const found = new Map();
    for (const anchor of region.querySelectorAll('a[href*="/p/"], a[href*="/home/post/"]')) {
      const url = canonical(anchor.href);
      if (!url || found.has(url)) continue;
      const title = anchor.querySelector('[class*="clamp-"], h2, h3, [data-post-title]')?.textContent.trim();
      // Ignore links inside a saved Note unless they are an actual post attachment.
      if (!title) continue;
      const thumbnail = [...anchor.querySelectorAll("img")].find(img => !/avatar/i.test(img.alt) && (img.width > 80 || /postImage/.test(img.className)));
      const publication = anchor.querySelector('a[target="_blank"]')?.textContent.trim() || "";
      found.set(url, {url, title, publication, ...metadata(anchor), thumbnail: thumbnail?.src || "", anchor});
    }
    return [...found.values()];
  }
  function postPage(doc = document) {
    const reader = doc.querySelector("article.post-viewer-post");
    if (reader) {
      const title = [...reader.querySelectorAll('a[href*="/p/"]')].find(a => canonical(a.href));
      if (!title) return null;
      return {url: canonical(title.href), title: title.textContent.trim(),
        ...metadata(reader.querySelector('.post-header') || reader),
        publication: reader.querySelector('a[target="_blank"]')?.textContent.trim() || "",
        thumbnail: reader.querySelector("figure img")?.src || reader.querySelector('figure a[href*="substackcdn.com/"]')?.href || "", anchor: reader};
    }
    const title = doc.querySelector('.post-header h1');
    const url = canonical(doc.querySelector('link[rel="canonical"]')?.href || doc.querySelector('meta[property="og:url"]')?.content || "");
    if (!title || !url) return null;
    return {url, title: title.textContent.trim(),
      ...metadata(title.closest('.post-header')),
      author: doc.querySelector('meta[name="author"]')?.content || metadata(title.closest('.post-header')).author,
      publishedAt: doc.querySelector('meta[property="article:published_time"]')?.content?.slice(0, 10) || metadata(title.closest('.post-header')).publishedAt,
      publication: doc.querySelector('meta[property="og:site_name"]')?.content || doc.querySelector('h1 a')?.textContent.trim() || "",
      thumbnail: doc.querySelector('meta[property="og:image"]')?.content || "", anchor: title.closest('.post') || title};
  }
  function isSaved(control) {
    return control.getAttribute("aria-pressed") === "true" || [...control.classList].some(name => name.startsWith("saved-"));
  }
  function isSaveItem(control) {
    return control?.getAttribute("role") === "menuitem" && /^Save(?:\s*S)?$/i.test(control.textContent.trim());
  }
  return {canonical, extract, note, postPage, isSaved, isSaveItem};
})();
