# fiaOS on a Surface Laptop Go 2: Linux kiosk setup

The result is a dedicated appliance. It powers on with a silent GRUB and the fiaOS Plymouth splash, signs in automatically on tty1 as `kiosk`, and runs **cage** (a Wayland kiosk compositor) with **Chromium --kiosk** pointed at `http://localhost:8080`. The fiaOS Node server runs as a hardened systemd service bound to 127.0.0.1, and both it and the browser restart themselves if they crash.

> **The Surface Laptop Go 2 (i5-1135G7) has a fan.** fiaOS is tuned to keep it quiet:
> - TLP: `powersave` governor, CPU capped at **60 % max performance** on AC (50 % on battery), turbo and dynamic boost off, `power` energy policy, iGPU capped at 800 MHz, low-power platform profile.
> - `thermald` keeps temperatures in check.
> - If the fan still spins up, lower `CPU_MAX_PERF_ON_AC` in `/etc/tlp.d/50-fiaos.conf` (e.g. 45), then run `sudo tlp start`.
>
> The rest of the low-power design:
> - The app has no continuous JS loops, and all motion is CSS. Everything pauses after 45 s idle and at night.
> - The clock ticks once a minute and weather refreshes every 30 min.
> - Chromium background services are disabled.
> - TLP sets the `powersave` governor, low-power platform profile and no turbo boost; `thermald` is also enabled.
> - The server is capped at 60 % of one CPU.

## What you need
- Surface Laptop Go 2 (12.4" 1536×1024 touch, i5-1135G7, Intel Wi-Fi 6 AX201) and its charger. The built-in keyboard is used for setup.
- A USB-C stick (or USB-A stick plus adapter), at least 1 GB.
- Wi-Fi name and password.
- `fiaos.zip`.

## 1. Make the USB
1. Download **Debian 12 netinst amd64** (`debian-12.x.x-amd64-netinst.iso`) from https://www.debian.org/distrib/netinst. It includes non-free firmware, which you need for the Intel AX201 Wi-Fi.
2. Write it with **balenaEtcher** or **Rufus** (DD mode). On Linux/macOS: `sudo dd if=debian-12*.iso of=/dev/sdX bs=4M status=progress conv=fsync`.
3. Optional (for an automated install): copy `linux/preseed.cfg` and `fiaos.zip` to the stick. Etcher/dd sticks are read-only ISO9660, so for this use Rufus in "ISO mode" or host `preseed.cfg` on a web server instead.

## 2. Surface UEFI settings
Power off and wait 10 s. Then hold the **Volume Up key on the keyboard** (top row, speaker-with-plus icon), and while holding it **press and release Power**. Keep holding until the grey **Surface UEFI** screen appears (Microsoft's documented method). *No luck?* In Windows: Settings → System → Recovery → **Advanced startup: Restart now** → Troubleshoot → Advanced options → **UEFI Firmware Settings** → Restart. In UEFI:
- **Security → Secure Boot**: you have two choices.
  - **Option A (simplest):** set it to **Disabled**/"None". The linux-surface kernel then boots without extra steps.
  - **Option B (keep Secure Boot):** choose **"Microsoft & 3rd-party CA"**. The installer adds `linux-surface-secureboot-mok`, and on the first reboot a blue **MOK Manager** screen appears. Pick *Enroll MOK → Continue → Yes* and type the password **`surface`**. If you skip this step, the Surface kernel won't boot; pick the Debian kernel under GRUB's *Advanced options* (hold **Shift/Esc** at boot) and rerun `sudo mokutil --import /usr/share/linux-surface-secureboot/surface.cer`.
- **Boot configuration**: move **USB Storage** to the top.
- **TPM**: leave it on. **Note:** disk encryption isn't used, see the security notes.

To boot from USB once: power off, hold the keyboard **Volume Down** key, press **Power**.

## 3. Install Debian (this wipes Windows)
- **Interactive (recommended):** choose *Install* (not graphical), language English, location Australia, keyboard US.
  - **Network:** pick your Wi-Fi.
  - **Hostname:** `fiaos`.
  - **Root password:** leave it empty, so the admin user gets sudo.
  - **User:** `fiadmin` with a strong password.
  - **Partitioning:** *Guided – use entire disk*, all files in one partition.
  - **Software selection:** untick everything except **standard system utilities** (plus *SSH server* if you want remote admin).
  - **GRUB:** yes.
- **Automated:** at the boot menu choose *Advanced options → Automated install* and give `file:///cdrom/preseed.cfg` or `http://…/preseed.cfg`. It still asks for the admin password and confirms the network.

## 4. Install fiaOS
Log in as `fiadmin`, then:
```sh
nmcli dev wifi connect "YourWiFi" password "secret"      # if Wi-Fi isn't up yet (or run: sudo nmtui)
sudo apt install -y unzip curl
# get fiaos.zip onto the device (USB stick: lsblk; sudo mount /dev/sda1 /mnt; cp /mnt/fiaos.zip ~)
unzip fiaos.zip && cd fiaos/linux
sudo bash install-fiaos.sh          # asks for an optional xAI key; safe to re-run to update
sudo reboot
```
On reboot it goes GRUB (hidden), then the fiaOS splash, then fiaOS full-screen.

**Wi-Fi after install:** run `sudo nmtui` on the admin console (TTY2). NetworkManager saves the connection and reconnects at boot.

## Everyday admin
| Task | How |
|---|---|
| Admin console | **Ctrl+Alt+F2** (log in as `fiadmin`). Back to fiaOS: **Ctrl+Alt+F1** |
| Restart the app | `sudo systemctl restart fiaos` (server). Restart the browser: `sudo pkill -u kiosk chromium` (it restarts on its own) |
| Logs | `journalctl -u fiaos -e` · `sudo less ~kiosk/.fiaos-kiosk.log` |
| Set or change the xAI key | `sudoedit /etc/fiaos/fiaos.env` → `XAI_API_KEY=…`, then `sudo systemctl restart fiaos` |
| Night dimming | `/etc/fiaos/brightness.conf` (DAY/DIM %). Times are in `/etc/systemd/system/fiaos-dim.timer` (21:00) and `fiaos-day.timer` (06:30). Touching the screen at night restores dim (not full) brightness |
| Update fiaOS | Copy the new zip, then `sudo bash fiaos/linux/install-fiaos.sh` |
| Security updates | Automatic (unattended-upgrades for Debian, Debian-Security and linux-surface). Reboots at 03:30 only when needed |
| Show the boot menu | Hold **Shift** or **Esc** while powering on |

**Screen behaviour:**
- The screen never blanks: there's no DPMS, `consoleblank=0`, and sleep/suspend are masked.
- After 20 min without input, fiaOS returns to the Stage tab, closes panels and keeps animations still. Animations already pause after 45 s idle.
- Night mode dims the screen from 21:00 to 06:00 (app) and lowers the backlight at 21:00 (timer).
- The lid and power button are ignored so it behaves like an appliance. To power off, hold **Power** for about 10 s, or run `sudo poweroff` from TTY2.

## Uninstall / revert
`sudo bash fiaos/linux/uninstall-fiaos.sh` removes autologin, the services, timers, theme, GRUB and TLP tweaks, the app and its config. The device returns to a normal Debian console login.
- `FIAOS_PURGE=1` also deletes the `kiosk`/`fiaos` users, cage/Chromium and the linux-surface repo.
- `FIAOS_KEEP_CONFIG=1` keeps `/etc/fiaos`.
- The linux-surface kernel stays installed. To go back to Windows, reinstall it from Microsoft's Surface recovery image.

## Security notes (please read)
- **Auto-login means anyone holding the device can use fiaOS.** That includes Bea's diet, study and expense data, and whatever her calendar ICS link exposes. Treat it like a shared household screen.
- The `kiosk` user has **no password and no sudo**. The admin account is `fiadmin`, so use a strong password. The server only listens on 127.0.0.1.
- **No disk encryption.** The install uses no LUKS, because unattended boot plus auto-login would need the key stored on the device anyway. Someone with physical access and a USB stick could therefore read the disk, including app data in `~kiosk/.config/chromium` and the xAI key in `/etc/fiaos/fiaos.env`. Encryption is possible: choose *Guided – use entire disk and set up encrypted LVM* in the installer. Then a passphrase is needed at every boot, unless you set up TPM unlocking with `systemd-cryptenroll` (Debian 12 needs extra initramfs work; not set up here). This is the same trade-off as BitLocker with auto sign-in on Windows.
- The xAI key file is `root:fiaos 0640`, so the kiosk user and browser can't read it.
- With Secure Boot disabled (Option A), boot-level tampering isn't detected. Option B keeps Secure Boot on.

## What was tested vs not
See the "Testing" section in `README.md`.

## Surface Laptop Go 2 notes
- **linux-surface support:** the linux-surface project lists the Surface Laptop Go 2 (SLG2) as supported. Keyboard, touchpad, touchscreen, Wi-Fi, Bluetooth, speakers, buttons, suspend, battery status, performance modes and cameras are all ✓; battery status and performance modes need linux-surface ≥ 5.18.10 (we install 7.x). Source: https://github.com/linux-surface/linux-surface/wiki/Supported-Devices-and-Features
- **Wi-Fi:** Intel Wi-Fi 6 AX201 (driver `iwlwifi`, firmware package `firmware-iwlwifi`). It's included in the installer's firmware bundle and installed by `install-fiaos.sh`.
- **Display:** 1536×1024 (3:2). Chromium runs at `--force-device-scale-factor=1.25` (about 1229×819 CSS px). For bigger touch targets, set 1.5 by adding `FIAOS_SCALE=1.5` to the top of `/usr/local/bin/fiaos-kiosk`.
- **Lid:** closing the lid is ignored (the kiosk keeps running). Power off with `sudo poweroff` from TTY2, or hold Power for about 10 s.
