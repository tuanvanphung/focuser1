#Requires -Version 5.1

param(
    [switch]$Portable  # Pass -Portable to build exe only, no installer
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# -----------------------------------------------------------------------
# Resolve repo root (works when dot-sourced, run directly, or from ISE)
# -----------------------------------------------------------------------
$RepoRoot = $PSScriptRoot
if (-not $RepoRoot) {
    $RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
}
if (-not $RepoRoot) {
    $RepoRoot = Get-Location
}
$OriginalLocation = Get-Location
Set-Location $RepoRoot

# -----------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------
function Assert-ExitCode {
    param([string]$Step)
    if ($LASTEXITCODE -ne 0) {
        Write-Host "`nFAILED: $Step (exit code $LASTEXITCODE)" -ForegroundColor Red
        Set-Location $OriginalLocation
        exit 1
    }
}

function Write-Step {
    param([int]$N, [int]$Of, [string]$Message)
    Write-Host "`n[$N/$Of] $Message" -ForegroundColor Yellow
}

function Resolve-TauriCli {
    param([string]$RepoRoot, [string]$FrontendDir)

    # 1. frontend-local npm install (@tauri-apps/cli installed as dev dep)
    $local = Join-Path $FrontendDir 'node_modules\.bin\tauri.cmd'
    if (Test-Path $local) {
        return @{ Exe = $local; LeadArgs = @() }
    }

    # 2. repo-root npm install (workspace / hoisted)
    $rootBin = Join-Path $RepoRoot 'node_modules\.bin\tauri.cmd'
    if (Test-Path $rootBin) {
        return @{ Exe = $rootBin; LeadArgs = @() }
    }

    # 3. cargo-installed tauri-cli  (cargo install tauri-cli)
    $null = & cargo tauri --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        return @{ Exe = 'cargo'; LeadArgs = @('tauri') }
    }

    # 4. globally installed npm / standalone binary on PATH
    $global = Get-Command tauri -ErrorAction SilentlyContinue
    if ($global) {
        return @{ Exe = $global.Source; LeadArgs = @() }
    }

    return $null
}

# -----------------------------------------------------------------------
# Paths
# -----------------------------------------------------------------------
$FrontendDir = Join-Path $RepoRoot 'crates\focuser-ui\frontend'
$TauriAppDir = Join-Path $RepoRoot 'crates\focuser-ui'
$BinDir      = Join-Path $RepoRoot 'crates\focuser-ui\binaries'

# Honour CARGO_TARGET_DIR if the environment overrides it
$TargetDir  = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR }
              else { Join-Path $RepoRoot 'target' }
$ReleaseDir = Join-Path $TargetDir 'release'

# -----------------------------------------------------------------------
$ModeLabel = if ($Portable) { "Portable (exe only)" } else { "Full Installer" }
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "    Starting Production Build - $ModeLabel" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

# -----------------------------------------------------------------------
# Step 1 - Resolve host target triple
# -----------------------------------------------------------------------
Write-Step 1 4 "Resolving host target triple..."

$rustcOutput = & rustc -vV 2>&1
Assert-ExitCode "rustc -vV"

$Triple = ($rustcOutput | Select-String '^host:').Line -replace '^host:\s*', ''
if (-not $Triple) {
    Write-Host "FAILED: could not parse host triple from 'rustc -vV'" -ForegroundColor Red
    Set-Location $OriginalLocation
    exit 1
}
Write-Host "      -> $Triple" -ForegroundColor DarkGray

# -----------------------------------------------------------------------
# Step 2 - Build both sidecars in a single cargo invocation
# -----------------------------------------------------------------------
Write-Step 2 4 "Compiling sidecars (release, locked)..."

cargo build --release --locked -p focuser-cli -p focuser-native
Assert-ExitCode "cargo build --release -p focuser-cli -p focuser-native"

# -----------------------------------------------------------------------
# Step 3 - Copy sidecars into the Tauri binaries folder
# -----------------------------------------------------------------------
Write-Step 3 4 "Syncing sidecar binaries..."

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

foreach ($name in @('focuser-cli', 'focuser-native')) {
    $src = Join-Path $ReleaseDir "$name.exe"
    if (-not (Test-Path $src)) {
        Write-Host "FAILED: expected binary not found: $src" -ForegroundColor Red
        Write-Host "       (Check CARGO_TARGET_DIR or cargo build output above)" -ForegroundColor Yellow
        Set-Location $OriginalLocation
        exit 1
    }
    $dst = Join-Path $BinDir "$name-$Triple.exe"
    Copy-Item $src $dst -Force
    Write-Host "      -> $(Split-Path -Leaf $dst)" -ForegroundColor DarkGray
}

# -----------------------------------------------------------------------
# Step 4 - Tauri bundle
# -----------------------------------------------------------------------
if ($Portable) {
    Write-Step 4 4 "Compiling portable exe with Tauri (no installer)..."
} else {
    Write-Step 4 4 "Compiling desktop app with Tauri (full installer)..."
}

if (-not (Test-Path (Join-Path $FrontendDir 'node_modules'))) {
    Write-Host "      node_modules not found, Tauri will run npm ci automatically" -ForegroundColor DarkGray
}

$Cli = Resolve-TauriCli -RepoRoot $RepoRoot -FrontendDir $FrontendDir
if (-not $Cli) {
    Write-Host "FAILED: Tauri CLI not found anywhere." -ForegroundColor Red
    Write-Host ""
    Write-Host "Install it with ONE of the following, then re-run this script:" -ForegroundColor Yellow
    Write-Host "  Option A (Cargo):  cargo install tauri-cli --version `"^2`" --locked" -ForegroundColor Gray
    Write-Host "  Option B (npm):    npm install --save-dev `"@tauri-apps/cli@^2`" --prefix crates\focuser-ui\frontend" -ForegroundColor Gray
    Set-Location $OriginalLocation
    exit 1
}
Write-Host "      using: $($Cli.Exe) $($Cli.LeadArgs -join ' ')" -ForegroundColor DarkGray

$TauriBuildArgs = $Cli.LeadArgs + 'build'
if ($Portable) {
    $TauriBuildArgs += '--no-bundle'
    Write-Host "      bundles: none (portable exe only)" -ForegroundColor DarkGray
} else {
    Write-Host "      bundles: msi, nsis (full installer)" -ForegroundColor DarkGray
}

Push-Location $TauriAppDir
try {
    & $Cli.Exe @TauriBuildArgs
    Assert-ExitCode "tauri build"
} finally {
    Pop-Location
}

# -----------------------------------------------------------------------
# Done
# -----------------------------------------------------------------------
Write-Host "`n=================================================" -ForegroundColor Green
Write-Host "    SUCCESS! Production Build Completed!         " -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Green

if ($Portable) {
    $ExePath = Join-Path $ReleaseDir 'focuser-ui.exe'
    Write-Host "Portable executable:" -ForegroundColor White
    if (Test-Path $ExePath) {
        $sizeMB = [math]::Round((Get-Item $ExePath).Length / 1MB, 1)
        Write-Host "  $ExePath  ($sizeMB MB)" -ForegroundColor Cyan
    } else {
        Write-Host "  $ExePath" -ForegroundColor Cyan
        Write-Host "  (file not found - check tauri build output above)" -ForegroundColor DarkYellow
    }
} else {
    $BundleDir = Join-Path $ReleaseDir 'bundle'
    Write-Host "Installers:" -ForegroundColor White
    foreach ($sub in @('nsis', 'msi')) {
        $dir = Join-Path $BundleDir $sub
        if (Test-Path $dir) {
            Get-ChildItem $dir -Filter '*.exe', '*.msi' | ForEach-Object {
                $sizeMB = [math]::Round($_.Length / 1MB, 1)
                Write-Host "  $($_.FullName)  ($sizeMB MB)" -ForegroundColor Cyan
            }
        }
    }
}

Write-Host "=================================================" -ForegroundColor Green

Set-Location $OriginalLocation
