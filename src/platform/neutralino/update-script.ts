/**
 * Installer of an update (Windows PowerShell 5.1), written to the temporary folder and started by
 * the app just before it exits. Reads its settings from the JSON file given as -Config. Plain
 * ASCII: PowerShell 5.1 reads a script without BOM in the ANSI code page (the translated texts
 * come from the JSON, read as UTF-8).
 *
 * Checks the package (downloaded by the app), waits for every window of the app to close, renames the
 * files being replaced to *.<stamp>.old (a running exe can be renamed, not overwritten: the MCP
 * server may still be in use by an AI client), copies the new ones, writes the marker
 * edimus-update.json and starts the new version, which removes the marker and the old files
 * (UpdaterPort.finish). If anything fails, or the new version exits without removing the
 * marker, the old files are put back and the previous version starts again.
 */
export const UPDATE_SCRIPT = String.raw`
param([Parameter(Mandatory = $true)][string]$Config)
$ErrorActionPreference = 'Stop'
$cfg = Get-Content -Raw -Encoding UTF8 -LiteralPath $Config | ConvertFrom-Json
$work = Split-Path -Parent $Config
Start-Transcript -LiteralPath (Join-Path $work 'update.log') -Force | Out-Null
Add-Type -AssemblyName System.Windows.Forms

$appDir = $cfg.appDir
$exe = Join-Path $appDir $cfg.exe
$exeName = [IO.Path]::GetFileNameWithoutExtension($cfg.exe)
$marker = Join-Path $appDir 'edimus-update.json'
$replaced = New-Object System.Collections.ArrayList
$added = New-Object System.Collections.ArrayList

function Ask($text, $buttons, $icon) {
  [System.Windows.Forms.MessageBox]::Show($text, $cfg.title, $buttons, $icon)
}

function Others {
  @(Get-Process -Name $exeName -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })
}

function Restore {
  foreach ($path in $added) { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue }
  foreach ($item in $replaced) {
    Remove-Item -LiteralPath $item.target -Force -ErrorAction SilentlyContinue
    Move-Item -LiteralPath $item.backup -Destination $item.target -Force
  }
}

try {
  $zip = $cfg.zip
  $hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
  if ($hash -ne $cfg.sha256) { throw "checksum mismatch of the downloaded package" }

  Wait-Process -Id $cfg.pid -Timeout 60 -ErrorAction SilentlyContinue
  while ((Others).Count -gt 0) {
    $choice = Ask $cfg.waitOthers 'YesNoCancel' 'Warning'
    if ($choice -eq 'Cancel') {
      Start-Process -FilePath $exe -WorkingDirectory $appDir
      exit 0
    }
    if ($choice -eq 'No') { Others | Stop-Process -Force }
    for ($i = 0; $i -lt 20 -and (Others).Count -gt 0; $i++) { Start-Sleep -Milliseconds 500 }
  }

  $staging = Join-Path $work 'package'
  if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
  Expand-Archive -LiteralPath $zip -DestinationPath $staging -Force
  $stamp = Get-Date -Format 'yyyyMMddHHmmss'
  foreach ($file in Get-ChildItem -LiteralPath $staging -Recurse -File) {
    $target = Join-Path $appDir $file.FullName.Substring($staging.Length + 1)
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    if (Test-Path -LiteralPath $target) {
      $backup = "$target.$stamp.old"
      Move-Item -LiteralPath $target -Destination $backup -Force
      [void]$replaced.Add(@{ target = $target; backup = $backup })
    } else {
      [void]$added.Add($target)
    }
    Copy-Item -LiteralPath $file.FullName -Destination $target -Force
    Unblock-File -LiteralPath $target
  }

  [IO.File]::WriteAllText($marker, (@{ from = $cfg.from; to = $cfg.to } | ConvertTo-Json))
  $proc = Start-Process -FilePath $exe -WorkingDirectory $appDir -PassThru
  $deadline = (Get-Date).AddSeconds(60)
  while ((Test-Path -LiteralPath $marker) -and -not $proc.HasExited -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
  }
  if ((Test-Path -LiteralPath $marker) -and $proc.HasExited) { throw "the new version did not start" }
} catch {
  $message = $_.Exception.Message
  Write-Output "update failed: $message"
  Restore
  Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
  Ask $cfg.failed.Replace('{message}', $message) 'OK' 'Error' | Out-Null
  Start-Process -FilePath $exe -WorkingDirectory $appDir
}
Stop-Transcript | Out-Null
`;
