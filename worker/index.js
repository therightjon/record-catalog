import { validateRecord } from "../lib/record.js";
import { authenticate, AccessError } from "./access.js";
const MAX = 4096;
const securityHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self' https://musicbrainz.org; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
function reply(status, message, extra = {}) {
  return new Response(JSON.stringify({ message, ...extra }), {
    status,
    headers: { ...securityHeaders, "Content-Type": "application/json" },
  });
}
function secure(response) {
  const result = new Response(response.body, response);
  for (const [name, value] of Object.entries(securityHeaders))
    result.headers.set(name, value);
  return result;
}
function validOrigin(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.origin === value;
  } catch {
    return false;
  }
}
export function createWorker(resolveKey) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (!validOrigin(env.ADMIN_ORIGIN))
        return reply(
          503,
          "Sign-in is not configured. Set ADMIN_ORIGIN in the Worker configuration.",
        );
      if (url.origin !== env.ADMIN_ORIGIN)
        return reply(403, "Use the configured sign-in address.");
      let identity;
      try {
        identity = await authenticate(request, env, resolveKey);
      } catch (error) {
        return reply(
          error instanceof AccessError ? error.status : 503,
          error instanceof AccessError
            ? error.message
            : "Sign-in is temporarily unavailable.",
        );
      }

      if (url.pathname === "/records") {
        if (request.method !== "POST") return reply(405, "Use POST.");
        // All writes originate from this Worker-hosted page. No cross-site CORS grant.
        if (request.headers.get("Origin") !== env.ADMIN_ORIGIN)
          return reply(403, "Open the add-record page to save.");
        if (
          (request.headers.get("Content-Type") || "").split(";")[0].trim() !==
          "application/json"
        )
          return reply(415, "Use JSON.");
        if (!env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY || !env.GITHUB_REF)
          return reply(503, "Save service is not configured.");
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
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
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
      }
      if (!["GET", "HEAD"].includes(request.method))
        return reply(405, "Method not allowed.");
      if (url.pathname === "/session")
        return reply(200, "Signed in.", identity);
      if (url.pathname === "/config.js") {
        return new Response(
          `export default ${JSON.stringify({
            title: "Side A",
            admin: true,
            adminUrl: env.ADMIN_ORIGIN + "/",
            publicCatalogUrl: env.PUBLIC_CATALOG_URL,
            musicBrainzContact: "https://github.com/" + env.GITHUB_REPOSITORY,
          })};`,
          {
            headers: { ...securityHeaders, "Content-Type": "text/javascript" },
          },
        );
      }
      if (url.pathname === "/data/records.json") {
        try {
          const catalogUrl = new URL(
            "data/records.json",
            env.PUBLIC_CATALOG_URL,
          );
          if (catalogUrl.protocol !== "https:") throw Error();
          // Fetch the latest published catalog, never the snapshot bundled with the Worker.
          catalogUrl.searchParams.set("t", String(Date.now()));
          const response = await fetch(catalogUrl, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(15000),
          });
          if (!response.ok) throw Error();
          const records = (await response.json()).map(validateRecord);
          return new Response(JSON.stringify(records), {
            headers: { ...securityHeaders, "Content-Type": "application/json" },
          });
        } catch {
          return reply(
            502,
            "The published catalog is temporarily unavailable.",
          );
        }
      }
      // Admin sessions and assets must not be cached by an installed service worker.
      if (url.pathname === "/sw.js")
        return reply(
          404,
          "Offline caching is available on the public catalog.",
        );
      if (!env.ASSETS)
        return reply(503, "Build and deploy the add-record page assets.");
      return secure(await env.ASSETS.fetch(request));
    },
  };
}
export default createWorker();
