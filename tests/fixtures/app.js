// Minimal HTTP server used as a fixture for e2e tests.
// Responds to GET / with a simple HTML page and GET /api/health with 200.
const http = require("node:http");

const port = process.env.PORT || 3999;

const HTML = `<!DOCTYPE html>
<html>
<head><title>pr-visual fixture</title></head>
<body>
  <h1>Fixture App</h1>
  <p>This is a test page for pr-visual e2e tests.</p>
  <button id="login">Log in</button>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.url === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"status":"ok"}');
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(HTML);
});

server.listen(port, () => {
  console.log(`Fixture app listening on http://localhost:${port}`);
});
