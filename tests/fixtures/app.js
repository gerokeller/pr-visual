// Minimal HTTP server used as a fixture for e2e tests.
// Responds to GET / with a simple HTML page and GET /api/health with 200.
const http = require("node:http");

const port = process.env.PORT || 3999;

function pageHtml({ session }) {
  const banner = session
    ? `<div id="auth-state" data-session="${session}">Logged in as ${session}</div>`
    : `<div id="auth-state" data-session="">Anonymous</div>`;
  return `<!DOCTYPE html>
<html>
<head>
  <title>pr-visual fixture</title>
  <style>
    body { margin: 0; padding: 40px; font-family: system-ui, sans-serif; }
    #login { padding: 12px 24px; margin-top: 20px; }
    #auth-state { padding: 8px 12px; background: #eef; border-radius: 6px; display: inline-block; margin-bottom: 20px; }
  </style>
</head>
<body>
  ${banner}
  <h1>Fixture App</h1>
  <p>This is a test page for pr-visual e2e tests.</p>
  <button id="login">Log in</button>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  if (req.url === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"status":"ok"}');
    return;
  }
  // Read the `pr_visual_session` cookie if present so tests can verify the
  // auth storage state was loaded into the Playwright context.
  const cookieHeader = req.headers.cookie || "";
  const match = cookieHeader.match(/pr_visual_session=([^;]+)/);
  const session = match ? decodeURIComponent(match[1]) : "";
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(pageHtml({ session }));
});

server.listen(port, () => {
  console.log(`Fixture app listening on http://localhost:${port}`);
});
