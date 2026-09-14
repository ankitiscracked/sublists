// Run with node tests/check.mjs. Models the Notes scripting interface without user data.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const base = new URL('../', import.meta.url);
const postsContext = vm.createContext({URL});
vm.runInContext(readFileSync(new URL('extension/posts.js', base),'utf8'),postsContext);
const canonical = postsContext.SubstackPosts.canonical;
assert.equal(canonical('https://example.substack.com/p/title/?utm_source=web#x'),'https://example.substack.com/p/title');
assert.equal(canonical('https://substack.com/home/post/p-123'),'https://substack.com/home/post/p-123');
assert.equal(canonical('https://www.substack.com/@writer/note/c-123/?utm_source=app#x'),'https://substack.com/@writer/note/c-123');
for (const u of ['https://evil.com/@writer/note/c-123','https://substack.com/@writer/note/c-no','https://substack.com/@writer/note/c-123/extra']) assert.equal(canonical(u),'');
for (const u of ['javascript:alert(1)','file:///x','https://u:p@substack.com/p/x','https://substack.com/saved']) assert.equal(canonical(u),'');

let serial=0;
const items=[];
const collection = owner => {
  const list=[];
  const get=()=>list;
  get.push=item=>{item.owner=owner;list.push(item);};
  return get;
};
function folder(name) {
  const id=`folder-${++serial}`, f={id:()=>id,name:()=>name,container:()=>f.owner,shared:()=>false};
  f.folders=collection(f);f.notes=collection(f);return f;
}
function note(body) {
  const id=`note-${++serial}`;
  return {modificationDate:()=>new Date(1000),id:()=>id,name:()=>body.match(/<h1>(.*?)<\/h1>/)[1],body:()=>body,attachments:()=>[],passwordProtected:()=>false,shared:()=>false};
}
const account={id:()=>"account-1",name:()=>"Test account"};account.folders=collection(account);
const app={accounts:()=>[account],defaultAccount:()=>account,Folder:({name})=>folder(name),Note:({body})=>note(body),show:()=>{},activate:()=>{}};
app.move=(n,{to})=>{const source=n.owner.notes();source.splice(source.indexOf(n),1);to.notes.push(n);};
const context=vm.createContext({Application:()=>app,JSON});
vm.runInContext(readFileSync(new URL('native/notes.js',base),'utf8'),context);
const run = req=>JSON.parse(context.run([JSON.stringify(req)]));
assert.equal(run({action:'snapshot'}).folders.length,0);
const f=run({action:'createFolder',name:'Design'});
assert.equal(run({action:'createFolder',name:'design'}).id,f.id);
assert.equal(account.folders().length,1);
const request={action:'save',folderId:f.id,url:'https://example.substack.com/p/test',body:'<h1>Test post</h1><p><a href="https://example.substack.com/p/test">Read on Substack</a></p>'};
const first=run(request),again=run(request);
assert.equal(first.existed,false);assert.equal(again.existed,true);assert.equal(first.noteId,again.noteId);
assert.equal(run({action:'snapshot'}).folders[0].posts.length,1);
assert.equal(run({action:'verify',folderId:f.id,noteId:first.noteId}).url,request.url);
const savedNote=account.folders()[0].folders()[0].notes()[0];
const image={id:()=>"image-1",name:()=>"thumbnail.jpg"};
savedNote.attachments=()=>[image,image];
assert.equal(run({action:'verify',folderId:f.id,noteId:first.noteId}).duplicateThumbnail,true);
savedNote.attachments=()=>[image,{id:()=>"image-2",name:()=>"user-image.jpg"}];
assert.equal(run({action:'verify',folderId:f.id,noteId:first.noteId}).duplicateThumbnail,false);
savedNote.attachments=()=>[image];
assert.equal(run({action:'verify',folderId:f.id,noteId:first.noteId}).duplicateThumbnail,false);
assert.throws(()=>run({action:'save',folderId:'missing',url:request.url}),/Folder missing/);
assert.throws(()=>run({action:'snapshot',accountId:'missing'}),/no longer exists/);

// A list choice is mandatory. Existing Inbox contents are ordinary user data.
assert.throws(() => run({action:'save', url:request.url, body:request.body}), /Choose a list/);
assert.equal(account.folders()[0].folders().some(folder => folder.name() === 'Inbox'), false);
const legacyInbox = folder('Inbox');
account.folders()[0].folders.push(legacyInbox);
const legacyBody = '<h1>Existing item</h1><p><a href="https://example.substack.com/p/legacy">Open on Substack</a></p><p>User annotation</p>';
const legacyNote = note(legacyBody);
legacyNote.attachments = () => [image];
legacyInbox.notes.push(legacyNote);
const combined = run({action:'save', folderName:'Reading', url:'https://example.substack.com/p/combined', body:'<h1>Combined</h1><p><a href="https://example.substack.com/p/combined">Open on Substack</a></p>'});
assert.equal(combined.createdFolder, true);
const reused = run({action:'save', folderName:'reading', url:combined.url, body:'DO NOT OVERWRITE'});
assert.equal(reused.createdFolder, false);
assert.equal(reused.noteId, combined.noteId);
const explicitlySaved = run({action:'save', folderId:f.id, url:'https://example.substack.com/p/legacy', body:legacyBody});
assert.notEqual(explicitlySaved.noteId, legacyNote.id());
assert.equal(explicitlySaved.moved, false);
assert.equal(legacyInbox.notes()[0].id(), legacyNote.id());
assert.equal(legacyNote.body(), legacyBody);
assert.equal(legacyNote.attachments().length, 1);
assert.throws(() => run({action:'save', folderId:'missing', url:request.url}), /Folder missing/);
console.log('PASS: mandatory list choice, combined create-and-save, existing list reuse, legacy Inbox content untouched.');

// Cache skips unchanged nonmatching bodies during duplicate checks; matching
// IDs, modified notes and new notes still get current persisted-link readback.
const destination = account.folders()[0].folders().find(folder => folder.id() === f.id);
const tracked = destination.notes().find(item => item.id() === explicitlySaved.noteId);
const originalBody = tracked.body;
let bodyReads = 0;
tracked.body = () => { bodyReads++; return originalBody(); };
const cacheFirst = run({action:'snapshot', _cache:{}});
const metadataCache = cacheFirst._metadataCache;
bodyReads = 0;
run({action:'snapshot', _cache:metadataCache});
assert.equal(bodyReads, 0);
run({...request, _cache:metadataCache});
assert.equal(bodyReads, 0, 'Unchanged nonmatches do not read body');
const hourOldCache = structuredClone(metadataCache);
for (const entry of Object.values(hourOldCache)) entry.checkedAt = Date.now() - 3600000;
run({...request, _cache:hourOldCache});
assert.equal(bodyReads, 0, 'An hour-old unchanged URL index still skips nonmatching bodies');
tracked.modificationDate = () => new Date(2000);
const updatedCache = run({action:'snapshot', _cache:metadataCache});
assert.equal(bodyReads, 1);
assert.equal(updatedCache._metadataCache[tracked.id()].modified, 2000);
run({action:'verify', folderId:f.id, noteId:tracked.id(), _cache:updatedCache._metadataCache});
assert.equal(bodyReads, 2, 'Verification always reads persisted data');
const staleCache = structuredClone(updatedCache._metadataCache);
staleCache[tracked.id()].checkedAt = 0;
run({action:'snapshot', _cache:staleCache});
assert.equal(bodyReads, 3);
staleCache['deleted-note'] = {modified:1000,checkedAt:Date.now(),post:{url:request.url}};
assert.equal(run({action:'snapshot', _cache:staleCache})._metadataCache['deleted-note'], undefined);
assert.equal(run({action:'verify', noteId:tracked.id(), folderId:'old-folder', followNote:true}).folderId, f.id);
// A matching cached URL is never sufficient on its own.
tracked.body = () => originalBody().replaceAll('/p/legacy', '/p/externally-edited');
const separatelySaved = run({action:'save', folderId:f.id, url:explicitlySaved.url, body:legacyBody, _cache:updatedCache._metadataCache});
assert.notEqual(separatelySaved.noteId, tracked.id());
assert.ok(tracked.body().includes('externally-edited'));
destination.notes().splice(destination.notes().findIndex(n => n.id() === separatelySaved.noteId), 1);
// A changed nonmatch must become discoverable under its new URL.
tracked.modificationDate = () => new Date(3000);
const editedDuplicate = run({action:'save', folderId:f.id, url:'https://example.substack.com/p/externally-edited', body:'DO NOT OVERWRITE', _cache:updatedCache._metadataCache});
assert.equal(editedDuplicate.noteId, tracked.id());
const uncached = note('<h1>External</h1><p><a href="https://example.substack.com/p/external">Open on Substack</a></p>');
destination.notes.push(uncached);
assert.equal(run({action:'save', folderId:f.id, url:'https://example.substack.com/p/external', body:'DO NOT OVERWRITE', _cache:metadataCache}).noteId, uncached.id());
// Deleted IDs never authorize a cached duplicate result.
const cachedForDeletion = run({action:'snapshot', _cache:{}})._metadataCache;
destination.notes().splice(destination.notes().indexOf(uncached), 1);
assert.notEqual(run({action:'save', folderId:f.id, url:'https://example.substack.com/p/external', body:'<h1>Replacement</h1><p><a href="https://example.substack.com/p/external">Open on Substack</a></p>', _cache:cachedForDeletion}).noteId, uncached.id());
// Notes timestamps have one-second resolution: a cache recorded in that same
// second must not hide another edit before the timestamp can advance.
const sameSecond = Math.floor(Date.now() / 1000) * 1000;
tracked.modificationDate = () => new Date(sameSecond);
const freshCache = run({action:'snapshot', _cache:{}})._metadataCache;
tracked.body = () => originalBody().replaceAll('/p/legacy', '/p/same-second-edit');
assert.equal(run({action:'save', folderId:f.id, url:'https://example.substack.com/p/same-second-edit', body:'DO NOT OVERWRITE', _cache:freshCache}).noteId, tracked.id());
tracked.body = originalBody;
console.log('PASS: indexed duplicate lookup skips stable nonmatches, verifies matches, finds edited/new notes, ignores deleted IDs.');
const deleted={id:()=>{const error=new Error("Can't get object.");error.errorNumber=-1728;throw error;}};
account.folders()[0].folders.push(deleted);
legacyInbox.notes.push(deleted);
assert.equal(run({action:'snapshot'}).folders.length,3);
const denied={id:()=>{const error=new Error('Permission denied');error.errorNumber=-1743;throw error;}};
account.folders()[0].folders.push(denied);
assert.throws(()=>run({action:'snapshot'}),/Permission denied/);
account.folders()[0].folders().pop();
console.log('PASS: deleted Notes objects ignored; permission errors are never swallowed.');
// Destructive operations are restricted to direct private children of Substack.
const rootFolder=account.folders()[0], outside=folder('Unrelated');account.folders.push(outside);
let deletes=0;const trashed=[];app.delete=f=>{const isFolder=!!f.folders;if(isFolder)deletes++;else trashed.push(f);const siblings=isFolder?f.owner.folders():f.owner.notes();siblings.splice(siblings.indexOf(f),1);};
const deleteReq=id=>({action:'deleteFolder',accountId:account.id(),folderId:id});
assert.throws(()=>run(deleteReq(rootFolder.id())),/cannot be deleted/);
run(deleteReq(outside.id()));assert.equal(deletes,0,'Outside folder is never deleted');
const disposable=run({action:'save',folderName:'Delete test',url:request.url,body:request.body});
const doomed=rootFolder.folders().find(f=>{try{return f.id()===disposable.folderId;}catch{return false;}});
doomed.shared=()=>true;assert.throws(()=>run(deleteReq(doomed.id())),/Shared/);doomed.shared=()=>false;
const nested=folder('Nested');doomed.folders.push(nested);assert.throws(()=>run(deleteReq(doomed.id())),/nested/);doomed.folders().pop();
doomed.notes()[0].passwordProtected=()=>true;assert.throws(()=>run(deleteReq(doomed.id())),/locked/);doomed.notes()[0].passwordProtected=()=>false;
const beforeDelete=run({action:'snapshot',_cache:{}})._metadataCache;
const removed=run({...deleteReq(doomed.id()),_cache:beforeDelete});
assert.equal(removed.deleted,true);assert.equal(deletes,1);assert.equal(removed._metadataCache[disposable.noteId],undefined,'Deleted metadata removed');
assert.ok(trashed.some(n=>n.id()===disposable.noteId),'Notes deleted normally before empty folder removal');
assert.equal(run(deleteReq(doomed.id())).alreadyDeleted,true);assert.equal(deletes,1,'Lost-response retry is idempotent');
const emptyList=run({action:'createFolder',name:'Empty deletion'});run(deleteReq(emptyList.id));assert.equal(deletes,2);
assert.ok(account.folders().includes(outside));assert.equal(run({action:'snapshot'}).folders.length,3,'Other lists unchanged');
console.log('PASS: populated/empty deletion, metadata purge, idempotent retry, account/root/outside/shared/locked/nested containment.');
account.folders()[0].shared=()=>true;
assert.throws(()=>run({action:'snapshot'}),/shared/);
console.log('PASS: canonical URLs, real-folder hierarchy model, duplicate-safe save, note readback, stale IDs, shared-folder exclusion.');
const {isSaved,isSaveItem}=postsContext.SubstackPosts;
assert.equal(isSaved({getAttribute:()=>null,classList:['saveButton-ab','saved-xyz']}),true);
assert.equal(isSaved({getAttribute:()=>null,classList:['saveButton-ab']}),false);
for(const label of ['Save','Save S','SaveS']) assert.equal(isSaveItem({getAttribute:()=> 'menuitem',textContent:label}),true);
for(const label of ['Unsave','Saved','Save image','Save as image']) assert.equal(isSaveItem({getAttribute:()=> 'menuitem',textContent:label}),false);
let listener;
const runtime={onStartup:{addListener(){}},onInstalled:{addListener(){}},id:'test-extension',getURL:()=> 'chrome-extension://test-extension/',onMessage:{addListener:fn=>{listener=fn;}},sendNativeMessage:async()=>({ok:true})};
vm.runInNewContext(readFileSync(new URL('extension/background.js',base),'utf8'),{URL,setTimeout,chrome:{action:{onClicked:{addListener(){}}},runtime,storage:{local:{get:async()=>({}),set:async()=>{}}},tabs:{query:async()=>[]},alarms:{onAlarm:{addListener(){}},create:async()=>{},clear:async()=>{}}}});
for(const url of ['https://substack.com/','https://writer.substack.com/p/test']) assert.equal(listener({action:'snapshot'},{id:runtime.id,url},()=>{}),true);
for(const url of ['https://substack.com.evil.test/','https://notsubstack.com/','http://writer.substack.com/']) assert.equal(listener({action:'snapshot'},{id:runtime.id,url},()=>{}),undefined);
assert.equal(listener({action:'snapshot'},{id:'other-extension',url:'https://substack.com/'},()=>{}),undefined);
console.log('PASS: save/unsave detection, menu shortcut labels, publication host boundary and sender identity.');
