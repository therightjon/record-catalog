import test from "node:test";
import assert from "node:assert/strict";
import {
  validateRecord,
  mergeRecord,
  searchQuery,
  fromRelease,
  VINYL_FILTER,
} from "../lib/record.js";
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
