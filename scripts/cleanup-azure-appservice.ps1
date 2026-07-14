param(
  [string]$ResourceGroup = "fpv-car-rg",
  [string]$RelayApp = "fpv-car-relay-noppanun",
  [string]$WebApp = "fpv-car-web-noppanun",
  [string]$Plan = "fpv-car-plan"
)

$ErrorActionPreference = "Stop"

function Assert-AzCli {
  $az = Get-Command az -ErrorAction SilentlyContinue
  if (-not $az) {
    throw "Azure CLI 'az' was not found in this PowerShell session."
  }
}

function Remove-WebAppIfExists {
  param(
    [string]$Name
  )

  $exists = $null
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $exists = az webapp show --resource-group $ResourceGroup --name $Name --query "name" -o tsv 2>$null
  } catch {
    $exists = $null
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if (-not $exists) {
    Write-Host "Web App not found, skipping: ${Name}"
    return
  }

  Write-Host "Deleting Web App: $Name"
  az webapp delete --resource-group $ResourceGroup --name $Name
}

function Remove-PlanIfExists {
  $exists = $null
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $exists = az appservice plan show --resource-group $ResourceGroup --name $Plan --query "name" -o tsv 2>$null
  } catch {
    $exists = $null
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if (-not $exists) {
    Write-Host "App Service Plan not found, skipping: ${Plan}"
    return
  }

  Write-Host "Deleting App Service Plan: $Plan"
  az appservice plan delete --resource-group $ResourceGroup --name $Plan --yes
}

Assert-AzCli

Write-Host "This removes only App Service resources, not the resource group."
Write-Host "Resource group: $ResourceGroup"
Write-Host ""

Remove-WebAppIfExists -Name $RelayApp
Remove-WebAppIfExists -Name $WebApp
Remove-PlanIfExists

Write-Host ""
Write-Host "Cleanup completed."
Write-Host "Remaining resources in ${ResourceGroup}:"
az resource list --resource-group $ResourceGroup --query "[].{name:name,type:type,location:location}" -o table
