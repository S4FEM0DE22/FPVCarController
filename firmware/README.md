# FPV Car Firmware

This folder contains Arduino sketches for the project hardware:

- `esp32-vehicle/esp32-vehicle.ino` controls the TB6612FNG motor driver, pan/tilt servos, light, buzzer, WebSocket connection, and telemetry.
- `esp32-cam/esp32-cam.ino` runs an ESP32-CAM MJPEG stream and redirects users to the web controller with the camera stream URL.

## Required Arduino Libraries

Install these from Arduino IDE Library Manager:

- ArduinoJson by Benoit Blanchon
- WebSockets by Markus Sattler
- ESP32Servo by Kevin Harrington / John K. Bennett

Also install the ESP32 board package in Arduino IDE.

## First-Time Shared Wi-Fi Setup

Use this flow when the ESP32 vehicle and ESP32-CAM have no saved Wi-Fi yet:

1. Flash both sketches.
2. Power on the ESP32 vehicle and ESP32-CAM at the same time.
3. Connect your phone, tablet, or computer to:
   - SSID: `FPV-Car-Setup`
   - Password: `12345678`
4. Open:

```text
http://192.168.4.1
```

5. Choose your Wi-Fi/hotspot, enter the password once, and fill in the controller/cloud settings.
6. Press `Save and connect both boards`.

After saving:

- The ESP32 vehicle saves the Wi-Fi and connects to it.
- The ESP32 vehicle keeps the setup AP open briefly and exposes `/api/cam-provision`.
- The ESP32-CAM joins `FPV-Car-Setup`, fetches the same Wi-Fi/controller/cloud settings, saves them to Preferences, then connects to the same Wi-Fi.

On later boots, both boards connect to the saved Wi-Fi automatically. You do not need to open the setup page again unless you change Wi-Fi or clear settings.

## ESP32 Vehicle Setup

1. Open `esp32-vehicle/esp32-vehicle.ino`.
2. Select an ESP32 board, then flash it.
3. On first boot, use the shared setup page above.
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
3. Power it on together with the ESP32 vehicle during first-time setup.
4. The ESP32-CAM does not open its own setup portal. It waits for the ESP32 vehicle setup AP, fetches the provision data, saves it, and joins the same Wi-Fi.
5. After saving Wi-Fi, open the camera IP. It redirects to:

```text
<control_url>?cam=http://<camera-ip>/stream
```

The web app stores this camera URL in `localStorage`, so it keeps working after refresh on desktop, phone, and tablet. When cloud WebSocket settings are configured, the ESP32-CAM also publishes JPEG frames to the relay as `camera_frame` messages so the Azure-hosted controller can show the camera without loading the local `http://<camera-ip>/stream` URL.

## Shared Wi-Fi From The Web App

The controller page can change Wi-Fi for both boards from one form:

- ESP32 vehicle receives `WIFI_SET` through the existing WebSocket `action` channel.
- ESP32-CAM receives the same SSID/password through `POST http://<camera-ip>/api/wifi`.
- Both boards save the new Wi-Fi to Preferences, so the next boot uses the new network automatically.

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
