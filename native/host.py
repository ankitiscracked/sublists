#!/usr/bin/env python3
"""Chrome native messaging host. Python standard library + macOS Notes scripting."""
import contextlib
import fcntl
import html
import json
import os
from pathlib import Path
import re
import signal
import struct
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

HERE = Path(__file__).resolve().parent
MAX_MESSAGE = 128 * 1024
MAX_IMAGE = 8 * 1024 * 1024
IMAGE_HOSTS = {"substackcdn.com", "substack-post-media.s3.amazonaws.com"}


def text(value, label, limit=500, optional=False):
    if not isinstance(value, str) or len(value) > limit or any(ord(c) < 32 for c in value):
        raise ValueError(f"Invalid {label}.")
    value = value.strip()
    if not value and not optional:
        raise ValueError(f"{label} is required.")
    return value


def url(value, image=False):
    value = text(value, "URL", 8192)
    u = urllib.parse.urlsplit(value)
    if u.scheme != "https" or not u.hostname or u.username or u.password or u.port not in (None, 443):
        raise ValueError("Only HTTPS URLs without credentials are supported.")
    if image:
        if u.hostname not in IMAGE_HOSTS:
            raise ValueError("Thumbnail must come from Substack's image CDN.")
        return value
    note = u.hostname in ("substack.com", "www.substack.com") and re.fullmatch(r"/@[\w-]+/note/c-\d+/?", u.path, re.ASCII)
    if not note and not re.fullmatch(r"/(p/[^/]+/?|home/post/p-\d+/?)", u.path):
        raise ValueError("Not a Substack post or Note URL.")
    if note:
        return urllib.parse.urlunsplit(("https", "substack.com", u.path.rstrip("/"), "", ""))
    return urllib.parse.urlunsplit(("https", u.netloc.lower(), u.path.rstrip("/"), "", ""))


def validate(req):
    if not isinstance(req, dict):
        raise ValueError("Expected a JSON object.")
    action = req.get("action")
    if action not in {"ping", "snapshot", "createFolder", "deleteFolder", "save", "show", "attachThumbnail"}:
        raise ValueError("Unknown action.")
    clean = {"action": action}
    if action == "ping":
        return clean
    clean["accountId"] = text(req.get("accountId", ""), "account", optional=action != "deleteFolder")
    if action in {"save", "show", "attachThumbnail", "deleteFolder"}:
        clean["folderId"] = text(req.get("folderId", ""), "folder", optional=action == "save")
    if action in {"show", "attachThumbnail"}:
        clean["noteId"] = text(req.get("noteId", ""), "note", optional=action == "show")
    if action == "attachThumbnail":
        clean["url"] = url(req.get("url"))
        clean["thumbnail"] = text(req.get("thumbnail", ""), "thumbnail", 8192, optional=True)
    if action == "createFolder":
        clean["name"] = text(req.get("name"), "folder name", 100)
    if action == "save":
        clean["folderName"] = text(req.get("folderName", ""), "folder name", 100, optional=True)
        if bool(clean["folderId"]) == bool(clean["folderName"]):
            raise ValueError("Choose a list or provide a new list name before saving.")
        clean["deferThumbnail"] = req.get("deferThumbnail") is True
        clean.update(url=url(req.get("url")), title=text(req.get("title"), "title", 1000), publication=text(req.get("publication", ""), "publication", optional=True))
        clean["author"] = text(req.get("author", ""), "author", optional=True)
        clean["publishedAt"] = text(req.get("publishedAt", ""), "publication date", 100, optional=True)
        clean["thumbnail"] = text(req.get("thumbnail", ""), "thumbnail", 8192, optional=True)
        # Keep the link saveable if its thumbnail is unavailable/unsupported.
        e = html.escape
        metadata = " · ".join(dict.fromkeys(value for value in (clean["author"], clean["publication"], clean["publishedAt"]) if value))
        clean["body"] = f'<h1>{e(clean["title"])}</h1>'
        if metadata:
            clean["body"] += f'<p>{e(metadata)}</p>'
        clean["body"] += f'<p><a href="{e(clean["url"], quote=True)}">Open on Substack</a></p>'
        if clean["thumbnail"]:
            try:
                clean["body"] += f'<p><a href="{e(url(clean["thumbnail"], image=True), quote=True)}">Thumbnail source</a></p>'
            except ValueError:
                pass
    return clean


class PermanentError(RuntimeError):
    """A queued thumbnail no longer has an eligible saved note."""


def notes(req):
    cache_path = HERE / ".metadata-cache.json"
    req = {**req, "_cachePath": str(cache_path)}
    proc = subprocess.run(["/usr/bin/osascript", "-l", "JavaScript", str(HERE / "notes.js"), json.dumps(req)], capture_output=True, text=True, timeout=55)
    if proc.returncode:
        if "-1743" in proc.stderr:
            raise RuntimeError("Allow the companion to control Notes in System Settings → Privacy & Security → Automation, then retry.")
        message = proc.stderr.strip()[-600:] or "Apple Notes did not respond."
        if req.get("followNote") and any(reason in message for reason in ("Note moved or deleted", "Note is now locked or shared", "The Substack folder is shared")):
            raise PermanentError("Saved note moved outside Substack or was deleted.")
        raise RuntimeError(message)
    result = json.loads(proc.stdout)
    metadata = result.pop("_metadataCache", None)
    if metadata is not None:
        # Called under notes_lock; replace prevents a partial cache after interruption.
        temporary = cache_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(metadata))
        temporary.chmod(0o600)
        temporary.replace(cache_path)
    return result


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        url(newurl, image=True)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def image_bytes(source):
    request = urllib.request.Request(url(source, image=True), headers={"User-Agent": "SubstackFolders/0.1", "Accept": "image/jpeg,image/png,image/webp,image/gif"})
    # A socket timeout applies per address; unreachable IPv6 addresses can stack up.
    def timeout(signum, frame):
        # OSError/TimeoutError gets swallowed by socket's address-retry loop.
        raise RuntimeError("Thumbnail download exceeded 20 seconds.")
    previous = signal.signal(signal.SIGALRM, timeout)
    signal.setitimer(signal.ITIMER_REAL, 20)
    try:
        with urllib.request.build_opener(SafeRedirect).open(request, timeout=10) as response:
            data = response.read(MAX_IMAGE + 1)
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)
    if len(data) > MAX_IMAGE:
        raise ValueError("Thumbnail exceeds 8 MB.")
    if not (data.startswith(b"\x89PNG\r\n\x1a\n") or data.startswith(b"\xff\xd8\xff") or data.startswith((b"GIF87a", b"GIF89a")) or (data.startswith(b"RIFF") and data[8:12] == b"WEBP")):
        raise ValueError("Thumbnail is not a supported image.")
    return data


@contextlib.contextmanager
def notes_lock():
    with open(HERE / ".notes.lock", "a") as lock:
        deadline = time.monotonic() + 30
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() > deadline:
                    raise RuntimeError("Notes is busy saving another post. Retry in a moment.")
                time.sleep(.05)
        yield


def attach_thumbnail(clean, result):
    # Network and image conversion never hold the Notes lock. Re-read by stable
    # note ID afterwards because the picker may have moved it in the meantime.
    thumbnail = result.get("thumbnail") or clean.get("thumbnail", "")
    with tempfile.TemporaryDirectory(prefix="substack-folders-") as directory:
        raw, converted = Path(directory) / "source", Path(directory) / "thumbnail.jpg"
        if not result["hasThumbnail"]:
            raw.write_bytes(image_bytes(thumbnail))
            subprocess.run(["/usr/bin/sips", "-s", "format", "jpeg", "-Z", "960", str(raw), "--out", str(converted)], check=True, capture_output=True, timeout=15)
        verify = {"action": "verify", "accountId": result.get("accountId", clean.get("accountId", "")), "folderId": result["folderId"], "noteId": result["noteId"], "followNote": True}
        with notes_lock():
            current = notes(verify)
            if not current or current["url"] != clean["url"]:
                raise PermanentError("Saved note changed or was removed before the thumbnail could attach.")
            if not current["hasThumbnail"] or current.get("duplicateThumbnail"):
                subprocess.run(["/usr/bin/osascript", str(HERE / "attach.applescript"), result["noteId"], str(converted)], check=True, capture_output=True, timeout=30)
                current = notes(verify)
            if not current or current["url"] != clean["url"] or not current["hasThumbnail"] or current.get("duplicateThumbnail"):
                raise RuntimeError("Thumbnail readback failed.")
            result.update(current)
    return {"ok": True, **result, "thumbnailPending": False}


def handle(req):
    clean = validate(req)
    if clean["action"] == "ping":
        return {"ok": True, "version": "0.12.0"}
    with notes_lock():
        result = notes({**clean, "action": "verify", "followNote": True} if clean["action"] == "attachThumbnail" else clean)
    thumbnail = result.get("thumbnail") or clean.get("thumbnail", "")
    needed = (thumbnail and not result.get("hasThumbnail")) or result.get("duplicateThumbnail")
    if clean["action"] == "save" and needed and clean["deferThumbnail"]:
        return {"ok": True, **result, "thumbnailPending": True}
    if clean["action"] == "attachThumbnail" and result.get("url") != clean["url"]:
        raise PermanentError("Saved note changed or was removed before the thumbnail could attach.")
    if clean["action"] in {"save", "attachThumbnail"} and needed:
        try:
            return attach_thumbnail(clean, result)
        except PermanentError:
            raise
        except Exception:
            if clean["action"] == "attachThumbnail":
                raise RuntimeError("Link saved in Notes; thumbnail could not be attached. Retry shortly.")
            result["warning"] = "Link saved in Notes; thumbnail could not be attached. Choose this folder again to retry."
    return {"ok": True, **result, "thumbnailPending": False}


def read_exact(stream, size):
    data = bytearray()
    while len(data) < size:
        part = stream.read(size - len(data))
        if not part:
            raise ValueError("Truncated native message.")
        data.extend(part)
    return bytes(data)


def serve(incoming, outgoing):
    prefix = incoming.read(4)
    if not prefix:
        return
    try:
        if len(prefix) != 4:
            raise ValueError("Truncated native header.")
        size = struct.unpack("=I", prefix)[0]
        if not 0 < size <= MAX_MESSAGE:
            raise ValueError("Native message is too large.")
        response = handle(json.loads(read_exact(incoming, size)))
    except Exception as error:
        response = {"ok": False, "error": str(error)}
        if isinstance(error, PermanentError):
            response["permanent"] = True
    data = json.dumps(response, ensure_ascii=False).encode("utf-8")
    if len(data) > 900_000:
        data = b'{"ok":false,"error":"Notes library exceeds the current response limit. Split it across Notes accounts."}'
    outgoing.write(struct.pack("=I", len(data)) + data)
    outgoing.flush()


if __name__ == "__main__":
    # Chrome enforces allowed_origins; also check the caller before opening Notes.
    config = json.loads((HERE / "config.json").read_text())
    if len(sys.argv) < 2 or sys.argv[1] != config["origin"]:
        sys.exit("Unrecognized extension origin.")
    serve(sys.stdin.buffer, sys.stdout.buffer)
