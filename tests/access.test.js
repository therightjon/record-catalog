import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from "jose";
import { authenticate } from "../worker/access.js";
import { createWorker } from "../worker/index.js";
import { readSession, submitRecord, SessionError } from "../lib/session.js";
const keys = await generateKeyPair("RS256");
const otherKeys = await generateKeyPair("RS256");
const jwk = await exportJWK(keys.publicKey);
jwk.kid = "test-key";
const resolver = createLocalJWKSet({ keys: [jwk] });
const worker = createWorker(resolver);
const env = {
  ACCESS_TEAM_DOMAIN: "https://test-team.cloudflareaccess.com",
  ACCESS_AUD: "test-audience",
  ALLOWED_EMAILS: "owner@example.com",
  ADMIN_ORIGIN: "https://admin.example.com",
  PUBLIC_CATALOG_URL: "https://owner.github.io/records/",
  GITHUB_TOKEN: "private-token",
  GITHUB_REPOSITORY: "owner/records",
  GITHUB_REF: "main",
  ASSETS: {
    fetch: async () =>
      new Response("asset", { headers: { "Content-Type": "text/html" } }),
  },
};
const record = {
  id: "12345678-1234-1234-1234-123456789abc",
  artist: "Artist",
  title: "Album",
  format: "Vinyl",
};
async function token(overrides = {}, privateKey = keys.privateKey) {
  return new SignJWT({
    email: "owner@example.com",
    type: "app",
    iss: env.ACCESS_TEAM_DOMAIN,
    aud: [env.ACCESS_AUD],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 600,
    sub: "owner",
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .sign(privateKey);
}
const validToken = await token();
function request(path = "/records", options = {}) {
  const {
    jwt = validToken,
    origin = env.ADMIN_ORIGIN,
    body = record,
    method = path === "/records" ? "POST" : "GET",
    headers = {},
  } = options;
  return new Request(env.ADMIN_ORIGIN + path, {
    method,
    headers: {
      ...(jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {}),
      ...(origin ? { Origin: origin } : {}),
      "Content-Type": "application/json",
      ...headers,
    },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}
test("valid signed Access token authorizes the allowed owner", async () => {
  assert.equal(
    (await authenticate(request(), env, resolver)).email,
    "owner@example.com",
  );
});
test("missing, forged, expired, wrong audience, issuer and missing claims fail verification", async () => {
  for (const jwt of [
    null,
    "forged",
    await token({}, otherKeys.privateKey),
    await token({ exp: 10 }),
    await token({ aud: "another-app" }),
    await token({ iss: "https://evil.cloudflareaccess.com" }),
    await token({ exp: undefined }),
    await token({ nbf: Math.floor(Date.now() / 1000) + 1000 }),
  ]) {
    assert.equal(
      (await worker.fetch(request("/records", { jwt }), env)).status,
      401,
    );
  }
});
test("email allowlist and application token type are enforced, spoofed identity headers do not help", async () => {
  const jwt = await token({ email: "stranger@example.com" });
  assert.equal(
    (
      await worker.fetch(
        request("/records", {
          jwt,
          headers: {
            "Cf-Access-Authenticated-User-Email": "owner@example.com",
          },
        }),
        env,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await worker.fetch(
        request("/records", { jwt: await token({ type: "service" }) }),
        env,
      )
    ).status,
    403,
  );
});
test("unconfigured auth fails closed and legacy owner keys grant no access", async () => {
  for (const missing of [
    "ACCESS_AUD",
    "ACCESS_TEAM_DOMAIN",
    "ALLOWED_EMAILS",
    "ADMIN_ORIGIN",
  ]) {
    assert.equal(
      (await worker.fetch(request("/"), { ...env, [missing]: "" })).status,
      503,
    );
  }
  assert.equal(
    (
      await worker.fetch(
        request("/records", {
          jwt: null,
          headers: { Authorization: "Bearer old-owner-key" },
        }),
        { ...env, OWNER_KEY: "old-owner-key" },
      )
    ).status,
    401,
  );
});
test("page, config, session and assets all require a verified session", async () => {
  for (const path of [
    "/",
    "/index.html",
    "/config.js",
    "/session",
    "/assets/icon.svg",
  ]) {
    const response = await worker.fetch(request(path, { jwt: null }), env);
    assert.equal(response.status, 401);
    assert.match(response.headers.get("Cache-Control"), /no-store/);
  }
  const response = await worker.fetch(request("/config.js"), env);
  assert.equal(response.status, 200);
  const source = await response.text();
  assert.match(source, /"admin":true/);
  assert.ok(!source.includes(env.GITHUB_TOKEN));
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  assert.equal((await worker.fetch(request("/sw.js"), env)).status, 404);
  const page = await worker.fetch(request("/"), env);
  assert.match(
    page.headers.get("Content-Security-Policy"),
    /frame-ancestors 'none'/,
  );
});
test("same-origin CSRF guard, method and content type checks protect writes", async () => {
  for (const origin of [
    null,
    "https://evil.example",
    "https://owner.github.io",
  ]) {
    const response = await worker.fetch(request("/records", { origin }), env);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  }
  assert.equal(
    (await worker.fetch(request("/records", { method: "OPTIONS" }), env))
      .status,
    405,
  );
  assert.equal(
    (
      await worker.fetch(
        request("/records", { headers: { "Content-Type": "text/plain" } }),
        env,
      )
    ).status,
    415,
  );
  assert.equal(
    (await worker.fetch(new Request("https://alias.example/session"), env))
      .status,
    403,
  );
});
test("invalid and oversized record submissions are rejected after authentication", async () => {
  assert.equal(
    (
      await worker.fetch(
        request("/records", { body: { ...record, id: "bad" } }),
        env,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await worker.fetch(
        request("/records", { body: { x: "x".repeat(5000) } }),
        env,
      )
    ).status,
    413,
  );
});
test("signed owner dispatches a validated record and sees queued status", async () => {
  const original = globalThis.fetch;
  let called;
  globalThis.fetch = async (url, options) => {
    called = { url, options };
    return new Response(null, { status: 204 });
  };
  try {
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, 202);
    assert.equal(
      called.url,
      "https://api.github.com/repos/owner/records/actions/workflows/save-record.yml/dispatches",
    );
    assert.equal(JSON.parse(called.options.body).ref, "main");
    assert.equal(
      JSON.parse(JSON.parse(called.options.body).inputs.record).id,
      record.id,
    );
    assert.equal(called.options.headers["Cf-Access-Jwt-Assertion"], undefined);
  } finally {
    globalThis.fetch = original;
  }
});
test("upstream failure is reported without exposing private details", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("private details", { status: 403 });
  try {
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, 502);
    assert.ok(!(await response.text()).includes("private details"));
  } finally {
    globalThis.fetch = original;
  }
});
test("admin catalog reads the latest Pages JSON without forwarding credentials", async () => {
  const original = globalThis.fetch;
  let called;
  globalThis.fetch = async (url, options) => {
    called = { url: new URL(url), options };
    return Response.json([record]);
  };
  try {
    const response = await worker.fetch(request("/data/records.json"), env);
    assert.equal(response.status, 200);
    assert.equal((await response.json())[0].id, record.id);
    assert.equal(called.url.origin, "https://owner.github.io");
    assert.equal(called.url.pathname, "/records/data/records.json");
    assert.deepEqual(called.options.headers, { Accept: "application/json" });
    assert.match(response.headers.get("Cache-Control"), /no-store/);
  } finally {
    globalThis.fetch = original;
  }
});
test("browser sends same-origin cookies and never mistakes login HTML for a queued save", async () => {
  let options;
  await submitRecord(record, async (url, init) => {
    assert.equal(url, "/records");
    options = init;
    return Response.json({ message: "queued" }, { status: 202 });
  });
  assert.equal(options.credentials, "same-origin");
  assert.equal(options.redirect, "error");
  assert.equal(options.headers.Authorization, undefined);
  await assert.rejects(
    submitRecord(
      record,
      async () =>
        new Response("<html>Login</html>", {
          headers: { "Content-Type": "text/html" },
        }),
    ),
    SessionError,
  );
  await assert.rejects(
    submitRecord(record, async () =>
      Response.json({ message: "no" }, { status: 401 }),
    ),
    SessionError,
  );
  await assert.rejects(
    submitRecord(record, async () =>
      Response.json({ message: "not queued" }, { status: 200 }),
    ),
    /not queued/,
  );
  await assert.rejects(
    readSession(async () =>
      Response.json({ email: "owner@example.com", expiresAt: 1 }),
    ),
    SessionError,
  );
});
