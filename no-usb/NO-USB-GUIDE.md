# Installing fiaOS on the Surface Laptop Go 2 without a USB stick

This guide is for someone who has never used Linux. Expect about **1.5–2 hours** in total, most of it waiting.
**At the end, Windows and everything on the Surface is gone.** fiaOS becomes the only system on it.

How it works: a script in Windows makes a small 2 GB "installer" area on the Surface's own drive and puts the official Debian installer there. The Surface then restarts into it. The installer runs entirely from memory and downloads everything else over Wi-Fi, so it can safely erase the whole drive, including the installer area. fiaOS is set up automatically at the end.

> **Strong advice:** buy a cheap USB stick anyway (about $10 AUD, 16 GB+, USB-C or USB-A with a USB-C adapter). You don't need it for this method, but it's **the only way back** if something goes wrong. Microsoft's Surface recovery image needs one. Having it in the drawer turns "stuck" into "15-minute fix".

---

## Before you start (≈15 min)
1. **Back up** everything you want to keep from the Surface: photos, documents, browser bookmarks/passwords. Put them in OneDrive/Google Drive/iCloud, or send them to the Mac. *Everything left on the Surface will be erased.*
2. **Plug in the charger** and keep it plugged in the whole time.
3. **Keyboard:** use the Surface Laptop's built-in keyboard and touchpad. The installer doesn't use touch.
4. Know your **Wi-Fi name and password**.
5. On the Mac, unzip `fiaos.zip` and keep this guide open there (the Surface will be busy).
6. Copy the `fiaos.zip` file to the Surface: email it to yourself, use OneDrive/Google Drive, or download it there directly. **On the Surface, right-click it → Extract All…** to e.g. `C:\Users\<you>\Downloads\fiaos`.

## Step 1: Turn Secure Boot off (≈3 min)
The fiaOS installer menu isn't signed by Microsoft, so the Surface must be allowed to start it.
1. Shut the Surface down (Start → Power → Shut down).
2. Wait 10 s, then hold the **Volume Up key on the keyboard** (top row, speaker-with-plus icon), and while holding it **press and release Power**. Keep holding until the grey **Surface UEFI** screen appears (Microsoft's documented method). *No luck?* In Windows: Settings → System → Recovery → **Advanced startup: Restart now** → Troubleshoot → Advanced options → **UEFI Firmware Settings** → Restart.
3. Tap **Security** → **Change configuration** under *Secure Boot* → choose **None** (or *Disabled*) → OK.
4. Tap **Exit** → **Restart now**. The Surface boots back to Windows. A red padlock on the splash screen is normal now.

*(The script in Step 2 checks this and offers to take you to this screen if it's still on.)*

> **Already decrypting?** If you turned off Device encryption yourself, let it finish (Settings → Privacy & security → Device encryption shows *Off*). The script detects this and skips the wait.

## Step 2: Run the preparation script in Windows (≈10–60 min)
1. Open the extracted `fiaos` folder → `no-usb`.
2. Click **Start**, type **PowerShell**, right-click **Windows PowerShell** → **Run as administrator** → Yes.
3. Copy-paste these lines (change the path if you extracted somewhere else) and press Enter:
   ```powershell
   cd "$env:USERPROFILE\Downloads\fiaos\no-usb"
   Set-ExecutionPolicy -Scope Process Bypass -Force
   .\prepare-from-windows.ps1
   ```
   *Faster option:* `.\prepare-from-windows.ps1 -SuspendOnly` skips the long decryption. That's fine because the drive is erased anyway.
4. The script walks you through it and stops if anything looks wrong:
   - **Checks** the model, charger, free space and Secure Boot.
   - Asks you to type **BACKED UP** to confirm your backup.
   - **BitLocker / Device encryption:**
     - It shows your recovery key and saves it in a note.
     - Then it turns encryption off and waits until it's done. That's usually 20–60 min with a progress bar; leave it alone.
   - Opens **RECOVERY-NOTE.txt** in Notepad. **Take a photo of it with your phone** (it has the serial number and BitLocker key), then type **SAVED**.
   - **Shrinks C:** and creates the 2 GB **FIAOSINST** area.
   - **Downloads** the official Debian 12 installer and firmware (about 410 MB) and **checks their SHA256 fingerprints**. If a file is corrupted it stops.
   - Sets the Surface to start the fiaOS installer **once** on the next restart.
5. When it says **READY**, answer **Y** to restart.

> Changed your mind at any point before Step 3? Run `.\undo-prepare.ps1` in an admin PowerShell. It removes the boot entry and the installer area, grows C: back and resumes BitLocker.

## Step 3: The installer (≈30–60 min)
1. After the restart, a black menu appears: **"Install fiaOS (ERASES the whole internal drive…)"**. Press **Enter**, or wait 15 s.
   - Not ready? Use the arrow keys to choose **Back to Windows (change nothing)**.
2. Blue screens follow. Use the **keyboard**: arrow keys to move, **Enter** to choose, **Tab** to reach buttons, **Space** to tick.
3. **Wi-Fi:** pick your network from the list, choose *WPA/WPA2 PSK*, and type the Wi-Fi password.
4. **Admin password:** type a strong password for the `fiadmin` account, twice. **Write it down.** You'll need it to fix or update things later.
5. **Partitioning:**
   - Choose **Guided – use entire disk**, then pick the Surface's internal drive (the large one, about 64 or 128 GB).
   - On the **"Write the changes to disks?"** screen, choose **Yes**. **This is the point of no return.** Nothing is erased before you choose Yes.
6. Wait. It downloads and installs Debian, then fiaOS (Chromium, Surface drivers and so on). The bar can sit still for minutes; that's normal.
7. "Installation complete" → **Continue**. The Surface restarts and you should get the soft fiaOS splash, then fiaOS full-screen.
   - If you see a text login instead, wait 5 min: a first-boot step finishes fiaOS and restarts once more.

## If the Wi-Fi isn't found or won't connect during install
Use your **phone as a wired connection** (USB tethering):
1. Connect the phone to the Surface's USB-C port with its charging cable. iPhone users need a USB-C cable or adapter.
2. **Android:** Settings → Network → Hotspot & tethering → **USB tethering** on.
   **iPhone:** Settings → **Personal Hotspot** → *Allow Others to Join* on, then tap **Trust** on the phone.
3. In the installer, choose **Go Back** until you reach *Configure the network*, then pick the interface named like **usb0** or **enx…** (not "wlp…"). It sets itself up automatically.
4. After installation you can switch to Wi-Fi: on the device, press **Ctrl+Alt+F2**, log in as `fiadmin`, run `sudo nmtui`, then **Ctrl+Alt+F1** to return.

## If something goes wrong
| What you see | What to do |
|---|---|
| The Surface starts Windows instead of the installer menu | Secure Boot is probably still on (Step 1). Or start it manually: shut down, hold the keyboard **Volume Up** key + press Power → **Boot configuration** → swipe **fiaOS installer** to the left (or drag it to the top) → Exit. |
| The installer menu appears but you want Windows | Choose **Back to Windows**, then run `undo-prepare.ps1`. |
| BitLocker recovery screen in Windows | Type the recovery key from your photo of RECOVERY-NOTE.txt (or from https://aka.ms/myrecoverykey). |
| The installer stops with an error **before** "Write the changes to disks? → Yes" | Nothing is erased. Hold Power 10 s to switch off, then power on: Windows starts normally. Run `undo-prepare.ps1` and tell us what the error said. |
| The installer fails **after** you chose Yes | Windows is gone, but the installer is still on the drive until it's overwritten. Power off, then hold the keyboard **Volume Up** key + Power → Boot configuration and try the entry again. If there's no entry: you need a USB stick (below). |
| The Surface won't start anything / black screen | Hold Power 20 s, then try again. Still nothing: use a USB stick (below). |
| fiaOS shows a text login and nothing else | Press Ctrl+Alt+F2, log in as `fiadmin`, run `sudo bash /root/fiaos/linux/install-fiaos.sh`, then `sudo reboot`. |

**Last-resort recovery needs a USB stick (16 GB+):**
- **Back to Windows:** on the Mac or any PC, go to https://support.microsoft.com/surface-recovery-image, enter the Surface's **serial number** (on RECOVERY-NOTE.txt, or on the kickstand), and follow Microsoft's steps to make a recovery USB. Boot from it: hold the keyboard **Volume Down** key and press Power.
- **Or put fiaOS on with the normal USB method:** see `linux/SURFACE-LINUX-SETUP.md`.

## Afterwards
- Admin console: **Ctrl+Alt+F2** (log in as `fiadmin`). Back to fiaOS: **Ctrl+Alt+F1**.
- Add the xAI key later: `sudoedit /etc/fiaos/fiaos.env` → `XAI_API_KEY=…` → `sudo systemctl restart fiaos`.
- **Security:** fiaOS signs in automatically, so anyone holding the Surface can see Ada's, Bea's and Cam's dashboards. The disk isn't encrypted, so treat it like a shared kitchen screen. More detail is in `linux/SURFACE-LINUX-SETUP.md`.
- The Surface Laptop Go 2 has a fan; fiaOS caps the CPU at 60 % with turbo off to keep it quiet. The only sound it ever makes is one soft chime when a thunderstorm is forecast (never 21:00–07:00).

## For the curious: what's inside `no-usb/`
| File | What it does |
|---|---|
| `prepare-from-windows.ps1` | Everything in Step 2 (logs to `C:\fiaOS-prep\prepare-log.txt`) |
| `undo-prepare.ps1` | Reverts Step 2 (only before you erase the disk) |
| `payload/EFI/BOOT/BOOTX64.EFI` | GRUB boot menu with the fiaOS entries built in |
| `payload/debian/fiaos.cpio.gz` | Small add-on for the installer: automatic answers (`preseed.cfg`) + the fiaOS files |
| `payload/debian/{linux,initrd.gz,firmware.cpio.gz}` | Official Debian 12 netboot installer + firmware. The Windows script re-downloads and verifies these |
| `build-payload.sh` | Rebuilds the payload on Linux/Mac (`--download` fetches + verifies the Debian files) |
| `payload-src/` | Sources: `grub.cfg`, `preseed.cfg`, first-boot retry service |

Wi-Fi note: the Surface Laptop Go 2 uses **Intel Wi-Fi 6 AX201** (driver `iwlwifi`). Its firmware (`firmware-iwlwifi`) is in the official Debian firmware bundle the installer loads, and the kiosk installs it too. The bundle also covers Qualcomm ath10k (Surface Go 2) and Marvell mwifiex (older Surfaces).
