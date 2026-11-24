# P682018 First-Person View Remote-Controlled Car over a Network Using ESP32

**ชื่อโครงงาน:** รถบังคับมุมมองบุคคลที่หนึ่งผ่านระบบเครือข่ายโดยใช้ ESP32  
**Project title:** First-Person View Remote-Controlled Car over a Network Using ESP32  
**รหัสโครงงาน:** P682018 · ภาคเรียนที่ 2/2568  

---

## ภาพรวม
ระบบรถบังคับมุมมองบุคคลที่หนึ่ง (First-Person View: FPV) ที่ควบคุมการเคลื่อนที่และรับชมภาพวิดีโอสตรีมมิงแบบ Real-time ผ่านระบบเครือข่ายอินเทอร์เน็ต/คลาวด์ พัฒนาขึ้นโดยใช้ไมโครคอนโทรลเลอร์ ESP32 สองตัวทำงานร่วมกันผ่านการสื่อสารแบบอนุกรม UART (ตัวหนึ่งควบคุมมอเตอร์ขับเคลื่อน, เซอร์โวมุมกล้อง และเซนเซอร์ ส่วนอีกตัวประมวลผลและส่งสตรีมภาพความเร็วสูงจากโมดูลกล้อง ESP32-CAM) เชื่อมโยงผ่าน WebSocket Relay Server ไปยังหน้าเว็บแอปพลิเคชัน (Next.js) บนเบราว์เซอร์

**กลุ่มผู้ใช้งาน/เป้าหมาย:**
- นักเรียน นักศึกษา และนักพัฒนาที่สนใจศึกษาการประยุกต์ใช้งาน IoT, Embedded Systems, Robotics และ Web Teleoperation ทางไกล
- ผู้ใช้งานทั่วไปที่ต้องการควบคุมยานพาหนะหรือหุ่นยนต์สำรวจระยะไกลผ่านเครือข่ายโดยไม่ถูกจำกัดด้วยระยะส่งสัญญาณวิทยุ (RF) แบบเดิม

---

## สถาปัตยกรรมระบบ

```text
Browser Controller (Next.js) ─┐
ESP32 Vehicle (Main MCU) ────┼─ WebSocket Relay (Node.js) ── Vehicle Commands / Telemetry
ESP32-CAM (Camera MCU) ──────┘                            └─ JPEG Camera Frames
```

```text
esp32_fpv_car/
├── rc-car-control/                 # เว็บแอปพลิเคชันควบคุมรถและรับชมสตรีม (Next.js + Tailwind CSS)
│   └── src/
│       ├── app/                    # Routes and Pages (/controller)
│       ├── components/controller/  # UI Components (Joystick, Telemetry, Video Screen)
│       ├── hooks/                  # Custom Hooks (Gamepad, Keyboard, WebSocket State)
│       ├── lib/                    # Protocol, Input Logic & Handlers
│       └── types/                  # TypeScript Data Types
├── server/                         # Node.js WebSocket Relay Server & Test Suites
├── firmware/
│   ├── esp32-vehicle-a4950/        # เฟิร์มแวร์บอร์ดรถ (สำหรับมอเตอร์ไดรเวอร์ Massmore A4950)
│   ├── esp32-vehicle-tb6612/       # เฟิร์มแวร์บอร์ดรถ (สำหรับมอเตอร์ไดรเวอร์ TB6612FNG)
│   └── esp32-cam/                  # เฟิร์มแวร์บอร์ดกล้อง ESP32-CAM (OV2640)
├── docs/                           # เอกสารประกอบและคู่มือการติดตั้ง (Azure Linux VM Guide)
├── .github/workflows/              # GitHub Actions CI Workflow
└── ecosystem.config.cjs            # PM2 Configuration สำหรับรันบน Linux VM
```

---

## สิ่งที่ต้องมีก่อนติดตั้ง

### 1. ภาษาและสภาพแวดล้อม (Runtime / Languages)
- **Node.js:** เวอร์ชัน 22.x ขึ้นไป (LTS) พร้อม **npm**
- **Arduino IDE:** เวอร์ชัน 2.x ขึ้นไป พร้อมติดตั้งบอร์ดแพ็กเกจ **esp32 by Espressif Systems**
- **Git**

### 2. ฐานข้อมูลและบริการภายนอก (Database & External Services)
- **ฐานข้อมูล:** ไม่มี (No Database) — ระบบทำงานแบบ Real-time State, Stream Relay และ Local Flash Preferences บน ESP32
- **คลาวด์/เซิร์ฟเวอร์:** รองรับการรันแบบเครื่องโลคอล (Localhost) หรือนำขึ้น **Azure Linux VM (Ubuntu)** ร่วมกับ **Nginx** (Reverse Proxy & SSL) และ **PM2** (Process Manager)

### 3. ไลบรารีสำหรับ Arduino IDE (Library Dependencies)
ติดตั้งผ่าน Library Manager:
- `ArduinoJson` (โดย Benoit Blanchon)
- `WebSockets` (โดย Markus Sattler)
- `ESP32Servo` (โดย Kevin Harrington / John K. Bennett)
- `Adafruit GFX Library`
- `Adafruit SSD1306`

### 4. ฮาร์ดแวร์และอุปกรณ์ (Hardware Components)
- **บอร์ดประมวลผลหลัก (Vehicle Board):** ESP32 Dev Module (NodeMCU-32S)
- **บอร์ดกล้อง (Camera Board):** ESP32-CAM (โมดูล AI-Thinker พร้อมเซนเซอร์ OV2640)
- **โมดูลขับมอเตอร์ (เลือกแบบใดแบบหนึ่ง):**
  - โมดูล Massmore A4950 Dual-Channel Motor Driver หรือ
  - โมดูล TB6612FNG Dual H-Bridge Driver
- **เซอร์โวมอเตอร์กิมบอล (Camera Pan/Tilt):** SG90 Micro Servo 2 ตัว
- **จอแสดงผลสถานะ:** จอ I2C OLED 0.96 นิ้ว (SSD1306, 128x64, Address `0x3C`)
- **ระบบพลังงานและเซนเซอร์:**
  - แบตเตอรี่ 3S Li-ion / LiPo (11.1V – 12.6V)
  - โมดูลลดแรงดันไฟ (Buck Converter) แปลงเป็น 5V จ่ายไฟเลี้ยงบอร์ด ESP32 ทั้งสอง
  - วงจรตรวจวัดแรงดันแบตเตอรี่ (Voltage Divider: 47kΩ และ 10kΩ พร้อม 100nF เข้าขา GPIO34)
- **อุปกรณ์เพิ่มเติม:** Active Buzzer 3.3V (แตร เข้าขา GPIO4), สวิตช์ปุ่มกดรีเซ็ต Wi-Fi (GPIO32)

---

## ขั้นติดตั้ง

```bash
# 1. โคลนคลังโค้ดนี้
git clone https://github.com/S4FEM0DE22/FPVCarController.git
cd FPVCarController/esp32_fpv_car

# 2. ติดตั้ง Dependencies ฝั่ง WebSocket Relay Server
cd server
npm ci
cd ..

# 3. ติดตั้ง Dependencies ฝั่ง Web Controller (Next.js)
cd rc-car-control
npm ci
cd ..
```

---

## ตั้งค่า

คัดลอกไฟล์ `.env.example` เป็น `.env` (หรือ `.env.local`) แล้วระบุค่าตามสภาพแวดล้อม **ห้าม commit ไฟล์ `.env` หรือไฟล์ที่มีความลับขึ้นระบบ Git เด็ดขาด**

### 1. WebSocket Relay Server (`server/`)
```bash
cd server
cp .env.example .env
```
- `PORT`: หมายเลขพอร์ตที่ WebSocket Relay เปิดให้บริการ (ค่าเริ่มต้น `8080`)
- `ALLOW_LOCALHOST_AUTH_BYPASS`: กำหนดเป็น `true` เมื่อพัฒนาบน localhost เพื่อข้ามการตรวจสอบโทเค็น (ตั้งเป็น `false` บน Production)
- `VEHICLE_AUTH_TOKEN`: โทเค็นลับความปลอดภัยสำหรับยืนยันตัวตนของบอร์ด ESP32
- `CONTROLLER_AUTH_TOKEN`: โทเค็นลับความปลอดภัยสำหรับเว็บเบราว์เซอร์ผู้ควบคุม
- `RATE_LIMIT_MAX_MESSAGES`: ขีดจำกัดอัตราการส่งข้อความต่อนาทีของผู้ใช้
- `CAMERA_FRAME_MIN_INTERVAL_MS`: หน่วงเวลาขั้นต่ำระหว่างเฟรมภาพ (ms) เพื่อคุมแบนด์วิดท์

### 2. Web Controller (`rc-car-control/`)
```bash
cd rc-car-control
cp .env.example .env.local
```
- `NEXT_PUBLIC_WS_URL`: ที่อยู่ WebSocket Server (เช่น `ws://localhost:8080` สำหรับทดสอบในเครื่อง หรือ `wss://yourdomain.com/ws` สำหรับใช้งานจริงบน HTTPS)
- `NEXT_PUBLIC_VEHICLE_ID`: รหัสประจำตัวของรถที่ต้องการควบคุม (ค่าเริ่มต้น `car-001`)
- `NEXT_PUBLIC_CONTROLLER_AUTH_TOKEN`: โทเค็นลับสำหรับเบราว์เซอร์ ต้องตรงกับ `CONTROLLER_AUTH_TOKEN` ของฝั่ง Server
- `NEXT_PUBLIC_ESP32_CAM_STREAM_URL`: (ระบุเฉพาะกรณีต่อตรง) URL ของสตรีมภาพแบบ MJPEG ผ่านวงแลนเดียวกัน

---

## วิธีรัน

### การรันบนเครื่องคอมพิวเตอร์ (Local Development)

เปิด Terminal 2 หน้าต่าง:

**หน้าต่างที่ 1 — รัน WebSocket Relay:**
```bash
cd server
npm run dev
```

**หน้าต่างที่ 2 — รัน Web Controller:**
```bash
cd rc-car-control
npm run dev
```
เปิดเบราว์เซอร์ไปที่ `http://localhost:3000/controller` (ค่าเริ่มต้นจะเชื่อมต่อไปยัง `ws://localhost:8080`)

### การตรวจสอบความถูกต้องก่อน Deploy (CI / Quality Checks)
```bash
npm test --prefix server
npm run lint --prefix rc-car-control
npm run check:unused --prefix rc-car-control
npm run build --prefix rc-car-control
```

### การแฟลชโปรแกรมลงบอร์ด ESP32
1. เปิด **Arduino IDE** แล้วเลือกเปิดไฟล์:
   - สำหรับบอร์ดควบคุมรถ: `firmware/esp32-vehicle-a4950/esp32-vehicle-a4950.ino` (หรือโฟลเดอร์ `esp32-vehicle-tb6612` ตามฮาร์ดแวร์ที่ติดตั้ง)
   - สำหรับบอร์ดกล้อง: `firmware/esp32-cam/esp32-cam.ino`
2. เสียบสาย USB เข้าคอมพิวเตอร์ เลือกพอร์ต COM และเลือกประเภทบอร์ดให้ถูกต้อง จากนั้นกด **Upload**

---

## คู่มือการใช้งาน

### 1. การเชื่อมต่อ Wi-Fi และตั้งค่าระบบครั้งแรก (Captive Portal)
1. จ่ายไฟเลี้ยงระบบรถ (บอร์ดรถและบอร์ดกล้องจะเปิดพร้อมกัน)
2. เชื่อมต่อ Wi-Fi จากมือถือหรือคอมพิวเตอร์เข้า Access Point ของรถ:
   - **SSID:** `FPV-Car-Setup`
   - **Password:** `12345678`
3. หน้าต่าง Captive Portal จะเปิดขึ้นอัตโนมัติ (หากไม่เปิด ให้เข้าเว็บ `http://192.168.4.1`)
4. ป้อนชื่อ/รหัสผ่านของ Wi-Fi (2.4 GHz) ที่ต้องการให้รถเชื่อมต่อ พร้อมระบุโฮสต์ของเซิร์ฟเวอร์ WebSocket และกดยืนยัน ข้อมูลจะถูกบันทึกและส่งต่อไปยัง ESP32-CAM ผ่าน UART อัตโนมัติ

### 2. การควบคุมยานพาหนะผ่านหน้าเว็บ
1. เข้าหน้าเว็บ `/controller` สัญญาณภาพสดจากกล้องจะปรากฏบนจอภาพ พร้อมแถบแสดงสถานะแบตเตอรี่, ค่า Wi-Fi RSSI, และความหน่วงของระบบ
2. **การขับเคลื่อน:** ควบคุมได้ทั้งผ่าน Virtual Joystick / D-Pad บนหน้าจอสัมผัส และปุ่มคีย์บอร์ด (W, A, S, D หรือปุ่มลูกศร) หรือ Gamepad
3. **การควบคุมกล้อง:** หมุนปรับกิมบอล Pan (ซ้าย-ขวา) และ Tilt (ก้ม-เงย) จากแผงควบคุม
4. **อุปกรณ์เสริม:** กดปุ่มเพื่อเปิด/ปิดไฟส่องสว่าง (Flash Light) และกดสั่งแตร (Horn)

### 3. เอกสารเพิ่มเติมในโฟลเดอร์ `docs/` และ `firmware/`
- [คู่มือการติดตั้งและการ Deploy บน Azure Linux VM](docs/AZURE_LINUX_VM_TH.md)
- [รายละเอียดการต่อวงจรและพินฮาร์ดแวร์ทั้งหมด](firmware/README.md)

---

## ไฟล์ขนาดใหญ่ (โมเดล ชุดข้อมูล)

โครงงานนี้เป็นระบบ Embedded IoT ร่วมกับ Web Teleoperation แบบสตรีมมิง Real-time  
**"ไม่มีไฟล์โมเดลปัญญาประดิษฐ์ (AI Model) หรือชุดข้อมูล (Dataset) ขนาดใหญ่เกิน 100 MB ภายในระบบ"**  
ไฟล์โปรเจกต์ทั้งหมดถูกจัดเก็บและเวอร์ชันคอนโทรลผ่าน Git บน GitHub ได้โดยตรง
