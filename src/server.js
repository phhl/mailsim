// Entry point of the application.
// Starts the HTTP server and loads the Express app.

const { app } = require('./app');

const PORT = Number(process.env.PORT || 3000);

app.listen(PORT, () => {
  console.log(`Mail-Simulator läuft auf http://localhost:${PORT}`);
});
