# FPV Car Controller

Web controller for an ESP32 FPV car. The app connects to the WebSocket relay server, shows ESP32 telemetry, displays an ESP32-CAM MJPEG stream, and supports keyboard, gamepad, touch, phone, and tablet controls.

## Run Locally

Start the relay server first:

```powershell
cd server
npm.cmd run dev
```

Then start the web controller:

```powershell
cd rc-car-control
npm.cmd run dev
```

Open:

```text
http://localhost:3000/controller
```

For phone and tablet testing on the same Wi-Fi, open the controller with the computer LAN IP:

```text
http://<computer-lan-ip>:3000/controller
```

## Environment Variables

Copy `.env.example` to `.env.local` when you need custom endpoints:

```text
NEXT_PUBLIC_WS_URL=ws://<server-ip>:8080
NEXT_PUBLIC_VEHICLE_ID=car-001
NEXT_PUBLIC_CONTROLLER_AUTH_TOKEN=<controller-token>
NEXT_PUBLIC_ESP32_CAM_STREAM_URL=http://<esp32-cam-ip>/stream
```

`NEXT_PUBLIC_CLOUD_URL` can also be used as a base URL for deployed setups.

## Controls

- Keyboard: `W/A/S/D` drive, arrow keys camera, `H` horn, `L` light, `R` camera reset, `X` camera on/off.
- Gamepad: left stick drive, right stick or D-pad camera, `A/B/X/Y` actions, menu button stop.
- Touch: left joystick drive, right joystick camera, action bar for utility controls.

On phone and tablet, virtual joysticks are hidden automatically when a gamepad is connected.

## Checks

```powershell
npm.cmd run lint
npm.cmd run check:unused
npm.cmd run build
```
