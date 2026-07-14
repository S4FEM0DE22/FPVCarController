# วิธีทำ Azure Linux VM สำหรับโปรเจกต์ FPV Car

เป้าหมายคือใช้ Linux VM ตัวเดียวรันทั้ง:

- เว็บควบคุมรถ Next.js
- WebSocket relay สำหรับ ESP32 / ESP32-CAM
- Nginx เป็นตัวรับ HTTPS/WSS ด้านหน้า

โครงสร้างหลังทำเสร็จ:

```text
https://<domain>/controller  -> เว็บควบคุมรถ
wss://<domain>/ws            -> relay WebSocket
https://<domain>/health      -> เช็ค relay
```

ถ้ายังไม่มี domain สามารถใช้ Public IP ทดสอบด้วย HTTP ก่อน แต่ถ้าจะให้ ESP32 ใช้ `wss` แนะนำให้มี domain เพื่อทำ HTTPS certificate

## 1. สร้าง Linux VM ใน Azure Portal

ไปที่ Azure Portal แล้วเลือก:

```text
Virtual Machines -> Create -> Azure virtual machine
```

ตั้งค่าหลัก:

```text
Subscription: Azure for Students
Resource group: fpv-car-rg
Virtual machine name: fpv-car-vm
Region: East Asia หรือ region ที่สร้างได้
Image: Ubuntu Server 24.04 LTS หรือ 22.04 LTS
Size: เลือกตัวที่ free eligible ถ้ามี เช่น B1s
Authentication type: SSH public key
Username: azureuser
Inbound ports: SSH 22, HTTP 80, HTTPS 443
```

กด `Review + create` แล้วสร้าง VM

หลังสร้างเสร็จ ให้จด:

```text
Public IP address
Username
Private key file
```

## 2. SSH เข้า VM

จาก PowerShell บน Windows:

```powershell
ssh azureuser@<public-ip>
```

ถ้าใช้ไฟล์ private key:

```powershell
ssh -i C:\path\to\key.pem azureuser@<public-ip>
```

## 3. ติดตั้งโปรแกรมบน VM

รันบน Ubuntu VM:

```bash
sudo apt update
sudo apt install -y git nginx certbot python3-certbot-nginx curl ufw
```

ติดตั้ง Node.js 22:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

ติดตั้ง PM2 สำหรับรัน Node app ค้างไว้:

```bash
sudo npm install -g pm2
```

เปิด firewall พื้นฐาน:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw --force enable
```

## 4. เอาโปรเจกต์ขึ้น VM

วิธีที่แนะนำคือ push โปรเจกต์ขึ้น GitHub ก่อน แล้ว clone ลง VM:

```bash
cd /opt
sudo git clone <your-repo-url> FPVCarController
sudo chown -R $USER:$USER /opt/FPVCarController
cd /opt/FPVCarController
```

ถ้ายังไม่มี GitHub repo ให้ใช้ `scp` หรือ SFTP อัปโหลดโฟลเดอร์โปรเจกต์ไปที่:

```text
/opt/FPVCarController
```

## 5. ตั้งค่า environment

แก้ชื่อ domain ในตัวอย่างจาก `fpv.example.com` เป็น domain จริงของคุณ

สร้างไฟล์ relay env:

```bash
cat >/opt/FPVCarController/server/.env <<'EOF'
PORT=8080
ALLOW_LOCALHOST_AUTH_BYPASS=false
VEHICLE_AUTH_TOKEN=fpv-veh-Noppanun-2026-secure
CONTROLLER_AUTH_TOKEN=fpv-web-Noppanun-2026-secure
RATE_LIMIT_MAX_MESSAGES=600
EOF
```

สร้างไฟล์ web env:

```bash
cat >/opt/FPVCarController/rc-car-control/.env.production <<'EOF'
NEXT_PUBLIC_WS_URL=wss://fpv.example.com/ws
NEXT_PUBLIC_VEHICLE_ID=car-001
NEXT_PUBLIC_CONTROLLER_AUTH_TOKEN=fpv-web-Noppanun-2026-secure
EOF
```

## 6. ติดตั้ง dependencies และ build

Relay:

```bash
cd /opt/FPVCarController/server
npm ci --omit=dev
```

Web:

```bash
cd /opt/FPVCarController/rc-car-control
npm ci
npm run build
```

## 7. รันแอปด้วย PM2

สร้าง PM2 config:

```bash
cat >/opt/FPVCarController/ecosystem.config.cjs <<'EOF'
module.exports = {
  apps: [
    {
      name: "fpv-relay",
      cwd: "/opt/FPVCarController/server",
      script: "index.js",
      env: {
        NODE_ENV: "production",
        PORT: "8080",
      },
    },
    {
      name: "fpv-web",
      cwd: "/opt/FPVCarController/rc-car-control",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
    },
  ],
};
EOF
```

เริ่มรัน:

```bash
cd /opt/FPVCarController
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd
```

คำสั่ง `pm2 startup systemd` จะพิมพ์คำสั่งอีกบรรทัดออกมา ให้ copy ไปรันหนึ่งครั้ง

เช็คสถานะ:

```bash
pm2 status
```

## 8. ตั้งค่า Nginx

ถ้ามี domain ให้แทน `fpv.example.com` ด้วย domain จริง

```bash
sudo tee /etc/nginx/sites-available/fpv-car >/dev/null <<'EOF'
server {
  listen 80;
  server_name fpv.example.com;

  location /ws {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600;
    proxy_send_timeout 3600;
  }

  location /health {
    proxy_pass http://127.0.0.1:8080/health;
  }

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
EOF
```

เปิด site:

```bash
sudo ln -sfn /etc/nginx/sites-available/fpv-car /etc/nginx/sites-enabled/fpv-car
sudo nginx -t
sudo systemctl reload nginx
```

## 9. เปิด HTTPS

ต้องมี domain ชี้ A record มาที่ Public IP ของ VM ก่อน

```bash
sudo certbot --nginx -d fpv.example.com
```

ทดสอบ:

```text
https://fpv.example.com/health
https://fpv.example.com/controller
```

## 10. ตั้งค่า ESP32

ESP32 vehicle WiFi Manager:

```text
ws_scheme = wss
ws_host = fpv.example.com
ws_port = 443
ws_path = /ws
vehicle_id = car-001
auth_token = fpv-veh-Noppanun-2026-secure
control_url = https://fpv.example.com/controller
```

ESP32-CAM WiFi Manager:

```text
control_url = https://fpv.example.com/controller
camera_name = FPV ESP32-CAM
ws_scheme = wss
ws_host = fpv.example.com
ws_port = 443
ws_path = /ws
vehicle_id = car-001
auth_token = fpv-veh-Noppanun-2026-secure
```

## 11. คำสั่งดู log

```bash
pm2 logs fpv-relay
pm2 logs fpv-web
```

restart:

```bash
pm2 restart all
```

หลังแก้โค้ด:

```bash
cd /opt/FPVCarController
git pull

cd server
npm ci --omit=dev

cd ../rc-car-control
npm ci
npm run build

pm2 restart all
```

## 12. หยุดค่าใช้จ่าย

ถ้าไม่ใช้แล้ว ให้ลบ VM และ disk ที่เกี่ยวข้องใน Azure Portal

แค่ stop VM อาจยังมีค่า disk/storage อยู่ ถ้าต้องการหยุดค่าใช้จ่ายให้ชัวร์ที่สุด ให้ delete resource ที่ไม่ใช้
