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

On most phones and tablets, the setup page now opens automatically as a captive portal. Use `192.168.4.1` only when the popup does not appear.

5. Choose your Wi-Fi/hotspot, enter the password once, and fill in the controller/cloud settings.
6. Press `Save and connect both boards`.

After saving:

- The ESP32 vehicle saves the Wi-Fi and keeps `FPV-Car-Setup` active.
- The ESP32-CAM fetches the same Wi-Fi/controller/cloud settings and saves them to Preferences.
- The ESP32-CAM acknowledges that the settings were saved, then both boards connect to the new Wi-Fi.
- The progress page shows whether the camera has received the settings and whether the vehicle connected successfully.
- If the password is incorrect, the setup network remains available so the value can be corrected.

On later boots, the vehicle briefly exposes a hidden `FPV-Car-Sync` channel so the camera can verify that both saved configurations match. When they match, the camera acknowledges immediately and both boards continue to the saved Wi-Fi. The visible `FPV-Car-Setup` network appears only when setup or recovery is required.

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

The web app stores this camera URL in `localStorage`, so it keeps working after refresh on desktop, phone, and tablet. When cloud WebSocket settings are configured, the ESP32-CAM publishes JPEG frames directly as binary WebSocket messages. The relay and browser keep only the newest usable frame so delayed JPEG frames do not build up when the connection slows down.

The Vehicle tab in Settings provides three persistent cloud stream profiles:

- `realtime`: QVGA (`320x240`) with a 75 ms frame interval for driving.
- `balanced`: constant CIF (`400x296`) to avoid sensor reconfiguration while the camera moves.
- `quality`: VGA (`640x480`) while idle and CIF (`400x296`) while the camera moves.

The camera returns to its idle resolution about `1200 ms` after movement stops. The realtime and balanced profiles keep one resolution in both modes, avoiding a sensor pause during pan/tilt. With PSRAM, JPEG capture uses two frame buffers in continuous `CAMERA_GRAB_LATEST` mode. Realtime and balanced allow at most two cloud frames in flight to cover one network round trip; quality allows one. The relay acknowledges as soon as it forwards a frame to a ready controller, while the browser display acknowledgement independently prevents a slow phone or tablet from accumulating old frames. Excess frames are dropped instead of queued. The ESP32-CAM saves the selected profile in Preferences and reports FPS, frame RTT, frame size, RSSI, and timeout counters to Controller Insights. Without PSRAM it falls back to a single QVGA buffer.

Deploy the updated relay and web app before flashing this ESP32-CAM firmware. The new firmware expects frame acknowledgements from the relay. The relay remains compatible with the older JSON/Base64 camera frame format during migration.

## Shared Wi-Fi From The Web App

The controller page can change Wi-Fi for both boards from one form:

- The web app sends `WIFI_SCAN` through the cloud relay. The ESP32 scans nearby 2.4 GHz networks and returns SSID, signal strength, channel, and security status for the selection list.
- The relay sends `WIFI_SET` to ESP32-CAM first. ESP32-CAM saves the credentials and returns `wifi_update_ack`; only then does the relay forward the same update to the main ESP32.
- If ESP32-CAM does not confirm the update within the configured timeout, the main ESP32 stays on the current network and the controller receives an error instead of a false success message.
- Both boards save the new Wi-Fi to Preferences, send their final status, then reconnect after a short delay.
- The controller does not need direct access to the camera IP, so the change also works when the browser and car use different networks.
- Settings compares the SSID and gateway reported by both boards and shows whether they are on the same Wi-Fi.

If the new Wi-Fi credentials are incorrect, both boards restart their recovery flow after about 25 seconds. Connect to `FPV-Car-Setup` to correct them.

The relay treats the camera as offline after about 10 seconds without a frame or stream-status message. It clears the cached frame at the same time, preventing the controller from showing a stale online state after camera power is removed.

Deploy the updated relay and flash the updated `esp32-vehicle.ino` before using the scan list. Older relay or firmware versions do not understand `wifi_scan_result`.

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
