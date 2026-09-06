import { createRemoteJWKSet, jwtVerify } from "jose";
let keySet;
let keyIssuer;

export class AccessError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function accessConfig(env) {
  const issuer = env.ACCESS_TEAM_DOMAIN;
  const emails = (env.ALLOWED_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (
    !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer || "") ||
    !env.ACCESS_AUD ||
    !emails.length ||
    !emails.every((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
  ) {
    throw new AccessError(
      503,
      "Sign-in is not configured. Complete the Cloudflare Access setup in the README.",
    );
  }
  return { issuer, emails };
}

// The optional key resolver is used by tests with real signed fixture tokens.
// Production always obtains signing keys from the configured Cloudflare team.
export async function authenticate(request, env, resolveKey) {
  const { issuer, emails } = accessConfig(env);
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || token.length > 16384)
    throw new AccessError(401, "Sign in with Cloudflare Access to continue.");
  if (!resolveKey) {
    if (keyIssuer !== issuer) {
      keySet = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), {
        timeoutDuration: 5000,
      });
      keyIssuer = issuer;
    }
    resolveKey = keySet;
  }
  let payload;
  try {
    ({ payload } = await jwtVerify(token, resolveKey, {
      algorithms: ["RS256"],
      issuer,
      audience: env.ACCESS_AUD,
      requiredClaims: ["exp", "iat", "sub", "email"],
      clockTolerance: 5,
    }));
  } catch {
    throw new AccessError(
      401,
      "Your sign-in could not be verified. Sign in again.",
    );
  }
  if (
    typeof payload.email !== "string" ||
    !emails.includes(payload.email.toLowerCase()) ||
    payload.type !== "app"
  ) {
    throw new AccessError(403, "This account is not allowed to add records.");
  }
  return { email: payload.email, expiresAt: payload.exp };
}
