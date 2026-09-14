// Preview-only transport. This file is not shipped inside the Chrome extension.
const previewFailure = new URL(location.href).searchParams.get("failure");
const listPreview = location.pathname === "/saved" || new URL(location.href).searchParams.has("lists");
history.replaceState(null, "", listPreview ? "/saved" + location.hash : "/home");
const demoPosts = [
  {title: "The quiet art of paying attention", publication: "Field Notes", url: "https://example.substack.com/p/paying-attention", color: "#536553", label: "FIELD NOTES", author: "Maya", date: "Sep 6"},
  {title: "Good design leaves room for living", publication: "Objects & Ideas", url: "https://example.substack.com/p/room-for-living", color: "#685b49", label: "OBJECTS & IDEAS", author: "Alex", date: "Sep 4"},
  {title: "A weekend without a plan", publication: "Small Journeys", url: "https://example.substack.com/p/weekend-without-a-plan", color: "#485b70", label: "SMALL JOURNEYS", author: "Sam", date: "Sep 2"}
];
const feed = document.querySelector('[aria-label="Saved items"]');
for (const p of demoPosts) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="340"><rect width="800" height="340" fill="${p.color}"/><circle cx="625" cy="118" r="130" fill="#fff" opacity=".08"/><path d="M0 300L250 130 460 340H0" fill="#fff" opacity=".07"/><text x="40" y="70" font-family="Georgia" font-size="20" fill="#e6e2d8" letter-spacing="5">${p.label.replaceAll('&','&amp;')}</text><path d="M40 100H140" stroke="#e6e2d8" opacity=".4"/></svg>`;
  const article = document.createElement("article"); article.className = "feedItem-demo"; article.setAttribute("aria-label", "Post");
  article.innerHTML = `<div class="byline"><span class="avatar">${p.author[0]}</span>${p.author}<span class="date">${p.date}</span></div><div><a class="postAttachment-demo" href="${p.url}"><img class="postImage-demo" width="600" alt="" src="data:image/svg+xml,${encodeURIComponent(svg)}"><div class="post-meta"><span class="publication">${p.publication}</span><div class="clamp-demo">${p.title}</div><button type="button" aria-label="Save" class="native-save" aria-pressed="false">▮</button></div></a></div><div class="engagement">♡ 42 ◯ 8 ↗</div>`;
  feed.append(article);
}
const db = {accounts:[{id:"preview",name:"Preview"}],accountId:"preview",accountName:"Preview",folders:[{id:"essays",name:"Essays",posts:[]},{id:"design",name:"Design",posts:[]},{id:"weekend",name:"Weekend reads",posts:[]}]};
let failNext = false;
window.previewFailure = previewFailure;
window.previewRequests = [];
window.chrome = {runtime:{sendMessage:async req => {
  if (req.action !== "setup" && (window.previewFailure || failNext)) { failNext = false; return {ok:false,code:window.previewFailure === "missing" ? "COMPANION_MISSING" : "CONNECTION_FAILED",error:"Simulated connection failure. Retry safely."}; }
  window.previewRequests.push(structuredClone(req));
  if (req.action === "snapshot") return structuredClone({ok:true,...db});
  if (req.action === "deleteFolder") {
    db.folders = db.folders.filter(f => f.id !== req.folderId);
    return structuredClone({ok:true,deleted:true,folderId:req.folderId,accountId:db.accountId,snapshot:{ok:true,...db}});
  }
  if (req.action === "createFolder") {
    let f = db.folders.find(f=>f.name.toLowerCase()===req.name.toLowerCase());
    if (!f) { f={id:crypto.randomUUID(),name:req.name,posts:[]}; db.folders.push(f); }
    return structuredClone({ok:true,...f,accountId:db.accountId,snapshot:{ok:true,...db}});
  }
  if (req.action === "save") {
    window.lastSavedRequest = structuredClone(req);
    if ((!req.folderId && !req.folderName) || (req.folderId && req.folderName)) return {ok:false,error:'Choose a list first.'};
    let f=req.folderId ? db.folders.find(f=>f.id===req.folderId) : db.folders.find(f=>f.name.toLowerCase()===req.folderName.toLowerCase());
    let createdFolder=false;
    if (!f && req.folderId) return {ok:false,error:"Folder missing"};
    if (!f) { f={id:crypto.randomUUID(),name:req.folderName,posts:[]}; db.folders.push(f); createdFolder=true; }
    const old=f.posts.find(p=>p.url===req.url);
    if (!old) f.posts.push({title:req.title,url:req.url,thumbnail:"",noteId:crypto.randomUUID(),hasThumbnail:true});
    return structuredClone({ok:true,...f.posts.find(p=>p.url===req.url),accountId:db.accountId,createdFolder,existed:!!old,hasThumbnail:true,folderId:f.id,folderName:f.name,snapshot:{ok:true,...db}});
  }
  if (req.action === "show") return {ok:false,error:"Preview only. Installed extension opens the real Apple Notes folder."};
  if (req.action === "setup") { window.open("https://github.com/ankitiscracked/sublists#install", "_blank", "noopener"); return {ok:true}; }
  return {ok:true};
}}};
document.querySelector("#theme").onclick=()=>document.body.classList.toggle("light");
// Test hooks are local to this preview, never accessible from the installed extension.
const failButton=document.createElement("button");failButton.textContent="Simulate connection error";failButton.id="simulate-error";failButton.onclick=()=>{failNext=true;};document.querySelector(".demo-banner").append(failButton);

// Simulate Substack's delegated bookmark/card handlers to check capture precedence.
window.nativeSaveClicks = 0;
window.nativeCardClicks = 0;
feed.addEventListener("click", event => {
  if (event.target.closest('button[aria-label="Save"]')) { event.preventDefault(); window.nativeSaveClicks++; const b=event.target.closest('button[aria-label="Save"]');b.setAttribute("aria-pressed",String(b.getAttribute("aria-pressed")!=="true")); }
  else if (event.target.closest("a")) { event.preventDefault(); window.nativeCardClicks++; }
});

// Native filter fixture: original controls and handlers must survive Lists.
for (const tab of document.querySelectorAll('.page-tabs [role="tab"]')) {
 tab.onclick=()=>{
  for(const t of document.querySelectorAll('.page-tabs [role="tab"]')) {t.setAttribute('aria-selected',String(t===tab));t.dataset.state=t===tab?'active':'inactive';}
  for(const item of feed.children) item.hidden=tab.textContent==='Posts'?item.getAttribute('aria-label')==='Note':tab.textContent==='Notes'?item.getAttribute('aria-label')!=='Note':false;
 };
}
if(listPreview) {
 const note=document.createElement('article');note.setAttribute('aria-label','Note');note.setAttribute('role','article');note.className='feedItem-demo';
 note.innerHTML='<div data-entity-key="c-123"><div class="byline"><span class="avatar">M</span><a href="https://substack.com/@maya">Maya Chen</a><a href="https://substack.com/@maya/note/c-123">Sep 6</a></div><div class="FeedProseMirror">The best design references are the ones you keep coming back to.</div></div>';
 feed.append(note);
 db.folders.find(f=>f.id==='design').posts=[
  {noteId:'design-post',title:demoPosts[0].title,url:demoPosts[0].url,thumbnail:''},
  {noteId:'design-note',title:'The best design references are the ones you keep coming back to.',url:'https://substack.com/@maya/note/c-123',thumbnail:''},
  {noteId:'design-unloaded',title:'A saved article outside the loaded feed',url:'https://example.substack.com/p/outside-feed',thumbnail:''}
 ];
 db.folders.find(f=>f.id==='weekend').posts=[{noteId:'weekend-post',title:demoPosts[1].title,url:demoPosts[1].url,thumbnail:''}];
}
