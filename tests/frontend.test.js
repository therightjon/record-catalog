import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("both public and signed-in UI have every required DOM control", async () => {
  const html = await readFile(
    new URL("../index.html", import.meta.url),
    "utf8",
  );
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  for (const [, id] of app.matchAll(/\$\(["']([^"']+)["']\)/g))
    assert.ok(ids.has(id), `Missing UI control: ${id}`);
  assert.ok(!ids.has("owner-key"));
});
