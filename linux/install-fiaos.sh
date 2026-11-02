#!/bin/bash
# fiaOS kiosk installer for a fresh Debian 12 (bookworm) minimal install on a Microsoft Surface Laptop Go 2 (also works on Surface Go 2).
# Idempotent: safe to re-run (e.g. to update the app). Run as root:  sudo bash install-fiaos.sh
# Options (env): FIAOS_NOTEBOOKLM=1 (opt-in unofficial notebooklm-py)  FIAOS_SKIP_SURFACE_KERNEL=1  FIAOS_XAI_KEY=<set-in-the-environment>  FIAOS_NONINTERACTIVE=1  FIAOS_TEST=1 (chroot/CI: no grub/initramfs/systemctl --now)
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo bash $0)"; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_SRC="$(cd "$HERE/.." && pwd)"
APP_DIR=/opt/fiaos
KIOSK_USER=kiosk
TEST="${FIAOS_TEST:-0}"
log() { printf '\n\033[1;36m[fiaOS]\033[0m %s\n' "$*"; }
export DEBIAN_FRONTEND=noninteractive

. /etc/os-release
[ "${VERSION_CODENAME:-}" = bookworm ] || echo "Warning: tested for Debian 12 bookworm, found ${PRETTY_NAME:-unknown}."

log "Enabling contrib/non-free-firmware (Wi-Fi firmware, microcode)"
if [ -f /etc/apt/sources.list ] && ! grep -q non-free-firmware /etc/apt/sources.list; then
  sed -i -E '/^deb(-src)? /{/non-free-firmware/!s/ main( |$)/ main contrib non-free-firmware\1/}' /etc/apt/sources.list
fi
apt-get update -q
apt-get install -y -q --no-install-recommends ca-certificates curl gpg sudo

if [ "${FIAOS_SKIP_SURFACE_KERNEL:-0}" != 1 ]; then
  log "Adding linux-surface repository + kernel (touch, battery, Wi-Fi fixes)"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://raw.githubusercontent.com/linux-surface/linux-surface/master/pkg/keys/surface.asc | gpg --dearmor --yes -o /etc/apt/keyrings/linux-surface.gpg
  echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/linux-surface.gpg] https://pkg.surfacelinux.com/debian release main" > /etc/apt/sources.list.d/linux-surface.list
  apt-get update -q
  apt-get install -y -q linux-image-surface linux-headers-surface libwacom-surface iptsd
  # Signed-kernel MOK for Secure Boot (enrol on next boot, password: surface). Harmless if Secure Boot is off.
  apt-get install -y -q linux-surface-secureboot-mok || echo "secureboot-mok not installed (OK if Secure Boot is disabled)"
fi

log "Installing kiosk stack"
apt-get install -y -q --no-install-recommends \
  nodejs cage chromium brightnessctl \
  plymouth plymouth-themes \
  network-manager wpasupplicant firmware-iwlwifi firmware-atheros firmware-misc-nonfree intel-microcode \
  unattended-upgrades apt-listchanges \
  tlp thermald \
  pipewire-audio wireplumber firmware-sof-signed alsa-utils \
  fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji \
  dbus-user-session libpam-systemd xdg-utils
node -e 'const [a]=process.versions.node.split(".");if(+a<18){console.error("Node 18+ required");process.exit(1)}'

log "Users"
id fiaos >/dev/null 2>&1 || useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin fiaos
id "$KIOSK_USER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$KIOSK_USER"
passwd -l "$KIOSK_USER" >/dev/null   # no password login for kiosk; only tty1 autologin
usermod -aG video,input,render,audio "$KIOSK_USER" 2>/dev/null || usermod -aG video,input,audio "$KIOSK_USER"
usermod -aG video fiaos

log "Installing app to $APP_DIR"
install -d -m 0755 "$APP_DIR"
for f in index.html app.js fx.js accounts.js integrations.js styles.css server.js package.json README.md INTEGRATIONS.md ACCOUNTS-SETUP.md; do install -m 0644 "$APP_SRC/$f" "$APP_DIR/$f"; done
install -d -m 0755 "$APP_DIR/vendor" && install -m 0644 "$APP_SRC/vendor/qrcode.js" "$APP_DIR/vendor/qrcode.js"
install -m 0755 "$HERE/fiaos-kiosk" /usr/local/bin/fiaos-kiosk
install -m 0755 "$HERE/fiaos-notebooklm-import" /usr/local/bin/fiaos-notebooklm-import
install -m 0755 "$HERE/fiaos-brightness" /usr/local/bin/fiaos-brightness

log "Config + optional xAI key (/etc/fiaos/fiaos.env, root:fiaos 0640)"
install -d -m 0750 -o root -g fiaos /etc/fiaos
[ -f /etc/fiaos/fiaos.env ] || install -m 0640 -o root -g fiaos /dev/null /etc/fiaos/fiaos.env
KEY="${FIAOS_XAI_KEY:-}"
if [ -z "$KEY" ] && [ "${FIAOS_NONINTERACTIVE:-0}" != 1 ] && [ -t 0 ] && ! grep -q '^XAI_API_KEY=' /etc/fiaos/fiaos.env; then
  read -r -s -p "Optional xAI API key for Negi-chan (Enter to skip): " KEY; echo
fi
if [ -n "$KEY" ]; then sed -i '/^XAI_API_KEY=/d' /etc/fiaos/fiaos.env; printf 'XAI_API_KEY=%s\n' "$KEY" >> /etc/fiaos/fiaos.env; fi
# account integration settings (placeholders; fill in per ACCOUNTS-SETUP.md, then: sudo systemctl restart fiaos)
grep -q '^# --- accounts ---' /etc/fiaos/fiaos.env || cat >> /etc/fiaos/fiaos.env <<'ENVEOF'
# --- accounts --- (see /opt/fiaos/ACCOUNTS-SETUP.md)
#GOOGLE_CLIENT_ID=<set-in-the-environment>
#GOOGLE_CLIENT_SECRET=<set-in-the-environment>
#MS_CLIENT_ID=<set-in-the-environment>
#MS_TENANT=common
#NOTEBOOKLM_PROJECT_NUMBER=123456789012
#NOTEBOOKLM_LOCATION=global
#NOTEBOOKLM_ENDPOINT_LOCATION=global
#FIAOS_TZ=UTC
ENVEOF
if [ "${FIAOS_NOTEBOOKLM:-0}" = 1 ]; then
  log "Optional: unofficial notebooklm-py (opt-in) in /opt/fiaos/nlm-venv"
  apt-get install -y --no-install-recommends python3-venv python3-pip
  [ -x /opt/fiaos/nlm-venv/bin/notebooklm ] || { python3 -m venv /opt/fiaos/nlm-venv && /opt/fiaos/nlm-venv/bin/pip install --quiet notebooklm-py || echo "WARN: notebooklm-py install failed (no network?) - rerun later"; }
fi
[ -f /etc/fiaos/brightness.conf ] || printf 'DAY=60\nDIM=15\nNIGHT_FROM=21\nNIGHT_TO=6\n' > /etc/fiaos/brightness.conf
chmod 0644 /etc/fiaos/brightness.conf

log "systemd units"
install -m 0644 "$HERE"/systemd/*.service "$HERE"/systemd/*.timer /etc/systemd/system/

log "Autologin on tty1 -> cage + Chromium kiosk"
install -d /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf <<EOT
[Service]
ExecStart=
ExecStart=-/sbin/agetty -o '-p -f -- \\\\u' --noclear --skip-login --nonewline --noissue --autologin $KIOSK_USER %I \$TERM
EOT
KH=$(getent passwd "$KIOSK_USER" | cut -d: -f6)
cat > "$KH/.bash_profile" <<'EOT'
# fiaOS: start the kiosk only on tty1; other TTYs (Ctrl+Alt+F2) are normal admin consoles
if [ "$(tty)" = /dev/tty1 ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then exec /usr/local/bin/fiaos-kiosk > "$HOME/.fiaos-kiosk.log" 2>&1; fi
EOT
touch "$KH/.hushlogin"; chown "$KIOSK_USER:$KIOSK_USER" "$KH/.bash_profile" "$KH/.hushlogin"

log "Chromium policy (quiet, no sign-in/sync/translate/password prompts)"
install -d /etc/chromium/policies/managed
cat > /etc/chromium/policies/managed/fiaos.json <<'EOT'
{ "BrowserSignin": 0, "SyncDisabled": true, "PasswordManagerEnabled": false, "AutofillAddressEnabled": false,
  "AutofillCreditCardEnabled": false, "TranslateEnabled": false, "MetricsReportingEnabled": false,
  "BackgroundModeEnabled": false, "DefaultBrowserSettingEnabled": false, "PromotionalTabsEnabled": false,
  "DefaultNotificationsSetting": 2, "DefaultGeolocationSetting": 2, "AudioCaptureAllowed": false, "VideoCaptureAllowed": false,
  "HardwareAccelerationModeEnabled": true, "DeveloperToolsAvailability": 2 }
EOT

log "Silent boot: GRUB timeout 0, quiet splash"
install -d /etc/default/grub.d
cat > /etc/default/grub.d/fiaos.cfg <<'EOT'
GRUB_TIMEOUT=0
GRUB_TIMEOUT_STYLE=hidden
GRUB_DISTRIBUTOR="fiaOS"
GRUB_CMDLINE_LINUX_DEFAULT="quiet splash loglevel=3 rd.udev.log_level=3 systemd.show_status=auto vt.global_cursor_default=0 consoleblank=0"
EOT

log "Plymouth fiaOS theme"
install -d /usr/share/plymouth/themes/fiaos
install -m 0644 "$HERE"/plymouth/fiaos.plymouth "$HERE"/plymouth/fiaos.script "$HERE"/plymouth/logo.png /usr/share/plymouth/themes/fiaos/

log "Low power: TLP powersave governor, thermald, no suspend (appliance)"
install -d /etc/tlp.d
cat > /etc/tlp.d/50-fiaos.conf <<'EOT'
# Surface Laptop Go 2 (i5-1135G7, has a fan): keep it cool and the fan quiet
CPU_SCALING_GOVERNOR_ON_AC=powersave
CPU_SCALING_GOVERNOR_ON_BAT=powersave
CPU_ENERGY_PERF_POLICY_ON_AC=power
CPU_ENERGY_PERF_POLICY_ON_BAT=power
CPU_MIN_PERF_ON_AC=0
CPU_MAX_PERF_ON_AC=60
CPU_MIN_PERF_ON_BAT=0
CPU_MAX_PERF_ON_BAT=50
CPU_BOOST_ON_AC=0
CPU_BOOST_ON_BAT=0
CPU_HWP_DYN_BOOST_ON_AC=0
CPU_HWP_DYN_BOOST_ON_BAT=0
INTEL_GPU_MAX_FREQ_ON_AC=800
INTEL_GPU_MAX_FREQ_ON_BAT=700
INTEL_GPU_BOOST_FREQ_ON_AC=800
INTEL_GPU_BOOST_FREQ_ON_BAT=700
PLATFORM_PROFILE_ON_AC=low-power
PLATFORM_PROFILE_ON_BAT=low-power
WIFI_PWR_ON_AC=on
WIFI_PWR_ON_BAT=on
EOT
install -d /etc/systemd/logind.conf.d
cat > /etc/systemd/logind.conf.d/fiaos.conf <<'EOT'
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
IdleAction=ignore
HandlePowerKey=ignore
EOT

log "Unattended security updates (reboot 03:30 only if needed)"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOT
cat > /etc/apt/apt.conf.d/52fiaos-unattended <<'EOT'
Unattended-Upgrade::Origins-Pattern {
        "origin=Debian,codename=${distro_codename}-security,label=Debian-Security";
        "origin=Debian,codename=${distro_codename},label=Debian";
        "site=pkg.surfacelinux.com";
};
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "03:30";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
EOT

rm -f /etc/systemd/system/fiaos-off.timer   # older builds blanked at night; screen now stays on
log "Enabling services"
systemctl daemon-reload 2>/dev/null || true
systemctl enable fiaos.service fiaos-dim.timer fiaos-day.timer fiaos-brightness@wake.service tlp.service thermald.service unattended-upgrades.service NetworkManager.service
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
if [ "$TEST" != 1 ]; then
  plymouth-set-default-theme fiaos
  update-initramfs -u
  update-grub
  systemctl restart fiaos.service || true
else
  plymouth-set-default-theme fiaos || true
  log "FIAOS_TEST=1: skipped initramfs, update-grub and service start"
fi
install -d /var/lib/fiaos; date > /var/lib/fiaos/installed
systemctl disable fiaos-firstboot.service 2>/dev/null || true
log "Done. Reboot to start fiaOS.  Admin console: Ctrl+Alt+F2 (back: Ctrl+Alt+F1).  Logs: journalctl -u fiaos, ~kiosk/.fiaos-kiosk.log"
