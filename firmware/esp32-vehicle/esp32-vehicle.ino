#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <WebSocketsClient.h>
#include <math.h>

// Required libraries:
// - WiFiManager by tzapu
// - ArduinoJson by Benoit Blanchon
// - WebSockets by Markus Sattler
// - ESP32Servo by Kevin Harrington / John K. Bennett

// TB6612FNG pin map. Change these to match your wiring.
static const int PIN_AIN1 = 26;
static const int PIN_AIN2 = 27;
static const int PIN_PWMA = 25;
static const int PIN_BIN1 = 14;
static const int PIN_BIN2 = 12;
static const int PIN_PWMB = 13;
static const int PIN_STBY = 33;

static const int PIN_SERVO_PAN = 18;
static const int PIN_SERVO_TILT = 19;
static const int PIN_LIGHT = 2;
static const int PIN_BUZZER = 4;
static const int PIN_BATTERY_ADC = 34;

static const int MOTOR_PWM_MAX = 255;
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

void sendDeviceLog(const char *level, const String &message);

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

void loadConfig() {
  prefs.begin("fpv-car", true);
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

void setMotorRaw(int in1, int in2, int pwmPin, float value) {
  int pwm = clampInt((int)(fabs(value) * MOTOR_PWM_MAX), 0, MOTOR_PWM_MAX);
  if (value > 0.02f) {
    digitalWrite(in1, HIGH);
    digitalWrite(in2, LOW);
  } else if (value < -0.02f) {
    digitalWrite(in1, LOW);
    digitalWrite(in2, HIGH);
  } else {
    digitalWrite(in1, LOW);
    digitalWrite(in2, LOW);
    pwm = 0;
  }
  analogWrite(pwmPin, pwm);
}

void applyDrive(float throttle, float steering) {
  throttle = clampFloat(throttle, -1, 1);
  steering = clampFloat(steering, -1, 1);

  float left = clampFloat(throttle + steering, -1, 1);
  float right = clampFloat(throttle - steering, -1, 1);

  digitalWrite(PIN_STBY, HIGH);
  setMotorRaw(PIN_AIN1, PIN_AIN2, PIN_PWMA, left);
  setMotorRaw(PIN_BIN1, PIN_BIN2, PIN_PWMB, right);
}

void stopDrive() {
  drive.command = "STOP";
  drive.throttle = 0;
  drive.steering = 0;
  applyDrive(0, 0);
}

float readBatteryPercent() {
  // Adjust dividerRatio and voltage limits for your Li-ion 3S pack.
  const float adcMax = 4095.0f;
  const float vRef = 3.3f;
  const float dividerRatio = 5.0f;
  int raw = analogRead(PIN_BATTERY_ADC);
  float voltage = (raw / adcMax) * vRef * dividerRatio;
  float percent = (voltage - 9.6f) * 100.0f / (12.6f - 9.6f);
  return clampFloat(percent, 0, 100);
}

int readWifiRssi() {
  return WiFi.isConnected() ? WiFi.RSSI() : -100;
}

void sendJsonDocument(JsonDocument &doc) {
  if (!wsConnected) return;
  String payload;
  serializeJson(doc, payload);
  webSocket.sendTXT(payload);
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
  JsonDocument doc;
  doc["type"] = "telemetry";
  doc["vehicleId"] = config.vehicleId;
  doc["online"] = WiFi.isConnected() && wsConnected;
  doc["battery"] = (int)round(readBatteryPercent());
  doc["wifi"] = readWifiRssi();
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

void changeWiFiFromPayload(JsonObject payload) {
  String ssid = payloadString(payload, "ssid", "");
  String password = payloadString(payload, "password", "");
  if (ssid.length() == 0) {
    sendStatus("WIFI_SET ignored: ssid is empty");
    return;
  }

  sendStatus("WIFI_SET received: switching vehicle WiFi");
  stopDrive();
  delay(150);
  WiFi.disconnect(true, true);
  delay(300);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), password.c_str());
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
    digitalWrite(PIN_BUZZER, HIGH);
    buzzerOffAt = millis() + 180;
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
    ackCommand(commandId, "rebooting ESP32");
    delay(120);
    ESP.restart();
  } else if (strcmp(action, "PROFILE_APPLY") == 0) {
    applyBehaviorProfile(payload);
  } else if (strcmp(action, "WIFI_SET") == 0) {
    changeWiFiFromPayload(payload);
  } else if (strcmp(action, "WIFI_PORTAL_OPEN") == 0) {
    Serial.println("Opening WiFi config portal");
    WiFiManager wm;
    wm.startConfigPortal(deviceName().c_str(), "12345678");
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

  portalServer.on("/reset-wifi", []() {
    portalServer.send(200, "text/plain", "WiFi settings cleared. Rebooting...");
    delay(300);
    WiFiManager wm;
    wm.resetSettings();
    ESP.restart();
  });

  portalServer.begin();
}

void setupWiFiManager() {
  WiFiManager wm;

  WiFiManagerParameter pWsScheme("ws_scheme", "ws or wss", config.wsScheme, sizeof(config.wsScheme));
  WiFiManagerParameter pWsHost("ws_host", "Cloud WebSocket host", config.wsHost, sizeof(config.wsHost));
  WiFiManagerParameter pWsPort("ws_port", "Cloud WebSocket port", config.wsPort, sizeof(config.wsPort));
  WiFiManagerParameter pWsPath("ws_path", "Cloud WebSocket path", config.wsPath, sizeof(config.wsPath));
  WiFiManagerParameter pVehicleId("vehicle_id", "Vehicle ID", config.vehicleId, sizeof(config.vehicleId));
  WiFiManagerParameter pAuthToken("auth_token", "Vehicle auth token", config.authToken, sizeof(config.authToken));
  WiFiManagerParameter pControlUrl("control_url", "Controller page URL", config.controlUrl, sizeof(config.controlUrl));

  wm.addParameter(&pWsScheme);
  wm.addParameter(&pWsHost);
  wm.addParameter(&pWsPort);
  wm.addParameter(&pWsPath);
  wm.addParameter(&pVehicleId);
  wm.addParameter(&pAuthToken);
  wm.addParameter(&pControlUrl);
  wm.setConfigPortalTimeout(240);
  wm.setConnectTimeout(25);
  wm.setBreakAfterConfig(true);

  bool connected = wm.autoConnect(deviceName().c_str(), "12345678");

  strlcpy(config.wsScheme, pWsScheme.getValue(), sizeof(config.wsScheme));
  strlcpy(config.wsHost, pWsHost.getValue(), sizeof(config.wsHost));
  strlcpy(config.wsPort, pWsPort.getValue(), sizeof(config.wsPort));
  strlcpy(config.wsPath, pWsPath.getValue(), sizeof(config.wsPath));
  strlcpy(config.vehicleId, pVehicleId.getValue(), sizeof(config.vehicleId));
  strlcpy(config.authToken, pAuthToken.getValue(), sizeof(config.authToken));
  strlcpy(config.controlUrl, pControlUrl.getValue(), sizeof(config.controlUrl));
  saveConfig();

  if (!connected) {
    Serial.println("WiFiManager failed or timed out. Restarting...");
    ESP.restart();
  }

  Serial.print("WiFi connected: ");
  Serial.println(WiFi.SSID());
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
  pinMode(PIN_PWMA, OUTPUT);
  pinMode(PIN_BIN1, OUTPUT);
  pinMode(PIN_BIN2, OUTPUT);
  pinMode(PIN_PWMB, OUTPUT);
  pinMode(PIN_STBY, OUTPUT);
  pinMode(PIN_LIGHT, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_BATTERY_ADC, INPUT);
  digitalWrite(PIN_STBY, HIGH);
  digitalWrite(PIN_LIGHT, LOW);
  digitalWrite(PIN_BUZZER, LOW);
  stopDrive();
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
  delay(300);
  Serial.println();
  Serial.println("Booting FPV Car ESP32...");
  loadConfig();
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
  setupPins();
  setupWiFiManager();
  printConnectionConfig();
  setupPortalRedirect();
  setupWebSocket();
}

void loop() {
  webSocket.loop();
  portalServer.handleClient();

  unsigned long now = millis();
  if (buzzerOffAt > 0 && now >= buzzerOffAt) {
    digitalWrite(PIN_BUZZER, LOW);
    buzzerOffAt = 0;
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
