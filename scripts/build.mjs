import { mkdir, cp, rm } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist/assets", { recursive: true });
for (const path of [
  "index.html",
  "styles.css",
  "app.js",
  "config.js",
  "manifest.webmanifest",
  "sw.js",
  "assets",
  "data",
  "lib",
])
  await cp(path, `dist/${path}`, { recursive: true });
await cp(
  "node_modules/@zxing/browser/umd/zxing-browser.min.js",
  "dist/assets/zxing-browser.min.js",
);

await mkdir("dist/assets/licenses", { recursive: true });
for (const [source, name] of [
  ["@zxing/browser/LICENSE", "zxing-browser.txt"],
  ["@zxing/library/LICENSE", "zxing-library.txt"],
  ["@zxing/text-encoding/LICENSE.md", "zxing-text-encoding.txt"],
  ["ts-custom-error/LICENSE", "ts-custom-error.txt"],
])
  await cp(`node_modules/${source}`, `dist/assets/licenses/${name}`);
