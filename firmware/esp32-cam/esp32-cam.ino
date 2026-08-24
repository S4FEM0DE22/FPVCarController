#include "esp_camera.h"
#include <Arduino.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WebSocketsClient.h>

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

static const int PIN_VEHICLE_UART_RX = 13;
static const int PIN_VEHICLE_UART_TX = 14;
static const uint32_t VEHICLE_UART_BAUD = 115200;

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
  char streamProfile[16] = "balanced";
};

Preferences prefs;
WebServer server(80);
WebSocketsClient webSocket;
HardwareSerial vehicleUart(1);
CamConfig config;
sensor_t *cameraSensor = nullptr;
bool cameraReady = false;
bool cameraHasPsram = false;
bool flashOn = false;
bool wsConnected = false;
bool cloudMotionMode = false;
bool wifiSwitchPending = false;
unsigned long wifiSwitchAt = 0;
bool wifiSwitchInProgress = false;
unsigned long wifiSwitchStartedAt = 0;
const unsigned long WIFI_SWITCH_TIMEOUT_MS = 25000;
const unsigned long WIFI_RECONNECT_INTERVAL_MS = 5000;
unsigned long wifiDisconnectedAt = 0;
unsigned long lastWifiReconnectAttemptAt = 0;
unsigned long lastFrameAt = 0;
unsigned long cloudMotionUntil = 0;
unsigned long lastStatusAt = 0;
unsigned long lastCloudFrameErrorLogAt = 0;
uint32_t cloudFramesSent = 0;
uint32_t cloudFrameAcks = 0;
uint32_t cloudFrameAckTimeouts = 0;
uint32_t cloudStaleFrameAcks = 0;
uint32_t cloudFrameSequence = 0;
static const uint8_t CLOUD_PENDING_FRAME_SLOTS = 24;
uint32_t pendingCloudFrameIds[CLOUD_PENDING_FRAME_SLOTS] = {};
unsigned long pendingCloudFrameSentAt[CLOUD_PENDING_FRAME_SLOTS] = {};
uint32_t cloudFramesAtLastStatus = 0;
size_t lastCloudFrameBytes = 0;
unsigned long lastCloudFrameAckMs = 0;
uint8_t cloudJpegQuality = 17;
uint8_t stableCloudFrameCount = 0;
unsigned long cloudFrameIntervalMs = 90;
unsigned long cloudFrameAckTimeoutMs = 1000;
uint8_t cloudMaxFramesInFlight = 2;
uint8_t cloudJpegQualityMin = 15;
uint8_t cloudJpegQualityMax = 26;
size_t cloudFrameTargetBytes = 32000;
unsigned long cloudFrameTargetAckMs = 300;
String wifiTransactionCommandId = "";
String wifiCandidateSsid = "";
String wifiCandidatePass = "";
String wifiActiveSsid = "";
String wifiActivePass = "";
bool wifiTransactionPrepared = false;
bool wifiTransactionArmed = false;
bool wifiCandidateConnected = false;
bool wifiFallbackInProgress = false;
bool wifiCandidateStatusSent = false;
unsigned long wifiTransactionStartedAt = 0;
const unsigned long WIFI_COMMIT_TIMEOUT_MS = 60000;
String vehicleUartBuffer = "";
bool uartProvisionReceived = false;
unsigned long uartProvisionRestartAt = 0;
String lastCommittedWifiCommandId = "";
String lastCommittedWifiSsid = "";

String deviceName();
String streamUrl();
String controlUrlWithCamera();
void sendCloudFrame();
void sendDeviceLog(const char *level, const String &message);
void sendCameraStreamStatus(float fps = 0.0f);
void tuneCloudJpegQuality();
void setCloudMotionMode(bool active);
void applyCloudStreamProfile(const char *profile, bool persist);
void processVehicleUart();

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
  prefs.getString("streamProfile", config.streamProfile, sizeof(config.streamProfile));
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
  prefs.putString("streamProfile", config.streamProfile);
  prefs.end();
}

bool isValidCloudStreamProfile(const char *profile) {
  return strcmp(profile, "realtime") == 0 ||
    strcmp(profile, "balanced") == 0 ||
    strcmp(profile, "quality") == 0;
}

framesize_t cloudIdleFrameSize() {
  if (!cameraHasPsram || strcmp(config.streamProfile, "realtime") == 0) {
    return FRAMESIZE_QVGA;
  }
  if (strcmp(config.streamProfile, "quality") == 0) {
    return FRAMESIZE_VGA;
  }
  return FRAMESIZE_CIF;
}

framesize_t cloudMotionFrameSize() {
  if (!cameraHasPsram || strcmp(config.streamProfile, "realtime") == 0) {
    return FRAMESIZE_QVGA;
  }
  if (strcmp(config.streamProfile, "quality") == 0) {
    return FRAMESIZE_CIF;
  }
  return FRAMESIZE_CIF;
}

void applyCloudStreamProfile(const char *profile, bool persist) {
  const char *nextProfile = isValidCloudStreamProfile(profile) ? profile : "balanced";
  strlcpy(config.streamProfile, nextProfile, sizeof(config.streamProfile));

  if (strcmp(nextProfile, "realtime") == 0) {
    cloudFrameIntervalMs = 75;
    cloudFrameAckTimeoutMs = 1500;
    cloudJpegQualityMin = 16;
    cloudJpegQualityMax = 24;
    cloudFrameTargetBytes = 22000;
    cloudFrameTargetAckMs = 220;
    cloudJpegQuality = min<uint8_t>(24, max<uint8_t>(18, cloudJpegQuality));
    cloudMaxFramesInFlight = 2;
  } else if (strcmp(nextProfile, "quality") == 0) {
    cloudFrameIntervalMs = 140;
    cloudFrameAckTimeoutMs = 2500;
    cloudJpegQualityMin = 10;
    cloudJpegQualityMax = 20;
    cloudFrameTargetBytes = 50000;
    cloudFrameTargetAckMs = 420;
    cloudJpegQuality = min<uint8_t>(18, max<uint8_t>(12, cloudJpegQuality));
    cloudMaxFramesInFlight = 1;
  } else {
    cloudFrameIntervalMs = 90;
    cloudFrameAckTimeoutMs = 1800;
    cloudJpegQualityMin = 12;
    cloudJpegQualityMax = 22;
    cloudFrameTargetBytes = 28000;
    cloudFrameTargetAckMs = 300;
    cloudJpegQuality = min<uint8_t>(20, max<uint8_t>(15, cloudJpegQuality));
    cloudMaxFramesInFlight = 2;
  }

  stableCloudFrameCount = 0;
  cloudMotionMode = false;
  cloudMotionUntil = 0;

  if (cameraSensor) {
    cameraSensor->set_framesize(cameraSensor, cloudIdleFrameSize());
    cameraSensor->set_quality(cameraSensor, cloudJpegQuality);
  }

  if (persist) saveConfig();
  Serial.printf(
    "Camera stream profile: %s interval=%lu ms ACK timeout=%lu ms Q=%u\n",
    config.streamProfile,
    cloudFrameIntervalMs,
    cloudFrameAckTimeoutMs,
    cloudJpegQuality
  );
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
  camera_config_t cam = {};
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

  cameraHasPsram = psramFound();
  applyCloudStreamProfile(config.streamProfile, false);

  if (cameraHasPsram) {
    Serial.println("PSRAM found. Using adaptive cloud stream.");
    cam.frame_size = cloudIdleFrameSize();
    cam.jpeg_quality = cloudJpegQuality;
    cam.fb_count = 2;
    cam.fb_location = CAMERA_FB_IN_PSRAM;
  } else {
    Serial.println("PSRAM not found. Using QVGA low-latency stream.");
    cloudMaxFramesInFlight = 1;
    cam.frame_size = FRAMESIZE_QVGA;
    cam.jpeg_quality = 16;
    cam.fb_count = 1;
    cam.fb_location = CAMERA_FB_IN_DRAM;
  }

  esp_err_t err = esp_camera_init(&cam);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x\n", err);
    return false;
  }

  cameraSensor = esp_camera_sensor_get();
  if (cameraSensor) {
    cameraSensor->set_framesize(cameraSensor, cloudIdleFrameSize());
    cameraSensor->set_quality(cameraSensor, cameraHasPsram ? cloudJpegQuality : 16);
    cameraSensor->set_vflip(cameraSensor, 0);
    cameraSensor->set_hmirror(cameraSensor, 0);
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

void persistWifiCandidate(const char *state) {
  prefs.begin("fpv-cam", false);
  prefs.putString("candidateSsid", wifiCandidateSsid);
  prefs.putString("candidatePass", wifiCandidatePass);
  prefs.putString("candidateCmd", wifiTransactionCommandId);
  prefs.putString("candidateState", state);
  prefs.end();
}

void clearPersistedWifiCandidate() {
  prefs.begin("fpv-cam", false);
  prefs.remove("candidateSsid");
  prefs.remove("candidatePass");
  prefs.remove("candidateCmd");
  prefs.remove("candidateState");
  prefs.end();
}

void clearWifiTransaction() {
  wifiTransactionCommandId = "";
  wifiCandidateSsid = "";
  wifiCandidatePass = "";
  wifiActiveSsid = "";
  wifiActivePass = "";
  wifiTransactionPrepared = false;
  wifiTransactionArmed = false;
  wifiCandidateConnected = false;
  wifiFallbackInProgress = false;
  wifiCandidateStatusSent = false;
  wifiTransactionStartedAt = 0;
  wifiSwitchPending = false;
  wifiSwitchInProgress = false;
  clearPersistedWifiCandidate();
}

void sendWifiPhase(const char *phase, bool ok, const String &message) {
  if (!wsConnected || wifiTransactionCommandId.length() == 0) return;
  JsonDocument doc;
  doc["type"] = "wifi_phase_ack";
  doc["vehicleId"] = config.vehicleId;
  doc["commandId"] = wifiTransactionCommandId;
  doc["phase"] = phase;
  doc["ok"] = ok;
  doc["ssid"] = wifiCandidateSsid;
  doc["message"] = message;
  doc["timestamp"] = millis();
  String payload;
  serializeJson(doc, payload);
  webSocket.sendTXT(payload);
}

void sendWifiCandidateStatus(const char *state, const String &message) {
  if (!wsConnected || wifiTransactionCommandId.length() == 0) return;
  JsonDocument doc;
  doc["type"] = "wifi_candidate_status";
  doc["vehicleId"] = config.vehicleId;
  doc["commandId"] = wifiTransactionCommandId;
  doc["state"] = state;
  doc["ssid"] = WiFi.isConnected() ? WiFi.SSID() : "";
  doc["gateway"] = WiFi.isConnected() ? WiFi.gatewayIP().toString() : "";
  doc["message"] = message;
  doc["timestamp"] = millis();
  String payload;
  serializeJson(doc, payload);
  webSocket.sendTXT(payload);
}

void restoreActiveWifi(const char *reason) {
  if (wifiActiveSsid.length() == 0) return;
  Serial.print("Restoring active WiFi: ");
  Serial.println(reason);
  strlcpy(config.wifiSsid, wifiActiveSsid.c_str(), sizeof(config.wifiSsid));
  strlcpy(config.wifiPass, wifiActivePass.c_str(), sizeof(config.wifiPass));
  wifiFallbackInProgress = true;
  wifiCandidateConnected = false;
  wifiCandidateStatusSent = false;
  wifiSwitchPending = true;
  wifiSwitchAt = millis() + 300;
}

void prepareWifiCandidate(JsonObject payload, const char *commandId) {
  String ssid = payload["ssid"] | "";
  String password = payload["password"] | "";
  if (ssid.length() == 0 || !commandId || strlen(commandId) == 0) return;

  clearWifiTransaction();
  wifiTransactionCommandId = commandId;
  wifiCandidateSsid = ssid;
  wifiCandidatePass = password;
  wifiActiveSsid = config.wifiSsid;
  wifiActivePass = config.wifiPass;
  wifiTransactionPrepared = true;
  wifiTransactionStartedAt = millis();
  persistWifiCandidate("prepared");
  sendWifiPhase("prepared", true, "camera stored WiFi candidate");
  sendDeviceLog("info", "WiFi candidate prepared; active WiFi unchanged");
}

void armWifiCandidate(const char *commandId) {
  if (!wifiTransactionPrepared || !commandId || wifiTransactionCommandId != commandId) return;
  wifiTransactionArmed = true;
  wifiTransactionStartedAt = millis();
  persistWifiCandidate("armed");
  sendWifiPhase("armed", true, "camera ready for coordinated switch");
  wifiSwitchPending = true;
  wifiSwitchAt = millis() + 3000;
}

void commitWifiCandidate(const char *commandId) {
  if (!wifiCandidateConnected || !commandId || wifiTransactionCommandId != commandId) return;
  saveConfig();
  sendWifiPhase("committed", true, "camera committed active WiFi");
  clearWifiTransaction();
}

void rollbackWifiCandidate(const char *commandId, const char *reason) {
  if (!commandId || wifiTransactionCommandId != commandId) return;
  if (wifiCandidateConnected || wifiSwitchInProgress || wifiTransactionArmed) {
    restoreActiveWifi(reason);
    return;
  }
  sendWifiPhase("rolled_back", true, reason);
  clearWifiTransaction();
}

void sendVehicleUartDocument(JsonDocument &doc) {
  serializeJson(doc, vehicleUart);
  vehicleUart.write('\n');
  vehicleUart.flush();
}

void sendVehicleWifiAck(
  const String &commandId,
  const char *phase,
  bool ok,
  const String &ssid,
  const String &message
) {
  JsonDocument doc;
  doc["type"] = "wifi_ack";
  doc["commandId"] = commandId;
  doc["phase"] = phase;
  doc["ok"] = ok;
  doc["ssid"] = ssid;
  doc["message"] = message;
  sendVehicleUartDocument(doc);
}

bool applyUartProvision(JsonDocument &doc) {
  const char *ssid = doc["ssid"] | "";
  String requestId = doc["requestId"] | "";
  if (strlen(ssid) == 0 || requestId.length() == 0) return false;

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

  JsonDocument ack;
  ack["type"] = "provision_ack";
  ack["requestId"] = requestId;
  ack["ok"] = true;
  ack["message"] = "camera saved UART provision";
  sendVehicleUartDocument(ack);
  uartProvisionReceived = true;
  uartProvisionRestartAt = millis() + 700;
  Serial.print("Provision saved from vehicle UART: SSID=");
  Serial.println(config.wifiSsid);
  return true;
}

void handleVehicleWifiAction(JsonDocument &doc) {
  String action = doc["action"] | "";
  String commandId = doc["commandId"] | "";
  if (commandId.length() == 0) return;

  if (action == "prepare") {
    String ssid = doc["ssid"] | "";
    if (ssid.length() == 0) {
      sendVehicleWifiAck(commandId, "prepared", false, "", "missing WiFi SSID");
      return;
    }
    if (
      wifiTransactionPrepared &&
      wifiTransactionCommandId == commandId &&
      wifiCandidateSsid == ssid
    ) {
      sendVehicleWifiAck(commandId, "prepared", true, ssid, "camera already prepared");
      return;
    }
    clearWifiTransaction();
    wifiTransactionCommandId = commandId;
    wifiCandidateSsid = ssid;
    wifiCandidatePass = String(doc["password"] | "");
    wifiActiveSsid = config.wifiSsid;
    wifiActivePass = config.wifiPass;
    wifiTransactionPrepared = true;
    wifiTransactionStartedAt = millis();
    persistWifiCandidate("prepared");
    sendVehicleWifiAck(commandId, "prepared", true, ssid, "camera stored WiFi candidate over UART");
    return;
  }

  if (
    action == "commit" &&
    commandId == lastCommittedWifiCommandId &&
    lastCommittedWifiSsid.length() > 0
  ) {
    sendVehicleWifiAck(
      commandId,
      "committed",
      true,
      lastCommittedWifiSsid,
      "camera commit already applied"
    );
    return;
  }
  if (commandId != wifiTransactionCommandId) return;
  if (action == "arm") {
    wifiTransactionArmed = true;
    wifiTransactionStartedAt = millis();
    persistWifiCandidate("armed");
    sendVehicleWifiAck(commandId, "armed", true, wifiCandidateSsid, "camera armed over UART");
  } else if (action == "switch") {
    if (!wifiTransactionArmed) {
      sendVehicleWifiAck(commandId, "switching", false, wifiCandidateSsid, "camera was not armed");
      return;
    }
    unsigned long delayMs = constrain((unsigned long)(doc["delayMs"] | 3000), 1500UL, 5000UL);
    wifiSwitchPending = true;
    wifiSwitchAt = millis() + delayMs;
    wifiTransactionStartedAt = millis();
    sendVehicleWifiAck(commandId, "switching", true, wifiCandidateSsid, "camera switch scheduled");
  } else if (action == "commit") {
    if (!wifiCandidateConnected) return;
    saveConfig();
    lastCommittedWifiCommandId = commandId;
    lastCommittedWifiSsid = wifiCandidateSsid;
    sendVehicleWifiAck(commandId, "committed", true, wifiCandidateSsid, "camera committed active WiFi");
    clearWifiTransaction();
  } else if (action == "rollback") {
    String reason = doc["reason"] | "vehicle requested rollback";
    if (wifiCandidateConnected || wifiSwitchInProgress || wifiTransactionArmed) {
      restoreActiveWifi(reason.c_str());
    } else {
      sendVehicleWifiAck(commandId, "rolled_back", true, wifiCandidateSsid, reason);
      clearWifiTransaction();
    }
  }
}

void handleVehicleUartLine(const String &line) {
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, line);
  if (error) {
    Serial.print("Vehicle UART JSON error: ");
    Serial.println(error.c_str());
    return;
  }
  const char *type = doc["type"] | "";
  if (strcmp(type, "provision") == 0) {
    applyUartProvision(doc);
  } else if (strcmp(type, "wifi_action") == 0) {
    handleVehicleWifiAction(doc);
  }
}

void processVehicleUart() {
  while (vehicleUart.available() > 0) {
    char value = (char)vehicleUart.read();
    if (value == '\r') continue;
    if (value == '\n') {
      if (vehicleUartBuffer.length() > 0) {
        handleVehicleUartLine(vehicleUartBuffer);
        vehicleUartBuffer = "";
      }
      continue;
    }
    if (vehicleUartBuffer.length() < 1200) {
      vehicleUartBuffer += value;
    } else {
      vehicleUartBuffer = "";
    }
  }
}

void sendCameraStreamStatus(float fps) {
  if (!wsConnected) return;

  JsonDocument doc;
  doc["type"] = "camera_stream_status";
  doc["vehicleId"] = config.vehicleId;
  doc["profile"] = config.streamProfile;
  doc["mode"] = cloudMotionMode ? "motion" : "idle";
  doc["fps"] = fps;
  doc["ackMs"] = lastCloudFrameAckMs;
  doc["frameBytes"] = lastCloudFrameBytes;
  doc["jpegQuality"] = cloudJpegQuality;
  doc["rssi"] = WiFi.RSSI();
  doc["wifiSsid"] = WiFi.isConnected() ? WiFi.SSID() : "";
  doc["wifiGateway"] = WiFi.isConnected() ? WiFi.gatewayIP().toString() : "";
  doc["timeouts"] = cloudFrameAckTimeouts;
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

void setCloudMotionMode(bool active) {
  if (!cameraHasPsram || !cameraSensor || cloudMotionMode == active) return;

  const framesize_t previousFrameSize = cloudMotionMode
    ? cloudMotionFrameSize()
    : cloudIdleFrameSize();
  cloudMotionMode = active;
  const framesize_t nextFrameSize = cloudMotionMode
    ? cloudMotionFrameSize()
    : cloudIdleFrameSize();
  stableCloudFrameCount = 0;
  if (nextFrameSize != previousFrameSize) {
    cameraSensor->set_framesize(cameraSensor, nextFrameSize);
  }

  Serial.printf(
    "Camera %s mode (%s profile)\n",
    cloudMotionMode ? "motion" : "idle",
    config.streamProfile
  );
}

void tuneCloudJpegQuality() {
  if (!cameraHasPsram || !cameraSensor || lastCloudFrameAckMs == 0) return;

  uint8_t nextQuality = cloudJpegQuality;
  const bool overloaded =
    lastCloudFrameBytes > cloudFrameTargetBytes ||
    lastCloudFrameAckMs > cloudFrameTargetAckMs;
  const bool stable =
    lastCloudFrameBytes < cloudFrameTargetBytes * 3 / 4 &&
    lastCloudFrameAckMs < cloudFrameTargetAckMs * 3 / 4;

  if (overloaded) {
    stableCloudFrameCount = 0;
    nextQuality = min<uint8_t>(cloudJpegQualityMax, cloudJpegQuality + 2);
  } else if (stable) {
    stableCloudFrameCount++;
    if (stableCloudFrameCount >= 8 && cloudJpegQuality > cloudJpegQualityMin) {
      stableCloudFrameCount = 0;
      nextQuality = cloudJpegQuality - 1;
    }
  } else {
    stableCloudFrameCount = 0;
  }

  if (nextQuality != cloudJpegQuality) {
    cloudJpegQuality = nextQuality;
    cameraSensor->set_quality(cameraSensor, cloudJpegQuality);
    Serial.printf("Adaptive JPEG quality changed to %u\n", cloudJpegQuality);
  }
}

void clearPendingCloudFrameAcks() {
  memset(pendingCloudFrameIds, 0, sizeof(pendingCloudFrameIds));
  memset(pendingCloudFrameSentAt, 0, sizeof(pendingCloudFrameSentAt));
}

uint8_t pendingCloudFrameAckCount() {
  uint8_t count = 0;
  for (uint8_t index = 0; index < CLOUD_PENDING_FRAME_SLOTS; index++) {
    if (pendingCloudFrameIds[index] != 0) count++;
  }
  return count;
}

void expirePendingCloudFrameAcks(unsigned long now) {
  for (uint8_t index = 0; index < CLOUD_PENDING_FRAME_SLOTS; index++) {
    if (
      pendingCloudFrameIds[index] != 0 &&
      now - pendingCloudFrameSentAt[index] >= cloudFrameAckTimeoutMs
    ) {
      pendingCloudFrameIds[index] = 0;
      pendingCloudFrameSentAt[index] = 0;
      cloudFrameAckTimeouts++;
    }
  }
}

void trackPendingCloudFrameAck(uint32_t frameId, unsigned long sentAt) {
  const uint8_t index = frameId % CLOUD_PENDING_FRAME_SLOTS;
  if (pendingCloudFrameIds[index] != 0) {
    cloudFrameAckTimeouts++;
  }
  pendingCloudFrameIds[index] = frameId;
  pendingCloudFrameSentAt[index] = sentAt;
}

bool completePendingCloudFrameAck(
  uint32_t frameId,
  unsigned long now,
  unsigned long &roundTripMs
) {
  const uint8_t index = frameId % CLOUD_PENDING_FRAME_SLOTS;
  if (pendingCloudFrameIds[index] != frameId) return false;

  roundTripMs = now - pendingCloudFrameSentAt[index];
  pendingCloudFrameIds[index] = 0;
  pendingCloudFrameSentAt[index] = 0;
  return true;
}

void sendCloudFrame() {
  if (!cameraReady || !wsConnected) return;
  if (
    wifiTransactionPrepared ||
    wifiSwitchPending ||
    wifiSwitchInProgress ||
    wifiFallbackInProgress
  ) {
    return;
  }

  const unsigned long now = millis();
  expirePendingCloudFrameAcks(now);
  // A two-frame pipeline can cover one cloud RTT without allowing an
  // unbounded ordered TCP queue. The quality profile stays at one frame.
  if (pendingCloudFrameAckCount() >= cloudMaxFramesInFlight) return;
  if (now - lastFrameAt < cloudFrameIntervalMs) return;
  lastFrameAt = now;

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("Cloud frame skipped: frame buffer unavailable");
    sendCloudFrameErrorLog("Cloud frame skipped: frame buffer unavailable");
    return;
  }

  const size_t frameBytes = fb->len;
  const uint32_t frameId = cloudFrameSequence + 1;
  const bool sent = webSocket.sendBIN(fb->buf, frameBytes);
  esp_camera_fb_return(fb);

  if (sent) {
    cloudFrameSequence = frameId;
    trackPendingCloudFrameAck(frameId, millis());
    lastCloudFrameBytes = frameBytes;
    cloudFramesSent++;
  } else {
    sendCloudFrameErrorLog("Cloud frame skipped: WebSocket send failed");
  }
}

void onWebSocketEvent(WStype_t type, uint8_t *payload, size_t length) {
  if (type == WStype_CONNECTED) {
    wsConnected = true;
    if (wifiCandidateConnected || wifiFallbackInProgress) {
      wifiCandidateStatusSent = false;
    }
    cloudFrameSequence = 0;
    clearPendingCloudFrameAcks();
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
    sendCameraStreamStatus();
    return;
  }

  if (type == WStype_DISCONNECTED) {
    wsConnected = false;
    clearPendingCloudFrameAcks();
    return;
  }

  if (type == WStype_TEXT) {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, payload, length);
    if (error) return;

    const char *messageType = doc["type"] | "";
    if (strcmp(messageType, "camera_frame_ack") == 0) {
      const uint32_t ackFrameId = doc["frameId"] | 0;
      unsigned long frameRoundTripMs = 0;
      if (!completePendingCloudFrameAck(ackFrameId, millis(), frameRoundTripMs)) {
        cloudStaleFrameAcks++;
        return;
      }

      lastCloudFrameAckMs = frameRoundTripMs;
      cloudFrameAcks++;
      if (doc["accepted"] | false) {
        tuneCloudJpegQuality();
      }
      return;
    }

    if (strcmp(messageType, "camera_motion") == 0) {
      unsigned long holdMs = doc["holdMs"] | 1200;
      holdMs = constrain(holdMs, 250UL, 2000UL);
      cloudMotionUntil = millis() + holdMs;
      setCloudMotionMode(true);
      return;
    }

    if (strcmp(messageType, "camera_stream_profile") == 0) {
      const char *profile = doc["profile"] | "";
      if (!isValidCloudStreamProfile(profile)) {
        sendDeviceLog("warn", "Rejected invalid camera stream profile");
        return;
      }

      applyCloudStreamProfile(profile, true);
      sendDeviceLog("info", String("Camera stream profile changed to ") + profile);
      sendCameraStreamStatus();
      return;
    }

    if (strcmp(messageType, "action") == 0) {
      const char *action = doc["action"] | "";
      const char *commandId = doc["commandId"] | "";
      JsonObject actionPayload = doc["payload"].as<JsonObject>();
      if (strcmp(action, "WIFI_PREPARE") == 0) {
        prepareWifiCandidate(actionPayload, commandId);
      } else if (strcmp(action, "WIFI_APPLY") == 0) {
        armWifiCandidate(commandId);
      } else if (strcmp(action, "WIFI_COMMIT") == 0) {
        commitWifiCandidate(commandId);
      } else if (strcmp(action, "WIFI_ROLLBACK") == 0) {
        rollbackWifiCandidate(commandId, "relay requested rollback");
      } else if (strcmp(action, "NETWORK_RECONNECT") == 0) {
        WiFi.reconnect();
      } else if (strcmp(action, "WIFI_PORTAL_OPEN") == 0) {
        sendDeviceLog("info", "Restarting camera for shared WiFi setup");
        prefs.begin("fpv-cam", false);
        prefs.remove("wifiSsid");
        prefs.remove("wifiPass");
        prefs.remove("candidateSsid");
        prefs.remove("candidatePass");
        prefs.remove("candidateCmd");
        prefs.remove("candidateState");
        prefs.end();
        delay(150);
        ESP.restart();
      }
    }
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
    prefs.remove("candidateSsid");
    prefs.remove("candidatePass");
    prefs.remove("candidateCmd");
    prefs.remove("candidateState");
    prefs.end();
    WiFi.disconnect(true, true);
    ESP.restart();
  });

  server.begin();
  Serial.println("Camera HTTP server started on port 80");
}

void stopStaConnectionAttempt() {
  WiFi.setAutoReconnect(false);
  WiFi.disconnect(true, false);
  delay(250);
}

void beginStaConnection(const char *ssid, const char *password, bool autoReconnect) {
  stopStaConnectionAttempt();
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(autoReconnect);
  delay(100);
  WiFi.begin(ssid, password);
}

bool connectToConfiguredWiFi(unsigned long timeoutMs) {
  if (strlen(config.wifiSsid) == 0) return false;

  beginStaConnection(config.wifiSsid, config.wifiPass, true);

  Serial.print("Connecting WiFi: ");
  Serial.println(config.wifiSsid);
  Serial.print("Saved password length: ");
  Serial.println(strlen(config.wifiPass));

  unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < timeoutMs) {
    processVehicleUart();
    if (uartProvisionReceived) {
      stopStaConnectionAttempt();
      return false;
    }
    delay(100);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi connect failed.");
    stopStaConnectionAttempt();
    return false;
  }

  Serial.print("WiFi connected: ");
  Serial.print(WiFi.SSID());
  Serial.print(" IP=");
  Serial.println(WiFi.localIP());
  return true;
}

void maintainWiFiConnection(unsigned long now) {
  if (WiFi.status() == WL_CONNECTED) {
    if (wifiDisconnectedAt != 0) {
      Serial.print("ESP32-CAM WiFi restored: ");
      Serial.print(WiFi.SSID());
      Serial.print(" IP=");
      Serial.println(WiFi.localIP());
    }
    wifiDisconnectedAt = 0;
    lastWifiReconnectAttemptAt = 0;
    return;
  }

  if (wifiSwitchPending || wifiSwitchInProgress || strlen(config.wifiSsid) == 0) {
    return;
  }

  if (wifiDisconnectedAt == 0) {
    wifiDisconnectedAt = now;
    Serial.printf("ESP32-CAM WiFi lost (status=%d). Starting recovery...\n", WiFi.status());
  }

  if (lastWifiReconnectAttemptAt != 0 &&
      now - lastWifiReconnectAttemptAt < WIFI_RECONNECT_INTERVAL_MS) {
    return;
  }

  lastWifiReconnectAttemptAt = now;
  Serial.print("Retrying saved WiFi: ");
  Serial.println(config.wifiSsid);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  if (!WiFi.reconnect()) {
    WiFi.begin(config.wifiSsid, config.wifiPass);
  }
}

void setupWiFiManager() {
  if (connectToConfiguredWiFi(18000)) return;

  Serial.println("Saved WiFi unavailable. Waiting for vehicle UART provisioning.");
  while (!uartProvisionReceived) {
    processVehicleUart();
    delay(10);
  }

  Serial.println("UART provisioning saved. Restarting camera on the new WiFi...");
  delay(800);
  ESP.restart();
}

void setup() {
  Serial.begin(115200);
  vehicleUart.setRxBufferSize(2048);
  vehicleUart.begin(
    VEHICLE_UART_BAUD,
    SERIAL_8N1,
    PIN_VEHICLE_UART_RX,
    PIN_VEHICLE_UART_TX
  );
  delay(300);
  Serial.println();
  Serial.println("Booting FPV ESP32-CAM...");
  Serial.println("Vehicle UART ready: RX=GPIO13 TX=GPIO14 baud=115200");
  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);
  loadConfig();
  clearPersistedWifiCandidate();
  WiFi.mode(WIFI_STA);
  Serial.print("ESP32-CAM WiFi MAC: ");
  Serial.println(WiFi.macAddress());
  if (!isValidCloudStreamProfile(config.streamProfile)) {
    strlcpy(config.streamProfile, "balanced", sizeof(config.streamProfile));
  }
  setupWiFiManager();
  cameraReady = setupCamera();
  setupRoutes();
  setupWebSocket();
  printCameraConfig();
  Serial.println(cameraReady ? "ESP32-CAM ready" : "ESP32-CAM web server ready, camera failed");
}

void loop() {
  processVehicleUart();
  webSocket.loop();
  server.handleClient();

  unsigned long now = millis();

  if (
    uartProvisionReceived &&
    uartProvisionRestartAt > 0 &&
    (long)(now - uartProvisionRestartAt) >= 0
  ) {
    Serial.println("Applying new UART provisioning after restart...");
    delay(100);
    ESP.restart();
  }

  if (wifiSwitchPending && (long)(millis() - wifiSwitchAt) >= 0) {
    wifiSwitchPending = false;
    wifiSwitchInProgress = true;
    wifiSwitchStartedAt = millis();
    if (wifiTransactionArmed && !wifiFallbackInProgress) {
      strlcpy(config.wifiSsid, wifiCandidateSsid.c_str(), sizeof(config.wifiSsid));
      strlcpy(config.wifiPass, wifiCandidatePass.c_str(), sizeof(config.wifiPass));
    }
    Serial.println("Switching ESP32-CAM to the newly saved WiFi...");
    WiFi.disconnect(false, false);
    delay(300);
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);
    WiFi.setAutoReconnect(true);
    WiFi.begin(config.wifiSsid, config.wifiPass);
  }

  maintainWiFiConnection(millis());
  sendCloudFrame();

  if (wifiSwitchInProgress) {
    if (WiFi.status() == WL_CONNECTED) {
      wifiSwitchInProgress = false;
      Serial.println("ESP32-CAM connected to the new WiFi.");
      if (wifiFallbackInProgress) {
        wifiCandidateConnected = false;
      } else if (wifiTransactionArmed) {
        wifiCandidateConnected = true;
      }
      wifiCandidateStatusSent = false;
    } else if (millis() - wifiSwitchStartedAt > WIFI_SWITCH_TIMEOUT_MS) {
      wifiSwitchInProgress = false;
      if (!wifiFallbackInProgress && wifiTransactionArmed) {
        restoreActiveWifi("candidate connection timed out");
      } else {
        Serial.println("Active WiFi recovery failed. Restarting...");
        ESP.restart();
      }
    }
  }
  if (wifiCandidateConnected && wsConnected && !wifiCandidateStatusSent) {
    sendWifiCandidateStatus("connected", "camera reached cloud through candidate WiFi");
    wifiCandidateStatusSent = true;
  }
  if (
    wifiFallbackInProgress &&
    WiFi.status() == WL_CONNECTED &&
    wsConnected &&
    !wifiCandidateStatusSent
  ) {
    sendWifiCandidateStatus("rolled_back", "camera restored active WiFi");
    wifiCandidateStatusSent = true;
    clearWifiTransaction();
  }
  if (
    wifiTransactionArmed &&
    !wifiFallbackInProgress &&
    now - wifiTransactionStartedAt > WIFI_COMMIT_TIMEOUT_MS
  ) {
    restoreActiveWifi("cloud commit timed out");
  }
  if (cloudMotionMode && (long)(now - cloudMotionUntil) >= 0) {
    setCloudMotionMode(false);
  }

  if (now - lastStatusAt > 3000) {
    const unsigned long statusElapsedMs = lastStatusAt == 0 ? 3000 : now - lastStatusAt;
    const uint32_t framesSinceStatus = cloudFramesSent - cloudFramesAtLastStatus;
    const float cloudFps = statusElapsedMs > 0
      ? (framesSinceStatus * 1000.0f) / statusElapsedMs
      : 0.0f;
    lastStatusAt = now;
    cloudFramesAtLastStatus = cloudFramesSent;
    if (wsConnected) {
      Serial.printf(
        "Camera cloud online | sent=%lu ack=%lu staleAck=%lu timeout=%lu pending=%u/%u profile=%s mode=%s FPS=%.1f RTT=%lu ms bytes=%u Q=%u RSSI=%d dBm\n",
        (unsigned long)cloudFramesSent,
        (unsigned long)cloudFrameAcks,
        (unsigned long)cloudStaleFrameAcks,
        (unsigned long)cloudFrameAckTimeouts,
        pendingCloudFrameAckCount(),
        cloudMaxFramesInFlight,
        config.streamProfile,
        cloudMotionMode ? "motion" : "idle",
        cloudFps,
        lastCloudFrameAckMs,
        (unsigned int)lastCloudFrameBytes,
        cloudJpegQuality,
        WiFi.RSSI()
      );
      sendCameraStreamStatus(cloudFps);
    } else {
      Serial.printf(
        "Camera cloud disconnected | WiFi=%s status=%d RSSI=%d dBm\n",
        WiFi.status() == WL_CONNECTED ? "connected" : "disconnected",
        WiFi.status(),
        WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : -100
      );
    }
  }
}
