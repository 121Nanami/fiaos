#!/bin/bash
# Install FiaOS desktop entries for EllenOS (aarch64 Arch, X11).
# User install (default):
#   bash linux/ellenos/install-app-library.sh
# Package install (used by the PKGBUILD):
#   bash linux/ellenos/install-app-library.sh --prefix /usr --destdir "$pkgdir"
# System install onto this machine:
#   sudo bash linux/ellenos/install-app-library.sh --system
set -euo pipefail

SYSTEM=0
PREFIX=""
DESTDIR=""
ROOT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --system) SYSTEM=1; shift ;;
    --prefix) PREFIX="${2:?}"; shift 2 ;;
    --destdir) DESTDIR="${2:?}"; shift 2 ;;
    --root) ROOT="${2:?}"; shift 2 ;;
    -h|--help)
      echo "Usage: install-app-library.sh [--system] [--prefix DIR] [--destdir DIR] [--root REPO]"
      exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
if [[ -z "$ROOT" ]]; then ROOT=$(cd "$SCRIPT_DIR/../.." && pwd); fi
if [[ -z "$PREFIX" ]]; then
  if [[ "$SYSTEM" -eq 1 ]]; then PREFIX=/usr; else PREFIX="${HOME}/.local"; fi
fi

LIST="$SCRIPT_DIR/apps.list"
ICONS="$SCRIPT_DIR/icons"
SHELL_SRC="$SCRIPT_DIR/electron-shell.js"
[[ -f "$LIST" && -f "$SHELL_SRC" ]] || { echo "Missing EllenOS files next to this script" >&2; exit 1; }

APPDIR="$DESTDIR$PREFIX/share/applications"
ICONDIR="$DESTDIR$PREFIX/share/icons/hicolor/scalable/apps"
BINDIR="$DESTDIR$PREFIX/bin"
SHARE="$DESTDIR$PREFIX/share/ellenos"
install -d "$APPDIR" "$ICONDIR" "$BINDIR" "$SHARE"

# The opener is written here so its paths are the final prefix, not the staging dir.
cat > "$BINDIR/ellenos-open" << EOF
#!/bin/bash
# Open one FiaOS app in its own window.
# ellen-app (EllenOS helper) is preferred, then Electron, then a kiosk browser.
set -euo pipefail
APP="\${1:-library}"
BASE="\${ELLENOS_FIAOS_URL:-http://127.0.0.1:8080}"
BASE="\${BASE%/}"
case "\$APP" in
  library) URL="\$BASE/apps.html" ;;
  facet) URL="\$BASE/facet.html?app=facet" ;;
  desk) URL="\$BASE/desk.html?app=desk" ;;
  *) URL="\$BASE/?app=\$APP" ;;
esac
SHELL_JS="$PREFIX/share/ellenos/electron-shell.js"
if command -v ellen-app >/dev/null 2>&1; then
  exec ellen-app "\$URL"
fi
if command -v electron >/dev/null 2>&1 && [[ -f "\$SHELL_JS" ]]; then
  exec electron "\$SHELL_JS" "\$URL"
fi
for bin in chromium chromium-browser google-chrome google-chrome-stable; do
  if command -v "\$bin" >/dev/null 2>&1; then
    exec "\$bin" --app="\$URL"
  fi
done
if command -v firefox >/dev/null 2>&1; then
  exec firefox --new-window "\$URL"
fi
echo "No ellen-app, Electron, or browser on PATH. Open \$URL" >&2
exit 1
EOF
chmod 755 "$BINDIR/ellenos-open"
install -m 644 "$SHELL_SRC" "$SHARE/electron-shell.js"

while IFS='|' read -r id name blurb href category; do
  [[ -n "${id:-}" ]] || continue
  icon_src="$ICONS/fiaos-$id.svg"
  [[ -f "$icon_src" ]] || { echo "Missing icon for $id" >&2; exit 1; }
  install -m 644 "$icon_src" "$ICONDIR/fiaos-$id.svg"
  cat > "$APPDIR/fiaos-$id.desktop" << EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=$name
Comment=$blurb
Exec=$PREFIX/bin/ellenos-open $id
Icon=$PREFIX/share/icons/hicolor/scalable/apps/fiaos-$id.svg
Terminal=false
Categories=$category;
StartupNotify=true
EOF
done < "$LIST"

if [[ -z "$DESTDIR" ]] && command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$PREFIX/share/applications" >/dev/null 2>&1 || true
fi
if [[ -z "$DESTDIR" ]] && command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f "$PREFIX/share/icons/hicolor" >/dev/null 2>&1 || true
fi

echo "Installed $(grep -c . "$LIST") FiaOS launchers into $DESTDIR$PREFIX"
echo "App Library: $PREFIX/bin/ellenos-open library"
