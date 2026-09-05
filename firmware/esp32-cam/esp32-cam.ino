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
bool webSocketStarted = false;
bool runtimeServicesStarted = false;
bool cloudMotionMode = false;
enum class CameraWifiPhase : uint8_t {
  Idle,
  Ready,
  CandidateScheduled,
  ConnectingCandidate,
  Candidate,
  RollbackScheduled,
  ConnectingRollback,
  Failed
};

CameraWifiPhase cameraWifiPhase = CameraWifiPhase::Idle;
unsigned long wifiSwitchAt = 0;
unsigned long wifiSwitchStartedAt = 0;
unsigned long lastWifiSwitchRetryAt = 0;
const unsigned long WIFI_SWITCH_TIMEOUT_MS = 40000;
const unsigned long WIFI_SWITCH_RETRY_INTERVAL_MS = 8000;
const unsigned long WIFI_RECONNECT_GRACE_MS = 2000;
const unsigned long WIFI_RECONNECT_INTERVAL_MS = 10000;
unsigned long wifiDisconnectedAt = 0;
unsigned long lastWifiReconnectAttemptAt = 0;
unsigned long lastFrameAt = 0;
unsigned long lastCloudFrameSentAt = 0;
unsigned long cloudMotionUntil = 0;
unsigned long lastStatusAt = 0;
unsigned long lastCloudFrameErrorLogAt = 0;
unsigned long lastCameraRecoveryAt = 0;
uint8_t consecutiveFrameCaptureFailures = 0;
const unsigned long CAMERA_RECOVERY_INTERVAL_MS = 12000;
const uint8_t CAMERA_FRAME_FAILURE_LIMIT = 5;
const unsigned long CAMERA_SENSOR_RECONFIGURE_COOLDOWN_MS = 3000;
const unsigned long CLOUD_ADAPTIVE_COOLDOWN_MS = 1800;
uint32_t cloudFramesSent = 0;
uint32_t cloudFrameAcks = 0;
uint32_t cloudFrameAckTimeouts = 0;
uint32_t cloudStaleFrameAcks = 0;
uint32_t cloudFramesDropped = 0;
uint32_t cloudFramesRejected = 0;
uint32_t cameraFramesCaptured = 0;
uint32_t cloudFrameSequence = 0;
static const uint8_t CLOUD_PENDING_FRAME_SLOTS = 24;
uint32_t pendingCloudFrameIds[CLOUD_PENDING_FRAME_SLOTS] = {};
unsigned long pendingCloudFrameSentAt[CLOUD_PENDING_FRAME_SLOTS] = {};
uint32_t cloudFramesAtLastStatus = 0;
uint32_t cloudAcksAtLastStatus = 0;
uint32_t cameraFramesAtLastStatus = 0;
size_t lastCloudFrameBytes = 0;
unsigned long lastCloudFrameAckMs = 0;
unsigned long lastCloudFrameSendMs = 0;
uint8_t cloudJpegQuality = 17;
uint8_t stableCloudFrameCount = 0;
uint8_t pressuredCloudFrameCount = 0;
unsigned long cloudFrameIntervalMs = 90;
unsigned long cloudFrameIntervalMinMs = 90;
unsigned long cloudFrameIntervalMaxMs = 190;
unsigned long cloudFrameAckTimeoutMs = 1000;
uint8_t cloudMaxFramesInFlight = 2;
uint8_t cloudJpegQualityMin = 15;
uint8_t cloudJpegQualityMax = 26;
size_t cloudFrameTargetBytes = 32000;
unsigned long cloudFrameTargetAckMs = 300;
uint32_t cloudAcksAtLastTune = 0;
uint32_t cloudTimeoutsAtLastTune = 0;
uint32_t cloudDropsAtLastTune = 0;
uint32_t cloudRejectsAtLastTune = 0;
unsigned long lastCloudAdaptiveAt = 0;
int appliedCameraFrameSize = -1;
int appliedCameraJpegQuality = -1;
unsigned long lastCameraSensorReconfigureAt = 0;
String wifiTransactionCommandId = "";
String wifiCandidateSsid = "";
String wifiCandidatePass = "";
String wifiActiveSsid = "";
String wifiActivePass = "";
bool wifiFailureAckSent = false;
unsigned long wifiTransactionStartedAt = 0;
String vehicleUartBuffer = "";
bool uartProvisionReceived = false;
unsigned long uartProvisionRestartAt = 0;
bool vehicleConfigSyncReceived = false;
bool vehicleConfigSyncAvailable = false;
String vehicleConfigSyncRequestId = "";
String lastCommittedWifiCommandId = "";
String lastCommittedWifiSsid = "";
unsigned long lastVehicleUartStatusAt = 0;
unsigned long lastVehicleConfigRequestAt = 0;

String deviceName();
String streamUrl();
String controlUrlWithCamera();
void sendCloudFrame();
void serviceCameraRuntime();
void sendDeviceLog(const char *level, const String &message);
void sendCameraStreamStatus(float fps = 0.0f);
void tuneCloudJpegQuality();
void setCloudMotionMode(bool active);
void applyCloudStreamProfile(const char *profile, bool persist);
void processVehicleUart();
void sendVehicleUartStatus(bool force = false);
void setCameraFlash(bool enabled);
bool applyCameraSettingsIfChanged(
  framesize_t frameSize,
  uint8_t jpegQuality,
  bool forceFrameSize = false
);

void setCameraFlash(bool enabled) {
  flashOn = enabled;
  digitalWrite(FLASH_LED_PIN, flashOn ? HIGH : LOW);
  Serial.print("Camera flash synchronized: ");
  Serial.println(flashOn ? "ON" : "OFF");
}

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
  return FRAMESIZE_VGA;
}

framesize_t cloudMotionFrameSize() {
  if (!cameraHasPsram || strcmp(config.streamProfile, "realtime") == 0) {
    return FRAMESIZE_QVGA;
  }
  return FRAMESIZE_VGA;
}

const char *cameraFrameSizeName(framesize_t frameSize) {
  if (frameSize == FRAMESIZE_VGA) return "640x480";
  if (frameSize == FRAMESIZE_CIF) return "400x296";
  if (frameSize == FRAMESIZE_QVGA) return "320x240";
  return "other";
}

uint8_t cloudModeJpegQualityMin() {
  if (!cloudMotionMode) return cloudJpegQualityMin;
  if (strcmp(config.streamProfile, "quality") == 0) return 14;
  if (strcmp(config.streamProfile, "balanced") == 0) return 15;
  return cloudJpegQualityMin;
}

bool applyCameraSettingsIfChanged(
  framesize_t frameSize,
  uint8_t jpegQuality,
  bool forceFrameSize
) {
  if (!cameraSensor) return false;

  bool applied = false;
  const unsigned long now = millis();
  if (appliedCameraFrameSize != (int)frameSize) {
    const bool cooldownElapsed =
      lastCameraSensorReconfigureAt == 0 ||
      now - lastCameraSensorReconfigureAt >= CAMERA_SENSOR_RECONFIGURE_COOLDOWN_MS;
    if (forceFrameSize || cooldownElapsed) {
      if (cameraSensor->set_framesize(cameraSensor, frameSize) == 0) {
        appliedCameraFrameSize = (int)frameSize;
        lastCameraSensorReconfigureAt = now;
        applied = true;
      }
    }
  }

  if (appliedCameraJpegQuality != (int)jpegQuality) {
    if (cameraSensor->set_quality(cameraSensor, jpegQuality) == 0) {
      appliedCameraJpegQuality = jpegQuality;
      applied = true;
    }
  }
  return applied;
}

void applyCloudStreamProfile(const char *profile, bool persist) {
  const char *nextProfile = isValidCloudStreamProfile(profile) ? profile : "balanced";
  strlcpy(config.streamProfile, nextProfile, sizeof(config.streamProfile));

  if (strcmp(nextProfile, "realtime") == 0) {
    cloudFrameIntervalMs = 70;
    cloudFrameIntervalMinMs = 70;
    cloudFrameIntervalMaxMs = 170;
    cloudFrameAckTimeoutMs = 1500;
    cloudJpegQualityMin = 16;
    cloudJpegQualityMax = 24;
    cloudFrameTargetBytes = 22000;
    cloudFrameTargetAckMs = 220;
    cloudJpegQuality = min<uint8_t>(24, max<uint8_t>(18, cloudJpegQuality));
    cloudMaxFramesInFlight = 2;
  } else if (strcmp(nextProfile, "quality") == 0) {
    cloudFrameIntervalMs = 70;
    cloudFrameIntervalMinMs = 70;
    cloudFrameIntervalMaxMs = 200;
    cloudFrameAckTimeoutMs = 1800;
    cloudJpegQualityMin = 10;
    cloudJpegQualityMax = 20;
    cloudFrameTargetBytes = 50000;
    cloudFrameTargetAckMs = 220;
    cloudJpegQuality = 13;
    cloudMaxFramesInFlight = 2;
  } else {
    cloudFrameIntervalMs = 80;
    cloudFrameIntervalMinMs = 80;
    cloudFrameIntervalMaxMs = 190;
    cloudFrameAckTimeoutMs = 1800;
    cloudJpegQualityMin = 12;
    cloudJpegQualityMax = 20;
    cloudFrameTargetBytes = 42000;
    cloudFrameTargetAckMs = 250;
    cloudJpegQuality = 15;
    cloudMaxFramesInFlight = 2;
  }

  stableCloudFrameCount = 0;
  pressuredCloudFrameCount = 0;
  cloudMotionMode = false;
  cloudMotionUntil = 0;

  if (cameraSensor) {
    applyCameraSettingsIfChanged(
      cloudIdleFrameSize(),
      cloudJpegQuality,
      true
    );
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
    appliedCameraFrameSize = (int)cam.frame_size;
    appliedCameraJpegQuality = cam.jpeg_quality;
    applyCameraSettingsIfChanged(
      cloudIdleFrameSize(),
      cameraHasPsram ? cloudJpegQuality : 16,
      true
    );
    cameraSensor->set_vflip(cameraSensor, 0);
    cameraSensor->set_hmirror(cameraSensor, 0);
    cameraSensor->set_brightness(cameraSensor, 0);
    cameraSensor->set_contrast(cameraSensor, 1);
    cameraSensor->set_saturation(cameraSensor, 0);
    cameraSensor->set_sharpness(cameraSensor, 1);
  }

  Serial.println("Camera init OK");
  return true;
}

bool setupCameraWithRetry(uint8_t maxAttempts) {
  for (uint8_t attempt = 1; attempt <= maxAttempts; attempt++) {
    cameraSensor = nullptr;
    appliedCameraFrameSize = -1;
    appliedCameraJpegQuality = -1;
    if (attempt > 1) {
      esp_camera_deinit();
      delay(150);
    }

    pinMode(PWDN_GPIO_NUM, OUTPUT);
    digitalWrite(PWDN_GPIO_NUM, HIGH);
    delay(120);
    digitalWrite(PWDN_GPIO_NUM, LOW);
    delay(280);

    Serial.printf("Camera init attempt %u/%u\n", attempt, maxAttempts);
    if (setupCamera()) {
      consecutiveFrameCaptureFailures = 0;
      return true;
    }
    delay(700);
  }
  return false;
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
  cameraFramesCaptured++;

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
  client.setNoDelay(true);
  client.setTimeout(2000);
  String response = "HTTP/1.1 200 OK\r\n";
  response += "Access-Control-Allow-Origin: *\r\n";
  response += "Content-Type: multipart/x-mixed-replace; boundary=frame\r\n\r\n";
  client.print(response);

  // Local and cloud viewers share the active sensor profile.
  uint32_t localFrames = 0;
  unsigned long localStatsAt = millis();
  unsigned long localFrameAt = 0;

  while (client.connected()) {
    serviceCameraRuntime();
    if (cameraWifiSwitching() || uartProvisionReceived || WiFi.status() != WL_CONNECTED) break;
    if (!cameraReady) break;
    const unsigned long captureAt = millis();
    if (captureAt - localFrameAt < cloudFrameIntervalMs) {
      delay(1);
      continue;
    }
    localFrameAt = captureAt;
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
      delay(1);
      continue;
    }

    cameraFramesCaptured++;
    const size_t frameBytes = fb->len;
    const size_t headerBytes = client.printf(
      "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n",
      frameBytes
    );
    const size_t imageBytes = headerBytes > 0
      ? client.write(fb->buf, frameBytes)
      : 0;
    const size_t trailerBytes = imageBytes == frameBytes
      ? client.print("\r\n")
      : 0;
    esp_camera_fb_return(fb);

    if (imageBytes != frameBytes || trailerBytes == 0) break;
    localFrames++;

    const unsigned long now = millis();
    if (now - localStatsAt >= 3000) {
      const float localFps =
        (localFrames * 1000.0f) / (now - localStatsAt);
      Serial.printf(
        "Camera local | resolution=%s FPS=%.1f Q=%u RSSI=%d dBm\n",
        cameraFrameSizeName(cloudMotionMode ? cloudMotionFrameSize() : cloudIdleFrameSize()),
        localFps,
        cloudJpegQuality,
        WiFi.RSSI()
      );
      localFrames = 0;
      localStatsAt = now;
    }

    yield();
    delay(1);
  }

  client.stop();
  const framesize_t cloudFrameSize = cloudMotionMode
    ? cloudMotionFrameSize()
    : cloudIdleFrameSize();
  applyCameraSettingsIfChanged(cloudFrameSize, cloudJpegQuality, true);
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

void clearPersistedWifiCandidate() {
  prefs.begin("fpv-cam", false);
  prefs.remove("candidateSsid");
  prefs.remove("candidatePass");
  prefs.remove("candidateCmd");
  prefs.remove("candidateState");
  prefs.end();
}

void clearSavedWifiCredentials() {
  prefs.begin("fpv-cam", false);
  prefs.remove("wifiSsid");
  prefs.remove("wifiPass");
  prefs.end();
}

bool cameraWifiTransactionActive() {
  return cameraWifiPhase != CameraWifiPhase::Idle;
}

bool cameraWifiSwitching() {
  return
    cameraWifiPhase == CameraWifiPhase::Ready ||
    cameraWifiPhase == CameraWifiPhase::CandidateScheduled ||
    cameraWifiPhase == CameraWifiPhase::ConnectingCandidate ||
    cameraWifiPhase == CameraWifiPhase::RollbackScheduled ||
    cameraWifiPhase == CameraWifiPhase::ConnectingRollback;
}

void clearWifiTransaction() {
  cameraWifiPhase = CameraWifiPhase::Idle;
  wifiTransactionCommandId = "";
  wifiCandidateSsid = "";
  wifiCandidatePass = "";
  wifiActiveSsid = "";
  wifiActivePass = "";
  wifiFailureAckSent = false;
  wifiTransactionStartedAt = 0;
  wifiSwitchAt = 0;
  wifiSwitchStartedAt = 0;
  lastWifiSwitchRetryAt = 0;
  clearPersistedWifiCandidate();
}

void sendVehicleUartDocument(JsonDocument &doc) {
  serializeJson(doc, vehicleUart);
  vehicleUart.write('\n');
  vehicleUart.flush();
}

const char *cameraWifiStateName() {
  switch (cameraWifiPhase) {
    case CameraWifiPhase::Ready:
      return "ready";
    case CameraWifiPhase::CandidateScheduled:
    case CameraWifiPhase::ConnectingCandidate:
      return "switching";
    case CameraWifiPhase::Candidate:
      return "candidate";
    case CameraWifiPhase::RollbackScheduled:
    case CameraWifiPhase::ConnectingRollback:
      return "rollback";
    case CameraWifiPhase::Failed:
      return "failed";
    case CameraWifiPhase::Idle:
    default:
      return "idle";
  }
}

void sendVehicleUartStatus(bool force) {
  unsigned long now = millis();
  if (!force && now - lastVehicleUartStatusAt < 1500) return;
  lastVehicleUartStatusAt = now;

  JsonDocument doc;
  doc["type"] = "camera_status";
  doc["wifiConnected"] = WiFi.isConnected();
  doc["cloudConnected"] = wsConnected;
  doc["cameraReady"] = cameraReady;
  doc["streamActive"] =
    cameraReady &&
    wsConnected &&
    lastCloudFrameSentAt > 0 &&
    now - lastCloudFrameSentAt < 5000;
  doc["rssi"] = WiFi.isConnected() ? WiFi.RSSI() : -100;
  doc["ssid"] = WiFi.isConnected() ? WiFi.SSID() : "";
  doc["wifiState"] = cameraWifiStateName();
  doc["targetSsid"] = wifiCandidateSsid;
  doc["flashOn"] = flashOn;
  sendVehicleUartDocument(doc);
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
  doc["protocol"] = 2;
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
  if (!doc["lightOn"].isNull()) {
    setCameraFlash(doc["lightOn"].as<bool>());
  }
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

void sendVehicleConfigSyncAck(bool ok, bool changed, const String &message) {
  JsonDocument ack;
  ack["type"] = "config_sync_ack";
  ack["requestId"] = vehicleConfigSyncRequestId;
  ack["ok"] = ok;
  ack["changed"] = changed;
  ack["hasConfig"] = vehicleConfigSyncAvailable;
  ack["ssid"] = vehicleConfigSyncAvailable ? String(config.wifiSsid) : "";
  ack["message"] = message;
  sendVehicleUartDocument(ack);
}

bool applyVehicleConfigSync(JsonDocument &doc) {
  String requestId = doc["requestId"] | "";
  if (
    requestId.length() == 0 ||
    requestId != vehicleConfigSyncRequestId
  ) {
    return false;
  }

  const bool hasConfig = doc["hasConfig"] | false;
  String ssid = doc["ssid"] | "";
  if (hasConfig && ssid.length() == 0) {
    sendVehicleConfigSyncAck(false, false, "vehicle sync omitted WiFi SSID");
    return false;
  }

  if (!doc["lightOn"].isNull()) {
    setCameraFlash(doc["lightOn"].as<bool>());
  }

  bool changed = false;
  if (!hasConfig) {
    changed = strlen(config.wifiSsid) > 0 || strlen(config.wifiPass) > 0;
    config.wifiSsid[0] = '\0';
    config.wifiPass[0] = '\0';
  } else {
    const char *password = doc["password"] | "";
    const char *wsScheme = doc["wsScheme"] | config.wsScheme;
    const char *wsHost = doc["wsHost"] | config.wsHost;
    const char *wsPort = doc["wsPort"] | config.wsPort;
    const char *wsPath = doc["wsPath"] | config.wsPath;
    const char *vehicleId = doc["vehicleId"] | config.vehicleId;
    const char *authToken = doc["authToken"] | config.authToken;
    const char *controlUrl = doc["controlUrl"] | config.controlUrl;

    changed =
      String(config.wifiSsid) != ssid ||
      strcmp(config.wifiPass, password) != 0 ||
      strcmp(config.wsScheme, wsScheme) != 0 ||
      strcmp(config.wsHost, wsHost) != 0 ||
      strcmp(config.wsPort, wsPort) != 0 ||
      strcmp(config.wsPath, wsPath) != 0 ||
      strcmp(config.vehicleId, vehicleId) != 0 ||
      strcmp(config.authToken, authToken) != 0 ||
      strcmp(config.controlUrl, controlUrl) != 0;

    strlcpy(config.wifiSsid, ssid.c_str(), sizeof(config.wifiSsid));
    strlcpy(config.wifiPass, password, sizeof(config.wifiPass));
    strlcpy(config.wsScheme, wsScheme, sizeof(config.wsScheme));
    strlcpy(config.wsHost, wsHost, sizeof(config.wsHost));
    strlcpy(config.wsPort, wsPort, sizeof(config.wsPort));
    strlcpy(config.wsPath, wsPath, sizeof(config.wsPath));
    strlcpy(config.vehicleId, vehicleId, sizeof(config.vehicleId));
    strlcpy(config.authToken, authToken, sizeof(config.authToken));
    strlcpy(config.controlUrl, controlUrl, sizeof(config.controlUrl));
  }

  vehicleConfigSyncAvailable = hasConfig;
  vehicleConfigSyncReceived = true;
  if (changed) saveConfig();
  sendVehicleConfigSyncAck(
    true,
    changed,
    hasConfig ? "camera synchronized vehicle configuration" : "camera cleared stale WiFi cache"
  );
  Serial.print("Vehicle configuration sync received: ");
  Serial.println(hasConfig ? config.wifiSsid : "no saved WiFi");
  return true;
}

void handleVehicleWifiAction(JsonDocument &doc) {
  String action = doc["action"] | "";
  String commandId = doc["commandId"] | "";
  const int protocol = doc["protocol"] | 0;
  if (commandId.length() == 0) return;

  Serial.printf(
    "Vehicle WiFi UART action: action=%s command=%s protocol=%d\n",
    action.c_str(),
    commandId.c_str(),
    protocol
  );

  if (action == "reset") {
    clearWifiTransaction();
    prefs.begin("fpv-cam", false);
    prefs.remove("wifiSsid");
    prefs.remove("wifiPass");
    prefs.remove("candidateSsid");
    prefs.remove("candidatePass");
    prefs.remove("candidateCmd");
    prefs.remove("candidateState");
    prefs.end();
    sendVehicleWifiAck(commandId, "reset", true, "", "camera WiFi cleared");
    Serial.println("Camera WiFi cleared by vehicle UART. Restarting...");
    delay(200);
    ESP.restart();
    return;
  }

  if (protocol != 2) {
    sendVehicleWifiAck(
      commandId,
      "failed",
      false,
      "",
      "unsupported WiFi protocol"
    );
    return;
  }

  if (action == "replace") {
    String ssid = doc["ssid"] | "";
    if (ssid.length() == 0) {
      sendVehicleWifiAck(commandId, "failed", false, "", "missing WiFi SSID");
      return;
    }

    if (
      cameraWifiTransactionActive() &&
      wifiTransactionCommandId == commandId &&
      wifiCandidateSsid == ssid
    ) {
      sendVehicleWifiAck(
        commandId,
        "ready",
        true,
        ssid,
        "camera already accepted candidate"
      );
      return;
    }

    clearWifiTransaction();
    wifiTransactionCommandId = commandId;
    wifiCandidateSsid = ssid;
    wifiCandidatePass = String(doc["password"] | "");
    wifiActiveSsid = config.wifiSsid;
    wifiActivePass = config.wifiPass;
    clearSavedWifiCredentials();
    const unsigned long delayMs = constrain(
      (unsigned long)(doc["delayMs"] | 3000),
      1500UL,
      6000UL
    );
    cameraWifiPhase = CameraWifiPhase::CandidateScheduled;
    wifiSwitchAt = millis() + delayMs;
    wifiTransactionStartedAt = millis();
    sendVehicleWifiAck(
      commandId,
      "ready",
      true,
      ssid,
      "camera accepted candidate and scheduled WiFi switch"
    );
    Serial.print("Camera candidate received from vehicle: ");
    Serial.println(ssid);
    Serial.printf("Camera WiFi switch scheduled in %lu ms.\n", delayMs);
    return;
  }

  if (action == "rollback") {
    String ssid = doc["ssid"] | "";
    if (ssid.length() == 0) {
      sendVehicleWifiAck(
        commandId,
        "failed",
        false,
        "",
        "rollback omitted previous WiFi"
      );
      return;
    }

    wifiTransactionCommandId = commandId;
    wifiActiveSsid = ssid;
    wifiActivePass = String(doc["password"] | "");
    strlcpy(config.wifiSsid, wifiActiveSsid.c_str(), sizeof(config.wifiSsid));
    strlcpy(config.wifiPass, wifiActivePass.c_str(), sizeof(config.wifiPass));
    saveConfig();

    if (
      WiFi.status() == WL_CONNECTED &&
      WiFi.SSID() == wifiActiveSsid
    ) {
      sendVehicleWifiAck(
        commandId,
        "rolled_back",
        true,
        wifiActiveSsid,
        "camera already uses previous WiFi"
      );
      clearWifiTransaction();
      return;
    }

    unsigned long delayMs =
      constrain((unsigned long)(doc["delayMs"] | 3000), 500UL, 5000UL);
    cameraWifiPhase = CameraWifiPhase::RollbackScheduled;
    wifiSwitchAt = millis() + delayMs;
    wifiTransactionStartedAt = millis();
    sendVehicleWifiAck(
      commandId,
      "rollback",
      true,
      wifiActiveSsid,
      "camera rollback scheduled"
    );
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

  if (
    !cameraWifiTransactionActive() ||
    commandId != wifiTransactionCommandId
  ) {
    sendVehicleWifiAck(
      commandId,
      "failed",
      false,
      "",
      "camera has no matching WiFi transaction"
    );
    return;
  }

  if (action == "switch") {
    if (
      cameraWifiPhase == CameraWifiPhase::CandidateScheduled ||
      cameraWifiPhase == CameraWifiPhase::ConnectingCandidate ||
      cameraWifiPhase == CameraWifiPhase::Candidate
    ) {
      sendVehicleWifiAck(
        commandId,
        "switching",
        true,
        wifiCandidateSsid,
        "camera switch already active"
      );
      return;
    }
    if (cameraWifiPhase != CameraWifiPhase::Ready) {
      sendVehicleWifiAck(
        commandId,
        "failed",
        false,
        wifiCandidateSsid,
        "camera candidate is not ready"
      );
      return;
    }

    unsigned long delayMs =
      constrain((unsigned long)(doc["delayMs"] | 3000), 500UL, 5000UL);
    cameraWifiPhase = CameraWifiPhase::CandidateScheduled;
    wifiSwitchAt = millis() + delayMs;
    wifiTransactionStartedAt = millis();
    sendVehicleWifiAck(
      commandId,
      "switching",
      true,
      wifiCandidateSsid,
      "camera switch scheduled"
    );
  } else if (action == "commit") {
    if (
      cameraWifiPhase != CameraWifiPhase::Candidate ||
      WiFi.status() != WL_CONNECTED ||
      WiFi.SSID() != wifiCandidateSsid
    ) {
      sendVehicleWifiAck(
        commandId,
        "failed",
        false,
        wifiCandidateSsid,
        "camera has not verified candidate WiFi"
      );
      return;
    }

    strlcpy(config.wifiSsid, wifiCandidateSsid.c_str(), sizeof(config.wifiSsid));
    strlcpy(config.wifiPass, wifiCandidatePass.c_str(), sizeof(config.wifiPass));
    saveConfig();
    lastCommittedWifiCommandId = commandId;
    lastCommittedWifiSsid = wifiCandidateSsid;
    sendVehicleWifiAck(
      commandId,
      "committed",
      true,
      wifiCandidateSsid,
      "camera committed candidate WiFi"
    );
    clearWifiTransaction();
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
  } else if (strcmp(type, "config_sync") == 0) {
    applyVehicleConfigSync(doc);
  } else if (strcmp(type, "wifi_action") == 0) {
    handleVehicleWifiAction(doc);
  } else if (strcmp(type, "light_state") == 0) {
    setCameraFlash(doc["on"] | false);
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

void requestVehicleConfigSync() {
  JsonDocument doc;
  doc["type"] = "config_request";
  doc["requestId"] = vehicleConfigSyncRequestId;
  doc["cachedSsid"] = config.wifiSsid;
  sendVehicleUartDocument(doc);
}

void syncConfigFromVehicle(unsigned long timeoutMs) {
  const uint32_t chipSuffix = (uint32_t)(ESP.getEfuseMac() & 0xFFFFFF);
  vehicleConfigSyncRequestId =
    String("boot-") + String(chipSuffix, HEX) + "-" + String(millis());
  vehicleConfigSyncReceived = false;
  vehicleConfigSyncAvailable = false;

  Serial.println("Requesting authoritative configuration from vehicle UART...");
  const unsigned long startedAt = millis();
  unsigned long lastRequestAt = 0;
  while (
    !vehicleConfigSyncReceived &&
    millis() - startedAt < timeoutMs
  ) {
    if (lastRequestAt == 0 || millis() - lastRequestAt >= 500) {
      requestVehicleConfigSync();
      lastRequestAt = millis();
    }
    processVehicleUart();
    delay(10);
  }

  if (!vehicleConfigSyncReceived) {
    config.wifiSsid[0] = '\0';
    config.wifiPass[0] = '\0';
    clearSavedWifiCredentials();
    Serial.println("Vehicle config sync unavailable; waiting for vehicle UART.");
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
  if (!cameraHasPsram || cloudMotionMode == active) return;

  cloudMotionMode = active;
  const framesize_t nextFrameSize = cloudMotionMode
    ? cloudMotionFrameSize()
    : cloudIdleFrameSize();
  stableCloudFrameCount = 0;
  pressuredCloudFrameCount = 0;

  const uint8_t modeQualityMin = cloudModeJpegQualityMin();
  if (cloudJpegQuality < modeQualityMin) {
    cloudJpegQuality = modeQualityMin;
  }
  if (cameraSensor) {
    applyCameraSettingsIfChanged(nextFrameSize, cloudJpegQuality);
  }

  Serial.printf(
    "Camera %s mode (%s profile)\n",
    cloudMotionMode ? "motion" : "idle",
    config.streamProfile
  );
}

void tuneCloudJpegQuality() {
  if (!cameraHasPsram || !cameraSensor) return;

  const bool ackAdvanced = cloudFrameAcks != cloudAcksAtLastTune;
  const bool timeoutAdvanced =
    cloudFrameAckTimeouts != cloudTimeoutsAtLastTune;
  const bool dropAdvanced = cloudFramesDropped != cloudDropsAtLastTune;
  const bool rejectAdvanced = cloudFramesRejected != cloudRejectsAtLastTune;
  if (!ackAdvanced && !timeoutAdvanced && !dropAdvanced && !rejectAdvanced) {
    return;
  }

  cloudAcksAtLastTune = cloudFrameAcks;
  cloudTimeoutsAtLastTune = cloudFrameAckTimeouts;
  cloudDropsAtLastTune = cloudFramesDropped;
  cloudRejectsAtLastTune = cloudFramesRejected;

  const uint8_t pendingFrames = pendingCloudFrameAckCount();
  const bool veryBad =
    timeoutAdvanced ||
    lastCloudFrameAckMs > 300 ||
    lastCloudFrameSendMs > 250;
  const bool overloaded =
    veryBad ||
    dropAdvanced ||
    rejectAdvanced ||
    lastCloudFrameBytes > cloudFrameTargetBytes ||
    lastCloudFrameAckMs > cloudFrameTargetAckMs ||
    lastCloudFrameSendMs > 120 ||
    pendingFrames >= cloudMaxFramesInFlight;
  const bool stable =
    ackAdvanced &&
    !overloaded &&
    lastCloudFrameAckMs > 0 &&
    lastCloudFrameAckMs < 120 &&
    lastCloudFrameBytes < cloudFrameTargetBytes * 4 / 5 &&
    lastCloudFrameSendMs < 80 &&
    pendingFrames < cloudMaxFramesInFlight;

  if (overloaded) {
    stableCloudFrameCount = 0;
    pressuredCloudFrameCount = min<uint8_t>(
      20,
      pressuredCloudFrameCount + (veryBad || rejectAdvanced ? 2 : 1)
    );
  } else if (stable) {
    if (pressuredCloudFrameCount > 0) pressuredCloudFrameCount--;
    stableCloudFrameCount = min<uint8_t>(20, stableCloudFrameCount + 1);
  } else {
    stableCloudFrameCount = 0;
    pressuredCloudFrameCount = 0;
  }

  const unsigned long now = millis();
  if (
    lastCloudAdaptiveAt != 0 &&
    now - lastCloudAdaptiveAt < CLOUD_ADAPTIVE_COOLDOWN_MS
  ) {
    return;
  }

  uint8_t nextQuality = cloudJpegQuality;
  unsigned long nextInterval = cloudFrameIntervalMs;
  if (pressuredCloudFrameCount >= 3) {
    pressuredCloudFrameCount = 0;
    if (cloudFrameIntervalMs < cloudFrameIntervalMinMs + 30) {
      nextInterval = min(
        cloudFrameIntervalMaxMs,
        cloudFrameIntervalMs + (veryBad ? 15UL : 10UL)
      );
    } else if (cloudJpegQuality < cloudJpegQualityMax) {
      nextQuality = cloudJpegQuality + 1;
    } else if (cloudFrameIntervalMs < cloudFrameIntervalMaxMs) {
      nextInterval = min(cloudFrameIntervalMaxMs, cloudFrameIntervalMs + 15UL);
    }
  } else if (stableCloudFrameCount >= 12) {
    stableCloudFrameCount = 0;
    const uint8_t qualityFloor = cloudModeJpegQualityMin();
    if (cloudJpegQuality > qualityFloor) {
      nextQuality = cloudJpegQuality - 1;
    } else if (cloudFrameIntervalMs > cloudFrameIntervalMinMs) {
      nextInterval = max(
        cloudFrameIntervalMinMs,
        cloudFrameIntervalMs - 5UL
      );
    }
  }

  if (
    nextQuality == cloudJpegQuality &&
    nextInterval == cloudFrameIntervalMs
  ) {
    return;
  }

  cloudJpegQuality = nextQuality;
  cloudFrameIntervalMs = nextInterval;
  lastCloudAdaptiveAt = now;
  if (cameraSensor) {
    const framesize_t frameSize = cloudMotionMode
      ? cloudMotionFrameSize()
      : cloudIdleFrameSize();
    applyCameraSettingsIfChanged(frameSize, cloudJpegQuality);
  }
  Serial.printf(
    "Camera adaptive | interval=%lu ms Q=%u pressure=%u stable=%u\n",
    cloudFrameIntervalMs,
    cloudJpegQuality,
    pressuredCloudFrameCount,
    stableCloudFrameCount
  );
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
  bool expired = false;
  for (uint8_t index = 0; index < CLOUD_PENDING_FRAME_SLOTS; index++) {
    if (
      pendingCloudFrameIds[index] != 0 &&
      now - pendingCloudFrameSentAt[index] >= cloudFrameAckTimeoutMs
    ) {
      pendingCloudFrameIds[index] = 0;
      pendingCloudFrameSentAt[index] = 0;
      cloudFrameAckTimeouts++;
      expired = true;
    }
  }
  if (expired) tuneCloudJpegQuality();
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
  if (cameraWifiSwitching()) return;

  const unsigned long now = millis();
  expirePendingCloudFrameAcks(now);
  if (now - lastFrameAt < cloudFrameIntervalMs) return;
  lastFrameAt = now;
  // Skip this capture slot when the small ACK window is full. There is no
  // JPEG queue, so the next available slot always captures the newest frame.
  if (pendingCloudFrameAckCount() >= cloudMaxFramesInFlight) {
    cloudFramesDropped++;
    tuneCloudJpegQuality();
    return;
  }

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    consecutiveFrameCaptureFailures++;
    Serial.println("Cloud frame skipped: frame buffer unavailable");
    sendCloudFrameErrorLog("Cloud frame skipped: frame buffer unavailable");
    if (consecutiveFrameCaptureFailures >= CAMERA_FRAME_FAILURE_LIMIT) {
      Serial.println("Camera frame buffer stalled. Scheduling camera recovery...");
      sendDeviceLog("error", "Camera frame buffer stalled; starting recovery");
      cameraReady = false;
      cameraSensor = nullptr;
      appliedCameraFrameSize = -1;
      appliedCameraJpegQuality = -1;
      esp_camera_deinit();
      lastCameraRecoveryAt = 0;
      consecutiveFrameCaptureFailures = 0;
    }
    return;
  }
  consecutiveFrameCaptureFailures = 0;
  cameraFramesCaptured++;

  const size_t frameBytes = fb->len;
  const uint32_t frameId = cloudFrameSequence + 1;
  const unsigned long sendStartedAt = millis();
  const bool sent = webSocket.sendBIN(fb->buf, frameBytes);
  lastCloudFrameSendMs = millis() - sendStartedAt;
  esp_camera_fb_return(fb);

  if (sent) {
    cloudFrameSequence = frameId;
    trackPendingCloudFrameAck(frameId, millis());
    lastCloudFrameSentAt = millis();
    lastCloudFrameBytes = frameBytes;
    cloudFramesSent++;
  } else {
    cloudFramesDropped++;
    tuneCloudJpegQuality();
    sendCloudFrameErrorLog("Cloud frame skipped: WebSocket send failed");
  }
}

void onWebSocketEvent(WStype_t type, uint8_t *payload, size_t length) {
  if (type == WStype_CONNECTED) {
    wsConnected = true;
    lastCloudFrameSentAt = 0;
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
      if (doc["accepted"] | false) {
        cloudFrameAcks++;
        tuneCloudJpegQuality();
      } else {
        const char *reason = doc["reason"] | "";
        if (
          strcmp(reason, "frame_interval") == 0 ||
          strcmp(reason, "frame_too_large") == 0 ||
          strcmp(reason, "invalid_jpeg") == 0
        ) {
          cloudFramesRejected++;
          tuneCloudJpegQuality();
        }
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
      if (strcmp(action, "NETWORK_RECONNECT") == 0) {
        WiFi.reconnect();
      } else if (strcmp(action, "WIFI_PORTAL_OPEN") == 0) {
        sendDeviceLog("info", "Camera is waiting for vehicle UART WiFi reset");
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
  webSocketStarted = true;
}

void resetCloudConnectionForWifiChange() {
  if (!webSocketStarted && !wsConnected) return;
  Serial.println("Resetting camera WebSocket for WiFi change...");
  webSocket.disconnect();
  webSocketStarted = false;
  wsConnected = false;
  clearPendingCloudFrameAcks();
}

void setupRoutes() {
  server.on("/", handleRoot);
  server.on("/control", sendRedirectToControl);
  server.on("/capture", handleCapture);
  server.on("/stream", handleStream);
  server.on("/flash", []() {
    setCameraFlash(!flashOn);
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
  resetCloudConnectionForWifiChange();
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
    sendVehicleUartStatus();
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
    if (
      strlen(config.wifiSsid) > 0 &&
      WiFi.SSID() != String(config.wifiSsid)
    ) {
      Serial.print("ESP32-CAM connected to unexpected SSID: ");
      Serial.print(WiFi.SSID());
      Serial.print("; selecting configured SSID: ");
      Serial.println(config.wifiSsid);
      lastWifiReconnectAttemptAt = now;
      beginStaConnection(config.wifiSsid, config.wifiPass, true);
      return;
    }
    if (wifiDisconnectedAt != 0) {
      Serial.print("ESP32-CAM WiFi restored: ");
      Serial.print(WiFi.SSID());
      Serial.print(" IP=");
      Serial.println(WiFi.localIP());
    }
    wifiDisconnectedAt = 0;
    lastWifiReconnectAttemptAt = 0;
    if (runtimeServicesStarted && !webSocketStarted) {
      Serial.println("WiFi restored. Restarting camera WebSocket...");
      setupWebSocket();
    }
    return;
  }

  if (cameraWifiSwitching() || strlen(config.wifiSsid) == 0) {
    return;
  }

  if (wifiDisconnectedAt == 0) {
    wifiDisconnectedAt = now;
    Serial.printf("ESP32-CAM WiFi lost (status=%d). Starting recovery...\n", WiFi.status());
  }

  if (now - wifiDisconnectedAt < WIFI_RECONNECT_GRACE_MS) return;

  if (lastWifiReconnectAttemptAt != 0 &&
      now - lastWifiReconnectAttemptAt < WIFI_RECONNECT_INTERVAL_MS) {
    return;
  }

  lastWifiReconnectAttemptAt = now;
  Serial.print("Retrying saved WiFi: ");
  Serial.println(config.wifiSsid);
  beginStaConnection(config.wifiSsid, config.wifiPass, true);
}

void maintainCamera(unsigned long now) {
  if (
    cameraReady ||
    WiFi.status() != WL_CONNECTED ||
    cameraWifiSwitching() ||
    (lastCameraRecoveryAt > 0 && now - lastCameraRecoveryAt < CAMERA_RECOVERY_INTERVAL_MS)
  ) {
    return;
  }

  lastCameraRecoveryAt = now;
  Serial.println("Camera is not ready. Starting automatic recovery...");
  cameraReady = setupCameraWithRetry(2);
  if (cameraReady) {
    Serial.println("Camera automatic recovery succeeded.");
    sendDeviceLog("info", "Camera recovered without reboot");
    sendCameraStreamStatus();
    sendVehicleUartStatus(true);
  } else {
    Serial.println("Camera automatic recovery failed; retrying later.");
    sendDeviceLog("error", "Camera recovery failed; retry scheduled");
  }
}

void setupWiFiManager() {
  if (connectToConfiguredWiFi(18000)) return;

  Serial.println("Saved WiFi unavailable. Continuing in offline recovery mode.");
  Serial.println("Camera will keep retrying WiFi and accepting vehicle UART commands.");
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
  sendVehicleUartStatus(true);
  clearPersistedWifiCandidate();
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(false);
  WiFi.disconnect(false, true);
  delay(50);
  Serial.print("ESP32-CAM WiFi MAC: ");
  Serial.println(WiFi.macAddress());
  if (!isValidCloudStreamProfile(config.streamProfile)) {
    strlcpy(config.streamProfile, "balanced", sizeof(config.streamProfile));
  }
  syncConfigFromVehicle(8000);
  setupWiFiManager();
  cameraReady = setupCameraWithRetry(3);
  lastCameraRecoveryAt = millis();
  setupRoutes();
  setupWebSocket();
  runtimeServicesStarted = true;
  printCameraConfig();
  Serial.println(cameraReady ? "ESP32-CAM ready" : "ESP32-CAM web server ready, camera failed");
}

void serviceCameraRuntime() {
  processVehicleUart();
  sendVehicleUartStatus();
  webSocket.loop();

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

  if (
    !vehicleConfigSyncReceived &&
    vehicleConfigSyncRequestId.length() > 0 &&
    now - lastVehicleConfigRequestAt >= 1000
  ) {
    lastVehicleConfigRequestAt = now;
    requestVehicleConfigSync();
  }

  if (
    (
      cameraWifiPhase == CameraWifiPhase::CandidateScheduled ||
      cameraWifiPhase == CameraWifiPhase::RollbackScheduled
    ) &&
    (long)(now - wifiSwitchAt) >= 0
  ) {
    const bool rollingBack =
      cameraWifiPhase == CameraWifiPhase::RollbackScheduled;
    if (!rollingBack) {
      strlcpy(
        config.wifiSsid,
        wifiCandidateSsid.c_str(),
        sizeof(config.wifiSsid)
      );
      strlcpy(
        config.wifiPass,
        wifiCandidatePass.c_str(),
        sizeof(config.wifiPass)
      );
      cameraWifiPhase = CameraWifiPhase::ConnectingCandidate;
    } else {
      cameraWifiPhase = CameraWifiPhase::ConnectingRollback;
    }

    wifiSwitchStartedAt = now;
    lastWifiSwitchRetryAt = now;
    resetCloudConnectionForWifiChange();
    Serial.print("Switching ESP32-CAM WiFi to: ");
    Serial.println(config.wifiSsid);
    beginStaConnection(config.wifiSsid, config.wifiPass, true);
  }

  maintainWiFiConnection(now);
  maintainCamera(now);
  sendCloudFrame();

  const bool connectingCandidate =
    cameraWifiPhase == CameraWifiPhase::ConnectingCandidate;
  const bool connectingRollback =
    cameraWifiPhase == CameraWifiPhase::ConnectingRollback;
  if (connectingCandidate || connectingRollback) {
    const bool targetConnected =
      WiFi.status() == WL_CONNECTED &&
      WiFi.SSID() == String(config.wifiSsid);

    if (targetConnected) {
      if (connectingCandidate) {
        cameraWifiPhase = CameraWifiPhase::Candidate;
        wifiTransactionStartedAt = now;
        wifiFailureAckSent = false;
        Serial.println("ESP32-CAM joined candidate WiFi.");
      } else {
        sendVehicleWifiAck(
          wifiTransactionCommandId,
          "rolled_back",
          true,
          wifiActiveSsid,
          "camera restored previous WiFi"
        );
        clearWifiTransaction();
      }
      sendVehicleUartStatus(true);
    } else if (now - wifiSwitchStartedAt > WIFI_SWITCH_TIMEOUT_MS) {
      if (connectingCandidate) {
        cameraWifiPhase = CameraWifiPhase::Failed;
        if (!wifiFailureAckSent) {
          wifiFailureAckSent = true;
          sendVehicleWifiAck(
            wifiTransactionCommandId,
            "failed",
            false,
            wifiCandidateSsid,
            "camera could not join selected WiFi"
          );
        }
      } else {
        Serial.println("Camera could not restore previous WiFi. Restarting...");
        ESP.restart();
      }
    } else if (
      now - lastWifiSwitchRetryAt >= WIFI_SWITCH_RETRY_INTERVAL_MS
    ) {
      lastWifiSwitchRetryAt = now;
      Serial.print("Retrying camera WiFi: ");
      Serial.println(config.wifiSsid);
      beginStaConnection(config.wifiSsid, config.wifiPass, true);
    }
  }

  if (
    cameraWifiPhase == CameraWifiPhase::Failed &&
    WiFi.status() == WL_CONNECTED &&
    WiFi.SSID() == wifiCandidateSsid
  ) {
    cameraWifiPhase = CameraWifiPhase::Candidate;
    wifiFailureAckSent = false;
    sendVehicleUartStatus(true);
  }
  if (cloudMotionMode && (long)(now - cloudMotionUntil) >= 0) {
    setCloudMotionMode(false);
  }

  if (now - lastStatusAt > 3000) {
    const unsigned long statusElapsedMs = lastStatusAt == 0 ? 3000 : now - lastStatusAt;
    const uint32_t framesSinceStatus = cloudFramesSent - cloudFramesAtLastStatus;
    const uint32_t acksSinceStatus = cloudFrameAcks - cloudAcksAtLastStatus;
    const uint32_t capturesSinceStatus =
      cameraFramesCaptured - cameraFramesAtLastStatus;
    const float cloudFps = statusElapsedMs > 0
      ? (framesSinceStatus * 1000.0f) / statusElapsedMs
      : 0.0f;
    const float ackFps = statusElapsedMs > 0
      ? (acksSinceStatus * 1000.0f) / statusElapsedMs
      : 0.0f;
    const float captureFps = statusElapsedMs > 0
      ? (capturesSinceStatus * 1000.0f) / statusElapsedMs
      : 0.0f;
    lastStatusAt = now;
    cloudFramesAtLastStatus = cloudFramesSent;
    cloudAcksAtLastStatus = cloudFrameAcks;
    cameraFramesAtLastStatus = cameraFramesCaptured;
    if (wsConnected) {
      const framesize_t activeFrameSize = cloudMotionMode
        ? cloudMotionFrameSize()
        : cloudIdleFrameSize();
      Serial.printf(
        "Camera online | mode=%s resolution=%s capture=%.1f FPS cloud=%.1f FPS ack=%.1f FPS RTT=%lu ms send=%lu ms JPEG=%.1f KB Q=%u interval=%lu ms RSSI=%d dBm pending=%u/%u drop=%lu reject=%lu timeout=%lu staleAck=%lu profile=%s\n",
        cloudMotionMode ? "motion" : "idle",
        cameraFrameSizeName(activeFrameSize),
        captureFps,
        cloudFps,
        ackFps,
        lastCloudFrameAckMs,
        lastCloudFrameSendMs,
        lastCloudFrameBytes / 1024.0f,
        cloudJpegQuality,
        cloudFrameIntervalMs,
        WiFi.RSSI(),
        pendingCloudFrameAckCount(),
        cloudMaxFramesInFlight,
        (unsigned long)cloudFramesDropped,
        (unsigned long)cloudFramesRejected,
        (unsigned long)cloudFrameAckTimeouts,
        (unsigned long)cloudStaleFrameAcks,
        config.streamProfile
      );
      sendCameraStreamStatus(cloudFps);
      // Keep remote diagnostics sparse so logging does not compete with JPEGs.
      static unsigned long lastRemoteLogAt = 0;
      if (lastRemoteLogAt == 0 || now - lastRemoteLogAt >= 10000) {
        lastRemoteLogAt = now;
        char diagnostic[240];
        snprintf(diagnostic, sizeof(diagnostic),
          "Camera FPS capture=%.1f sent=%.1f ack=%.1f RTT=%lu send=%lu ms JPEG=%lu B Q=%u RSSI=%d pending=%u/%u drop=%lu reject=%lu timeout=%lu staleAck=%lu",
          captureFps, cloudFps, ackFps, lastCloudFrameAckMs,
          lastCloudFrameSendMs, (unsigned long)lastCloudFrameBytes,
          cloudJpegQuality, WiFi.RSSI(), pendingCloudFrameAckCount(),
          cloudMaxFramesInFlight, (unsigned long)cloudFramesDropped,
          (unsigned long)cloudFramesRejected, (unsigned long)cloudFrameAckTimeouts,
          (unsigned long)cloudStaleFrameAcks);
        sendDeviceLog("info", diagnostic);
      }
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

void loop() {
  serviceCameraRuntime();
  server.handleClient();
}
