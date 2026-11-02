#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Reverts prepare-from-windows.ps1: removes the fiaOS boot entry and installer partition, grows C: back, resumes BitLocker.
  Only meaningful BEFORE the Debian installer has erased the drive.
.PARAMETER ReEncrypt
  If C: was decrypted, start BitLocker / device encryption again (needs a Windows edition that supports it).
#>
[CmdletBinding()]
param([switch]$ReEncrypt)
$ErrorActionPreference = 'Stop'
$StateDir = 'C:\fiaOS-prep'
$Label = 'FIAOSINST'
$state = @{}
$sf = Join-Path $StateDir 'state.json'
if (Test-Path $sf) { (Get-Content $sf -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $state[$_.Name] = $_.Value } }

Write-Host '=== Removing one-time boot + boot entry ===' -ForegroundColor Cyan
bcdedit.exe /deletevalue '{fwbootmgr}' bootsequence 2>$null | Out-Null
if ($state.bootEntry) { bcdedit.exe /delete $state.bootEntry /f | Out-Host }
$left = bcdedit.exe /enum firmware | Select-String -Pattern 'fiaOS installer' -Context 3, 0
foreach ($m in $left) { $g = [regex]::Match(($m.Context.PreContext -join ' '), '\{[0-9a-fA-F-]{36}\}').Value; if ($g) { bcdedit.exe /delete $g /f | Out-Host } }

Write-Host '=== Removing installer partition ===' -ForegroundColor Cyan
$vol = Get-Volume | Where-Object { $_.FileSystemLabel -eq $Label } | Select-Object -First 1
if ($vol) { Get-Partition -Volume $vol | Remove-Partition -Confirm:$false; Write-Host "Removed $Label." } else { Write-Host 'No installer partition found.' }

Write-Host '=== Growing C: back ===' -ForegroundColor Cyan
Update-HostStorageCache
$max = (Get-PartitionSupportedSize -DriveLetter C).SizeMax
$cur = (Get-Partition -DriveLetter C).Size
if ($max -gt $cur + 1MB) { Resize-Partition -DriveLetter C -Size $max; Write-Host 'C: extended.' } else { Write-Host 'C: is already at full size (or the free space is not next to it; use Disk Management).' }

Write-Host '=== BitLocker ===' -ForegroundColor Cyan
try {
    $bl = Get-BitLockerVolume -MountPoint 'C:'
    if ($bl.ProtectionStatus -eq 'Off' -and $bl.VolumeStatus -eq 'FullyEncrypted') { Resume-BitLocker -MountPoint 'C:' | Out-Null; Write-Host 'BitLocker protection resumed.' }
    elseif ($state.bitlocker -eq 'decrypted' -and $ReEncrypt) { Enable-BitLocker -MountPoint 'C:' -RecoveryPasswordProtector -UsedSpaceOnly | Out-Null; Write-Host 'Re-encryption started. SAVE THE NEW RECOVERY KEY (Settings > Privacy & security > Device encryption).' }
    elseif ($state.bitlocker -eq 'decrypted') { Write-Host 'C: was decrypted. Re-enable via Settings > Privacy & security > Device encryption, or re-run with -ReEncrypt.' }
    else { Write-Host "BitLocker: $($bl.VolumeStatus) / $($bl.ProtectionStatus)" }
} catch { Write-Host 'BitLocker cmdlets unavailable; check Settings > Device encryption.' }
Remove-Item $sf -ErrorAction SilentlyContinue
Write-Host "`nDone. Windows is back to normal. (Your recovery note in $StateDir was kept.)" -ForegroundColor Green
