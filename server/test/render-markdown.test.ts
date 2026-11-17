import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../src/render-markdown.js";

test("Markdown retains text formatting and rejects executable HTML", () => {
  const safe = renderMarkdown("**完成说明**\n\n- 第一项\n- 第二项\n\n[文档](https://example.org/docs)");
  assert.match(safe, /<strong>完成说明<\/strong>/);
  assert.match(safe, /<li>第一项<\/li>/);
  assert.match(safe, /href="https:\/\/example.org\/docs"/);
  assert.match(safe, /rel="noreferrer noopener"/);
  const unsafe = renderMarkdown('<script>window.pwned=1</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">click</a><iframe srcdoc="<script>alert(1)</script>"></iframe>');
  assert.doesNotMatch(unsafe, /<script|<img|onerror|javascript:|<iframe/i);
});

test("Markdown rejects unsafe URLs, SVG and style while preserving table layout", () => {
  const html = renderMarkdown('<svg><a href="javascript:alert(1)">x</a></svg><p style="position:fixed">text</p><a href="//example.org">external</a>\n\n| A | B |\n| - | - |\n| 1 | 2 |');
  assert.doesNotMatch(html, /<svg|style=|href="\/\//i);
  assert.match(html, /<table>/);
});
