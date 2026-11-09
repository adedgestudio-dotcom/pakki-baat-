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
    assert.ok(footer.includes('<div className="product-footer-wordmark">pakki baat.</div>'));
    assert.ok(footer.includes('<div className="product-footer-meta">'));
    assert.ok(footer.includes('<span className="product-footer-credit">A '));
    assert.equal((footer.match(/className="product-footer-meta-item"/g) || []).length, 2);
    assert.match(footer, /href="https:\/\/zorivo.in"[^>]*>Zorivo<\/a> product/);
    assert.ok(footer.includes('href={`mailto:${SUPPORT_EMAIL}`}>Help</a>'));
    assert.ok(footer.includes('<small className="app-version">v{appVersion}</small>'));
    assert.match(footer, /className="[^"]*product-footer/);
  }
});

test("product footer provides safe-area navigation clearance and readable colors", () => {
  const css = fs.readFileSync(path.join(__dirname, "../app/workspace.css"), "utf8");
  assert.ok(css.includes('footer:is(.product-footer,.settings-brand-footer){display:grid;justify-items:center;'));
  assert.ok(css.includes('border:0;box-shadow:none;background:transparent'));
  assert.ok(css.includes('font:18px/1.4 Georgia,"Times New Roman",serif;color:#2d7667'));
  assert.ok(css.includes('align-items:center;flex-wrap:wrap;gap:0 10px'));
  assert.ok(css.includes('.product-footer-meta .app-version{display:inline;margin:0;color:inherit;font-size:inherit}'));
  assert.ok(css.includes('padding-bottom:calc(100px + env(safe-area-inset-bottom,0px))'));
});

test("both footer rows meet 4.5:1 contrast in light and dark themes", () => {
  const luminance = hex => {
    const rgb = hex.match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  for (const [ink, paper] of [["52645b","f5f1e8"],["2d7667","f5f1e8"],["b7c7bf","242927"],["9bd4b8","242927"]]) {
    const a = luminance(ink), b = luminance(paper);
    assert.ok((Math.max(a,b) + .05) / (Math.min(a,b) + .05) >= 4.5);
  }
});
