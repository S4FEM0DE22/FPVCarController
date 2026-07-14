# DigitalOcean Droplet deployment guide

This guide runs both parts of the FPV car project on one Ubuntu Droplet:

- Relay WebSocket server on `127.0.0.1:8080`
- Next.js controller web app on `127.0.0.1:3000`
- Nginx public reverse proxy with HTTPS:
  - `https://<domain>/controller` -> web app
  - `wss://<domain>/ws` -> relay server

Using one domain keeps ESP32 setup simple.

## 1. Create the Droplet

Recommended small demo size:

- Ubuntu 24.04 LTS
- Basic shared CPU
- 1 GB RAM minimum, 2 GB is more comfortable for Next.js builds
- Region near Thailand, for example Singapore if available

If using GitHub Student Developer Pack credit, redeem the DigitalOcean offer
before creating the Droplet.

## 2. Point a domain to the Droplet

Create an `A` record:

```text
fpv.example.com -> <droplet-ip>
```

If you do not have a domain, you can test with the Droplet IP over HTTP first,
but ESP32 cloud setup is much better with HTTPS/WSS from a real domain.

## 3. Install server packages

SSH into the Droplet:

```bash
ssh root@<droplet-ip>
```

Install Node.js, Nginx, Certbot, Git, and PM2:

```bash
apt update
apt install -y ca-certificates curl gnupg git nginx certbot python3-certbot-nginx

curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
npm install -g pm2
```

## 4. Upload or clone the project

Option A: clone from GitHub:

```bash
cd /opt
git clone <your-repo-url> FPVCarController
cd /opt/FPVCarController
```

Option B: upload the project by SFTP/SCP to `/opt/FPVCarController`.

## 5. Configure environment

Create relay environment:

```bash
cat >/opt/FPVCarController/server/.env <<'EOF'
PORT=8080
ALLOW_LOCALHOST_AUTH_BYPASS=false
VEHICLE_AUTH_TOKEN=fpv-veh-Noppanun-2026-secure
CONTROLLER_AUTH_TOKEN=fpv-web-Noppanun-2026-secure
RATE_LIMIT_MAX_MESSAGES=600
EOF
```

Create web environment:

```bash
cat >/opt/FPVCarController/rc-car-control/.env.production <<'EOF'
NEXT_PUBLIC_WS_URL=wss://fpv.example.com/ws
NEXT_PUBLIC_VEHICLE_ID=car-001
NEXT_PUBLIC_CONTROLLER_AUTH_TOKEN=fpv-web-Noppanun-2026-secure
EOF
```

Replace `fpv.example.com` with your real domain.

## 6. Install and build

```bash
cd /opt/FPVCarController/server
npm ci --omit=dev

cd /opt/FPVCarController/rc-car-control
npm ci
npm run build
```

## 7. Start apps with PM2

Create PM2 config:

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

Start and save:

```bash
cd /opt/FPVCarController
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd
```

Run the command printed by `pm2 startup systemd`.

## 8. Configure Nginx

```bash
cat >/etc/nginx/sites-available/fpv-car <<'EOF'
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

ln -sfn /etc/nginx/sites-available/fpv-car /etc/nginx/sites-enabled/fpv-car
nginx -t
systemctl reload nginx
```

Replace every `fpv.example.com` before reloading Nginx.

## 9. Enable HTTPS

```bash
certbot --nginx -d fpv.example.com
```

After this, test:

```text
https://fpv.example.com/health
https://fpv.example.com/controller
```

## 10. ESP32 settings

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

## Useful commands

Check app status:

```bash
pm2 status
pm2 logs fpv-relay
pm2 logs fpv-web
```

Restart after code changes:

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

Stop costs when done:

```text
Delete the Droplet from the DigitalOcean dashboard.
```

Powering off a Droplet may not stop all billing because disk/resource allocation
can still count. Delete it when you are done with the demo.
