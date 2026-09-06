import { validateRecord } from "../lib/record.js";
const MAX = 4096;
async function equalSecret(a, b) {
  const digest = (s) =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  return crypto.subtle.timingSafeEqual
    ? crypto.subtle.timingSafeEqual(x, y)
    : new Uint8Array(x).reduce(
        (n, v, i) => n | (v ^ new Uint8Array(y)[i]),
        0,
      ) === 0;
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Vary: "Origin",
    };
    const reply = (status, message) =>
      new Response(JSON.stringify({ message }), { status, headers });
    if (!env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN)
      return reply(403, "Origin not allowed.");
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    if (new URL(request.url).pathname !== "/records")
      return reply(404, "Not found.");
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return reply(405, "Use POST.");
    if (
      !env.OWNER_KEY ||
      env.OWNER_KEY.length < 32 ||
      !env.GITHUB_TOKEN ||
      !env.GITHUB_REPOSITORY ||
      !env.GITHUB_REF
    )
      return reply(503, "Save service is not configured.");
    const auth = request.headers.get("Authorization") || "";
    if (
      auth.length > 512 ||
      !(await equalSecret(auth, `Bearer ${env.OWNER_KEY}`))
    )
      return reply(401, "Incorrect owner key.");
    if (
      !(request.headers.get("Content-Type") || "").startsWith(
        "application/json",
      )
    )
      return reply(415, "Use JSON.");
    let record;
    try {
      const reader = request.body?.getReader();
      if (!reader) return reply(400, "Missing body.");
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX) {
          await reader.cancel();
          return reply(413, "Record too large.");
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.length;
      }
      record = validateRecord(JSON.parse(new TextDecoder().decode(bytes)));
    } catch {
      return reply(400, "Invalid record.");
    }
    try {
      const response = await fetch(
        `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/workflows/save-record.yml/dispatches`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "Side-A-Catalog",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ref: env.GITHUB_REF,
            inputs: { record: JSON.stringify(record) },
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok)
        return reply(
          502,
          "GitHub could not queue the save. Check service configuration.",
        );
      return reply(
        202,
        "Queued. The record appears after GitHub publishes the catalog.",
      );
    } catch {
      return reply(502, "Save service unavailable. Retry later.");
    }
  },
};
