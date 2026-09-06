// MusicBrainz indexes complete normalized format names, not the word vinyl alone.
export const VINYL_FILTER =
  "format:(vinyl OR 7vinyl OR 10vinyl OR 12vinyl OR 3vinyl OR 4vinyl OR 5vinyl OR 6vinyl OR 8vinyl OR 9vinyl OR 11vinyl OR 13vinyl OR 14vinyl OR 15vinyl OR 16vinyl)";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateRecord(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Record must be an object.");
  const allowed = [
    "id",
    "title",
    "artist",
    "year",
    "country",
    "catalogNumber",
    "label",
    "barcode",
    "format",
  ];
  if (Object.keys(input).some((k) => !allowed.includes(k)))
    throw new Error("Unknown record field.");
  const record = {};
  for (const key of allowed) {
    const value = input[key] ?? "";
    if (
      typeof value !== "string" ||
      value.length > (["title", "artist"].includes(key) ? 300 : 120) ||
      /[\u0000-\u001f]/.test(value)
    )
      throw new Error(`Invalid ${key}.`);
    record[key] = value.trim();
  }
  if (!uuid.test(record.id) || !record.title || !record.artist)
    throw new Error("Release ID, artist and title are required.");
  if (record.year && !/^\d{4}$/.test(record.year))
    throw new Error("Year must have four digits.");
  if (record.barcode && !/^\d{6,14}$/.test(record.barcode))
    throw new Error("Invalid barcode.");
  if (!record.format.toLowerCase().includes("vinyl"))
    throw new Error("Choose a vinyl release.");
  record.id = record.id.toLowerCase();
  return record;
}
export function mergeRecord(records, input) {
  if (!Array.isArray(records)) throw new Error("Catalog must be an array.");
  const record = validateRecord(input);
  const clean = records.map(validateRecord);
  if (clean.some((r) => r.id === record.id)) return clean;
  return [...clean, record].sort(
    (a, b) =>
      a.artist.localeCompare(b.artist) ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id),
  );
}
export function searchQuery(mode, value) {
  const quoted = value
    .trim()
    .replace(/[+\-!(){}\[\]^"~*?:\\/&|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!quoted) throw new Error("Enter a search term.");
  if (mode === "barcode") {
    const code = value.replace(/[\s-]/g, "");
    if (!/^\d{8,14}$/.test(code))
      throw new Error("Enter an 8–14 digit barcode.");
    return `barcode:${code} AND ${VINYL_FILTER}`;
  }
  return mode === "catalog"
    ? `catno:"${quoted}" AND ${VINYL_FILTER}`
    : `(${quoted
        .split(" ")
        .map((w) => `(artist:"${w}" OR release:"${w}")`)
        .join(" AND ")}) AND ${VINYL_FILTER}`;
}
export function fromRelease(r) {
  return validateRecord({
    id: r.id,
    title: r.title,
    artist: (r["artist-credit"] || [])
      .map((a) => (a.name || a.artist?.name || "") + (a.joinphrase || ""))
      .join(""),
    year: (r.date || "").slice(0, 4),
    country: r.country || "",
    catalogNumber:
      r["label-info"]
        ?.map((l) => l["catalog-number"])
        .filter(Boolean)
        .join(" / ")
        .slice(0, 120) || "",
    label:
      r["label-info"]
        ?.map((l) => l.label?.name)
        .filter(Boolean)
        .join(" / ")
        .slice(0, 120) || "",
    barcode: /^\d{6,14}$/.test(r.barcode || "") ? r.barcode : "",
    format:
      r.media
        ?.map((m) => m.format)
        .filter(Boolean)
        .join(" / ") || "Vinyl",
  });
}
