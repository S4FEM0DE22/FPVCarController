# FPV Car Controller

ระบบควบคุมรถ FPV ผ่านเว็บ ประกอบด้วยเว็บ Next.js, WebSocket relay และ firmware สำหรับ ESP32 vehicle กับ ESP32-CAM

## โครงสร้างระบบ

```text
Browser controller ─┐
ESP32 vehicle ──────┼─ WebSocket relay ── vehicle commands/telemetry
ESP32-CAM ──────────┘                    └─ JPEG camera frames
```

- `rc-car-control/` — เว็บควบคุม Next.js
- `server/` — Node.js WebSocket relay
- `firmware/` — firmware รถและกล้อง
- `docs/AZURE_LINUX_VM_TH.md` — deployment หลักบน Azure Linux VM
- `docs/DIGITALOCEAN_DROPLET.md` — deployment ทางเลือก

Azure App Service ไม่ได้ใช้งานแล้ว โปรเจกต์ production ใช้ Linux VM เครื่องเดียว โดย Nginx ส่ง `/` ไปเว็บและ `/ws` ไป relay

## เริ่มใช้งานในเครื่อง

ต้องใช้ Node.js 22 ขึ้นไป เปิด terminal สองหน้าต่างแล้วรัน:

```powershell
cd server
npm.cmd ci
npm.cmd run dev
```

```powershell
cd rc-car-control
Copy-Item .env.example .env.local
npm.cmd ci
npm.cmd run dev
```

เปิด `http://localhost:3000/controller` ค่าเริ่มต้นของเว็บจะเชื่อม relay ที่ `ws://localhost:8080`

## Environment

ห้าม commit token จริง ใช้ไฟล์ตัวอย่างต่อไปนี้เป็นต้นแบบ:

- `server/.env.example`
- `rc-car-control/.env.example`

สำหรับ production ให้ตั้ง vehicle และ controller token ทั้งสองฝั่งให้ตรงกัน รวมทั้งใช้ `wss://` ผ่าน HTTPS domain

## ตรวจสอบก่อน deploy

```powershell
npm.cmd test --prefix server
npm.cmd run lint --prefix rc-car-control
npm.cmd run check:unused --prefix rc-car-control
npm.cmd run build --prefix rc-car-control
```

## Cloud ปัจจุบัน

ระบบออกแบบให้รันบน Azure Linux VM ด้วย PM2 และ Nginx ดูขั้นตอนทั้งหมดใน [คู่มือ Azure Linux VM](docs/AZURE_LINUX_VM_TH.md)

VM อาจถูก deallocate เพื่อหยุดค่า compute เมื่อไม่ได้ใช้งาน หลังเปิด VM ควรตรวจ `pm2 status`, Nginx และ `/health` ก่อนทดสอบรถ

