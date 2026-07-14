#include "esp_camera.h"
#include <Arduino.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <mbedtls/base64.h>

// Required library:
// - ArduinoJson by Benoit Blanchon
// Board target:
// - AI Thinker ESP32-CAM

#define PWDN_GPIO_NUM 32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 0
#define SIOD_GPIO_NUM 26
#define SIOC_GPIO_NUM 27
#define Y9_GPIO_NUM 35
#define Y8_GPIO_NUM 34
#define Y7_GPIO_NUM 39
#define Y6_GPIO_NUM 36
#define Y5_GPIO_NUM 21
#define Y4_GPIO_NUM 19
#define Y3_GPIO_NUM 18
#define Y2_GPIO_NUM 5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM 23
#define PCLK_GPIO_NUM 22
#define FLASH_LED_PIN 4

struct CamConfig {
  char wifiSsid[64] = "";
  char wifiPass[96] = "";
  char controlUrl[160] = "http://localhost:3000/controller";
  char cameraName[48] = "FPV ESP32-CAM";
  char wsHost[96] = "192.168.1.10";
  char wsPort[8] = "8080";
  char wsPath[32] = "/";
  char wsScheme[8] = "ws";
  char vehicleId[32] = "car-001";
  char authToken[96] = "";
};

Preferences prefs;
WebServer server(80);
WebSocketsClient webSocket;
CamConfig config;
bool cameraReady = false;
bool flashOn = false;
bool wsConnected = false;
unsigned long lastFrameAt = 0;
unsigned long lastStatusAt = 0;
unsigned long lastCloudFrameErrorLogAt = 0;
static const unsigned long CLOUD_FRAME_INTERVAL_MS = 350;

String deviceName();
String streamUrl();
String controlUrlWithCamera();
void sendCloudFrame();
void sendDeviceLog(const char *level, const String &message);

void printCameraConfig() {
  Serial.println();
  Serial.println("=== FPV ESP32-CAM ===");
  Serial.print("Device: ");
  Serial.println(deviceName());
  Serial.print("Camera name: ");
  Serial.println(config.cameraName);
  Serial.print("WiFi SSID: ");
  Serial.println(WiFi.SSID());
  Serial.print("WiFi IP: ");
  Serial.println(WiFi.localIP());
  Serial.print("WiFi RSSI: ");
  Serial.print(WiFi.RSSI());
  Serial.println(" dBm");
  Serial.print("Stream URL: ");
  Serial.println(streamUrl());
  Serial.print("Capture URL: ");
  Serial.print("http://");
  Serial.print(WiFi.localIP());
  Serial.println("/capture");
  Serial.print("Controller URL: ");
  Serial.println(controlUrlWithCamera());
  Serial.print("Cloud WebSocket: ");
  Serial.print(config.wsScheme);
  Serial.print("://");
  Serial.print(config.wsHost);
  Serial.print(":");
  Serial.print(config.wsPort);
  Serial.println(config.wsPath);
  Serial.print("Vehicle ID: ");
  Serial.println(config.vehicleId);
  Serial.println("=====================");
  Serial.println();
}

void sendCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

String deviceName() {
  uint64_t chipId = ESP.getEfuseMac();
  char suffix[7];
  snprintf(suffix, sizeof(suffix), "%06X", (uint32_t)(chipId & 0xFFFFFF));
  return String("FPV-CAM-") + suffix;
}

void loadConfig() {
  prefs.begin("fpv-cam", true);
  prefs.getString("wifiSsid", config.wifiSsid, sizeof(config.wifiSsid));
  prefs.getString("wifiPass", config.wifiPass, sizeof(config.wifiPass));
  prefs.getString("controlUrl", config.controlUrl, sizeof(config.controlUrl));
  prefs.getString("cameraName", config.cameraName, sizeof(config.cameraName));
  prefs.getString("wsHost", config.wsHost, sizeof(config.wsHost));
  prefs.getString("wsPort", config.wsPort, sizeof(config.wsPort));
  prefs.getString("wsPath", config.wsPath, sizeof(config.wsPath));
  prefs.getString("wsScheme", config.wsScheme, sizeof(config.wsScheme));
  prefs.getString("vehicleId", config.vehicleId, sizeof(config.vehicleId));
  prefs.getString("authToken", config.authToken, sizeof(config.authToken));
  prefs.end();
}

void saveConfig() {
  prefs.begin("fpv-cam", false);
  prefs.putString("wifiSsid", config.wifiSsid);
  prefs.putString("wifiPass", config.wifiPass);
  prefs.putString("controlUrl", config.controlUrl);
  prefs.putString("cameraName", config.cameraName);
  prefs.putString("wsHost", config.wsHost);
  prefs.putString("wsPort", config.wsPort);
  prefs.putString("wsPath", config.wsPath);
  prefs.putString("wsScheme", config.wsScheme);
  prefs.putString("vehicleId", config.vehicleId);
  prefs.putString("authToken", config.authToken);
  prefs.end();
}

String streamUrl() {
  return String("http://") + WiFi.localIP().toString() + "/stream";
}

String controlUrlWithCamera() {
  String url = config.controlUrl;
  url += url.indexOf('?') >= 0 ? "&" : "?";
  url += "cam=";
  url += streamUrl();
  return url;
}

bool setupCamera() {
  camera_config_t cam;
  cam.ledc_channel = LEDC_CHANNEL_0;
  cam.ledc_timer = LEDC_TIMER_0;
  cam.pin_d0 = Y2_GPIO_NUM;
  cam.pin_d1 = Y3_GPIO_NUM;
  cam.pin_d2 = Y4_GPIO_NUM;
  cam.pin_d3 = Y5_GPIO_NUM;
  cam.pin_d4 = Y6_GPIO_NUM;
  cam.pin_d5 = Y7_GPIO_NUM;
  cam.pin_d6 = Y8_GPIO_NUM;
  cam.pin_d7 = Y9_GPIO_NUM;
  cam.pin_xclk = XCLK_GPIO_NUM;
  cam.pin_pclk = PCLK_GPIO_NUM;
  cam.pin_vsync = VSYNC_GPIO_NUM;
  cam.pin_href = HREF_GPIO_NUM;
  cam.pin_sccb_sda = SIOD_GPIO_NUM;
  cam.pin_sccb_scl = SIOC_GPIO_NUM;
  cam.pin_pwdn = PWDN_GPIO_NUM;
  cam.pin_reset = RESET_GPIO_NUM;
  cam.xclk_freq_hz = 20000000;
  cam.pixel_format = PIXFORMAT_JPEG;
  cam.grab_mode = CAMERA_GRAB_LATEST;

  // Prefer low latency over image detail for FPV driving.
  if (psramFound()) {
    Serial.println("PSRAM found. Using QVGA low-latency stream.");
    cam.frame_size = FRAMESIZE_QVGA;
    cam.jpeg_quality = 14;
    cam.fb_count = 2;
  } else {
    Serial.println("PSRAM not found. Using QVGA low-latency stream.");
    cam.frame_size = FRAMESIZE_QVGA;
    cam.jpeg_quality = 16;
    cam.fb_count = 1;
  }

  esp_err_t err = esp_camera_init(&cam);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x\n", err);
    return false;
  }

  sensor_t *sensor = esp_camera_sensor_get();
  if (sensor) {
    sensor->set_framesize(sensor, FRAMESIZE_QVGA);
    sensor->set_quality(sensor, psramFound() ? 14 : 16);
    sensor->set_vflip(sensor, 0);
    sensor->set_hmirror(sensor, 0);
  }

  Serial.println("Camera init OK");
  return true;
}

void sendRedirectToControl() {
  String url = controlUrlWithCamera();
  Serial.print("Redirecting to controller: ");
  Serial.println(url);
  server.sendHeader("Location", url, true);
  server.send(302, "text/plain", "Opening controller...");
}

void handleRoot() {
  String html;
  html += "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>";
  html += "<meta http-equiv='refresh' content='2;url=" + controlUrlWithCamera() + "'>";
  html += "<title>FPV Camera</title></head><body style='font-family:sans-serif;padding:24px'>";
  html += "<h1>" + String(config.cameraName) + "</h1>";
  html += "<p>Camera stream: <a href='" + streamUrl() + "'>" + streamUrl() + "</a></p>";
  html += "<p><a href='" + controlUrlWithCamera() + "'>Open controller</a></p>";
  html += "<p><a href='/stream'>Open MJPEG stream</a></p>";
  html += "<p><a href='/reset-wifi'>Reset WiFi</a></p>";
  html += "</body></html>";
  server.send(200, "text/html", html);
}

String readArgOrJson(const char *key) {
  if (server.hasArg(key)) return server.arg(key);

  String raw = server.arg("plain");
  if (raw.length() == 0) return "";

  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, raw);
  if (error) return "";
  const char *value = doc[key] | "";
  return String(value);
}

void handleWifiSet() {
  sendCorsHeaders();

  if (server.method() == HTTP_OPTIONS) {
    server.send(204);
    return;
  }

  String ssid = readArgOrJson("ssid");
  String password = readArgOrJson("password");
  String controlUrl = readArgOrJson("controlUrl");

  if (ssid.length() == 0) {
    server.send(400, "application/json", "{\"ok\":false,\"message\":\"ssid is required\"}");
    return;
  }

  if (controlUrl.length() > 0) {
    strlcpy(config.controlUrl, controlUrl.c_str(), sizeof(config.controlUrl));
  }
  strlcpy(config.wifiSsid, ssid.c_str(), sizeof(config.wifiSsid));
  strlcpy(config.wifiPass, password.c_str(), sizeof(config.wifiPass));
  saveConfig();

  Serial.print("WiFi update requested: ssid=");
  Serial.print(ssid);
  Serial.print(" controlUrl=");
  Serial.println(controlUrl.length() > 0 ? controlUrl : config.controlUrl);

  server.send(200, "application/json", "{\"ok\":true,\"message\":\"camera wifi switching\"}");
  delay(250);
  WiFi.disconnect(true, true);
  delay(300);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), password.c_str());
}

void handleCapture() {
  if (!cameraReady) {
    Serial.println("Capture requested but camera is not ready");
    sendDeviceLog("warn", "Capture requested but camera is not ready");
    server.send(503, "text/plain", "Camera not ready");
    return;
  }

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("Capture failed: frame buffer unavailable");
    sendDeviceLog("error", "Capture failed: frame buffer unavailable");
    server.send(500, "text/plain", "Capture failed");
    return;
  }

  server.sendHeader("Content-Type", "image/jpeg");
  server.sendHeader("Content-Length", String(fb->len));
  server.send(200);
  WiFiClient client = server.client();
  client.write(fb->buf, fb->len);
  esp_camera_fb_return(fb);
}

void handleStream() {
  if (!cameraReady) {
    Serial.println("Stream requested but camera is not ready");
    server.send(503, "text/plain", "Camera not ready");
    return;
  }

  Serial.print("Stream client connected: ");
  Serial.println(server.client().remoteIP());

  WiFiClient client = server.client();
  String response = "HTTP/1.1 200 OK\r\n";
  response += "Access-Control-Allow-Origin: *\r\n";
  response += "Content-Type: multipart/x-mixed-replace; boundary=frame\r\n\r\n";
  client.print(response);

  while (client.connected()) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
      delay(30);
      continue;
    }

    client.printf("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n", fb->len);
    client.write(fb->buf, fb->len);
    client.print("\r\n");
    esp_camera_fb_return(fb);
    delay(45);
  }

  Serial.println("Stream client disconnected");
}

void sendIdentify() {
  if (!wsConnected) return;

  JsonDocument doc;
  doc["type"] = "identify";
  doc["clientType"] = "esp-cam";
  doc["vehicleId"] = config.vehicleId;
  doc["timestamp"] = millis();
  if (strlen(config.authToken) > 0) {
    doc["authToken"] = config.authToken;
  }

  String payload;
  serializeJson(doc, payload);
  webSocket.sendTXT(payload);
  Serial.print("ESP32-CAM identify sent: vehicleId=");
  Serial.println(config.vehicleId);
  sendDeviceLog("info", String("ESP32-CAM identify sent: vehicleId=") + config.vehicleId);
}

void sendDeviceLog(const char *level, const String &message) {
  if (!wsConnected) return;

  JsonDocument doc;
  doc["type"] = "device_log";
  doc["vehicleId"] = config.vehicleId;
  doc["source"] = "esp32-cam";
  doc["level"] = level;
  doc["message"] = message;
  doc["timestamp"] = millis();

  String payload;
  serializeJson(doc, payload);
  webSocket.sendTXT(payload);
}

void sendCloudFrameErrorLog(const String &message) {
  unsigned long now = millis();
  if (lastCloudFrameErrorLogAt != 0 && now - lastCloudFrameErrorLogAt < 3000) {
    return;
  }
  lastCloudFrameErrorLogAt = now;
  sendDeviceLog("warn", message);
}

void sendCloudFrame() {
  if (!cameraReady || !wsConnected) return;

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("Cloud frame skipped: frame buffer unavailable");
    sendCloudFrameErrorLog("Cloud frame skipped: frame buffer unavailable");
    return;
  }

  size_t encodedLen = 0;
  int lenResult = mbedtls_base64_encode(nullptr, 0, &encodedLen, fb->buf, fb->len);
  if (lenResult != MBEDTLS_ERR_BASE64_BUFFER_TOO_SMALL || encodedLen == 0) {
    Serial.println("Cloud frame skipped: base64 size failed");
    sendCloudFrameErrorLog("Cloud frame skipped: base64 size failed");
    esp_camera_fb_return(fb);
    return;
  }

  String encoded;
  encoded.reserve(encodedLen + 1);
  char *encodedBuffer = new char[encodedLen + 1];
  if (!encodedBuffer) {
    Serial.println("Cloud frame skipped: out of memory");
    sendCloudFrameErrorLog("Cloud frame skipped: out of memory");
    esp_camera_fb_return(fb);
    return;
  }

  if (mbedtls_base64_encode(
          (unsigned char *)encodedBuffer,
          encodedLen + 1,
          &encodedLen,
          fb->buf,
          fb->len) != 0) {
    Serial.println("Cloud frame skipped: base64 encode failed");
    sendCloudFrameErrorLog("Cloud frame skipped: base64 encode failed");
    delete[] encodedBuffer;
    esp_camera_fb_return(fb);
    return;
  }

  encodedBuffer[encodedLen] = '\0';
  encoded = encodedBuffer;
  delete[] encodedBuffer;
  esp_camera_fb_return(fb);

  String payload;
  payload.reserve(encoded.length() + 160);
  payload += "{\"type\":\"camera_frame\",\"vehicleId\":\"";
  payload += config.vehicleId;
  payload += "\",\"format\":\"jpeg\",\"width\":320,\"height\":240,\"timestamp\":";
  payload += String(millis());
  payload += ",\"data\":\"";
  payload += encoded;
  payload += "\"}";

  webSocket.sendTXT(payload);
}

void onWebSocketEvent(WStype_t type, uint8_t *payload, size_t length) {
  if (type == WStype_CONNECTED) {
    wsConnected = true;
    Serial.print("Camera WebSocket connected: ");
    Serial.print(config.wsScheme);
    Serial.print("://");
    Serial.print(config.wsHost);
    Serial.print(":");
    Serial.print(config.wsPort);
    Serial.println(config.wsPath);
    sendIdentify();
    sendDeviceLog("info", "Camera WebSocket connected");
    sendDeviceLog("info", cameraReady ? "Camera ready" : "Camera failed");
    return;
  }

  if (type == WStype_DISCONNECTED) {
    wsConnected = false;
    return;
  }

  if (type == WStype_ERROR) {
    Serial.print("Camera WebSocket error: ");
    if (payload && length > 0) {
      Serial.write(payload, length);
    } else {
      Serial.print("(no detail)");
    }
    Serial.println();
  }
}

void setupWebSocket() {
  uint16_t port = (uint16_t)atoi(config.wsPort);
  String path = strlen(config.wsPath) > 0 ? String(config.wsPath) : "/";

  Serial.print("Starting camera WebSocket: ");
  Serial.print(config.wsScheme);
  Serial.print("://");
  Serial.print(config.wsHost);
  Serial.print(":");
  Serial.print(port);
  Serial.println(path);

  if (strcmp(config.wsScheme, "wss") == 0) {
    webSocket.beginSSL(config.wsHost, port, path.c_str());
  } else {
    webSocket.begin(config.wsHost, port, path.c_str());
  }

  webSocket.onEvent(onWebSocketEvent);
  webSocket.setReconnectInterval(2500);
  webSocket.enableHeartbeat(15000, 3000, 2);
}

void setupRoutes() {
  server.on("/", handleRoot);
  server.on("/control", sendRedirectToControl);
  server.on("/capture", handleCapture);
  server.on("/stream", handleStream);
  server.on("/api/wifi", HTTP_GET, handleWifiSet);
  server.on("/api/wifi", HTTP_POST, handleWifiSet);
  server.on("/api/wifi", HTTP_OPTIONS, handleWifiSet);

  server.on("/flash", []() {
    flashOn = !flashOn;
    digitalWrite(FLASH_LED_PIN, flashOn ? HIGH : LOW);
    Serial.print("Flash ");
    Serial.println(flashOn ? "ON" : "OFF");
    server.send(200, "text/plain", flashOn ? "flash on" : "flash off");
  });

  server.on("/reset-wifi", []() {
    Serial.println("Reset WiFi requested. Rebooting...");
    server.send(200, "text/plain", "WiFi settings cleared. Rebooting...");
    delay(300);
    prefs.begin("fpv-cam", false);
    prefs.remove("wifiSsid");
    prefs.remove("wifiPass");
    prefs.end();
    WiFi.disconnect(true, true);
    ESP.restart();
  });

  server.begin();
  Serial.println("Camera HTTP server started on port 80");
}

bool connectToConfiguredWiFi(unsigned long timeoutMs) {
  if (strlen(config.wifiSsid) == 0) return false;

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(config.wifiSsid, config.wifiPass);

  Serial.print("Connecting WiFi: ");
  Serial.println(config.wifiSsid);

  unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < timeoutMs) {
    delay(100);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi connect failed.");
    return false;
  }

  Serial.print("WiFi connected: ");
  Serial.print(WiFi.SSID());
  Serial.print(" IP=");
  Serial.println(WiFi.localIP());
  return true;
}

bool applyProvisionPayload(const String &body) {
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, body);
  if (error) {
    Serial.print("Provision JSON parse error: ");
    Serial.println(error.c_str());
    return false;
  }

  if (!(doc["ready"] | false)) return false;

  const char *ssid = doc["ssid"] | "";
  if (strlen(ssid) == 0) return false;

  strlcpy(config.wifiSsid, ssid, sizeof(config.wifiSsid));
  strlcpy(config.wifiPass, doc["password"] | "", sizeof(config.wifiPass));
  strlcpy(config.wsScheme, doc["wsScheme"] | config.wsScheme, sizeof(config.wsScheme));
  strlcpy(config.wsHost, doc["wsHost"] | config.wsHost, sizeof(config.wsHost));
  strlcpy(config.wsPort, doc["wsPort"] | config.wsPort, sizeof(config.wsPort));
  strlcpy(config.wsPath, doc["wsPath"] | config.wsPath, sizeof(config.wsPath));
  strlcpy(config.vehicleId, doc["vehicleId"] | config.vehicleId, sizeof(config.vehicleId));
  strlcpy(config.authToken, doc["authToken"] | config.authToken, sizeof(config.authToken));
  strlcpy(config.controlUrl, doc["controlUrl"] | config.controlUrl, sizeof(config.controlUrl));
  saveConfig();

  Serial.println("Provision saved from ESP32 vehicle.");
  return true;
}

bool fetchProvisionFromVehicle() {
  HTTPClient http;
  http.begin("http://192.168.4.1/api/cam-provision");
  int status = http.GET();
  if (status != 200) {
    http.end();
    return false;
  }

  String body = http.getString();
  http.end();
  return applyProvisionPayload(body);
}

bool waitForVehicleProvision() {
  Serial.println("Connecting to setup AP: FPV-Car-Setup");
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin("FPV-Car-Setup", "12345678");

  unsigned long apStartedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - apStartedAt < 30000) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Could not join FPV-Car-Setup.");
    return false;
  }

  Serial.println("Joined FPV-Car-Setup. Waiting for vehicle provision...");
  unsigned long provisionStartedAt = millis();
  while (millis() - provisionStartedAt < 240000) {
    if (fetchProvisionFromVehicle()) return true;
    delay(1000);
  }

  Serial.println("Provision wait timed out.");
  return false;
}

void setupWiFiManager() {
  if (connectToConfiguredWiFi(18000)) return;

  Serial.println("Saved WiFi unavailable. Waiting for ESP32 vehicle setup.");
  if (!waitForVehicleProvision()) {
    Serial.println("Provision failed. Restarting...");
    delay(1000);
    ESP.restart();
  }

  if (!connectToConfiguredWiFi(25000)) {
    Serial.println("Provisioned WiFi failed. Restarting...");
    delay(1000);
    ESP.restart();
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println("Booting FPV ESP32-CAM...");
  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);
  loadConfig();
  setupWiFiManager();
  cameraReady = setupCamera();
  setupRoutes();
  setupWebSocket();
  printCameraConfig();
  Serial.println(cameraReady ? "ESP32-CAM ready" : "ESP32-CAM web server ready, camera failed");
}

void loop() {
  webSocket.loop();
  server.handleClient();

  unsigned long now = millis();
  if (now - lastFrameAt > CLOUD_FRAME_INTERVAL_MS) {
    lastFrameAt = now;
    sendCloudFrame();
  }

  if (now - lastStatusAt > 3000) {
    lastStatusAt = now;
    Serial.println(wsConnected ? "Camera cloud stream online" : "Camera cloud stream disconnected");
  }
}
