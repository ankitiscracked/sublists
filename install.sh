#!/bin/bash
# Private GitHub installer. No sudo; never modifies Chrome's preferences.
set +x
set -euo pipefail
umask 077

repo="ankitiscracked/sublists"
support_dir="$HOME/Library/Application Support"
source_dir=""
open_setup=1

die() { printf '%s\n' "$*" >&2; exit 1; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --source) [ "$#" -ge 2 ] || die '--source needs a directory'; source_dir="$2"; shift 2 ;;
    --support-dir) [ "$#" -ge 2 ] || die '--support-dir needs a directory'; support_dir="$2"; shift 2 ;;
    --no-open) open_setup=0; shift ;;
    *) die "Unknown option: $1" ;;
  esac
done

[ "$(uname -s)" = Darwin ] || die 'Sublists requires macOS.'
command -v python3 >/dev/null || die 'Python 3 is required. Install it from python.org, then run this command again.'
python3 -c 'import sys; assert sys.version_info >= (3, 9)' 2>/dev/null || die 'Python 3.9 or newer is required.'
if [ "$open_setup" = 1 ]; then
  [ -d '/Applications/Google Chrome.app' ] || [ -d "$HOME/Applications/Google Chrome.app" ] || die 'Install Google Chrome, then run this command again.'
fi

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/sublists.XXXXXX")"
stage_dir=""
backup_dir=""
cleanup() {
  rm -rf "$work_dir"
  [ -z "$stage_dir" ] || rm -rf "$stage_dir"
  if [ -n "$backup_dir" ] && [ -d "$backup_dir/extension" ]; then
    [ -e "$install_dir/extension" ] || mv "$backup_dir/extension" "$install_dir/extension"
  fi
  [ -z "$backup_dir" ] || rm -rf "$backup_dir"
}
trap cleanup EXIT

if [ -z "$source_dir" ]; then
  command -v gh >/dev/null || die 'Install GitHub CLI from cli.github.com and run gh auth login first.'
  # Supply the header over stdin so the token is not in curl's process arguments.
  github_token="$(gh auth token --hostname github.com 2>/dev/null)" || die 'Run gh auth login with an account that can access ankitiscracked/sublists.'
  [ -n "$github_token" ] || die 'GitHub authentication is missing. Run gh auth login.'
  printf 'Downloading Sublists…\n'
  printf 'Authorization: Bearer %s\n' "$github_token" |
    curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
      --connect-timeout 15 --max-time 120 --header @- \
      "https://api.github.com/repos/$repo/tarball/main" --output "$work_dir/source.tar.gz" ||
    die 'Download failed. Make sure your GitHub account has access to the private repository.'
  unset github_token
  mkdir "$work_dir/source"
  tar -xzf "$work_dir/source.tar.gz" -C "$work_dir/source" --strip-components=1
  source_dir="$work_dir/source"
fi

[ -f "$source_dir/extension/manifest.json" ] && [ -f "$source_dir/native/install.py" ] || die 'The download is missing Sublists installation files.'
support_dir="$(python3 -c 'from pathlib import Path; import sys; print(Path(sys.argv[1]).expanduser().resolve())' "$support_dir")"
install_dir="$support_dir/Sublists"
mkdir -p "$install_dir"
chmod 700 "$install_dir"
stage_dir="$(mktemp -d "$install_dir/.extension.XXXXXX")"
cp -R "$source_dir/extension/." "$stage_dir/"
# Register only after the full download is available. Existing library cache and
# all Apple Notes content stay intact when the installer is run again.
python3 "$source_dir/native/install.py" --support-dir "$support_dir"
backup_dir="$(mktemp -d "$install_dir/.previous.XXXXXX")"
if [ -e "$install_dir/extension" ]; then mv "$install_dir/extension" "$backup_dir/extension"; fi
mv "$stage_dir" "$install_dir/extension"
stage_dir=""

printf '\nInstalled Sublists. Finish once in Chrome:\n'
printf '  1. Turn on Developer mode.\n'
printf '  2. Click Load unpacked and select:\n     %s\n' "$install_dir/extension"
printf '  3. Refresh Substack. Save an item, choose a list, and allow Notes access.\n'
printf '\nAlready installed? Click Reload for Sublists, then refresh Substack.\n'
if [ "$open_setup" = 1 ]; then
  open -R "$install_dir/extension" || true
  open -a 'Google Chrome' 'chrome://extensions/' || printf 'Open chrome://extensions in Chrome.\n'
fi
