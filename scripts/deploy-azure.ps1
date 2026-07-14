param(
  [string]$ResourceGroup = "fpv-car-rg",
  [string]$RelayApp = "fpv-car-relay-noppanun",
  [string]$WebApp = "fpv-car-web-noppanun",
  [string]$VehicleId = "car-001",
  [string]$VehicleToken = "fpv-veh-Noppanun-2026-secure",
  [string]$ControllerToken = "fpv-web-Noppanun-2026-secure",
  [switch]$FreeTier
)

$ErrorActionPreference = "Stop"

function Assert-AzCli {
  $az = Get-Command az -ErrorAction SilentlyContinue
  if (-not $az) {
    throw "Azure CLI 'az' was not found in this PowerShell session."
  }
}

function Invoke-Robocopy {
  param(
    [string]$Source,
    [string]$Destination,
    [string[]]$Args
  )

  & robocopy $Source $Destination @Args
  $code = $LASTEXITCODE
  if ($code -ge 8) {
    throw "robocopy failed with exit code $code"
  }
}

Assert-AzCli

$Root = Split-Path -Parent $PSScriptRoot
$RelayUrl = "wss://$RelayApp.azurewebsites.net"
$WebUrl = "https://$WebApp.azurewebsites.net/controller"
$AlwaysOn = if ($FreeTier) { "false" } else { "true" }

Write-Host "Configuring relay app settings..."
az webapp config set `
  --resource-group $ResourceGroup `
  --name $RelayApp `
  --web-sockets-enabled true `
  --always-on $AlwaysOn `
  --startup-file "node /home/site/wwwroot/index.js"

az webapp config appsettings set `
  --resource-group $ResourceGroup `
  --name $RelayApp `
  --settings `
    PORT=8080 `
    WEBSITES_PORT=8080 `
    SCM_DO_BUILD_DURING_DEPLOYMENT=true `
    ALLOW_LOCALHOST_AUTH_BYPASS=false `
    VEHICLE_AUTH_TOKEN=$VehicleToken `
    CONTROLLER_AUTH_TOKEN=$ControllerToken

Write-Host "Creating clean relay package..."
$RelayZip = Join-Path $Root "server.zip"
Remove-Item $RelayZip -Force -ErrorAction SilentlyContinue
Compress-Archive `
  -Path `
    (Join-Path $Root "server\index.js"), `
    (Join-Path $Root "server\logger.js"), `
    (Join-Path $Root "server\package.json"), `
    (Join-Path $Root "server\package-lock.json") `
  -DestinationPath $RelayZip `
  -Force

Write-Host "Deploying relay..."
az webapp deploy `
  --resource-group $ResourceGroup `
  --name $RelayApp `
  --src-path $RelayZip `
  --type zip `
  --clean true `
  --restart true

Write-Host "Configuring web app settings..."
az webapp config set `
  --resource-group $ResourceGroup `
  --name $WebApp `
  --always-on $AlwaysOn `
  --startup-file "/home/site/wwwroot/startup.sh"

az webapp config appsettings set `
  --resource-group $ResourceGroup `
  --name $WebApp `
  --settings `
    PORT=8080 `
    WEBSITES_PORT=8080 `
    SCM_DO_BUILD_DURING_DEPLOYMENT=true `
    NEXT_PUBLIC_WS_URL=$RelayUrl `
    NEXT_PUBLIC_VEHICLE_ID=$VehicleId `
    NEXT_PUBLIC_CONTROLLER_AUTH_TOKEN=$ControllerToken

Write-Host "Creating clean web package..."
$Stage = Join-Path $env:TEMP "fpv-web-deploy"
$WebZip = Join-Path $Root "rc-car-control.zip"
Remove-Item $Stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $Stage | Out-Null

Invoke-Robocopy `
  -Source (Join-Path $Root "rc-car-control") `
  -Destination $Stage `
  -Args @(
    "/E",
    "/XD", "node_modules", ".next", ".git",
    "/XF", "rc-car-control.zip", "tsconfig.tsbuildinfo", ".gitignore"
  )

Remove-Item $WebZip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $Stage "*") -DestinationPath $WebZip -Force

Write-Host "Deploying web app..."
az webapp deploy `
  --resource-group $ResourceGroup `
  --name $WebApp `
  --src-path $WebZip `
  --type zip `
  --clean true `
  --restart true

Write-Host ""
Write-Host "Deployment commands completed."
Write-Host "Relay health: https://$RelayApp.azurewebsites.net/health"
Write-Host "Controller:   $WebUrl"
