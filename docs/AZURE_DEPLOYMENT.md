# Azure deployment guide

This project can run on Azure with two App Services:

- `fpv-relay`: Node.js WebSocket relay server.
- `fpv-web`: Next.js controller web app.

The ESP32 vehicle and ESP32-CAM connect to the relay with `wss://`.

## 1. Install tools

Install Azure CLI, then sign in:

```powershell
az login
```

## 2. Create Azure resources

Use unique app names. Azure App Service names become public hostnames.

```powershell
$rg="fpv-car-rg"
$location="<allowed-region>"
$plan="fpv-car-plan"
$relayApp="fpv-car-relay-<yourname>"
$webApp="fpv-car-web-<yourname>"

az group create --name $rg --location $location
# Use B1 for stable long-running testing, or F1 for Azure Education free-tier demos.
az appservice plan create --name $plan --resource-group $rg --location $location --sku F1 --is-linux

$nodeRuntime="NODE:22-lts"
az webapp create --resource-group $rg --plan $plan --name $relayApp --runtime $nodeRuntime
az webapp create --resource-group $rg --plan $plan --name $webApp --runtime $nodeRuntime
```

Enable WebSockets. Free tier does not support Always On, so use `--always-on false`
when the App Service Plan is `F1`.

```powershell
az webapp config set --resource-group $rg --name $relayApp --web-sockets-enabled true --always-on false
az webapp config set --resource-group $rg --name $relayApp --startup-file "node /home/site/wwwroot/index.js"
az webapp config set --resource-group $rg --name $webApp --always-on false
```

## 3. Configure app settings

Relay server:

```powershell
az webapp config appsettings set --resource-group $rg --name $relayApp --settings `
  PORT=8080 `
  SCM_DO_BUILD_DURING_DEPLOYMENT=true `
  ALLOW_LOCALHOST_AUTH_BYPASS=false `
  VEHICLE_AUTH_TOKEN=<choose-a-token> `
  CONTROLLER_AUTH_TOKEN=<choose-a-controller-token>
```

Web app:

```powershell
az webapp config appsettings set --resource-group $rg --name $webApp --settings `
  NEXT_PUBLIC_WS_URL=wss://$relayApp.azurewebsites.net `
  NEXT_PUBLIC_VEHICLE_ID=car-001 `
  NEXT_PUBLIC_CONTROLLER_AUTH_TOKEN=<same-controller-token>
```

For a first test, you can omit the auth token settings, but add them before a public demo.

## 4. Deploy the relay server

Recommended: use the project deploy script. It creates clean zip packages,
excludes local build folders, configures App Service startup commands, and
deploys with `--clean true` so old files in `wwwroot` do not break Kudu.

```powershell
cd C:\Users\safem\FPVCarController
.\scripts\deploy-azure.ps1 -FreeTier
```

Manual relay-only deploy:

```powershell
Remove-Item server.zip -ErrorAction SilentlyContinue
Compress-Archive -Path server\index.js,server\logger.js,server\package.json,server\package-lock.json -DestinationPath server.zip -Force
az webapp deploy --resource-group $rg --name $relayApp --src-path server.zip --type zip --clean true --restart true
```

## 5. Deploy the controller web app

Use a staging folder so local `.next`, `node_modules`, and dev lock files are
not included in the Azure package.

```powershell
$stage = "$env:TEMP\fpv-web-deploy"
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stage | Out-Null
robocopy rc-car-control $stage /E /XD node_modules .next .git /XF rc-car-control.zip tsconfig.tsbuildinfo

Remove-Item rc-car-control.zip -ErrorAction SilentlyContinue
Compress-Archive -Path "$stage\*" -DestinationPath rc-car-control.zip -Force
az webapp deploy --resource-group $rg --name $webApp --src-path rc-car-control.zip --type zip --clean true --restart true
```

If Azure does not build the Next app automatically, use GitHub deployment or build locally and deploy the generated app with the correct Azure build settings. The important environment variable is:

```text
NEXT_PUBLIC_WS_URL=wss://<relay-app>.azurewebsites.net
```

## 6. Configure ESP32 vehicle

In the ESP32 vehicle WiFi Manager:

```text
ws_scheme = wss
ws_host   = <relay-app>.azurewebsites.net
ws_port   = 443
ws_path   = /
vehicle_id = car-001
auth_token = <same VEHICLE_AUTH_TOKEN if enabled>
control_url = https://<web-app>.azurewebsites.net/controller
```

Serial Monitor should show:

```text
WebSocket connected: wss://<relay-app>.azurewebsites.net:443/
```

## 7. Configure ESP32-CAM cloud stream

In the ESP32-CAM WiFi Manager:

```text
control_url = https://<web-app>.azurewebsites.net/controller
camera_name = FPV ESP32-CAM
ws_scheme = wss
ws_host   = <relay-app>.azurewebsites.net
ws_port   = 443
ws_path   = /
vehicle_id = car-001
auth_token = <same VEHICLE_AUTH_TOKEN if enabled>
```

The ESP32-CAM sends JPEG frames through the relay as `camera_frame` messages. The controller displays those cloud frames first, then falls back to a local `http://<camera-ip>/stream` URL if no cloud frame exists.

Start with QVGA and low FPS. ESP32-CAM cloud streaming is for demo/control visibility, not high-quality video.

## 8. Test flow

1. Open `https://<web-app>.azurewebsites.net/controller`.
2. Confirm the page says the relay is connected.
3. Power the ESP32 vehicle and check Serial Monitor for `WebSocket connected`.
4. Power the ESP32-CAM and check Serial Monitor for `Camera WebSocket connected`.
5. The camera image should appear on the web page through the cloud relay.
