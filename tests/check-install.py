"""Exercise the shell installer without opening Chrome or accessing Apple Notes."""
import json
from pathlib import Path
import struct
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="sublists install test ") as tmp:
    support = Path(tmp) / "Application Support"
    command = ["bash", str(root / "install.sh"), "--source", str(root), "--support-dir", str(support), "--no-open"]
    first = subprocess.run(command, check=True, capture_output=True, text=True)
    extension = support / "Sublists/extension"
    manifest_path = support / "Google/Chrome/NativeMessagingHosts/com.substackfolders.notes.json"
    manifest = json.loads(manifest_path.read_text())
    assert json.loads((extension / "manifest.json").read_text())["key"] == json.loads((root / "extension/manifest.json").read_text())["key"]
    assert manifest["allowed_origins"] == ["chrome-extension://nhhelefkeecnhjkggmfdigihegkmmakh/"]
    assert str(support) in manifest["path"]
    request = json.dumps({"action": "ping"}).encode()
    result = subprocess.run([manifest["path"], manifest["allowed_origins"][0]], input=struct.pack("=I", len(request)) + request, capture_output=True, check=True)
    assert struct.unpack("=I", result.stdout[:4])[0] == len(result.stdout[4:])
    assert json.loads(result.stdout[4:])["ok"]

    cache = support / "Sublists/companion/notes-cache.json"
    cache.write_text('{"preserve":true}')
    (extension / "obsolete.js").write_text("old release")
    subprocess.run(command, check=True, capture_output=True)
    assert cache.read_text() == '{"preserve":true}'
    assert not (extension / "obsolete.js").exists()
    assert json.loads(manifest_path.read_text()) == manifest
    assert not list((support / "Sublists").glob(".extension.*"))
    assert not list((support / "Sublists").glob(".previous.*"))

    # An incomplete download cannot replace an existing working installation.
    invalid = Path(tmp) / "incomplete"
    invalid.mkdir()
    failed = subprocess.run(["bash", str(root / "install.sh"), "--source", str(invalid), "--support-dir", str(support), "--no-open"], capture_output=True)
    assert failed.returncode != 0
    assert (extension / "manifest.json").is_file()
    assert json.loads(manifest_path.read_text()) == manifest

print("PASS: shell install/update, fixed ID, paths with spaces, native handshake, cache preservation, obsolete-file removal, failed-download preservation, temporary cleanup.")
