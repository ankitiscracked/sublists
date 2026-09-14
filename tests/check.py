"""Run with python3 tests/check.py. Does not access Apple Notes."""
import io
import json
from pathlib import Path
import struct
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "native"))
import host

def rejects(fn, *args):
    try:
        fn(*args)
    except (ValueError, TypeError):
        return
    raise AssertionError(f"Expected rejection: {args}")

assert host.url("https://writer.substack.com/p/hello/?utm_source=app#comments") == "https://writer.substack.com/p/hello"
assert host.url("https://custom.example/p/hello") == "https://custom.example/p/hello"
assert host.url("https://www.substack.com/@writer/note/c-123/?utm_source=app#x") == "https://substack.com/@writer/note/c-123"
for unsafe in ("https://evil.com/@writer/note/c-123", "https://substack.com/@writer/note/c-no", "https://substack.com/@writer/note/c-123/extra"):
    rejects(host.url, unsafe)
note = host.validate({"action":"save", "folderId":"test", "url":"https://substack.com/@writer/note/c-123", "title":"A Note", "publication":"Writer"})
assert 'href="https://substack.com/@writer/note/c-123"' in note["body"]
for unsafe in ("file:///etc/passwd", "javascript:alert(1)", "https://x:y@substack.com/p/x", "https://substack.com:8000/p/x", "https://substack.com/saved"):
    rejects(host.url, unsafe)
for unsafe in ("https://localhost/image.png", "https://substackcdn.com.evil.com/i", "https://127.0.0.1/i", "https://substackcdn.com@evil.com/i"):
    rejects(lambda u: host.url(u, image=True), unsafe)
assert host.url("https://substackcdn.com/image/fetch/test", image=True)
rejects(host.validate, {"action":"delete"})
rejects(host.validate, {"action":"createFolder", "name":"\n"})
rejects(host.validate, {"action":"createFolder", "name":"x"*101})
clean = host.validate({"action":"save", "folderId":"test", "url":"https://example.substack.com/p/test", "title":'<script>"Hello"</script>', "thumbnail":"https://evil.com/image"})
assert "<script>" not in clean["body"] and "&lt;script&gt;" in clean["body"]
assert "evil.com" not in clean["body"]
assert "Open on Substack" in clean["body"]
rich = host.validate({"action":"save", "folderName":"Reading", "url":"https://example.substack.com/p/post", "title":"A post", "author":"A & B", "publication":"Field Notes", "publishedAt":"2026-09-14"})
assert rich["folderId"] == "" and rich["folderName"] == "Reading"
assert "A &amp; B · Field Notes · 2026-09-14" in rich["body"]
assert "<img" not in rich["body"]
rejects(host.validate, {"action":"show"})
rejects(host.validate, {"action":"save", "url":rich["url"], "title":"A post", "publishedAt":"x"*101})

def roundtrip(payload):
    out = io.BytesIO()
    host.serve(io.BytesIO(payload), out)
    result = out.getvalue()
    assert struct.unpack("=I", result[:4])[0] == len(result[4:])
    return json.loads(result[4:])

req = json.dumps({"action":"ping"}).encode()
assert roundtrip(struct.pack("=I",len(req))+req)["ok"]
assert not roundtrip(b"\x01")["ok"]
assert not roundtrip(struct.pack("=I",host.MAX_MESSAGE+1))["ok"]
assert not roundtrip(struct.pack("=I",20)+b"{}")["ok"]
assert not roundtrip(struct.pack("=I",2)+b"[]")["ok"]
with patch.object(host, "handle", return_value={"ok":True,"text":"é 🪴"}):
    assert roundtrip(struct.pack("=I",len(req))+req)["text"] == "é 🪴"

# Check that attachment failure preserves the note and advertises a retry.
import tempfile
with tempfile.TemporaryDirectory() as tmp, patch.object(host, "HERE", Path(tmp)), patch.object(host, "notes", return_value={"noteId":"n1","hasThumbnail":False}), patch.object(host, "image_bytes", side_effect=ValueError("Network unavailable")):
    result=host.handle({"action":"save","folderId":"f1","title":"Post","url":"https://example.substack.com/p/post", "thumbnail":"https://substackcdn.com/test.jpg"})
    assert result["ok"] and result["noteId"] == "n1" and "retry" in result["warning"]

print("PASS: URL/CDN validation, escaped metadata, explicit list destination, Unicode framing, truncated/oversized input, partial-save recovery.")

# Install into a temporary Library, then exercise the actual executable's pipes.
import contextlib
import runpy
import subprocess
with tempfile.TemporaryDirectory(prefix="substack installer test ") as tmp:
    with patch.object(Path, "home", return_value=Path(tmp)), patch.object(sys, "argv", ["install.py"]), contextlib.redirect_stdout(io.StringIO()):
        runpy.run_path(str(Path(host.__file__).parent / "install.py"), run_name="__main__")
    manifest=json.loads((Path(tmp)/"Library/Application Support/Google/Chrome/NativeMessagingHosts/com.substackfolders.notes.json").read_text())
    assert manifest["allowed_origins"] == ['chrome-extension://nhhelefkeecnhjkggmfdigihegkmmakh/']
    result=subprocess.run([manifest["path"],manifest["allowed_origins"][0]],input=struct.pack("=I",len(req))+req,capture_output=True,check=True)
    assert json.loads(result.stdout[4:])["ok"]
    denied=subprocess.run([manifest["path"],"chrome-extension://"+"b"*32+"/"],input=b"",capture_output=True)
    assert denied.returncode != 0 and not denied.stdout
print("PASS: installer in paths with spaces, actual companion subprocess framing, extension-origin rejection.")

# Repairing Notes' duplicated reference never needs another network download.
with tempfile.TemporaryDirectory() as tmp, patch.object(host,"HERE",Path(tmp)), patch.object(host,"notes",side_effect=[{"noteId":"n1","folderId":"f1","hasThumbnail":True,"duplicateThumbnail":True},{"url":"https://example.substack.com/p/post","hasThumbnail":True,"duplicateThumbnail":False}]), patch.object(host,"image_bytes") as download, patch.object(host.subprocess,"run"):
    result=host.handle({"action":"save","folderId":"f1","title":"Post","url":"https://example.substack.com/p/post"})
    assert result["ok"] and not result["duplicateThumbnail"]
    download.assert_not_called()

with tempfile.TemporaryDirectory() as tmp, patch.object(host,"HERE",Path(tmp)), patch.object(host,"notes",return_value={"noteId":"n1","folderId":"inbox","hasThumbnail":False}), patch.object(host,"image_bytes") as download:
    result=host.handle({"action":"save","folderId":"f1","title":"Text-only Note","url":"https://substack.com/@writer/note/c-123"})
    assert result["ok"] and "warning" not in result
    download.assert_not_called()

import signal
previous=signal.getsignal(signal.SIGALRM)
with patch.object(host.urllib.request,"build_opener") as opener:
    opener.return_value.open.side_effect=lambda *a,**k: signal.getsignal(signal.SIGALRM)(signal.SIGALRM,None)
    try:
        host.image_bytes("https://substackcdn.com/image/fetch/test")
        raise AssertionError("Expected download deadline")
    except RuntimeError as error:
        assert "20 seconds" in str(error)
assert signal.getsignal(signal.SIGALRM)==previous and signal.getitimer(signal.ITIMER_REAL)==(0.0,0.0)
print("PASS: duplicate image repair skips network; download deadline propagates and clears timer.")

# A deferred save confirms the note without waiting for any image work.
with tempfile.TemporaryDirectory() as tmp, patch.object(host,"HERE",Path(tmp)), patch.object(host,"notes",return_value={"noteId":"n1","folderId":"f1","hasThumbnail":False}), patch.object(host,"image_bytes") as download:
    result=host.handle({"action":"save","folderId":"f1","deferThumbnail":True,"title":"Post","url":"https://example.substack.com/p/post","thumbnail":"https://substackcdn.com/test.jpg"})
    assert result["ok"] and result["thumbnailPending"] and result["noteId"]=="n1"
    download.assert_not_called()

# Lock availability during image download: concurrent saves must not queue behind network I/O.
import fcntl
with tempfile.TemporaryDirectory() as tmp, patch.object(host,"HERE",Path(tmp)):
    initial={"noteId":"n1","folderId":"old","url":"https://example.substack.com/p/post","hasThumbnail":False}
    moved={**initial,"folderId":"new"}
    attached={**moved,"hasThumbnail":True}
    def download_unlocked(source):
        with open(Path(tmp)/'.notes.lock','a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return b'image'
    with patch.object(host,"notes",side_effect=[initial,moved,attached]) as notes, patch.object(host,"image_bytes",side_effect=download_unlocked), patch.object(host.subprocess,"run"):
        result=host.handle({"action":"attachThumbnail","folderId":"old","noteId":"n1","url":initial['url'],"thumbnail":"https://substackcdn.com/test.jpg"})
        assert result['ok'] and result['folderId']=='new' and result['hasThumbnail'] and not result['thumbnailPending']
        assert all(call.args[0]['followNote'] for call in notes.call_args_list)
    with patch.object(host,"notes",return_value={**attached,"url":"https://example.substack.com/p/changed"}), patch.object(host,"image_bytes") as download:
        try:
            host.handle({"action":"attachThumbnail","folderId":"old","noteId":"n1","url":initial['url']})
            raise AssertionError('Changed note must reject attachment')
        except RuntimeError:
            pass
        download.assert_not_called()
print('PASS: deferred saves skip downloads, downloads release Notes lock, attachments follow moved IDs and reject changed links.')
with patch.object(host, 'handle', side_effect=host.PermanentError('Saved note deleted.')):
    assert roundtrip(struct.pack('=I',len(req))+req)['permanent'] is True
with patch.object(host.subprocess, 'run', return_value=type('Result',(),{'returncode':1,'stderr':'Error: Note moved or deleted. Refresh folders.'})()):
    try:
        host.notes({'action':'verify','followNote':True})
        raise AssertionError('Missing queued note must be permanent')
    except host.PermanentError:
        pass
print('PASS: deleted or changed queued notes return permanent failures for queue removal.')
for destination in ({}, {'folderId':'f1','folderName':'Reading'}, {'folderName':' '}, {'folderName':'x'*101}):
    rejects(host.validate, {'action':'save','url':'https://example.substack.com/p/post','title':'Post',**destination})
assert host.validate({'action':'save','folderName':' Reading ','url':'https://example.substack.com/p/post','title':'Post'})['folderName']=='Reading'
print('PASS: save requires exactly one explicit destination; list names are bounded and normalized.')
