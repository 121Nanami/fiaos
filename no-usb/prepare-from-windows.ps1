#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Prepares a Surface Laptop Go 2 (also Surface Go 2) running Windows to install fiaOS (Debian 12 kiosk) from its own drive, without a USB stick.
.DESCRIPTION
  1. Checks: Surface model, AC power/battery, free space, Secure Boot (must be OFF; offers to reboot into UEFI).
  2. BitLocker: saves recovery key(s) to a note, then decrypts C: (default) or suspends protection (-SuspendOnly).
  3. Writes C:\fiaOS-prep\RECOVERY-NOTE.txt (serial number, keys, recovery links).
  4. Shrinks C: and creates a ~2 GB FAT32 partition labelled FIAOSINST.
  5. Downloads the official Debian 12 netboot installer kernel/initrd + non-free firmware bundle, verifies SHA256.
  6. Copies the fiaOS payload (GRUB EFI menu, preseed + fiaOS files overlay).
  7. Adds a UEFI boot entry and sets it as the ONE-TIME next boot (bcdedit {fwbootmgr} bootsequence).
  Undo everything with undo-prepare.ps1 (as long as you have not run the installer yet).
.PARAMETER SuspendOnly
  Suspend BitLocker instead of fully decrypting (faster; fine because the installer erases the drive anyway).
.PARAMETER SizeMB
  Size of the installer partition (default 2048).
.PARAMETER NoReboot
  Do not offer to reboot at the end.
#>
[CmdletBinding()]
param([switch]$SuspendOnly, [int]$SizeMB = 2048, [switch]$NoReboot)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
$Payload = Join-Path $Here 'payload'
$StateDir = 'C:\fiaOS-prep'
$Label = 'FIAOSINST'
$DebBase = 'https://deb.debian.org/debian/dists/bookworm/main/installer-amd64/current/images'
$FwBase = 'https://cdimage.debian.org/cdimage/firmware/bookworm/current'
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
Start-Transcript -Path (Join-Path $StateDir 'prepare-log.txt') -Append | Out-Null

function Write-Step([string]$Text) { Write-Host "`n=== $Text ===" -ForegroundColor Cyan }
function Confirm-Continue([string]$Prompt, [string]$Expected) {
    $answer = Read-Host "$Prompt (type $Expected to continue)"
    if ($answer -ne $Expected) { Write-Host 'Stopped. Nothing else was changed.' -ForegroundColor Yellow; Stop-Transcript | Out-Null; exit 1 }
}
function Save-State([hashtable]$State) { $State | ConvertTo-Json | Set-Content -Path (Join-Path $StateDir 'state.json') -Encoding UTF8 }
function Get-State { $f = Join-Path $StateDir 'state.json'; if (Test-Path $f) { $h = @{}; (Get-Content $f -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $h[$_.Name] = $_.Value }; return $h } else { return @{} } }

try {
    $state = Get-State
    if (-not (Test-Path (Join-Path $Payload 'EFI\BOOT\BOOTX64.EFI'))) { throw "Payload not found next to this script ($Payload). Unzip the whole fiaos.zip first." }

    Write-Step '1/7 Pre-flight checks'
    $cs = Get-CimInstance Win32_ComputerSystem
    $bios = Get-CimInstance Win32_BIOS
    Write-Host "Device: $($cs.Manufacturer) $($cs.Model)  Serial: $($bios.SerialNumber)"
    if ($cs.Model -notmatch 'Surface Laptop Go 2|Surface Go 2') { Write-Warning 'This is not reported as a Surface Laptop Go 2 (or Surface Go 2). The scripts were written for those models.'; Confirm-Continue 'Continue anyway?' 'YES' }

    $bat = Get-CimInstance Win32_Battery | Select-Object -First 1
    if ($bat) {
        $onAC = $bat.BatteryStatus -in 2, 6, 7, 8, 9
        Write-Host "Battery: $($bat.EstimatedChargeRemaining)%  On AC: $onAC"
        if (-not $onAC) { throw 'Plug in the charger first (the install takes 30-60 minutes).' }
        if ($bat.EstimatedChargeRemaining -lt 50) { Write-Warning 'Battery below 50%. Leave it charging for a while before installing.' }
    }

    $secureBoot = $false
    try { $secureBoot = Confirm-SecureBootUEFI } catch { $secureBoot = $false }
    if ($secureBoot) {
        Write-Warning 'Secure Boot is ON. The fiaOS installer menu is not Microsoft-signed, so Secure Boot must be turned OFF first.'
        Write-Host 'Choose Y to restart straight into Surface UEFI now: Security > Secure Boot > Disabled, then Exit > Restart now.'
        Write-Host 'Back in Windows, run this script again.'
        if ((Read-Host 'Restart into UEFI now? (Y/N)') -match '^[Yy]') { Stop-Transcript | Out-Null; shutdown.exe /r /fw /t 5; exit 0 }
        throw 'Secure Boot is still on. Turn it off, then re-run.'
    }
    Write-Host 'Secure Boot: off (OK)'

    $existing = Get-Volume | Where-Object { $_.FileSystemLabel -eq $Label } | Select-Object -First 1
    if (-not $existing) {
        $c = Get-Volume -DriveLetter C
        $needGB = [math]::Round(($SizeMB + 4096) / 1024, 1)
        Write-Host ("C: free space: {0:N1} GB (need at least {1} GB)" -f ($c.SizeRemaining / 1GB), $needGB)
        if ($c.SizeRemaining -lt (($SizeMB + 4096) * 1MB)) { throw 'Not enough free space on C:. Free some space (Disk Clean-up) and re-run.' }
    }

    Write-Step '2/7 Backup confirmation'
    Write-Host 'The installer will ERASE THE WHOLE DRIVE: Windows, apps, files, everything.' -ForegroundColor Red
    Write-Host 'Back up anything you want to keep first (OneDrive, or copy to the Mac via AirDrop-alternatives / cloud / network share).'
    Confirm-Continue 'Have you backed up everything you need?' 'BACKED UP'

    Write-Step '3/7 BitLocker / Device encryption'
    $keys = @()
    $bl = $null
    try { $bl = Get-BitLockerVolume -MountPoint 'C:' } catch { Write-Host 'BitLocker cmdlets not available; checking with manage-bde.' }
    if ($bl) {
        $keys = @($bl.KeyProtector | Where-Object { $_.KeyProtectorType -eq 'RecoveryPassword' } | ForEach-Object { "ID $($_.KeyProtectorId): $($_.RecoveryPassword)" })
        Write-Host "C: volume status: $($bl.VolumeStatus), protection: $($bl.ProtectionStatus), encrypted: $($bl.EncryptionPercentage)%"
        if ($bl.VolumeStatus -ne 'FullyDecrypted') {
            if ($SuspendOnly) {
                Suspend-BitLocker -MountPoint 'C:' -RebootCount 0 | Out-Null
                $state.bitlocker = 'suspended'
                Write-Host 'BitLocker protection suspended (resume with undo-prepare.ps1).'
            } else {
                Write-Host 'Decrypting C: (manage-bde -off). This can take 20-60 minutes; keep the charger in.'
                manage-bde.exe -off C: | Out-Host
                $state.bitlocker = 'decrypted'
                do {
                    Start-Sleep -Seconds 20
                    $bl = Get-BitLockerVolume -MountPoint 'C:'
                    Write-Progress -Activity 'Decrypting C:' -Status "$($bl.EncryptionPercentage)% still encrypted" -PercentComplete (100 - $bl.EncryptionPercentage)
                } while ($bl.VolumeStatus -ne 'FullyDecrypted')
                Write-Progress -Activity 'Decrypting C:' -Completed
                Write-Host 'C: is fully decrypted.'
            }
        } else { Write-Host 'C: is not encrypted (OK).' }
    } else {
        manage-bde.exe -status C: | Out-Host
        Write-Warning 'If the status above shows encryption, run: manage-bde -off C:  and wait until "Fully Decrypted", then re-run.'
    }
    Save-State $state

    Write-Step '4/7 Recovery note'
    $note = @"
fiaOS preparation, $(Get-Date -Format 'yyyy-MM-dd HH:mm')
Device: $($cs.Manufacturer) $($cs.Model)
Serial number: $($bios.SerialNumber)   (you need this to download the Microsoft recovery image)
Windows: $((Get-CimInstance Win32_OperatingSystem).Caption) $((Get-CimInstance Win32_OperatingSystem).Version)

BitLocker recovery key(s) for C: (also at https://aka.ms/myrecoverykey if signed in with a Microsoft account):
$(if ($keys.Count) { $keys -join "`r`n" } else { '(none found / not encrypted)' })

Getting Windows back later:
  Surface recovery image: https://support.microsoft.com/surface-recovery-image  (needs a USB stick of 16 GB or more)
  Before running the installer you can undo all of this: run undo-prepare.ps1 as admin.

Surface Laptop Go 2 keys: hold the keyboard Volume Up key + press Power = UEFI settings.  Volume Down key + Power = boot from USB.
Or from Windows: Settings > System > Recovery > Advanced startup > Troubleshoot > Advanced options > UEFI Firmware Settings.
"@
    $notePath = Join-Path $StateDir 'RECOVERY-NOTE.txt'
    Set-Content -Path $notePath -Value $note -Encoding UTF8
    Write-Host "Saved $notePath. COPY IT OFF THIS DEVICE (photo with your phone, or email it to yourself / the Mac)."
    Start-Process notepad.exe $notePath
    Confirm-Continue 'Saved the recovery note somewhere else?' 'SAVED'

    Write-Step '5/7 Installer partition'
    $vol = Get-Volume | Where-Object { $_.FileSystemLabel -eq $Label } | Select-Object -First 1
    if ($vol) {
        Write-Host "Re-using existing $Label partition."
        $part = Get-Partition -Volume $vol
        if (-not $part.DriveLetter -or $part.DriveLetter -eq [char]0) { $part | Add-PartitionAccessPath -AssignDriveLetter; $part = Get-Partition -Volume $vol }
    } else {
        $cPart = Get-Partition -DriveLetter C
        $supported = Get-PartitionSupportedSize -DriveLetter C
        $newSize = $cPart.Size - ([int64]$SizeMB * 1MB)
        if ($newSize -lt $supported.SizeMin) { throw "C: can't shrink enough (Windows says the minimum is $([math]::Round($supported.SizeMin/1GB,1)) GB). Try Disk Clean-up, turn off hibernation (powercfg /h off), then re-run." }
        Write-Host "Shrinking C: by $SizeMB MB..."
        Resize-Partition -DriveLetter C -Size $newSize
        $part = New-Partition -DiskNumber $cPart.DiskNumber -Size ([int64]$SizeMB * 1MB) -AssignDriveLetter
        Format-Volume -Partition $part -FileSystem FAT32 -NewFileSystemLabel $Label -Confirm:$false | Out-Null
        $part = Get-Partition -DiskNumber $part.DiskNumber -PartitionNumber $part.PartitionNumber
        $state.partitionCreated = $true
    }
    $drive = "$($part.DriveLetter):"
    $state.drive = $drive; $state.diskNumber = $part.DiskNumber; $state.partitionNumber = $part.PartitionNumber
    Save-State $state
    Write-Host "Installer partition: $drive"

    Write-Step '6/7 Download Debian 12 installer + firmware (SHA256-verified) and copy fiaOS payload'
    $deb = Join-Path $drive 'debian'
    New-Item -ItemType Directory -Force -Path $deb, (Join-Path $drive 'EFI\BOOT'), (Join-Path $drive 'boot\grub') | Out-Null
    $ProgressPreference = 'SilentlyContinue'
    $sums = (Invoke-WebRequest -UseBasicParsing "$DebBase/SHA256SUMS").Content -split "`n"
    $fwSums = (Invoke-WebRequest -UseBasicParsing "$FwBase/SHA256SUMS").Content -split "`n"
    $files = @(
        @{ Url = "$DebBase/netboot/debian-installer/amd64/linux"; Name = 'linux'; Sums = $sums; Key = './netboot/debian-installer/amd64/linux' },
        @{ Url = "$DebBase/netboot/debian-installer/amd64/initrd.gz"; Name = 'initrd.gz'; Sums = $sums; Key = './netboot/debian-installer/amd64/initrd.gz' },
        @{ Url = "$FwBase/firmware.cpio.gz"; Name = 'firmware.cpio.gz'; Sums = $fwSums; Key = 'firmware.cpio.gz' }
    )
    foreach ($f in $files) {
        $dest = Join-Path $deb $f.Name
        $line = $f.Sums | Where-Object { ($_ -split '\s+')[1] -eq $f.Key } | Select-Object -First 1
        if (-not $line) { throw "No checksum listed for $($f.Key)" }
        $want = ($line -split '\s+')[0].ToLower()
        if (-not (Test-Path $dest) -or (Get-FileHash $dest -Algorithm SHA256).Hash.ToLower() -ne $want) {
            Write-Host "Downloading $($f.Name)..."
            Invoke-WebRequest -UseBasicParsing -Uri $f.Url -OutFile $dest
        }
        $got = (Get-FileHash $dest -Algorithm SHA256).Hash.ToLower()
        if ($got -ne $want) { Remove-Item $dest -Force; throw "SHA256 mismatch for $($f.Name). Download corrupted; re-run." }
        Write-Host "  $($f.Name) OK  sha256 $got"
    }
    Copy-Item (Join-Path $Payload 'EFI\BOOT\BOOTX64.EFI') (Join-Path $drive 'EFI\BOOT\BOOTX64.EFI') -Force
    Copy-Item (Join-Path $Payload 'grub.cfg') (Join-Path $drive 'boot\grub\grub.cfg') -Force
    Copy-Item (Join-Path $Payload 'debian\fiaos.cpio.gz') (Join-Path $deb 'fiaos.cpio.gz') -Force
    Copy-Item (Join-Path $Payload 'fiaos-installer.marker') (Join-Path $drive 'fiaos-installer.marker') -Force
    Write-Host 'Payload copied (Wi-Fi firmware for Intel AX201/iwlwifi, Qualcomm ath10k, Marvell mwifiex etc. comes from firmware.cpio.gz).'

    Write-Step '7/7 One-time boot entry'
    if ($state.bootEntry) { bcdedit.exe /delete $state.bootEntry /f 2>$null | Out-Null }
    $out = bcdedit.exe /copy '{bootmgr}' /d 'fiaOS installer'
    if ($LASTEXITCODE -ne 0 -or "$out" -notmatch '\{[0-9a-fA-F-]{36}\}') { throw "bcdedit /copy failed: $out" }
    $id = $Matches[0]
    $state.bootEntry = $id; Save-State $state
    bcdedit.exe /set $id device "partition=$drive" | Out-Null
    bcdedit.exe /set $id path '\EFI\BOOT\BOOTX64.EFI' | Out-Null
    bcdedit.exe /set '{fwbootmgr}' displayorder $id /addlast | Out-Null
    bcdedit.exe /set '{fwbootmgr}' bootsequence $id | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not set the one-time boot. Use the UEFI fallback in NO-USB-GUIDE.md.' }
    bcdedit.exe /enum '{fwbootmgr}' | Out-Host
    Write-Host "Boot entry $id set as the one-time next boot." -ForegroundColor Green

    Write-Host "`nREADY. On restart, the fiaOS installer menu appears (15 s timeout; 'Back to Windows' is an option)."
    Write-Host 'Nothing is erased until you confirm "Write the changes to disks? Yes" inside the installer.'
    Stop-Transcript | Out-Null
    if (-not $NoReboot -and (Read-Host 'Restart now? (Y/N)') -match '^[Yy]') { shutdown.exe /r /t 5 }
}
catch {
    Write-Host "`nERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Log: $StateDir\prepare-log.txt. To revert any changes made so far: run undo-prepare.ps1 as admin."
    try { Stop-Transcript | Out-Null } catch { Write-Verbose 'no transcript' }
    exit 1
}
