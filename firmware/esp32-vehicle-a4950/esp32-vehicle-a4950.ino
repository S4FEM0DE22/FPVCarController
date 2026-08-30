#include <Arduino.h>
#include <ArduinoJson.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <DNSServer.h>
#include <ESP32Servo.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <Wire.h>
#include <math.h>

// Required libraries:
// - ArduinoJson by Benoit Blanchon
// - WebSockets by Markus Sattler
// - ESP32Servo by Kevin Harrington / John K. Bennett
// - Adafruit GFX Library
// - Adafruit SSD1306

// Massmore A4950 dual-channel pin map. Each channel uses two logic inputs;
// PWM is applied to the active direction input.
static const int PIN_AIN1 = 26;
static const int PIN_AIN2 = 27;
static const int PIN_BIN1 = 14;
static const int PIN_BIN2 = 12;
static const char *MOTOR_DRIVER_NAME = "A4950";

static const int PIN_SERVO_PAN = 18;
static const int PIN_SERVO_TILT = 19;
static const int PIN_LIGHT = 2;
static const int PIN_BUZZER = 4;
static const unsigned long BUZZER_DURATION_MS = 300;
static const int PIN_BATTERY_ADC = 34;
static const int PIN_CAM_UART_RX = 16;
static const int PIN_CAM_UART_TX = 17;
static const int PIN_WIFI_RESET_BUTTON = 32;
static const uint32_t CAM_UART_BAUD = 115200;
static const int PIN_OLED_SDA = 21;
static const int PIN_OLED_SCL = 22;
static const uint8_t OLED_I2C_ADDRESS = 0x3C;
static const int OLED_WIDTH = 128;
static const int OLED_HEIGHT = 64;

static const int MOTOR_PWM_MAX = 255;
static const char *SETUP_AP_SSID = "FPV-Car-Setup";
static const char *DEVICE_AP_PASSWORD = "12345678";
// Safe limits for small plastic-gear 180-degree servos.
static const int SERVO_PAN_MIN = 15;
static const int SERVO_PAN_MAX = 175;
static const int SERVO_TILT_MIN = 30;
static const int SERVO_TILT_MAX = 110;
static const int SERVO_PAN_CENTER = 95;
static const int SERVO_TILT_CENTER = 64;
static const int SERVO_MIN_US = 500;
static const int SERVO_MAX_US = 2400;

struct VehicleConfig {
  char wifiSsid[64] = "";
  char wifiPass[96] = "";
  char wsHost[96] = "192.168.1.10";
  char wsPort[8] = "8080";
  char wsPath[32] = "/";
  char wsScheme[8] = "ws";
  char vehicleId[32] = "car-001";
  char authToken[96] = "";
  char controlUrl[160] = "http://localhost:3000/controller";
};

struct DriveState {
  String command = "STOP";
  float throttle = 0;
  float steering = 0;
};

struct BehaviorProfile {
  String name = "Balanced";
  float driveScale = 1.0f;
  float steeringScale = 1.0f;
  int cameraStepDeg = 6;
  float throttleExponent = 1.0f;
  String note = "Stable default mapping for general driving.";
};

Preferences prefs;
WebSocketsClient webSocket;
WebServer portalServer(80);
DNSServer dnsServer;
HardwareSerial cameraUart(2);
Adafruit_SSD1306 oled(OLED_WIDTH, OLED_HEIGHT, &Wire, -1);
Servo panServo;
Servo tiltServo;
VehicleConfig config;
DriveState drive;
BehaviorProfile behaviorProfile;

bool wsConnected = false;
bool lightOn = false;
bool cameraOn = true;
int panDeg = SERVO_PAN_CENTER;
int tiltDeg = SERVO_TILT_CENTER;
unsigned long lastTelemetryAt = 0;
unsigned long lastStatusAt = 0;
unsigned long lastCommandAt = 0;
unsigned long buzzerOffAt = 0;
unsigned long lastWsDisconnectedLogAt = 0;
bool setupSaveRequested = false;
bool setupProvisionReady = false;
volatile bool camProvisionAcked = false;
String camProvisionAckMessage = "";
String setupProvisionRequestId = "";
String cameraUartBuffer = "";
unsigned long lastCameraUartSendAt = 0;
unsigned long lastCameraUartStatusAt = 0;
unsigned long lastOledUpdateAt = 0;
unsigned long wifiResetButtonPressedAt = 0;
bool oledReady = false;
bool wifiResetButtonPressed = false;
bool wifiResetButtonHandled = false;
bool cameraUartWifiConnected = false;
bool cameraUartCloudConnected = false;
int cameraUartRssi = -100;
String cameraUartSsid = "";
float lastBatteryPercent = 0;
unsigned long camAckAt = 0;
const unsigned long CAM_ACK_TIMEOUT_MS = 120000; // wait up to 2 minutes for camera
bool setupConnectDone = false;
bool setupConnectOk = false;
unsigned long setupSavedAt = 0;
bool wifiSwitchPending = false;
unsigned long wifiSwitchAt = 0;
bool wifiSwitchInProgress = false;
unsigned long wifiSwitchStartedAt = 0;
const unsigned long WIFI_SWITCH_TIMEOUT_MS = 25000;
String setupLastError = "";
bool wifiScanInProgress = false;
String wifiScanRequestId = "";
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
bool wifiUartCameraPrepared = false;
bool wifiUartCameraArmed = false;
bool wifiVehicleCommitted = false;
String wifiResetCommandId = "";
bool wifiResetCameraAcked = false;
unsigned long wifiTransactionStartedAt = 0;
const unsigned long WIFI_COMMIT_TIMEOUT_MS = 60000;
const unsigned long WIFI_UART_RETRY_MS = 900;

void sendDeviceLog(const char *level, const String &message);
void handleResetWiFi();
void processCameraUart();
void pollWifiResetButton();
void updateOled(bool force = false);
void showOledMessage(const String &title, const String &detail = "");
void startBuzzer();
void stopBuzzer();

String deviceName() {
  uint64_t chipId = ESP.getEfuseMac();
  char suffix[7];
  snprintf(suffix, sizeof(suffix), "%06X", (uint32_t)(chipId & 0xFFFFFF));
  return String("FPV-Car-") + suffix;
}

float clampFloat(float value, float minValue, float maxValue) {
  if (value < minValue) return minValue;
  if (value > maxValue) return maxValue;
  return value;
}

int clampInt(int value, int minValue, int maxValue) {
  if (value < minValue) return minValue;
  if (value > maxValue) return maxValue;
  return value;
}

String oledFit(const String &value, size_t maxChars) {
  if (value.length() <= maxChars) return value;
  if (maxChars <= 3) return value.substring(0, maxChars);
  return value.substring(0, maxChars - 3) + "...";
}

void initOled() {
  Wire.begin(PIN_OLED_SDA, PIN_OLED_SCL);
  oledReady = oled.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDRESS);
  if (!oledReady) {
    Serial.println("OLED not found at I2C address 0x3C; continuing without display.");
    return;
  }

  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextSize(1);
  oled.setCursor(0, 0);
  oled.println("FPV CAR");
  oled.println();
  oled.println("Starting systems...");
  oled.display();
  Serial.println("OLED ready: SSD1306 128x64 address=0x3C SDA=21 SCL=22");
}

void showOledMessage(const String &title, const String &detail) {
  if (!oledReady) return;
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextSize(1);
  oled.setCursor(0, 8);
  oled.println(oledFit(title, 21));
  oled.drawFastHLine(0, 20, OLED_WIDTH, SSD1306_WHITE);
  oled.setCursor(0, 30);
  oled.println(oledFit(detail, 21));
  oled.display();
}

void updateOled(bool force) {
  if (!oledReady) return;
  unsigned long now = millis();
  if (!force && now - lastOledUpdateAt < 500) return;
  lastOledUpdateAt = now;

  const bool cameraUartOnline =
    lastCameraUartStatusAt > 0 && now - lastCameraUartStatusAt < 5000;
  wifi_mode_t wifiMode = WiFi.getMode();
  const bool setupApActive = wifiMode == WIFI_AP || wifiMode == WIFI_AP_STA;
  String wifiLabel = WiFi.isConnected()
    ? WiFi.SSID()
    : setupApActive
    ? String(SETUP_AP_SSID)
    : String("OFF");
  const char *cameraLabel = !cameraUartOnline
    ? "OFF"
    : cameraUartCloudConnected
    ? "ON"
    : cameraUartWifiConnected
    ? "NET"
    : "UART";
  const int battery = clampInt((int)round(lastBatteryPercent), 0, 100);
  const int vehicleRssi = WiFi.isConnected() ? WiFi.RSSI() : -100;
  const char *vehicleWifiState = WiFi.isConnected() ? "OK" : "OFF";
  const char *cameraWifiState =
    cameraUartOnline && cameraUartWifiConnected ? "OK" : "OFF";

  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextSize(1);
  oled.setCursor(0, 0);
  oled.print("FPV ");
  oled.print(MOTOR_DRIVER_NAME);
  oled.setCursor(98, 0);
  oled.print(wsConnected ? "V+" : "V-");
  oled.print(cameraUartOnline ? " C+" : " C-");
  oled.drawFastHLine(0, 9, OLED_WIDTH, SSD1306_WHITE);

  oled.setCursor(0, 12);
  oled.print("WIFI  V:");
  oled.print(vehicleWifiState);
  oled.print(" C:");
  oled.println(cameraWifiState);
  oled.setCursor(0, 21);
  oled.print("V: ");
  oled.println(oledFit(wifiLabel, 18));
  oled.setCursor(0, 30);
  oled.print("C: ");
  oled.println(
    cameraUartOnline && cameraUartWifiConnected
      ? oledFit(cameraUartSsid, 18)
      : String("OFF")
  );
  oled.setCursor(0, 39);
  oled.print("CLOUD V:");
  oled.print(wsConnected ? "ON" : "OFF");
  oled.print(" C:");
  oled.println(cameraLabel);
  oled.setCursor(0, 48);
  oled.print("BAT ");
  oled.drawRect(25, 48, 38, 8, SSD1306_WHITE);
  oled.fillRect(27, 50, (battery * 34) / 100, 4, SSD1306_WHITE);
  oled.setCursor(68, 48);
  oled.print(battery);
  oled.print("% R");
  oled.print(vehicleRssi);
  oled.setCursor(0, 57);
  oled.print("DRV ");
  oled.print(oledFit(drive.command, 6));
  oled.print(" P");
  oled.print(panDeg - SERVO_PAN_CENTER >= 0 ? "+" : "");
  oled.print(panDeg - SERVO_PAN_CENTER);
  oled.print(" T");
  oled.print(tiltDeg - SERVO_TILT_CENTER >= 0 ? "+" : "");
  oled.print(tiltDeg - SERVO_TILT_CENTER);
  oled.display();
}

void loadConfig() {
  prefs.begin("fpv-car", true);
  prefs.getString("wifiSsid", config.wifiSsid, sizeof(config.wifiSsid));
  prefs.getString("wifiPass", config.wifiPass, sizeof(config.wifiPass));
  prefs.getString("wsHost", config.wsHost, sizeof(config.wsHost));
  prefs.getString("wsPort", config.wsPort, sizeof(config.wsPort));
  prefs.getString("wsPath", config.wsPath, sizeof(config.wsPath));
  prefs.getString("wsScheme", config.wsScheme, sizeof(config.wsScheme));
  prefs.getString("vehicleId", config.vehicleId, sizeof(config.vehicleId));
  prefs.getString("authToken", config.authToken, sizeof(config.authToken));
  prefs.getString("controlUrl", config.controlUrl, sizeof(config.controlUrl));
  prefs.end();
}

void saveConfig() {
  prefs.begin("fpv-car", false);
  prefs.putString("wifiSsid", config.wifiSsid);
  prefs.putString("wifiPass", config.wifiPass);
  prefs.putString("wsHost", config.wsHost);
  prefs.putString("wsPort", config.wsPort);
  prefs.putString("wsPath", config.wsPath);
  prefs.putString("wsScheme", config.wsScheme);
  prefs.putString("vehicleId", config.vehicleId);
  prefs.putString("authToken", config.authToken);
  prefs.putString("controlUrl", config.controlUrl);
  prefs.end();
}

void writePanServo(int angle) {
  panDeg = clampInt(angle, SERVO_PAN_MIN, SERVO_PAN_MAX);
  panServo.write(panDeg);
}

void writeTiltServo(int angle) {
  tiltDeg = clampInt(angle, SERVO_TILT_MIN, SERVO_TILT_MAX);
  tiltServo.write(tiltDeg);
}

void writeCameraServos() {
  writePanServo(panDeg);
  writeTiltServo(tiltDeg);
}

void printServoTargets() {
  Serial.print("Servo target: pan=");
  Serial.print(panDeg);
  Serial.print(" deg, tilt=");
  Serial.print(tiltDeg);
  Serial.println(" deg");
  sendDeviceLog(
      "info",
      String("Servo target: pan=") + panDeg + " deg, tilt=" + tiltDeg + " deg");
}

void printConnectionConfig() {
  Serial.println();
  Serial.println("=== FPV Car ESP32 ===");
  Serial.print("Device: ");
  Serial.println(deviceName());
  Serial.print("WiFi IP: ");
  Serial.println(WiFi.localIP());
  Serial.print("WiFi RSSI: ");
  Serial.print(WiFi.RSSI());
  Serial.println(" dBm");
  Serial.print("WebSocket: ");
  Serial.print(config.wsScheme);
  Serial.print("://");
  Serial.print(config.wsHost);
  Serial.print(":");
  Serial.print(config.wsPort);
  Serial.println(config.wsPath);
  Serial.print("Vehicle ID: ");
  Serial.println(config.vehicleId);
  Serial.print("Controller URL: ");
  Serial.println(config.controlUrl);
  Serial.println("=====================");
  Serial.println();
}

const char *webSocketTypeName(WStype_t type) {
  switch (type) {
    case WStype_DISCONNECTED:
      return "DISCONNECTED";
    case WStype_CONNECTED:
      return "CONNECTED";
    case WStype_TEXT:
      return "TEXT";
    case WStype_BIN:
      return "BIN";
    case WStype_ERROR:
      return "ERROR";
    case WStype_FRAGMENT_TEXT_START:
      return "FRAGMENT_TEXT_START";
    case WStype_FRAGMENT_BIN_START:
      return "FRAGMENT_BIN_START";
    case WStype_FRAGMENT:
      return "FRAGMENT";
    case WStype_FRAGMENT_FIN:
      return "FRAGMENT_FIN";
    case WStype_PING:
      return "PING";
    case WStype_PONG:
      return "PONG";
    default:
      return "UNKNOWN";
  }
}

void setMotorRaw(int in1, int in2, float value) {
  int pwm = clampInt((int)(fabs(value) * MOTOR_PWM_MAX), 0, MOTOR_PWM_MAX);
  if (value > 0.02f) {
    analogWrite(in2, 0);
    digitalWrite(in2, LOW);
    analogWrite(in1, pwm);
  } else if (value < -0.02f) {
    digitalWrite(in1, LOW);
    analogWrite(in1, 0);
    analogWrite(in2, pwm);
  } else {
    analogWrite(in1, 0);
    analogWrite(in2, 0);
    digitalWrite(in1, LOW);
    digitalWrite(in2, LOW);
  }
}

void applyDrive(float throttle, float steering) {
  throttle = clampFloat(throttle, -1, 1);
  steering = clampFloat(steering, -1, 1);

  // While reversing, swap the differential steering mix so a logical LEFT
  // command still moves the vehicle toward its left side.
  float steeringMix = throttle < -0.02f ? -steering : steering;
  float left = clampFloat(throttle + steeringMix, -1, 1);
  float right = clampFloat(throttle - steeringMix, -1, 1);

  setMotorRaw(PIN_AIN1, PIN_AIN2, left);
  setMotorRaw(PIN_BIN1, PIN_BIN2, -right);
}

void stopDrive() {
  drive.command = "STOP";
  drive.throttle = 0;
  drive.steering = 0;
  applyDrive(0, 0);
}

float readBatteryPercent() {
  const float adcMax = 4095.0f;
  const float vRef = 3.3f;

  // R1 = 47k, R2 = 10k
  const float dividerRatio = 5.7f;

  const int samples = 30;
  uint32_t total = 0;

  for (int i = 0; i < samples; i++) {
    total += analogRead(PIN_BATTERY_ADC);
    delay(2);
  }

  float raw = total / (float)samples;
  float voltage = (raw / adcMax) * vRef * dividerRatio;

  float percent =
      (voltage - 9.6f) * 100.0f / (12.6f - 9.6f);

  return clampFloat(percent, 0, 100);
}

float readBatteryVoltage() {
  const float adcMax = 4095.0f;
  const float vRef = 3.3f;
  const float dividerRatio = 5.7f;

  const int samples = 30;
  uint32_t total = 0;

  for (int i = 0; i < samples; i++) {
    total += analogRead(PIN_BATTERY_ADC);
    delay(2);
  }

  float raw = total / (float)samples;
  return (raw / adcMax) * vRef * dividerRatio;
}

int readWifiRssi() {
  return WiFi.isConnected() ? WiFi.RSSI() : -100;
}

bool sendJsonDocument(JsonDocument &doc) {
  if (!wsConnected) return false;
  String payload;
  serializeJson(doc, payload);
  return webSocket.sendTXT(payload);
}

void sendDeviceLog(const char *level, const String &message) {
  if (!wsConnected) return;

  JsonDocument doc;
  doc["type"] = "device_log";
  doc["vehicleId"] = config.vehicleId;
  doc["source"] = "esp32";
  doc["level"] = level;
  doc["message"] = message;
  doc["timestamp"] = millis();
  sendJsonDocument(doc);
}

void persistWifiCandidate(const char *state) {
  prefs.begin("fpv-car", false);
  prefs.putString("candidateSsid", wifiCandidateSsid);
  prefs.putString("candidatePass", wifiCandidatePass);
  prefs.putString("candidateCmd", wifiTransactionCommandId);
  prefs.putString("candidateState", state);
  prefs.end();
}

void clearPersistedWifiCandidate() {
  prefs.begin("fpv-car", false);
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
  wifiUartCameraPrepared = false;
  wifiUartCameraArmed = false;
  wifiVehicleCommitted = false;
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
  sendJsonDocument(doc);
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
  sendJsonDocument(doc);
}

void sendCameraUartDocument(JsonDocument &doc) {
  serializeJson(doc, cameraUart);
  cameraUart.write('\n');
  cameraUart.flush();
  lastCameraUartSendAt = millis();
}

void sendCameraProvisionUart() {
  if (!setupProvisionReady || setupProvisionRequestId.length() == 0) return;
  JsonDocument doc;
  doc["type"] = "provision";
  doc["requestId"] = setupProvisionRequestId;
  doc["ssid"] = config.wifiSsid;
  doc["password"] = config.wifiPass;
  doc["wsScheme"] = config.wsScheme;
  doc["wsHost"] = config.wsHost;
  doc["wsPort"] = config.wsPort;
  doc["wsPath"] = config.wsPath;
  doc["vehicleId"] = config.vehicleId;
  doc["authToken"] = config.authToken;
  doc["controlUrl"] = config.controlUrl;
  sendCameraUartDocument(doc);
}

void sendCameraWifiUart(
  const char *action,
  const String &commandId,
  unsigned long delayMs = 0,
  const char *reason = ""
) {
  if (commandId.length() == 0) return;
  JsonDocument doc;
  doc["type"] = "wifi_action";
  doc["action"] = action;
  doc["commandId"] = commandId;
  if (strcmp(action, "prepare") == 0) {
    doc["ssid"] = wifiCandidateSsid;
    doc["password"] = wifiCandidatePass;
  }
  if (delayMs > 0) doc["delayMs"] = delayMs;
  if (reason && strlen(reason) > 0) doc["reason"] = reason;
  sendCameraUartDocument(doc);
}

void forwardCameraWifiPhase(
  const char *phase,
  bool ok,
  const String &ssid,
  const String &message
) {
  if (!wsConnected || wifiTransactionCommandId.length() == 0) return;
  JsonDocument doc;
  doc["type"] = "wifi_uart_camera_phase";
  doc["vehicleId"] = config.vehicleId;
  doc["commandId"] = wifiTransactionCommandId;
  doc["phase"] = phase;
  doc["ok"] = ok;
  doc["ssid"] = ssid;
  doc["message"] = message;
  doc["timestamp"] = millis();
  sendJsonDocument(doc);
}

void handleCameraUartLine(const String &line) {
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, line);
  if (error) {
    Serial.print("Camera UART JSON error: ");
    Serial.println(error.c_str());
    return;
  }

  const char *type = doc["type"] | "";
  if (strcmp(type, "camera_status") == 0) {
    lastCameraUartStatusAt = millis();
    cameraUartWifiConnected = doc["wifiConnected"] | false;
    cameraUartCloudConnected = doc["cloudConnected"] | false;
    cameraUartRssi = doc["rssi"] | -100;
    cameraUartSsid = String(doc["ssid"] | "");
    return;
  }
  if (strcmp(type, "provision_ack") == 0) {
    String requestId = doc["requestId"] | "";
    if (
      setupProvisionReady &&
      requestId == setupProvisionRequestId &&
      (doc["ok"] | false)
    ) {
      camProvisionAcked = true;
      camProvisionAckMessage = String(doc["message"] | "camera saved UART provision");
      camAckAt = millis();
      Serial.println("ESP32-CAM UART provisioning ACK received.");
    }
    return;
  }

  if (strcmp(type, "wifi_ack") != 0) return;
  String commandId = doc["commandId"] | "";
  String phase = doc["phase"] | "";
  if (
    phase == "reset" &&
    commandId == wifiResetCommandId &&
    (doc["ok"] | false)
  ) {
    wifiResetCameraAcked = true;
    return;
  }
  if (commandId != wifiTransactionCommandId) return;

  String ssid = doc["ssid"] | wifiCandidateSsid;
  String message = doc["message"] | "camera UART acknowledgement";
  bool ok = doc["ok"] | false;
  if (phase == "prepared" && ok) wifiUartCameraPrepared = true;
  if (phase == "armed" && ok) wifiUartCameraArmed = true;
  forwardCameraWifiPhase(phase.c_str(), ok, ssid, message);

  if (phase == "committed" && ok && wifiVehicleCommitted) {
    clearWifiTransaction();
  }
}

void processCameraUart() {
  while (cameraUart.available() > 0) {
    char value = (char)cameraUart.read();
    if (value == '\r') continue;
    if (value == '\n') {
      if (cameraUartBuffer.length() > 0) {
        handleCameraUartLine(cameraUartBuffer);
        cameraUartBuffer = "";
      }
      continue;
    }
    if (cameraUartBuffer.length() < 1200) {
      cameraUartBuffer += value;
    } else {
      cameraUartBuffer = "";
    }
  }
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

void sendIdentify() {
  JsonDocument doc;
  doc["type"] = "identify";
  doc["clientType"] = "esp";
  doc["vehicleId"] = config.vehicleId;
  doc["timestamp"] = millis();
  if (strlen(config.authToken) > 0) {
    doc["authToken"] = config.authToken;
  }
  sendJsonDocument(doc);
  Serial.print("Identify sent: vehicleId=");
  Serial.println(config.vehicleId);
  sendDeviceLog("info", String("Identify sent: vehicleId=") + config.vehicleId);
}

void sendStatus(const char *message) {
  JsonDocument doc;
  doc["type"] = "status";
  doc["vehicleId"] = config.vehicleId;
  doc["state"] = drive.command == "STOP" ? "idle" : "moving";
  doc["message"] = message;
  sendJsonDocument(doc);
}

void sendTelemetry() {
  lastBatteryPercent = readBatteryPercent();
  JsonDocument doc;
  doc["type"] = "telemetry";
  doc["vehicleId"] = config.vehicleId;
  doc["online"] = WiFi.isConnected() && wsConnected;
  doc["battery"] = (int)round(lastBatteryPercent);
  doc["wifi"] = readWifiRssi();
  doc["wifiSsid"] = WiFi.isConnected() ? WiFi.SSID() : "";
  doc["wifiGateway"] = WiFi.isConnected() ? WiFi.gatewayIP().toString() : "";
  doc["latency"] = 0;
  doc["cameraOn"] = cameraOn;

  JsonObject driveState = doc["driveState"].to<JsonObject>();
  driveState["command"] = drive.command;
  driveState["throttle"] = drive.throttle;
  driveState["steering"] = drive.steering;

  doc["lightOn"] = lightOn;
  doc["cameraTilt"] = tiltDeg;
  doc["cameraPan"] = panDeg;
  doc["cameraMode"] = "position-180";
  doc["vehicleState"] = drive.command == "STOP" ? "idle" : "moving";

  JsonObject profile = doc["behaviorProfile"].to<JsonObject>();
  profile["name"] = behaviorProfile.name;
  profile["driveScale"] = behaviorProfile.driveScale;
  profile["steeringScale"] = behaviorProfile.steeringScale;
  profile["cameraStepDeg"] = behaviorProfile.cameraStepDeg;
  profile["throttleExponent"] = behaviorProfile.throttleExponent;
  profile["note"] = behaviorProfile.note;

  doc["failure"] = nullptr;
  sendJsonDocument(doc);
}

void sendWifiScanResult(int networkCount, const char *errorMessage = nullptr) {
  JsonDocument doc;
  doc["type"] = "wifi_scan_result";
  doc["vehicleId"] = config.vehicleId;
  doc["timestamp"] = millis();
  if (wifiScanRequestId.length() > 0) {
    doc["requestId"] = wifiScanRequestId;
  }
  if (errorMessage && strlen(errorMessage) > 0) {
    doc["error"] = errorMessage;
  }

  JsonArray networks = doc["networks"].to<JsonArray>();
  int limit = min(networkCount, 32);
  for (int i = 0; i < limit; i++) {
    String ssid = WiFi.SSID(i);
    if (ssid.length() == 0) continue;

    JsonObject network = networks.add<JsonObject>();
    network["ssid"] = ssid;
    network["rssi"] = WiFi.RSSI(i);
    network["channel"] = WiFi.channel(i);
    network["secure"] = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;
  }

  sendJsonDocument(doc);
  sendDeviceLog(
      errorMessage ? "error" : "info",
      errorMessage ? String("WiFi scan failed: ") + errorMessage
                   : String("WiFi scan complete: ") + networkCount + " access points");
}

void startWifiScan(const char *commandId) {
  if (wifiScanInProgress) {
    sendDeviceLog("warn", "WiFi scan already running");
    return;
  }

  wifiScanRequestId = commandId ? String(commandId) : "";
  WiFi.scanDelete();
  int scanState = WiFi.scanNetworks(true, false);
  if (scanState == WIFI_SCAN_FAILED) {
    sendWifiScanResult(0, "ESP32 could not start WiFi scan");
    wifiScanRequestId = "";
    return;
  }

  wifiScanInProgress = true;
  sendDeviceLog("info", "WiFi scan started");
}

void processWifiScan() {
  if (!wifiScanInProgress) return;

  int networkCount = WiFi.scanComplete();
  if (networkCount == WIFI_SCAN_RUNNING) return;

  wifiScanInProgress = false;
  if (networkCount == WIFI_SCAN_FAILED) {
    sendWifiScanResult(0, "ESP32 WiFi scan failed");
  } else {
    sendWifiScanResult(networkCount);
  }

  WiFi.scanDelete();
  wifiScanRequestId = "";
}

float payloadNumber(JsonObject payload, const char *key, float fallback) {
  if (payload.isNull() || !payload[key].is<float>()) return fallback;
  return payload[key].as<float>();
}

String payloadString(JsonObject payload, const char *key, const String &fallback) {
  if (payload.isNull() || !payload[key].is<const char *>()) return fallback;
  return String(payload[key].as<const char *>());
}

void ackCommand(const char *commandId, const char *message) {
  // The cloud server already ACKs forwarded commands to the controller.
  // Keep this as a no-op so the ESP does not send unsupported ACK messages.
  (void)commandId;
  (void)message;
}

void handleControl(JsonDocument &doc) {
  const char *command = doc["command"] | "STOP";
  const char *commandId = doc["commandId"] | "";
  JsonObject payload = doc["payload"].as<JsonObject>();

  float throttle = payloadNumber(payload, "throttle", 0);
  float steering = payloadNumber(payload, "steering", 0);

  Serial.print("Control received: command=");
  Serial.print(command);
  Serial.print(" throttle=");
  Serial.print(throttle, 3);
  Serial.print(" steering=");
  Serial.print(steering, 3);
  if (strlen(commandId) > 0) {
    Serial.print(" commandId=");
    Serial.print(commandId);
  }
  Serial.println();
  sendDeviceLog(
      "info",
      String("Control ") + command + " throttle=" + String(throttle, 2) +
          " steering=" + String(steering, 2));

  float scaledThrottle =
      copysign(pow(fabs(throttle), behaviorProfile.throttleExponent), throttle) *
      behaviorProfile.driveScale;
  float scaledSteering = steering * behaviorProfile.steeringScale;

  drive.command = command;
  drive.throttle = clampFloat(scaledThrottle, -1, 1);
  drive.steering = clampFloat(scaledSteering, -1, 1);
  lastCommandAt = millis();
  applyDrive(drive.throttle, drive.steering);
  ackCommand(commandId, "control applied by ESP32");
  sendStatus("control applied by ESP32");
}

void applyBehaviorProfile(JsonObject payload) {
  JsonObject profile = payload["profile"].as<JsonObject>();
  if (profile.isNull()) return;

  behaviorProfile.name = payloadString(profile, "name", behaviorProfile.name);
  behaviorProfile.driveScale =
      clampFloat(payloadNumber(profile, "driveScale", behaviorProfile.driveScale), 0.3f, 2.0f);
  behaviorProfile.steeringScale =
      clampFloat(payloadNumber(profile, "steeringScale", behaviorProfile.steeringScale), 0.3f, 2.0f);
  behaviorProfile.cameraStepDeg =
      clampInt((int)round(payloadNumber(profile, "cameraStepDeg", behaviorProfile.cameraStepDeg)), 1, 12);
  behaviorProfile.throttleExponent =
      clampFloat(payloadNumber(profile, "throttleExponent", behaviorProfile.throttleExponent), 0.5f, 2.5f);
  behaviorProfile.note = payloadString(profile, "note", behaviorProfile.note);
}

void prepareWifiCandidate(JsonObject payload, const char *commandId) {
  String ssid = payloadString(payload, "ssid", "");
  String password = payloadString(payload, "password", "");
  if (ssid.length() == 0 || !commandId || strlen(commandId) == 0) {
    sendStatus("WIFI_PREPARE ignored: invalid request");
    return;
  }

  clearWifiTransaction();
  wifiTransactionCommandId = commandId;
  wifiCandidateSsid = ssid;
  wifiCandidatePass = password;
  wifiActiveSsid = config.wifiSsid;
  wifiActivePass = config.wifiPass;
  wifiTransactionPrepared = true;
  wifiTransactionStartedAt = millis();
  persistWifiCandidate("prepared");
  sendCameraWifiUart("prepare", wifiTransactionCommandId);
  sendWifiPhase("prepared", true, "vehicle stored WiFi candidate");
  sendStatus("WiFi candidate prepared; waiting for camera UART ACK");
  stopDrive();
}

void armWifiCandidate(const char *commandId) {
  if (
    !wifiTransactionPrepared ||
    !commandId ||
    wifiTransactionCommandId != commandId
  ) {
    return;
  }
  wifiTransactionArmed = true;
  wifiTransactionStartedAt = millis();
  persistWifiCandidate("armed");
  sendCameraWifiUart("arm", wifiTransactionCommandId);
  sendWifiPhase("armed", true, "vehicle ready for coordinated switch");
}

void startWifiCandidateSwitch(const char *commandId) {
  if (
    !wifiTransactionArmed ||
    !wifiUartCameraArmed ||
    !commandId ||
    wifiTransactionCommandId != commandId
  ) {
    sendWifiPhase("switching", false, "camera did not confirm UART arm");
    return;
  }

  const unsigned long switchDelayMs = 3000;
  sendCameraWifiUart("switch", wifiTransactionCommandId, switchDelayMs);
  wifiSwitchPending = true;
  wifiSwitchAt = millis() + switchDelayMs;
  wifiTransactionStartedAt = millis();
  sendWifiPhase("switching", true, "coordinated WiFi switch scheduled over UART");
}

void commitWifiCandidate(const char *commandId) {
  if (
    !wifiCandidateConnected ||
    !commandId ||
    wifiTransactionCommandId != commandId
  ) {
    return;
  }
  sendCameraWifiUart("commit", wifiTransactionCommandId);
  saveConfig();
  wifiVehicleCommitted = true;
  wifiTransactionStartedAt = millis();
  persistWifiCandidate("committed");
  sendWifiPhase("committed", true, "vehicle committed active WiFi");
}

void rollbackWifiCandidate(const char *commandId, const char *reason) {
  if (!commandId || wifiTransactionCommandId != commandId) return;
  sendCameraWifiUart("rollback", wifiTransactionCommandId, 0, reason);
  if (wifiCandidateConnected || wifiSwitchInProgress || wifiTransactionArmed) {
    restoreActiveWifi(reason);
    return;
  }
  sendWifiPhase("rolled_back", true, reason);
  clearWifiTransaction();
}

void resetSharedWifi(const char *commandId) {
  stopDrive();
  wifiResetCommandId = commandId && strlen(commandId) > 0
    ? String(commandId)
    : String("wifi-reset-local");
  wifiResetCameraAcked = false;
  showOledMessage("RESET WIFI", "Waiting for CAM...");

  unsigned long startedAt = millis();
  unsigned long lastSentAt = 0;
  while (!wifiResetCameraAcked && millis() - startedAt < 2500) {
    if (lastSentAt == 0 || millis() - lastSentAt >= 350) {
      sendCameraWifiUart("reset", wifiResetCommandId);
      lastSentAt = millis();
    }
    processCameraUart();
    delay(10);
  }

  prefs.begin("fpv-car", false);
  prefs.remove("wifiSsid");
  prefs.remove("wifiPass");
  prefs.remove("candidateSsid");
  prefs.remove("candidatePass");
  prefs.remove("candidateCmd");
  prefs.remove("candidateState");
  prefs.end();

  showOledMessage(
    "RESET WIFI",
    wifiResetCameraAcked ? "Both boards cleared" : "Vehicle cleared"
  );
  ackCommand(commandId, wifiResetCameraAcked
    ? "WiFi cleared on both boards"
    : "Vehicle WiFi cleared; camera ACK not received");
  delay(900);
  ESP.restart();
}

void pollWifiResetButton() {
  const bool pressed = digitalRead(PIN_WIFI_RESET_BUTTON) == LOW;
  const unsigned long now = millis();

  if (!pressed) {
    wifiResetButtonPressed = false;
    wifiResetButtonHandled = false;
    return;
  }

  if (!wifiResetButtonPressed) {
    wifiResetButtonPressed = true;
    wifiResetButtonHandled = false;
    wifiResetButtonPressedAt = now;
    Serial.println("WiFi reset button pressed; hold for 3 seconds.");
    showOledMessage("WIFI BUTTON", "Hold 3 seconds");
    return;
  }

  if (!wifiResetButtonHandled && now - wifiResetButtonPressedAt >= 3000) {
    wifiResetButtonHandled = true;
    Serial.println("WiFi reset button confirmed. Clearing both boards...");
    sendDeviceLog("info", "Hardware WiFi reset button confirmed");
    resetSharedWifi("wifi-reset-button");
  }
}

void handleAction(JsonDocument &doc) {
  const char *action = doc["action"] | "";
  const char *commandId = doc["commandId"] | "";
  JsonObject payload = doc["payload"].as<JsonObject>();
  float amount = clampFloat(payloadNumber(payload, "amount", 1), 0.25f, 1.0f);
  int cameraStep = (int)round(behaviorProfile.cameraStepDeg * amount);

  Serial.print("Action received: ");
  Serial.print(action);
  Serial.print(" amount=");
  Serial.print(amount, 2);
  if (strlen(commandId) > 0) {
    Serial.print(" commandId=");
    Serial.print(commandId);
  }
  Serial.println();
  sendDeviceLog("info", String("Action ") + action + " amount=" + String(amount, 2));

  if (strcmp(action, "LIGHT_TOGGLE") == 0) {
    lightOn = !lightOn;
    digitalWrite(PIN_LIGHT, lightOn ? HIGH : LOW);
  } else if (strcmp(action, "HORN") == 0) {
    startBuzzer();
  } else if (strcmp(action, "CAMERA_TOGGLE") == 0) {
    cameraOn = !cameraOn;
  } else if (strcmp(action, "CAM_RESET") == 0) {
    panDeg = SERVO_PAN_CENTER;
    tiltDeg = SERVO_TILT_CENTER;
  } else if (strcmp(action, "CAM_LEFT") == 0) {
    panDeg = clampInt(panDeg + cameraStep, SERVO_PAN_MIN, SERVO_PAN_MAX);
  } else if (strcmp(action, "CAM_RIGHT") == 0) {
    panDeg = clampInt(panDeg - cameraStep, SERVO_PAN_MIN, SERVO_PAN_MAX);
  } else if (strcmp(action, "CAM_UP") == 0) {
    tiltDeg = clampInt(tiltDeg + cameraStep, SERVO_TILT_MIN, SERVO_TILT_MAX);
  } else if (strcmp(action, "CAM_DOWN") == 0) {
    tiltDeg = clampInt(tiltDeg - cameraStep, SERVO_TILT_MIN, SERVO_TILT_MAX);
  } else if (strcmp(action, "NETWORK_RECONNECT") == 0) {
    WiFi.reconnect();
  } else if (strcmp(action, "REBOOT") == 0) {
    showOledMessage("RESTARTING", "Vehicle reboot");
    ackCommand(commandId, "rebooting ESP32");
    delay(700);
    ESP.restart();
  } else if (strcmp(action, "PROFILE_APPLY") == 0) {
    applyBehaviorProfile(payload);
  } else if (strcmp(action, "WIFI_SCAN") == 0) {
    startWifiScan(commandId);
  } else if (strcmp(action, "WIFI_PREPARE") == 0) {
    prepareWifiCandidate(payload, commandId);
  } else if (strcmp(action, "WIFI_APPLY") == 0) {
    armWifiCandidate(commandId);
  } else if (strcmp(action, "WIFI_SWITCH") == 0) {
    startWifiCandidateSwitch(commandId);
  } else if (strcmp(action, "WIFI_COMMIT") == 0) {
    commitWifiCandidate(commandId);
  } else if (strcmp(action, "WIFI_ROLLBACK") == 0) {
    rollbackWifiCandidate(commandId, "relay requested rollback");
  } else if (strcmp(action, "WIFI_PORTAL_OPEN") == 0) {
    Serial.println("Resetting shared WiFi and opening setup portal");
    resetSharedWifi(commandId);
    return;
  }

  if (strncmp(action, "CAM", 3) == 0) {
    writeCameraServos();
    printServoTargets();
  }
  ackCommand(commandId, "action applied by ESP32");
  sendStatus("action applied by ESP32");
  sendTelemetry();
}

void onWebSocketEvent(WStype_t type, uint8_t *payload, size_t length) {
  if (type == WStype_CONNECTED) {
    wsConnected = true;
    if (wifiCandidateConnected || wifiFallbackInProgress) {
      wifiCandidateStatusSent = false;
    }
    lastWsDisconnectedLogAt = 0;
    Serial.print("WebSocket connected: ");
    Serial.print(config.wsScheme);
    Serial.print("://");
    Serial.print(config.wsHost);
    Serial.print(":");
    Serial.print(config.wsPort);
    Serial.println(config.wsPath);
    sendIdentify();
    sendStatus("ESP32 vehicle connected");
    sendDeviceLog("info", "WebSocket connected");
    return;
  }

  if (type == WStype_DISCONNECTED) {
    wsConnected = false;
    stopDrive();
    unsigned long now = millis();
    if (lastWsDisconnectedLogAt == 0 || now - lastWsDisconnectedLogAt > 5000) {
      lastWsDisconnectedLogAt = now;
      Serial.print("WebSocket disconnected. Retrying ");
      Serial.print(config.wsScheme);
      Serial.print("://");
      Serial.print(config.wsHost);
      Serial.print(":");
      Serial.print(config.wsPort);
      Serial.println(config.wsPath);
    }
    return;
  }

  if (type == WStype_ERROR) {
    Serial.print("WebSocket error: ");
    if (payload && length > 0) {
      Serial.write(payload, length);
    } else {
      Serial.print("(no detail)");
    }
    Serial.println();
    sendDeviceLog("error", "WebSocket error");
    return;
  }

  if (type != WStype_TEXT && type != WStype_PING && type != WStype_PONG) {
    Serial.print("WebSocket event: ");
    Serial.println(webSocketTypeName(type));
  }

  if (type != WStype_TEXT) return;

  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, payload, length);
  if (error) {
    Serial.print("JSON parse error: ");
    Serial.println(error.c_str());
    sendDeviceLog("error", String("JSON parse error: ") + error.c_str());
    return;
  }

  const char *messageType = doc["type"] | "";
  if (strcmp(messageType, "control") == 0) {
    handleControl(doc);
  } else if (strcmp(messageType, "action") == 0) {
    handleAction(doc);
  } else if (strcmp(messageType, "ping") == 0) {
    JsonDocument pong;
    pong["type"] = "pong";
    pong["timestamp"] = doc["timestamp"] | millis();
    sendJsonDocument(pong);
  }
}

void setupPortalRedirect() {
  portalServer.on("/", []() {
    portalServer.sendHeader("Location", config.controlUrl, true);
    portalServer.send(302, "text/plain", "Opening controller...");
  });

  portalServer.on("/reset-wifi", handleResetWiFi);

  portalServer.begin();
}

bool connectToConfiguredWiFi(unsigned long timeoutMs, bool keepSetupAp) {
  if (strlen(config.wifiSsid) == 0) return false;

  WiFi.mode(keepSetupAp ? WIFI_AP_STA : WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(config.wifiSsid, config.wifiPass);

  Serial.print("Connecting WiFi: ");
  Serial.println(config.wifiSsid);

  unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < timeoutMs) {
    if (keepSetupAp) dnsServer.processNextRequest();
    portalServer.handleClient();
    processCameraUart();
    updateOled();
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

String htmlEscape(const char *value) {
  String escaped = value;
  escaped.replace("&", "&amp;");
  escaped.replace("\"", "&quot;");
  escaped.replace("<", "&lt;");
  escaped.replace(">", "&gt;");
  return escaped;
}

String wifiOptionsHtml() {
  String html;
  int networkCount = WiFi.scanNetworks();
  for (int i = 0; i < networkCount; i++) {
    String ssid = WiFi.SSID(i);
    if (ssid.length() == 0) continue;

    bool duplicate = false;
    for (int j = 0; j < i; j++) {
      if (WiFi.SSID(j) == ssid) {
        duplicate = true;
        break;
      }
    }
    if (duplicate) continue;

    int rssi = WiFi.RSSI(i);
    const char *signal = rssi >= -55 ? "แรงมาก" : rssi >= -67 ? "ดี" : rssi >= -75 ? "พอใช้" : "อ่อน";
    html += "<option value=\"" + htmlEscape(ssid.c_str()) + "\"";
    if (ssid == String(config.wifiSsid)) html += " selected";
    html += ">" + htmlEscape(ssid.c_str()) + " · " + signal + " (" + String(rssi) + " dBm)</option>";
  }
  WiFi.scanDelete();
  return html;
}

void sendSetupPage() {
  String html;
  html.reserve(9000);
  html += "<!doctype html><html lang='th'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>";
  html += "<title>ตั้งค่า FPV Car</title><style>";
  html += "*{box-sizing:border-box}body{font-family:system-ui,sans-serif;margin:0;background:#eef2f3;color:#172033}header{background:#111827;color:white;padding:22px 20px}header div,main{max-width:680px;margin:auto}h1{font-size:23px;margin:0 0 6px}h2{font-size:16px;margin:0 0 5px}p{margin:0;line-height:1.55}.sub{color:#cbd5e1;font-size:13px}main{padding:18px 14px 36px}.status{border-left:4px solid #10b981;background:#ecfdf5;padding:12px 14px;margin-bottom:14px;border-radius:6px}.section{background:white;border:1px solid #d8e0e5;border-radius:8px;padding:16px;margin-bottom:12px}.title{display:flex;gap:10px;align-items:flex-start}.num{display:grid;place-items:center;flex:0 0 26px;height:26px;border-radius:50%;background:#172033;color:white;font-weight:700;font-size:13px}.hint{color:#64748b;font-size:12px}label{display:block;margin:14px 0 6px;font-size:13px;font-weight:650}input,select{width:100%;padding:12px;border-radius:6px;border:1px solid #cbd5e1;background:white;color:#172033;font-size:16px}input:focus,select:focus{outline:2px solid #34d399;border-color:#059669}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}details{margin-top:12px;border-top:1px solid #e2e8f0;padding-top:12px}summary{cursor:pointer;font-size:13px;font-weight:700}.primary{width:100%;border:0;border-radius:7px;padding:14px;background:#059669;color:white;font-size:15px;font-weight:750}.secondary{display:inline-block;margin-top:10px;color:#475569;font-size:12px}.error{border-left-color:#e11d48;background:#fff1f2;color:#9f1239;margin-bottom:14px}.footer{font-size:11px;color:#64748b;text-align:center;margin-top:18px}@media(max-width:560px){header{padding:18px 16px}.grid{grid-template-columns:1fr}.section{padding:14px}}";
  html += "</style></head><body><header><div><h1>ตั้งค่า FPV Car</h1><p class='sub'>เลือก Wi-Fi ครั้งเดียว ระบบจะส่งค่าให้ ESP32 และ ESP32-CAM พร้อมกัน</p></div></header><main>";
  html += "<div class='status'><strong>พร้อมตั้งค่า</strong><p class='hint'>เชื่อมต่ออยู่กับ FPV-Car-Setup · เปิดไฟทั้งสองบอร์ดไว้จนกว่าจะเสร็จ</p></div>";
  if (setupLastError.length() > 0) html += "<div class='status error'><strong>การเชื่อมต่อครั้งก่อนยังไม่สำเร็จ</strong><p class='hint'>" + htmlEscape(setupLastError.c_str()) + "</p></div>";
  html += "<form method='post' action='/save'><section class='section'><div class='title'><span class='num'>1</span><div><h2>เลือก Wi-Fi หรือ Hotspot</h2><p class='hint'>ใช้เครือข่าย 2.4 GHz ที่รถอยู่ในระยะสัญญาณ</p></div></div>";
  html += "<label for='ssid_select'>เครือข่ายที่สแกนพบ</label><select id='ssid_select' name='ssid_select' onchange='toggleManual()'><option value=''>ใส่ชื่อเครือข่ายเอง</option>";
  html += wifiOptionsHtml();
  html += "</select><div id='manual'><label for='ssid'>ชื่อเครือข่าย</label><input id='ssid' name='ssid' autocomplete='off' value='";
  html += htmlEscape(config.wifiSsid);
  html += "'></div><label for='password'>รหัสผ่าน Wi-Fi</label><input id='password' name='password' type='password' autocomplete='new-password' placeholder='";
  html += strlen(config.wifiSsid) > 0 ? "เว้นว่างเพื่อใช้รหัสเดิม" : "ใส่รหัสผ่านของเครือข่าย";
  html += "'><p class='hint' style='margin-top:6px'>หากเลือก Wi-Fi เดิม สามารถเว้นว่างเพื่อใช้รหัสที่บันทึกไว้</p></section>";
  html += "<section class='section'><div class='title'><span class='num'>2</span><div><h2>ตรวจสอบ Cloud</h2><p class='hint'>ค่าเดิมพร้อมใช้งานแล้ว เปิดส่วนนี้เมื่อต้องเปลี่ยนเซิร์ฟเวอร์เท่านั้น</p></div></div><details><summary>การตั้งค่าขั้นสูง</summary><div class='grid'>";
  html += "<div><label>รูปแบบ WebSocket</label><select name='ws_scheme'><option value='ws'>ws</option><option value='wss'";
  html += strcmp(config.wsScheme, "wss") == 0 ? " selected" : "";
  html += ">wss</option></select></div>";
  html += "<div><label>Host</label><input name='ws_host' value='" + htmlEscape(config.wsHost) + "'></div>";
  html += "<div><label>Port</label><input name='ws_port' inputmode='numeric' value='" + htmlEscape(config.wsPort) + "'></div>";
  html += "<div><label>Path</label><input name='ws_path' value='" + htmlEscape(config.wsPath) + "'></div>";
  html += "<div><label>Vehicle ID</label><input name='vehicle_id' value='" + htmlEscape(config.vehicleId) + "'></div>";
  html += "<div><label>Auth token</label><input name='auth_token' type='password' placeholder='เว้นว่างเพื่อใช้ค่าเดิม'></div>";
  html += "</div><label>หน้าเว็บควบคุม</label><input name='control_url' value='" + htmlEscape(config.controlUrl) + "'></details></section>";
  html += "<section class='section'><div class='title'><span class='num'>3</span><div><h2>บันทึกให้ทั้งสองบอร์ด</h2><p class='hint'>ห้ามปิดไฟจนกว่าหน้าถัดไปจะแจ้งว่า ESP32-CAM รับค่าแล้ว</p></div></div><button class='primary' type='submit'>บันทึกและเชื่อมต่อ</button></section></form>";
  html += "<a class='secondary' href='/reset-wifi' onclick=\"return confirm('ล้างค่า Wi-Fi ที่บันทึกไว้หรือไม่?')\">ล้างค่า Wi-Fi และเริ่มใหม่</a><p class='footer'>หากหน้านี้ไม่เปิดอัตโนมัติ ให้เข้า 192.168.4.1</p>";
  html += "</main><script>function toggleManual(){document.getElementById('manual').hidden=document.getElementById('ssid_select').value!==''}toggleManual()</script></body></html>";
  portalServer.send(200, "text/html", html);
}

void sendSetupStatus() {
  JsonDocument doc;
  doc["cameraAcked"] = camProvisionAcked;
  doc["vehicleConnected"] = WiFi.status() == WL_CONNECTED;
  doc["ssid"] = config.wifiSsid;

  if (setupConnectDone && setupConnectOk) {
    doc["phase"] = "connected";
    doc["message"] = "เชื่อมต่อสำเร็จ กำลังปิดโหมดตั้งค่า";
  } else if (setupLastError.length() > 0) {
    doc["phase"] = "error";
    doc["message"] = setupLastError;
  } else if (camProvisionAcked) {
    doc["phase"] = "connecting";
    doc["message"] = "ESP32-CAM รับค่าผ่านสาย UART แล้ว กำลังเชื่อมต่อ Wi-Fi";
  } else if (setupProvisionReady) {
    doc["phase"] = "waiting_camera";
    doc["message"] = "บันทึกแล้ว กำลังรอ ESP32-CAM ยืนยันผ่านสาย UART";
  } else {
    doc["phase"] = "idle";
    doc["message"] = "รอการตั้งค่า";
  }

  String body;
  serializeJson(doc, body);
  portalServer.send(200, "application/json", body);
}

void handleResetWiFi() {
  portalServer.send(200, "text/html; charset=utf-8", "<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width'><body style='font-family:system-ui;padding:24px'><h2>ล้างค่าแล้ว</h2><p>กำลังเริ่มโหมดตั้งค่าใหม่...</p></body>");
  delay(300);
  resetSharedWifi("wifi-reset-local");
}

void handleSetupSave() {
  String selectedSsid = portalServer.arg("ssid_select");
  String manualSsid = portalServer.arg("ssid");
  String ssid = selectedSsid.length() > 0 ? selectedSsid : manualSsid;
  ssid.trim();

  if (ssid.length() == 0) {
    portalServer.send(400, "text/plain; charset=utf-8", "กรุณาเลือกหรือใส่ชื่อ Wi-Fi");
    return;
  }

  String previousSsid = config.wifiSsid;
  String password = portalServer.arg("password");
  String authToken = portalServer.arg("auth_token");
  strlcpy(config.wifiSsid, ssid.c_str(), sizeof(config.wifiSsid));
  if (password.length() > 0 || ssid != previousSsid) {
    strlcpy(config.wifiPass, password.c_str(), sizeof(config.wifiPass));
  }
  strlcpy(config.wsScheme, portalServer.arg("ws_scheme").c_str(), sizeof(config.wsScheme));
  strlcpy(config.wsHost, portalServer.arg("ws_host").c_str(), sizeof(config.wsHost));
  strlcpy(config.wsPort, portalServer.arg("ws_port").c_str(), sizeof(config.wsPort));
  strlcpy(config.wsPath, portalServer.arg("ws_path").c_str(), sizeof(config.wsPath));
  strlcpy(config.vehicleId, portalServer.arg("vehicle_id").c_str(), sizeof(config.vehicleId));
  if (authToken.length() > 0) {
    strlcpy(config.authToken, authToken.c_str(), sizeof(config.authToken));
  }
  strlcpy(config.controlUrl, portalServer.arg("control_url").c_str(), sizeof(config.controlUrl));
  saveConfig();

  camProvisionAcked = false;
  camProvisionAckMessage = "";
  camAckAt = 0;
  setupSaveRequested = true;
  setupProvisionReady = true;
  setupProvisionRequestId = String("setup-") + String(millis(), HEX);
  setupSavedAt = millis();
  setupLastError = "";
  sendCameraProvisionUart();
  Serial.println("Setup saved. Provision payload sent to ESP32-CAM over UART.");

  portalServer.send(200, "text/html; charset=utf-8",
                    "<!doctype html><html lang='th'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
                    "<title>กำลังเชื่อมต่อ</title><style>body{font-family:system-ui;margin:0;background:#eef2f3;color:#172033}main{max-width:560px;margin:0 auto;padding:34px 18px}.box{background:white;border:1px solid #d8e0e5;border-radius:8px;padding:22px}.loader{width:28px;height:28px;border:4px solid #d1fae5;border-top-color:#059669;border-radius:50%;animation:r 1s linear infinite}@keyframes r{to{transform:rotate(360deg)}}h1{font-size:21px}p{line-height:1.6;color:#475569}.state{margin-top:18px;padding:12px;background:#f1f5f9;border-radius:6px;font-weight:650}.back{display:inline-block;margin-top:16px;color:#047857}</style>"
                    "<main><div class='box'><div class='loader' id='loader'></div><h1>กำลังตั้งค่าสองบอร์ด</h1><p>เปิดไฟ ESP32 และ ESP32-CAM ไว้ ระบบกำลังส่งค่าผ่านสาย UART และตรวจสอบ Wi-Fi</p><div class='state' id='state'>กำลังรอ ESP32-CAM...</div><a class='back' href='/'>กลับไปแก้ไขค่า</a></div></main>"
                    "<script>async function check(){try{const r=await fetch('/api/setup-status',{cache:'no-store'});const s=await r.json();document.getElementById('state').textContent=s.message;if(s.phase==='connected'){document.getElementById('loader').style.display='none';return}}catch(e){document.getElementById('state').textContent='การเชื่อมต่อกับ FPV-Car-Setup สิ้นสุดแล้ว ลองเปิดหน้าเว็บควบคุม'}setTimeout(check,1000)}check()</script></html>");
}



void startSetupPortal() {
  setupSaveRequested = false;
  setupProvisionReady = false;
  setupConnectDone = false;
  setupConnectOk = false;
  setupSavedAt = 0;
  camProvisionAcked = false;
  camProvisionAckMessage = "";
  setupProvisionRequestId = "";
  camAckAt = 0;

  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(SETUP_AP_SSID, DEVICE_AP_PASSWORD);
  dnsServer.start(53, "*", WiFi.softAPIP());
  Serial.print("Setup AP started: FPV-Car-Setup IP=");
  Serial.println(WiFi.softAPIP());

  portalServer.stop();
  portalServer.on("/", HTTP_GET, sendSetupPage);
  portalServer.on("/save", HTTP_POST, handleSetupSave);
  portalServer.on("/api/setup-status", HTTP_GET, sendSetupStatus);
  portalServer.on("/reset-wifi", HTTP_GET, handleResetWiFi);
  portalServer.onNotFound([]() {
    portalServer.sendHeader("Location", "http://192.168.4.1/", true);
    portalServer.send(302, "text/plain", "Opening FPV Car setup...");
  });
  portalServer.begin();

  Serial.println("Open http://192.168.4.1 to configure Wi-Fi for both boards.");
  while (true) {
    dnsServer.processNextRequest();
    portalServer.handleClient();
    processCameraUart();
    updateOled();

    if (
      setupProvisionReady &&
      !camProvisionAcked &&
      millis() - lastCameraUartSendAt >= WIFI_UART_RETRY_MS
    ) {
      sendCameraProvisionUart();
    }

    // Keep the setup AP alive until the camera confirms the UART payload.
    if (setupProvisionReady && !camProvisionAcked) {
      if (millis() - setupSavedAt > CAM_ACK_TIMEOUT_MS) {
        Serial.println("Timed out waiting for ESP32-CAM ACK. Keeping setup portal open.");
        setupSavedAt = millis(); // keep waiting; user can retry without losing the portal
      }
    }

    // Only after the camera confirms it has saved the new Wi-Fi do we switch the car.
    if (setupProvisionReady && camProvisionAcked && !setupConnectDone) {
      Serial.println("Camera acknowledged provision. Vehicle is switching Wi-Fi now.");
      setupConnectOk = connectToConfiguredWiFi(25000, true);
      setupConnectDone = true;
      setupSavedAt = millis();

      if (!setupConnectOk) {
        Serial.println("Vehicle Wi-Fi failed. Keeping setup portal open for correction.");
        setupLastError = "เชื่อมต่อ Wi-Fi ไม่สำเร็จ ตรวจรหัสผ่าน ย่าน 2.4 GHz และจำนวนอุปกรณ์สูงสุดของ Hotspot (ต้องอย่างน้อย 2)";
        setupConnectDone = false;
        camProvisionAcked = false; // require a fresh camera ACK after another save
        WiFi.disconnect(false, false);
      }
    }

    if (setupConnectDone && setupConnectOk && millis() - setupSavedAt > 3000) {
      Serial.println("Vehicle setup completed after camera ACK.");
      break;
    }

    delay(10);
  }
  dnsServer.stop();
  portalServer.stop();
  WiFi.softAPdisconnect(true);

  if (setupConnectOk) {
    Serial.println("Shared WiFi setup complete. Restarting into normal mode...");
    delay(500);
    ESP.restart();
  }
}

void setupWiFiManager() {
  if (connectToConfiguredWiFi(18000, false)) return;

  Serial.println("Saved WiFi unavailable. Starting setup portal.");
  startSetupPortal();
}

void setupWebSocket() {
  uint16_t port = (uint16_t)atoi(config.wsPort);
  String path = strlen(config.wsPath) > 0 ? String(config.wsPath) : "/";

  Serial.print("Starting WebSocket client: ");
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

void setupPins() {
  pinMode(PIN_AIN1, OUTPUT);
  pinMode(PIN_AIN2, OUTPUT);
  pinMode(PIN_BIN1, OUTPUT);
  pinMode(PIN_BIN2, OUTPUT);
  // Keep both A4950 channels low before any other peripheral starts.
  digitalWrite(PIN_AIN1, LOW);
  digitalWrite(PIN_AIN2, LOW);
  digitalWrite(PIN_BIN1, LOW);
  digitalWrite(PIN_BIN2, LOW);
  pinMode(PIN_LIGHT, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_BATTERY_ADC, INPUT);
  pinMode(PIN_WIFI_RESET_BUTTON, INPUT_PULLUP);
  digitalWrite(PIN_LIGHT, LOW);
  digitalWrite(PIN_BUZZER, LOW);
}

void startBuzzer() {
  // Active 3.3V buzzer: drive it with a steady HIGH, without PWM.
  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(PIN_BUZZER, HIGH);
  buzzerOffAt = millis() + BUZZER_DURATION_MS;
}

void stopBuzzer() {
  digitalWrite(PIN_BUZZER, LOW);
  buzzerOffAt = 0;
}

void testServosOnBoot() {
  Serial.println("Servo boot test: 180 position test");
  writePanServo(SERVO_PAN_CENTER);
  writeTiltServo(SERVO_TILT_CENTER);
  printServoTargets();
  delay(500);

  writePanServo(130);
  writeTiltServo(95);
  printServoTargets();
  delay(500);

  writePanServo(50);
  writeTiltServo(45);
  printServoTargets();
  delay(500);

  writePanServo(SERVO_PAN_CENTER);
  writeTiltServo(SERVO_TILT_CENTER);
  printServoTargets();
  delay(300);
}

void setup() {
  Serial.begin(115200);
  // Establish a stopped motor state before UART, OLED, Wi-Fi, or Servo startup.
  setupPins();
  cameraUart.setRxBufferSize(2048);
  cameraUart.begin(CAM_UART_BAUD, SERIAL_8N1, PIN_CAM_UART_RX, PIN_CAM_UART_TX);
  delay(300);
  Serial.println();
  Serial.println("Booting FPV Car ESP32...");
  Serial.println("ESP32-CAM UART ready: RX=GPIO16 TX=GPIO17 baud=115200");
  initOled();
  loadConfig();
  clearPersistedWifiCandidate();
  panServo.setPeriodHertz(50);
  tiltServo.setPeriodHertz(50);
  panServo.attach(PIN_SERVO_PAN, SERVO_MIN_US, SERVO_MAX_US);
  tiltServo.attach(PIN_SERVO_TILT, SERVO_MIN_US, SERVO_MAX_US);
  writeCameraServos();
  Serial.print("Servo attached: pan GPIO");
  Serial.print(PIN_SERVO_PAN);
  Serial.print(", tilt GPIO");
  Serial.println(PIN_SERVO_TILT);
  testServosOnBoot();
  // stopDrive() uses PWM; call it only after Servo has been attached.
  stopDrive();
  setupWiFiManager();
  printConnectionConfig();
  setupPortalRedirect();
  setupWebSocket();
}

void loop() {
  processCameraUart();
  webSocket.loop();
  portalServer.handleClient();
  processWifiScan();
  updateOled();
  pollWifiResetButton();

  unsigned long now = millis();

  if (
    wifiTransactionPrepared &&
    !wifiUartCameraPrepared &&
    !wifiTransactionArmed &&
    now - lastCameraUartSendAt >= WIFI_UART_RETRY_MS
  ) {
    sendCameraWifiUart("prepare", wifiTransactionCommandId);
  } else if (
    wifiTransactionArmed &&
    !wifiUartCameraArmed &&
    !wifiSwitchPending &&
    !wifiSwitchInProgress &&
    now - lastCameraUartSendAt >= WIFI_UART_RETRY_MS
  ) {
    sendCameraWifiUart("arm", wifiTransactionCommandId);
  } else if (
    wifiVehicleCommitted &&
    now - lastCameraUartSendAt >= WIFI_UART_RETRY_MS
  ) {
    sendCameraWifiUart("commit", wifiTransactionCommandId);
  }

  if (wifiSwitchPending && (long)(millis() - wifiSwitchAt) >= 0) {
    wifiSwitchPending = false;
    wifiSwitchInProgress = true;
    wifiSwitchStartedAt = millis();
    if (wifiTransactionArmed && !wifiFallbackInProgress) {
      strlcpy(config.wifiSsid, wifiCandidateSsid.c_str(), sizeof(config.wifiSsid));
      strlcpy(config.wifiPass, wifiCandidatePass.c_str(), sizeof(config.wifiPass));
    }
    Serial.println("Switching ESP32 vehicle to the newly saved WiFi...");
    WiFi.disconnect(false, false);
    delay(300);
    WiFi.mode(WIFI_STA);
    WiFi.begin(config.wifiSsid, config.wifiPass);
  }

  if (wifiSwitchInProgress) {
    if (WiFi.status() == WL_CONNECTED) {
      wifiSwitchInProgress = false;
      Serial.println("ESP32 vehicle connected to the new WiFi.");
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
  if (
    wifiCandidateConnected &&
    wsConnected &&
    !wifiCandidateStatusSent
  ) {
    sendWifiCandidateStatus("connected", "vehicle reached cloud through candidate WiFi");
    wifiCandidateStatusSent = true;
  }
  if (
    wifiFallbackInProgress &&
    WiFi.status() == WL_CONNECTED &&
    wsConnected &&
    !wifiCandidateStatusSent
  ) {
    sendWifiCandidateStatus("rolled_back", "vehicle restored active WiFi");
    wifiCandidateStatusSent = true;
    clearWifiTransaction();
  }
  if (
    wifiTransactionArmed &&
    !wifiVehicleCommitted &&
    !wifiFallbackInProgress &&
    now - wifiTransactionStartedAt > WIFI_COMMIT_TIMEOUT_MS
  ) {
    restoreActiveWifi("cloud commit timed out");
  }
  if (buzzerOffAt > 0 && now >= buzzerOffAt) {
    stopBuzzer();
  }

  if (drive.command != "STOP" && now - lastCommandAt > 900) {
    stopDrive();
    sendStatus("watchdog stop");
  }

  if (now - lastTelemetryAt > 500) {
    lastTelemetryAt = now;
    sendTelemetry();
  }

  if (now - lastStatusAt > 2500) {
    lastStatusAt = now;
    sendStatus(wsConnected ? "ESP32 vehicle online" : "WebSocket disconnected");
  }
}
