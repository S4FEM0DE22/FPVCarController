const { WebSocketServer } = require("ws");

const wss = new WebSocketServer({ port: 8080 });

console.log("Mock WebSocket server running on ws://localhost:8080");

wss.on("connection", (ws) => {
  console.log("Client connected");

  const telemetryInterval = setInterval(() => {
    ws.send(
      JSON.stringify({
        type: "telemetry",
        vehicleId: "car-001",
        online: true,
        battery: 87,
        wifi: -52,
        latency: 35,
        cameraOn: true,
      })
    );
  }, 2000);

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log("Received:", data);

      if (data.type === "ping") {
        ws.send(
          JSON.stringify({
            type: "pong",
            timestamp: data.timestamp,
          })
        );
      } else {
        ws.send(
          JSON.stringify({
            type: "ack",
            message: "ok",
          })
        );
      }
    } catch (error) {
      console.error("Invalid JSON:", error);
    }
  });

  ws.on("close", () => {
    clearInterval(telemetryInterval);
    console.log("Client disconnected");
  });
});