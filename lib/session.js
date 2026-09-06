export class SessionError extends Error {}
async function jsonResponse(response) {
  if (!response.headers.get("Content-Type")?.includes("application/json")) {
    throw new SessionError(
      "Your sign-in has expired. Sign in again; your draft is saved on this device.",
    );
  }
  return response.json();
}
export async function readSession(fetcher = fetch) {
  const response = await fetcher("/session", {
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new SessionError("Sign in again to add records.");
  const data = await jsonResponse(response);
  if (
    typeof data.email !== "string" ||
    !Number.isFinite(data.expiresAt) ||
    data.expiresAt * 1000 <= Date.now()
  )
    throw new SessionError("Sign in again to add records.");
  return data;
}
export async function submitRecord(record, fetcher = fetch) {
  const response = await fetcher("/records", {
    method: "POST",
    credentials: "same-origin",
    redirect: "error",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
    signal: AbortSignal.timeout(20000),
  });
  if (response.status === 401 || response.status === 403)
    throw new SessionError(
      "Your sign-in has expired or access was denied. Sign in again; your draft is safe.",
    );
  const data = await jsonResponse(response);
  if (response.status !== 202)
    throw new Error(
      data.message || "Save could not be queued. Your draft is still here.",
    );
  return data;
}
