# FPV Car Firmware

This folder contains Arduino sketches for the project hardware:

- `esp32-vehicle/esp32-vehicle.ino` controls the TB6612FNG motor driver, pan/tilt servos, light, buzzer, WebSocket connection, and telemetry.
- `esp32-cam/esp32-cam.ino` runs an ESP32-CAM MJPEG stream and redirects users to the web controller with the camera stream URL.

## Required Arduino Libraries

Install these from Arduino IDE Library Manager:

- WiFiManager by tzapu
- ArduinoJson by Benoit Blanchon
- WebSockets by Markus Sattler
- ESP32Servo by Kevin Harrington / John K. Bennett

Also install the ESP32 board package in Arduino IDE.

## ESP32 Vehicle Setup

1. Open `esp32-vehicle/esp32-vehicle.ino`.
2. Select an ESP32 board, then flash it.
3. On first boot, connect your phone/laptop to the setup Wi-Fi:
   - SSID: `FPV-Car-xxxxxx`
   - Password: `12345678`
4. Fill in:
   - `ws_scheme`: `ws` for local server or `wss` for deployed HTTPS server
   - `ws_host`: cloud/server host, for example `192.168.1.10`
   - `ws_port`: `8080` locally, usually `443` for `wss`
   - `ws_path`: `/` or `/ws`
   - `vehicle_id`: must match the web app, default `car-001`
   - `auth_token`: optional, must match `VEHICLE_AUTH_TOKEN` on the server if enabled
   - `control_url`: web controller URL, for example `http://192.168.1.10:3000/controller`
5. After saving Wi-Fi, open the ESP32 IP address in a browser. It redirects to the controller page.

Default TB6612FNG pins are declared at the top of the sketch. Change them to match your wiring before flashing.

## ESP32-CAM Setup

1. Open `esp32-cam/esp32-cam.ino`.
2. Select `AI Thinker ESP32-CAM`, then flash it.
3. On first boot, connect to:
   - SSID: `FPV-CAM-xxxxxx`
   - Password: `12345678`
4. Fill in `control_url`, for example `http://192.168.1.10:3000/controller`.
   For cloud streaming, also fill in:
   - `ws_scheme`: `wss` for Azure/App Service HTTPS
   - `ws_host`: relay host, for example `<relay-app>.azurewebsites.net`
   - `ws_port`: `443` for `wss`
   - `ws_path`: `/`
   - `vehicle_id`: must match the vehicle and web app, default `car-001`
   - `auth_token`: optional, must match `VEHICLE_AUTH_TOKEN` on the relay if enabled
5. After saving Wi-Fi, open the camera IP. It redirects to:

```text
<control_url>?cam=http://<camera-ip>/stream
```

The web app stores this camera URL in `localStorage`, so it keeps working after refresh on desktop, phone, and tablet. When cloud WebSocket settings are configured, the ESP32-CAM also publishes JPEG frames to the relay as `camera_frame` messages so the Azure-hosted controller can show the camera without loading the local `http://<camera-ip>/stream` URL.

## Shared Wi-Fi From The Web App

Because the ESP32 vehicle and ESP32-CAM are two separate boards, the first setup still needs each board to join a Wi-Fi network at least once:

1. Configure `FPV-Car-xxxxxx`.
2. Configure `FPV-CAM-xxxxxx`.
3. Open the ESP32-CAM IP once so it redirects to the controller with `?cam=http://<camera-ip>/stream`.

After that, the controller page can change Wi-Fi for both boards from one form:

- ESP32 vehicle receives `WIFI_SET` through the existing WebSocket `action` channel.
- ESP32-CAM receives the same SSID/password through `POST http://<camera-ip>/api/wifi`.

This works best when the web controller, ESP32, and ESP32-CAM are reachable on the same LAN. If the controller is served over HTTPS, browsers may block calls to an `http://` ESP32-CAM address as mixed content; for local demos, use the controller over `http://<computer-lan-ip>:3000/controller`.

## Vehicle Tuning

The web app's Settings panel sends `PROFILE_APPLY` to the ESP32 vehicle. The ESP32 applies:

- `driveScale` to throttle
- `steeringScale` to steering
- `cameraStepDeg` to pan/tilt servo movement
- `throttleExponent` to the throttle response curve

The ESP32 includes the active behavior profile in telemetry so the controller can show the current profile name.

## Local Test Flow

Run the project locally:

```powershell
cd C:\Users\safem\FPVCarController\server
npm.cmd run dev
```

```powershell
cd C:\Users\safem\FPVCarController\rc-car-control
npm.cmd run dev
```

Then configure:

- ESP32 vehicle `ws_host` = your computer LAN IP
- ESP32 vehicle `ws_port` = `8080`
- ESP32-CAM `control_url` = `http://<computer-lan-ip>:3000/controller`

Open the ESP32-CAM IP from phone, tablet, or computer. It should redirect to the controller and pass the stream URL automatically.
