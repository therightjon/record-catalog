import { readFile, writeFile, rename } from "node:fs/promises";
import { mergeRecord } from "../lib/record.js";
const path = "data/records.json";
const records = JSON.parse(await readFile(path, "utf8"));
const result = mergeRecord(records, JSON.parse(process.env.RECORD || "null"));
await writeFile(`${path}.tmp`, JSON.stringify(result, null, 2) + "\n");
await rename(`${path}.tmp`, path);
