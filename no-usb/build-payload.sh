#!/bin/bash
# Builds payload/ for the no-USB installer (run on Linux or macOS-with-Homebrew-grub; already prebuilt in the zip).
#  payload/EFI/BOOT/BOOTX64.EFI   GRUB standalone EFI with the fiaOS menu embedded (needs Secure Boot OFF)
#  payload/debian/fiaos.cpio.gz   initrd overlay: /preseed.cfg + /fiaos (app, linux kit)
# The Debian netboot kernel/initrd + firmware are downloaded and SHA256-verified by prepare-from-windows.ps1 (or --download here).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; ROOT="$(cd "$HERE/.." && pwd)"; OUT="$HERE/payload"
mkdir -p "$OUT/EFI/BOOT" "$OUT/debian"
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
mkdir -p "$work/fiaos/linux" "$work/fiaos/no-usb/payload-src"
cp "$ROOT"/{index.html,app.js,fx.js,styles.css,server.js,package.json,README.md,INTEGRATIONS.md} "$work/fiaos/"
cp -r "$ROOT"/linux/. "$work/fiaos/linux/"
cp "$HERE"/payload-src/* "$work/fiaos/no-usb/payload-src/"
cp "$HERE/payload-src/preseed.cfg" "$work/preseed.cfg"
( cd "$work" && find preseed.cfg fiaos | LC_ALL=C sort | cpio -o -H newc --quiet --owner=0:0 ) | gzip -9n > "$OUT/debian/fiaos.cpio.gz"
cp "$HERE/payload-src/grub.cfg" "$OUT/grub.cfg"
grub-mkstandalone -O x86_64-efi -o "$OUT/EFI/BOOT/BOOTX64.EFI" \
  --modules="part_gpt part_msdos fat search search_label search_fs_file linux gzio chain efi_gop efi_uga all_video normal configfile echo test" \
  --locales="" --fonts="" --themes="" "boot/grub/grub.cfg=$HERE/payload-src/grub.cfg"
touch "$OUT/fiaos-installer.marker"
if [ "${1:-}" = --download ]; then
  B=https://deb.debian.org/debian/dists/bookworm/main/installer-amd64/current/images
  F=https://cdimage.debian.org/cdimage/firmware/bookworm/current
  curl -fsSL "$B/SHA256SUMS" -o "$work/S1"; curl -fsSL "$F/SHA256SUMS" -o "$work/S2"
  for f in linux initrd.gz; do curl -fsSL "$B/netboot/debian-installer/amd64/$f" -o "$OUT/debian/$f"
    want=$(awk -v f="./netboot/debian-installer/amd64/$f" '$2==f{print $1}' "$work/S1"); got=$(sha256sum "$OUT/debian/$f" | cut -d' ' -f1)
    [ "$want" = "$got" ] || { echo "SHA256 mismatch: $f"; exit 1; }; done
  curl -fsSL "$F/firmware.cpio.gz" -o "$OUT/debian/firmware.cpio.gz"
  want=$(awk '$2=="firmware.cpio.gz"{print $1}' "$work/S2"); got=$(sha256sum "$OUT/debian/firmware.cpio.gz" | cut -d' ' -f1)
  [ "$want" = "$got" ] || { echo "SHA256 mismatch: firmware.cpio.gz"; exit 1; }
  echo "Downloads verified."
fi
ls -la "$OUT" "$OUT/debian" "$OUT/EFI/BOOT"
