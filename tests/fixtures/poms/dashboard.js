// Fixture POM module for tests. Exports plain functions that accept a
// Playwright Page as the first argument plus optional user args.

async function openHome(page) {
  await page.goto(page.context().baseUrl ?? "http://localhost/", {
    waitUntil: "domcontentloaded",
  });
}

async function login(page, user) {
  // Purely for assertion — set a marker attribute the integration test reads.
  await page.evaluate((name) => {
    const el = document.querySelector("#auth-state");
    if (el) el.setAttribute("data-pom-login", String(name));
  }, user);
}

module.exports = { openHome, login };
