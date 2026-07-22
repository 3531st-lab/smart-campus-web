const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("quality page exposes five modules and role-aware workspaces", () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/quality-assessment.js"), "utf8");
  for (const label of ["德育", "智育", "体育", "美育", "劳育"]) assert.match(source, new RegExp(label));
  assert.match(source, /班级初审/);
  assert.match(source, /学院复核/);
  assert.match(source, /公示与申诉/);
  assert.match(source, /AbortController/);
  assert.doesNotMatch(source, /OCR|自动识别图片/);
});

test("quality workspace has a responsive theme-aware layout", () => {
  const css = fs.readFileSync(path.join(__dirname, "../public/assets/quality-assessment.css"), "utf8");
  assert.match(css, /\.quality-module-grid\s*\{[^}]*grid-template-columns/s);
  assert.match(css, /\.quality-review-table-wrap\s*\{[^}]*overflow:\s*auto/s);
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /html\[data-theme="day"\][\s\S]*\.quality-assessment-page/);
  assert.match(css, /html\[data-theme="night"\][\s\S]*\.quality-assessment-page/);
});
