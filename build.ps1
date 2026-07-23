param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("chrome", "firefox")]
    [string]$Browser
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$name = "rumble-extension"

$distRoot = Join-Path $root "dist"
$stageDir = Join-Path $distRoot $Browser

if (Test-Path $stageDir) { Remove-Item $stageDir -Recurse -Force }
New-Item -ItemType Directory -Path $stageDir | Out-Null

foreach ($item in @("icons", "css", "js", "_locales", "index.html")) {
    Copy-Item (Join-Path $root $item) -Destination $stageDir -Recurse
}

$manifestSource = if ($Browser -eq "firefox") { "manifest-firefox.json" } else { "manifest.json" }
Copy-Item (Join-Path $root $manifestSource) -Destination (Join-Path $stageDir "manifest.json")

$manifest = Get-Content (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json
$version = $manifest.version

$zipPath = Join-Path $distRoot "$name-$Browser-$version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

# Compress-Archive stores Windows-style backslash separators in the zip
# entries, which violates the zip spec (forward slashes are required) and
# can break extraction on the Linux-based store backends. Build the archive
# with System.IO.Compression directly instead, forcing forward slashes.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    Get-ChildItem -Path $stageDir -Recurse -File | ForEach-Object {
        $relativePath = $_.FullName.Substring($stageDir.Length + 1) -replace '\\', '/'
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $relativePath, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally {
    $zip.Dispose()
}

Write-Host "Built $Browser package: $zipPath"
