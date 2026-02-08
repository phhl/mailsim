// Entry point of the application.
// Starts the HTTP server and loads the Express app.

const fs = require("fs");
const { app } = require("./app");

const PORT = Number(process.env.PORT || 3000);
const SOCKET_PATH = process.env.SOCKET_PATH;
const SOCKET_MODE = process.env.SOCKET_MODE;

if (SOCKET_PATH) {
  try {
    if (fs.existsSync(SOCKET_PATH)) {
      fs.unlinkSync(SOCKET_PATH);
    }
  } catch (err) {
    console.error("Socket-Pfad kann nicht vorbereitet werden:", err);
    process.exit(1);
  }

  const server = app.listen(SOCKET_PATH, () => {
    if (SOCKET_MODE) {
      const mode = Number.parseInt(SOCKET_MODE, 8);
      if (Number.isNaN(mode)) {
        console.warn("SOCKET_MODE ist ungueltig; chmod wird uebersprungen.");
      } else {
        try {
          fs.chmodSync(SOCKET_PATH, mode);
        } catch (err) {
          console.warn("Socket-Pfad chmod fehlgeschlagen:", err);
        }
      }
    }
    console.log(`Mail-Simulator laeuft auf Socket ${SOCKET_PATH}`);
  });

  server.on("error", (err) => {
    console.error("Socket-Server Fehler:", err);
    process.exit(1);
  });
} else {
  app.listen(PORT, () => {
    console.log(`Mail-Simulator laeuft auf http://localhost:${PORT}`);
  });
}
