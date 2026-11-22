# Stages the GStreamer Windows runtime for Tauri bundling.
#
# Usage:
#   ./scripts/stage-gstreamer.ps1 -GStreamerRoot C:\gstreamer
#
# The release workflow calls this after installing the official MSVC runtime
# and development package. It copies the DLLs, plugins, GIO modules, plugin
# scanner and CA bundle into src-tauri/gstreamer-runtime, which
# src-tauri/tauri.windows.conf.json bundles next to hush.exe.

param(
    [string]$GStreamerRoot = "C:\gstreamer"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $GStreamerRoot)) {
    throw "GStreamer root not found: $GStreamerRoot"
}

$repo = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $repo "src-tauri\gstreamer-runtime"

$dirs = @(
    "bin",
    "lib\gstreamer-1.0",
    "lib\gio\modules",
    "libexec\gstreamer-1.0",
    "etc\ssl\certs",
    "share\glib-2.0\schemas"
)

if (Test-Path $stage) {
    Remove-Item -Recurse -Force $stage
}
foreach ($dir in $dirs) {
    New-Item -ItemType Directory -Force (Join-Path $stage $dir) | Out-Null
}

Copy-Item (Join-Path $GStreamerRoot "bin\*.dll") (Join-Path $stage "bin")
Copy-Item (Join-Path $GStreamerRoot "lib\gstreamer-1.0\*.dll") (Join-Path $stage "lib\gstreamer-1.0")

$gio = Join-Path $GStreamerRoot "lib\gio\modules"
if (Test-Path $gio) {
    Copy-Item (Join-Path $gio "*.dll") (Join-Path $stage "lib\gio\modules") -ErrorAction SilentlyContinue
}

$scanner = Join-Path $GStreamerRoot "libexec\gstreamer-1.0"
if (Test-Path $scanner) {
    Copy-Item (Join-Path $scanner "*") (Join-Path $stage "libexec\gstreamer-1.0") -Recurse -ErrorAction SilentlyContinue
}

# Keep a copy of the plugin scanner next to the runtime DLLs as well. GStreamer
# finds it in libexec, but running it from the same directory as gstreamer-1.0-0.dll
# avoids depending on PATH inheritance for its own DLL imports.
if (Test-Path $scanner) {
    Get-ChildItem $scanner -Filter "gst-plugin-scanner*.exe" -ErrorAction SilentlyContinue |
        ForEach-Object { Copy-Item $_.FullName (Join-Path $stage "bin") }
}
# Older GStreamer layouts keep the plugin scanner in bin instead of libexec.
Get-ChildItem (Join-Path $GStreamerRoot "bin") -Filter "gst-plugin-scanner*.exe" -ErrorAction SilentlyContinue |
    ForEach-Object { Copy-Item $_.FullName (Join-Path $stage "bin") }

$certs = Join-Path $GStreamerRoot "etc\ssl\certs"
if (Test-Path $certs) {
    Copy-Item (Join-Path $certs "*") (Join-Path $stage "etc\ssl\certs") -Recurse -ErrorAction SilentlyContinue
}

# Some GStreamer builds omit the CA bundle. Fall back to Git for Windows' copy
# so HTTPS streams still verify out of the box.
$stagedCa = Join-Path $stage "etc\ssl\certs\ca-certificates.crt"
if (-not (Test-Path $stagedCa)) {
    $candidates = @(
        "C:\Program Files\Git\mingw64\ssl\certs\ca-bundle.crt",
        "C:\Program Files\Git\usr\ssl\certs\ca-bundle.crt",
        "C:\Program Files\Git\mingw64\etc\ssl\certs\ca-bundle.crt"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            Copy-Item $candidate $stagedCa
            break
        }
    }
}

$schemas = Join-Path $GStreamerRoot "share\glib-2.0\schemas\gschemas.compiled"
if (Test-Path $schemas) {
    Copy-Item $schemas (Join-Path $stage "share\glib-2.0\schemas")
}

$core = Join-Path $stage "bin\gstreamer-1.0-0.dll"
if (-not (Test-Path $core)) {
    throw "Staging failed: $core was not copied from $GStreamerRoot"
}

$dllCount = (Get-ChildItem (Join-Path $stage "bin") -Filter *.dll).Count
$pluginCount = (Get-ChildItem (Join-Path $stage "lib\gstreamer-1.0") -Filter *.dll).Count
Write-Host "Staged $dllCount runtime DLLs and $pluginCount plugins into $stage"
