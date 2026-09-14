import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../extension/background.js',import.meta.url),'utf8');
const clone=x=>structuredClone(x), tick=()=>new Promise(r=>setTimeout(r,0));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
let saved={},calls=[],nativeHandler,listener,alarmListener,broadcasts=[];
function boot(){
 const runtime={id:'self',getURL:()=> 'chrome-extension://self/',onMessage:{addListener:fn=>listener=fn},onStartup:{addListener(){}},onInstalled:{addListener(){}},sendNativeMessage:async(host,message)=>{calls.push(clone(message));return clone(await nativeHandler(message));}};
 vm.runInNewContext(code,{URL,Date,setTimeout,chrome:{action:{onClicked:{addListener(){}}},runtime,storage:{local:{get:async()=>clone(saved),set:async v=>Object.assign(saved,clone(v))}},tabs:{query:async()=>[{id:1}],sendMessage:async(id,m)=>broadcasts.push(clone(m))},alarms:{onAlarm:{addListener:fn=>alarmListener=fn},create:async()=>{},clear:async()=>{}}}});
}
const sender={id:'self',url:'https://substack.com/saved'};
const send=m=>new Promise(resolve=>assert.equal(listener(m,sender,resolve),true));
const library={ok:true,accountId:'a',folders:[{id:'essays',name:'Essays',posts:[]},{id:'design',name:'Design',posts:[]}]};
const post={ok:true,accountId:'a',folderId:'essays',folderName:'Essays',noteId:'n1',title:'Test',url:'https://example.substack.com/p/test',thumbnail:'',hasThumbnail:false};
let read=deferred(); nativeHandler=m=>m.action==='snapshot'?read.promise:post;
boot();
const first=send({action:'snapshot'}),second=send({action:'snapshot'});
await tick();assert.equal(calls.length,1,'Concurrent cold reads coalesce');
read.resolve(library);await Promise.all([first,second]);
let start=performance.now();await send({action:'snapshot'});const cachedMs=performance.now()-start;
assert.equal(calls.length,1,'Warm read never contacts Notes');assert.ok(cachedMs<50);
await send({action:'save',folderId:'essays',title:'Test',url:post.url});
let snap=await send({action:'snapshot'});assert.equal(snap.folders[0].posts.length,1,'Save patches cache');
nativeHandler=async()=>({...post,noteId:'n3',folderId:'design',folderName:'Design'});
await send({action:'save',folderId:'design',title:'Test',url:post.url});
snap=await send({action:'snapshot'});assert.equal(snap.folders[0].posts.length,1);assert.equal(snap.folders[1].posts[0].noteId,'n3','Save to another list preserves both copies without scan');
// A scan started before a save must not erase its confirmed result.
read=deferred();nativeHandler=m=>m.action==='snapshot'?read.promise:{...post,noteId:'n2',url:'https://example.substack.com/p/two'};
const stale=send({action:'snapshot',refresh:true});await tick();
await send({action:'save',folderId:'essays',title:'Two',url:'https://example.substack.com/p/two'});
read.resolve(library);await stale;snap=await send({action:'snapshot'});assert.equal(snap.folders[0].posts[0].noteId,'n2','Concurrent write merged over older scan');
// Cache survives worker suspension; a failed refresh leaves cached navigation available.
saved.libraries.a.checkedAt=Date.now()-86400000;
nativeHandler=async()=>({ok:false,error:'Offline'});boot();
const callsBeforeRestartRead=calls.length;
assert.equal((await send({action:'snapshot'})).folders[0].posts[0].noteId,'n2');
await tick();assert.equal(calls.length,callsBeforeRestartRead,'Even day-old cached data never triggers an automatic Notes scan after restart');
assert.equal((await send({action:'snapshot',refresh:true})).ok,false);
assert.equal((await send({action:'snapshot'})).ok,true);
// Explicit refreshes share one scan and publish the result to existing tabs.
read=deferred();nativeHandler=()=>read.promise;
const beforeManual=calls.length,beforeBroadcast=broadcasts.length;
const manualOne=send({action:'snapshot',refresh:true}),manualTwo=send({action:'snapshot',accountId:'a',refresh:true});
await tick();assert.equal(calls.length,beforeManual+1,'Concurrent manual refreshes coalesce');
read.resolve(library);await Promise.all([manualOne,manualTwo]);await tick();
assert.ok(broadcasts.length>beforeBroadcast,'Manual refresh publishes to existing tabs');
// Thumbnail work is durable and does not block a confirmed save response.
let image=deferred();nativeHandler=m=>m.action==='attachThumbnail'?image.promise:{...post,thumbnail:'https://substackcdn.com/image/test.jpg',thumbnailPending:true};
const res=await send({action:'save',folderId:'essays',title:'Test',url:post.url});
assert.equal(res.thumbnailPending,true);assert.ok(saved.thumbnailQueue.n1,'Pending thumbnail is persisted before save responds');
await tick();assert.equal(calls.at(-1).action,'attachThumbnail');
image.resolve({ok:false,error:'Transient network failure'});await tick();await tick();
assert.ok(saved.thumbnailQueue.n1,'Transient failure remains queued');
nativeHandler=async()=>({...post,hasThumbnail:true});boot();alarmListener({name:'sf-thumbnails'});await tick();await tick();
assert.deepEqual(saved.thumbnailQueue,{},'Restarted worker retries and clears completed work');
assert.equal(saved.libraries.a.data.folders[0].posts.find(p=>p.noteId==='n1').hasThumbnail,true);
console.log(`PASS: cache read ${cachedMs.toFixed(2)}ms; coalesced reads, targeted list saves, concurrent write merge, restart persistence, offline cache, durable thumbnail retry.`);
