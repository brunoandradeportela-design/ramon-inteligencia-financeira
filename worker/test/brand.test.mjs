/* Identidade visual 2026: ativos existem, páginas usam a marca nova e a antiga não volta. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
const WEB = new URL("../../apps/web/", import.meta.url);
const read = p => readFileSync(new URL(p, WEB), "utf8");

test("ativos da nova marca", () => {
  for (const f of ["aurion-logo-primary.svg", "aurion-logo-light.svg", "aurion-logo-dark.svg", "aurion-symbol.svg", "aurion-symbol-dark.svg", "favicon.svg", "favicon.ico",
    "aurion-icon-512.png", "apple-touch-icon.png", "og-aurion.png", "desktop/aurion.ico", "desktop/aurion.icns", "desktop/aurion-256.png"]) assert.ok(existsSync(new URL("assets/brand/" + f, WEB)), f);
  assert.ok(existsSync(new URL("favicon.ico", WEB)));
  assert.match(read("assets/brand/aurion-logo-primary.svg"), /aria-label="Aurion — Inteligência Financeira, Tributária e de Mercado"/);
});

test("pontos de contato usam a marca nova", () => {
  assert.match(read("index.html"), /assets\/brand\/aurion-symbol\.svg/);
  assert.match(read("index.html"), /og:image" content="https:\/\/aurionfinance\.com\.br\/assets\/brand\/og-aurion\.png"/);
  for (const p of ["termos.html", "privacidade.html"]) assert.match(read(p), /assets\/brand\/aurion-symbol\.svg/, p);
  assert.match(read("app/js/app.js"), /brandSymbol\(\)/);
  assert.match(read("app/js/views.js"), /brandLockup/);
  assert.match(read("app/js/views_identity.js"), /brandLockup/);
  assert.match(read("app/js/auth4.js"), /brandSymbol\(\)/);
  assert.match(read("app/js/auth4.js"), /TRIBUTÁRIA E DE MERCADO/);
  assert.match(read("app/index.html"), /css\/brand\.css/);
  const m = JSON.parse(read("app/manifest.webmanifest"));
  assert.equal(m.background_color, "#071B32");
});

test("a marca antiga não aparece mais", () => {
  const files = ["app/js/app.js", "assets/img/favicon.svg", "app/js/auth4.js", "index.html"];
  for (const f of files) {
    const s = read(f);
    assert.doesNotMatch(s, /M16 3 L29 27/, f);            // triângulo antigo do cabeçalho
    assert.doesNotMatch(s, /M14 50 28 14/, f);            // "A" antigo do favicon
    assert.doesNotMatch(s, /PRÓXIMO NÍVEL/, f);           // assinatura antiga
  }
});
