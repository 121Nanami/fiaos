#!/bin/bash
# Reverts install-fiaos.sh (keeps installed packages and the linux-surface kernel unless FIAOS_PURGE=1).
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run as root"; exit 1; }
systemctl disable --now fiaos.service fiaos-dim.timer fiaos-off.timer fiaos-day.timer fiaos-brightness@wake.service 2>/dev/null || true
systemctl unmask sleep.target suspend.target hibernate.target hybrid-sleep.target || true
rm -f /etc/systemd/system/fiaos.service /etc/systemd/system/fiaos-brightness@.service /etc/systemd/system/fiaos-{dim,off,day}.timer
rm -rf /etc/systemd/system/getty@tty1.service.d/autologin.conf /etc/systemd/logind.conf.d/fiaos.conf
rm -f /etc/default/grub.d/fiaos.cfg /etc/tlp.d/50-fiaos.conf /etc/apt/apt.conf.d/52fiaos-unattended /etc/chromium/policies/managed/fiaos.json
rm -f /usr/local/bin/fiaos-kiosk /usr/local/bin/fiaos-brightness
rm -rf /opt/fiaos /usr/share/plymouth/themes/fiaos
[ "${FIAOS_KEEP_CONFIG:-0}" = 1 ] || rm -rf /etc/fiaos
if id kiosk >/dev/null 2>&1; then rm -f ~kiosk/.bash_profile; fi
plymouth-set-default-theme -R bgrt 2>/dev/null || plymouth-set-default-theme -R spinner 2>/dev/null || true
systemctl daemon-reload; update-grub || true
if [ "${FIAOS_PURGE:-0}" = 1 ]; then
  userdel -r kiosk 2>/dev/null || true; userdel fiaos 2>/dev/null || true
  apt-get purge -y cage chromium || true
  rm -f /etc/apt/sources.list.d/linux-surface.list /etc/apt/keyrings/linux-surface.gpg
fi
echo "fiaOS removed. Reboot to return to a normal console login."
