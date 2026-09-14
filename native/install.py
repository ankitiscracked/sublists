#!/usr/bin/env python3
"""Install Sublists' helper and register its fixed extension ID. No sudo."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--support-dir", type=Path, default=Path.home() / "Library/Application Support", help="Application Support directory (override for isolated installer tests)")
args = parser.parse_args()
if sys.platform != "darwin":
    parser.error("Apple Notes helper requires macOS.")
extension_manifest = json.loads((Path(__file__).resolve().parents[1] / "extension/manifest.json").read_text())
digest = hashlib.sha256(base64.b64decode(extension_manifest["key"], validate=True)).hexdigest()[:32]
extension_id = "".join(chr(ord("a") + int(char, 16)) for char in digest)

support = args.support_dir.expanduser().resolve()
target = support / "Sublists/companion"
target.mkdir(parents=True, exist_ok=True, mode=0o700)
os.chmod(target, 0o700)
for name in ("host.py", "notes.js", "attach.applescript"):
    shutil.copy2(Path(__file__).parent / name, target / name)
origin = f"chrome-extension://{extension_id}/"
(target / "config.json").write_text(json.dumps({"origin": origin}))
launcher = target / "launch"
launcher.write_text(f"#!/bin/sh\nexec {shlex.quote(sys.executable)} {shlex.quote(str(target / 'host.py'))} \"$@\"\n")
launcher.chmod(0o700)
manifest = support / "Google/Chrome/NativeMessagingHosts/com.substackfolders.notes.json"
manifest.parent.mkdir(parents=True, exist_ok=True)
manifest.write_text(json.dumps({"name": "com.substackfolders.notes", "description": "Substack Folders for Apple Notes", "path": str(launcher), "type": "stdio", "allowed_origins": [origin]}, indent=2))
manifest.chmod(0o600)
print(f"Helper installed for extension {extension_id}.")
print("Allow Notes automation when macOS asks. No Accessibility or Full Disk Access needed.")
