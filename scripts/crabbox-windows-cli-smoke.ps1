$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$nodeVersion = "24.15.0"
$tempRoot = [System.IO.Path]::GetTempPath()
$nodeDir = Join-Path $tempRoot "clawpdf-node"
$nodeRoot = Join-Path $nodeDir "node-v$nodeVersion-win-x64"
$nodeZip = Join-Path $tempRoot "clawpdf-node.zip"

if (!(Test-Path (Join-Path $nodeRoot "node.exe"))) {
  Remove-Item $nodeDir -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $nodeDir -Force | Out-Null
  Invoke-WebRequest "https://nodejs.org/dist/v$nodeVersion/node-v$nodeVersion-win-x64.zip" -OutFile $nodeZip
  Expand-Archive $nodeZip -DestinationPath $nodeDir -Force
}

$pnpmPrefix = Join-Path $tempRoot "clawpdf-pnpm"
$env:PATH = "$nodeRoot;$pnpmPrefix\node_modules\.bin;$env:PATH"
$npmExe = Join-Path $nodeRoot "npm.cmd"
$pnpmExe = Join-Path $pnpmPrefix "node_modules\.bin\pnpm.cmd"

function Invoke-Checked {
  param([string]$Executable, [string[]]$Arguments = @())
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $Executable $($Arguments -join ' ')"
  }
}

Invoke-Checked "node" @("--version")
Invoke-Checked $npmExe @("--version")
Invoke-Checked $npmExe @("install", "--prefix", $pnpmPrefix, "pnpm@11.2.2")

Invoke-Checked $pnpmExe @("install", "--frozen-lockfile")
Invoke-Checked $pnpmExe @("typecheck")
Invoke-Checked $pnpmExe @("test:cli")
