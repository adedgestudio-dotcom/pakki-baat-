const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../app/workspace.tsx"), "utf8");

test("customer footers use product branding, one support address and the package version", () => {
  assert.match(source, /const SUPPORT_EMAIL = "zorivoworks@gmail.com"/);
  assert.match(source, /import \{ version as appVersion \} from "@\/package.json"/);
  const footers = source.match(/<footer\b[\s\S]*?<\/footer>/g);
  assert.equal(footers.length, 8);
  for (const footer of footers) {
    assert.ok(!footer.includes("Sarrah Bharmal"));
    assert.match(footer, /Pakki Baat[\s\S]*?A\{" "\}/);
    assert.match(footer, /href="https:\/\/zorivo.in"[^>]*>Zorivo<\/a> product/);
    assert.ok(footer.includes('href={`mailto:${SUPPORT_EMAIL}`}>Help</a>'));
    assert.ok(footer.includes('<small className="app-version">v{appVersion}</small>'));
    assert.match(footer, /className="[^"]*product-footer/);
  }
});

test("product footer provides safe-area navigation clearance and readable colors", () => {
  const css = fs.readFileSync(path.join(__dirname, "../app/workspace.css"), "utf8");
  assert.match(css, /footer.product-footer \{ color: #52645b;/);
  assert.match(css, /\[data-theme="dark"\] footer.product-footer \{ color: #b7c7bf !important;/);
  assert.match(css, /footer.product-footer \{ padding-bottom: calc\(100px \+ env\(safe-area-inset-bottom, 0px\)\); \}/);
});
