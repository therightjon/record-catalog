import test from "node:test";
import assert from "node:assert/strict";
import {
  validateRecord,
  mergeRecord,
  searchQuery,
  fromRelease,
  VINYL_FILTER,
} from "../lib/record.js";
import worker from "../worker/index.js";
const record = {
  id: "12345678-1234-1234-1234-123456789abc",
  artist: "Artist",
  title: "Album",
  format: '12" Vinyl',
  year: "1984",
};
test("validation rejects unsafe and malformed input", () => {
  for (const input of [
    null,
    [],
    { ...record, id: "../../x" },
    { ...record, title: "" },
    { ...record, title: "a\nb" },
    { ...record, format: "CD" },
    { ...record, year: "yesterday" },
    { ...record, extra: "field" },
    { ...record, barcode: "123abc" },
  ])
    assert.throws(() => validateRecord(input));
  assert.equal(validateRecord(record).title, "Album");
});
test("deduplication preserves different pressings and handles retries", () => {
  let catalog = mergeRecord([], record);
  catalog = mergeRecord(catalog, { ...record, id: record.id.toUpperCase() });
  assert.equal(catalog.length, 1);
  catalog = mergeRecord(catalog, {
    ...record,
    id: "12345678-1234-1234-1234-123456789abd",
  });
  assert.equal(catalog.length, 2);
});
test("catalog and barcode queries constrain vinyl and escape query syntax", () => {
  assert.equal(
    searchQuery("catalog", "BSK 3472"),
    'catno:"BSK 3472" AND ' + VINYL_FILTER,
  );
  assert.equal(
    searchQuery("barcode", "0 7599 25395 1"),
    "barcode:07599253951 AND " + VINYL_FILTER,
  );
  assert.throws(() => searchQuery("barcode", "abc"));
  assert.equal(
    searchQuery("manual", "Fleetwood Rumours"),
    '((artist:"Fleetwood" OR release:"Fleetwood") AND (artist:"Rumours" OR release:"Rumours")) AND ' +
      VINYL_FILTER,
  );
  assert.equal(
    searchQuery("catalog", 'x" OR format:CD'),
    'catno:"x OR format CD" AND ' + VINYL_FILTER,
  );
});
test("release mapping joins artist credits and handles incomplete metadata", () => {
  const r = fromRelease({
    id: record.id,
    title: "Album",
    "artist-credit": [
      { name: "A", joinphrase: " & " },
      { artist: { name: "B" } },
    ],
    media: [{ format: "Vinyl" }],
  });
  assert.equal(r.artist, "A & B");
  assert.equal(r.year, "");
});
const env = {
  ALLOWED_ORIGIN: "https://owner.github.io",
  OWNER_KEY: "x".repeat(64),
  GITHUB_TOKEN: "secret",
  GITHUB_REPOSITORY: "owner/records",
  GITHUB_REF: "main",
};
function req(body = record, headers = {}, method = "POST") {
  return new Request("https://save.example/records", {
    method,
    headers: {
      Origin: env.ALLOWED_ORIGIN,
      Authorization: `Bearer ${env.OWNER_KEY}`,
      "Content-Type": "application/json",
      ...headers,
    },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}
test("endpoint rejects unauthorized, wrong origin, oversized and invalid requests", async () => {
  assert.equal(
    (await worker.fetch(req(record, { Origin: "https://evil.example" }), env))
      .status,
    403,
  );
  assert.equal(
    (await worker.fetch(req(record, { Authorization: "Bearer nope" }), env))
      .status,
    401,
  );
  assert.equal(
    (await worker.fetch(req({ x: "a".repeat(5000) }), env)).status,
    413,
  );
  assert.equal(
    (await worker.fetch(req({ ...record, id: "bad" }), env)).status,
    400,
  );
  assert.equal(
    (await worker.fetch(req(record, {}, "OPTIONS"), env)).status,
    204,
  );
  assert.equal((await worker.fetch(req(record, {}, "GET"), env)).status, 405);
});
test("endpoint dispatches only to configured repository and returns queued, not saved", async () => {
  const original = globalThis.fetch;
  let called;
  globalThis.fetch = async (url, options) => {
    called = { url, options };
    return new Response(null, { status: 204 });
  };
  try {
    const response = await worker.fetch(req(), env);
    assert.equal(response.status, 202);
    assert.ok(
      called.url.endsWith(
        "/owner/records/actions/workflows/save-record.yml/dispatches",
      ),
    );
    assert.equal(JSON.parse(called.options.body).ref, "main");
    assert.equal(
      JSON.parse(JSON.parse(called.options.body).inputs.record).id,
      record.id,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("upstream failures are not reported as success", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("private details", { status: 403 });
  try {
    const response = await worker.fetch(req(), env);
    assert.equal(response.status, 502);
    assert.ok(!(await response.text()).includes("private details"));
  } finally {
    globalThis.fetch = original;
  }
});
