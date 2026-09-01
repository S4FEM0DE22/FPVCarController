# FPV Car Firmware

This folder contains Arduino sketches for the project hardware:

- `esp32-vehicle-a4950/esp32-vehicle-a4950.ino` is the vehicle sketch for the A4950 dual-channel board.
- `esp32-vehicle-tb6612/esp32-vehicle-tb6612.ino` is the vehicle sketch for the TB6612FNG board.
- `esp32-cam/esp32-cam.ino` runs an ESP32-CAM MJPEG stream and redirects users to the web controller with the camera stream URL.

## Required Arduino Libraries

Install these from Arduino IDE Library Manager:

- ArduinoJson by Benoit Blanchon
- WebSockets by Markus Sattler
- ESP32Servo by Kevin Harrington / John K. Bennett
- Adafruit GFX Library
- Adafruit SSD1306

Also install the ESP32 board package in Arduino IDE.

## A4950 Motor Driver Wiring

The A4950 variant is configured for the Massmore A4950 dual-channel board shown in the project notes. It has two A4950 driver chips and uses four logic inputs. PWM is sent through the active direction input, so the old TB6612 `PWMA`, `PWMB`, and `STBY` wires are not used.

| A4950 board | ESP32 vehicle |
| --- | --- |
| AIN1 | GPIO26 |
| AIN2 | GPIO27 |
| BIN1 | GPIO14 |
| BIN2 | GPIO12 |
| VCC (3–5.5V) | 3V3 |
| VM (8–40V) | Motor battery through fuse |
| GND | Common GND |
| AOUT1/AOUT2 | Left motor |
| BOUT1/BOUT2 | Right motor |

Do not connect GPIO25, GPIO13, or GPIO33 to this A4950 board. Add bulk capacitance near `VM-GND`, keep the motor supply separate from the ESP32 regulator, and never connect or disconnect motor wires while powered.

## TB6612FNG Motor Driver Wiring

The TB6612 variant keeps the original three-signal-per-channel control:

| TB6612FNG | ESP32 vehicle |
| --- | --- |
| AIN1 | GPIO26 |
| AIN2 | GPIO27 |
| PWMA | GPIO25 |
| BIN1 | GPIO14 |
| BIN2 | GPIO12 |
| PWMB | GPIO13 |
| STBY | GPIO33 |
| VCC | 3V3 |
| VM | Motor battery through fuse |
| GND | Common GND |
| AO1/AO2 | Left motor |
| BO1/BO2 | Right motor |

Use only one driver wiring layout at a time. Do not connect the A4950 and TB6612 signal layouts together.

## UART Wiring Between Boards

Connect the boards before powering the car:

| ESP32 vehicle | ESP32-CAM (AI Thinker) | Purpose |
| --- | --- | --- |
| GPIO17 (TX2) | GPIO13 (RX1) | Vehicle sends configuration and commands |
| GPIO16 (RX2) | GPIO14 (TX1) | Camera sends acknowledgements |
| GND | GND | Shared signal reference |

UART uses 3.3 V logic. Do not connect either UART pin to 5 V. GPIO13 and GPIO14 on the ESP32-CAM are available only when the microSD interface is not used. Power for both boards still comes from the regulated supply; UART does not power the camera.

The link runs at `115200 8N1`. The sketches assign UART pins explicitly, so the USB Serial Monitor remains available on the normal programming port.

The vehicle light command is also synchronized over UART. Turning the vehicle light on or off from the controller sets the ESP32-CAM onboard flash LED on `GPIO4` to the same state. ESP32-CAM receives the current light state again during boot configuration sync, so restarting only the camera does not leave the two lights out of sync. Do not use the microSD interface while this flash/UART pin layout is active.

## Hardware Wi-Fi Reset Button

The vehicle supports a physical shared Wi-Fi reset button on `GPIO32`:

| Button | ESP32 vehicle |
| --- | --- |
| One terminal | GPIO32 |
| Other terminal | GND |

The firmware uses the internal pull-up resistor (`INPUT_PULLUP`). Press and hold the button for 3 seconds. The vehicle stops, clears saved Wi-Fi on both boards over UART, shows the reset state on the OLED, and restarts into `FPV-Car-Setup`. Do not connect this button to `3V3`.

## OLED Status Display

The vehicle firmware supports an optional 0.96-inch SSD1306 I2C OLED (`128x64`, address `0x3C`):

| OLED | ESP32 vehicle |
| --- | --- |
| VCC | 3V3 |
| GND | GND |
| SDA | GPIO21 |
| SCL | GPIO22 |

Both vehicle sketches use one fixed OLED dashboard so the important information is visible at a glance: vehicle/camera Wi-Fi, cloud links, battery, RSSI, drive command, and pan/tilt offsets. Text is shortened to fit the 128x64 display. ESP32-CAM sends a UART heartbeat every 1.5 seconds; the OLED marks the camera offline after about 5 seconds without a heartbeat.

The horn output is intended for an active 3.3V buzzer: connect buzzer `+` to `GPIO4` and buzzer `-` to `GND`. The firmware drives `GPIO4` HIGH for 300 ms when `HORN` is received, without PWM. Use a transistor or MOSFET if the buzzer module draws more current than an ESP32 GPIO can safely supply.

At boot the OLED shows `FPV CAR` while the system starts. A remote reboot shows `RESTARTING`, and the shared Wi-Fi reset shows `RESET WIFI` while both boards are cleared over UART. A physical power cut removes power from the OLED immediately, so showing `POWER OFF` after the switch is turned off requires a separate standby supply or small backup capacitor circuit.

The OLED is optional. If no display is detected at `0x3C`, the vehicle prints a message to Serial Monitor and continues normally. If your module uses address `0x3D`, change `OLED_I2C_ADDRESS` near the top of the selected vehicle sketch.

## 3S Battery Measurement

Both vehicle sketches measure a 3S Li-ion/LiPo pack on `GPIO34` through this divider:

| Connection | Component |
| --- | --- |
| Battery positive | `47k ohm` resistor to GPIO34 |
| GPIO34 | `10k ohm` resistor to GND |
| GPIO34 | `100nF` ceramic capacitor to GND (recommended) |
| Battery negative | Common GND |

Never connect the battery directly to GPIO34. A `12.6V` full pack produces about `2.21V` at GPIO34 with this divider. The firmware uses calibrated ADC millivolts, rejects the highest and lowest samples, smooths motor-load sag, and converts voltage to percentage with a 3S discharge curve. Insights shows both percent and measured voltage.

Resistor and ADC tolerances still require a one-time multimeter check. Measure the pack at rest, compare it with the voltage shown in Insights, then set `BATTERY_CALIBRATION` in the selected vehicle sketch to:

```text
multimeter voltage / web voltage
```

For example, if the multimeter reads `12.30V` and the web reads `12.00V`, use `BATTERY_CALIBRATION = 1.025f`. This percentage curve is not suitable for a 12V lead-acid battery.

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

The selected hotspot must use 2.4 GHz and allow at least two connected devices. A one-device hotspot limit makes the vehicle and camera alternate connections and cannot be corrected in firmware.

After saving:

- The main ESP32 sends the complete configuration to ESP32-CAM over UART.
- ESP32-CAM saves the configuration and returns an ACK over UART.
- Only after that ACK does the main ESP32 join the target Wi-Fi. ESP32-CAM restarts and joins the same saved Wi-Fi.
- The progress page does not report success after the UART save alone. It waits until the vehicle and camera use the selected SSID, the camera sensor is ready, the camera WebSocket reaches the cloud, and a recent JPEG frame has actually been sent.
- If the password is incorrect, the setup network remains available so the value can be corrected.

On later boots, ESP32-CAM requests the authoritative configuration from the vehicle over UART before starting Wi-Fi. The vehicle replies from its saved Preferences. If UART is temporarily unavailable, the camera stays offline and keeps requesting the vehicle configuration instead of using an independent Wi-Fi choice. This guarantees that both boards always receive the same network.

## ESP32 Vehicle Setup

1. Open the vehicle variant you need:
   - `esp32-vehicle-a4950/esp32-vehicle-a4950.ino` for the A4950 board
   - `esp32-vehicle-tb6612/esp32-vehicle-tb6612.ino` for the TB6612FNG board
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

Each vehicle variant is a complete standalone sketch. Open and flash only the file that matches the motor driver installed on the car.

When powered on, both variants first hold motor inputs low, then run the Servo test sequence and return to `pan=95`, `tilt=52`. Pan keeps its `15-175` servo range and displays the centered `95` position as `0 degrees`. The direct-drive tilt mechanism was level near servo `64`; its `52-110` range therefore starts about 12 degrees downward and keeps the previous upper limit. The startup/home position at `52` displays as `0 degrees`, and higher values display as up from that driving view. Automatic motor testing is disabled so the vehicle cannot drive unexpectedly at startup. Test motors only after the vehicle is secured and the wheels are lifted.

## ESP32-CAM Setup

1. Open `esp32-cam/esp32-cam.ino`.
2. Select `AI Thinker ESP32-CAM`, then flash it.
3. Power it on together with the ESP32 vehicle during first-time setup.
4. The ESP32-CAM does not open its own setup portal. It receives the vehicle configuration over UART, acknowledges the save, and then both boards join the same network.
5. At every later camera boot, Serial Monitor should show `Requesting authoritative configuration from vehicle UART` followed by `Vehicle configuration sync received`. The vehicle Serial Monitor should show `ESP32-CAM boot config sync: acknowledged`.
6. After saving Wi-Fi, open the camera IP. It redirects to:

```text
<control_url>?cam=http://<camera-ip>/stream
```

The web app stores this camera URL in `localStorage`, so it keeps working after refresh on desktop, phone, and tablet. When cloud WebSocket settings are configured, the ESP32-CAM publishes JPEG frames directly as binary WebSocket messages. The relay and browser keep only the newest usable frame so delayed JPEG frames do not build up when the connection slows down.

Camera initialization is retried three times during boot. If initialization still fails, the firmware retries periodically while Wi-Fi remains available. Five consecutive frame-buffer failures trigger an automatic camera deinit/init cycle. A Wi-Fi change also resets and starts the camera WebSocket again, so recovering video should not require a manual power cycle.

If vehicle configuration is unavailable at camera boot, ESP32-CAM enters offline recovery mode, reports status over UART, and requests configuration every second. It starts Wi-Fi only after the vehicle replies or sends first-time provisioning.

The Vehicle tab in Settings provides three persistent cloud stream profiles:

- `realtime`: QVGA (`320x240`) with a 75 ms frame interval for driving.
- `balanced`: constant CIF (`400x296`) to avoid sensor reconfiguration while the camera moves.
- `quality`: VGA (`640x480`) while idle and CIF (`400x296`) while the camera moves.

The camera returns to its idle resolution about `1200 ms` after movement stops. The realtime and balanced profiles keep one resolution in both modes, avoiding a sensor pause during pan/tilt. With PSRAM, JPEG capture uses two frame buffers in continuous `CAMERA_GRAB_LATEST` mode. Realtime and balanced allow at most two cloud frames in flight to cover one network round trip; quality allows one. The relay acknowledges as soon as it forwards a frame to a ready controller, while the browser display acknowledgement independently prevents a slow phone or tablet from accumulating old frames. Excess frames are dropped instead of queued. The ESP32-CAM saves the selected profile in Preferences and reports FPS, frame RTT, frame size, RSSI, and timeout counters to Controller Insights. Without PSRAM it falls back to a single QVGA buffer.

Deploy the updated relay and web app before flashing this ESP32-CAM firmware. The new firmware expects frame acknowledgements from the relay. The relay remains compatible with the older JSON/Base64 camera frame format during migration.

## Shared Wi-Fi From The Web App

The controller page can change Wi-Fi for both boards from one form:

- The web app sends `WIFI_SCAN` through the cloud relay. The ESP32 scans nearby 2.4 GHz networks and returns SSID, signal strength, channel, and security status for the selection list.
- The web app sends one `WIFI_SET` request. The relay forwards that same command only to the main ESP32 and waits for the final result.
- The main ESP32 is the only Wi-Fi transaction coordinator. It keeps the current credentials as a fallback, forwards the candidate to ESP32-CAM over UART, and decides when both boards switch, verify, commit, or roll back.
- ESP32-CAM accepts Wi-Fi changes only from the vehicle UART. Protocol v2 uses the short sequence `replace -> ready -> switch -> committed`. The camera removes its saved Wi-Fi when it accepts `replace`, tests the candidate only in RAM, and writes it to Preferences only after the vehicle sends `commit`.
- During the switch, both boards disable reconnect to the previous access point and accept success only when the connected SSID matches the selected network. ESP32-CAM also gives a brief disconnect grace period before restarting association, so a slow hotspot or DHCP response is not interrupted repeatedly.
- Until the vehicle reports that it accepted the request, the relay retries only the same idempotent `WIFI_SET` command. After acceptance, progress and recovery continue locally even while cloud WebSocket connections restart.
- The vehicle retains the previous credentials as the sole rollback source while both boards test the candidate network.
- The vehicle commits only after it is back on the cloud and a fresh camera UART status confirms the selected SSID, camera cloud connection, initialized sensor, and active JPEG stream.
- The controller reports success only after the vehicle and camera both acknowledge the local commit.
- If either board fails to join the candidate, reconnect to cloud, or produce a camera frame before timeout, only the vehicle decides to roll back. Its UART rollback message includes the previous SSID and password, so ESP32-CAM never guesses or selects a different network itself.
- During a successful web Wi-Fi change, the vehicle Serial Monitor shows camera ACKs for `ready`, `switching`, and `committed`. If one is missing, check the crossed TX/RX wires and common GND from the UART wiring table above.
- Keep the relay, selected vehicle sketch, and ESP32-CAM sketch on the same release when changing Wi-Fi from the web app.
- The controller does not need direct access to the camera IP, so the change also works when the browser and car use different networks.
- Settings compares the SSID and gateway reported by both boards and shows whether they are on the same Wi-Fi.

If the new Wi-Fi credentials are incorrect, both boards automatically reconnect to the previous saved network. `FPV-Car-Setup` is needed only for first-time setup or after explicitly clearing saved Wi-Fi.

The relay treats the camera as offline after about 10 seconds without a frame or stream-status message. It clears the cached frame at the same time, preventing the controller from showing a stale online state after camera power is removed.

Deploy the updated relay and flash the vehicle sketch matching the installed motor driver before using the scan list. Older relay or firmware versions do not understand `wifi_scan_result`.

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
