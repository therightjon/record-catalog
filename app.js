import config from "./config.js";
import { searchQuery, fromRelease, validateRecord } from "./lib/record.js";
import { readSession, submitRecord, SessionError } from "./lib/session.js";
const $ = (id) => document.getElementById(id);
let records = [],
  pending = [],
  sessionReady = false,
  sessionTimer,
  controls,
  scanVersion = 0,
  lastSearch = 0,
  offset = 0,
  currentQuery = "",
  searching = false;
const storageKey = `side-a:${new URL(".", location.href).pathname}:pending`;
try {
  pending = JSON.parse(localStorage.getItem(storageKey) || "[]").map((p) => ({
    record: validateRecord(p.record),
    state: p.state === "queued" ? "queued" : "draft",
  }));
} catch {
  $("status").textContent = "Local drafts could not be read.";
}
$("brand").textContent = config.title;
document.title = `${config.title} · Your record collection`;
const el = (tag, text, className) => {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  if (className) n.className = className;
  return n;
};
function cover(r) {
  const img = el("img", null, "cover");
  img.alt = `${r.title} cover`;
  img.loading = "lazy";
  img.src = `https://coverartarchive.org/release/${r.id}/front-250`;
  img.onerror = () => {
    img.onerror = null;
    img.src = "assets/placeholder.svg";
  };
  return img;
}
function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(pending));
    return true;
  } catch {
    $("status").textContent =
      "Device storage is full or unavailable. Export your drafts before closing this page.";
    return false;
  }
}
function render() {
  const term = $("filter").value.toLowerCase();
  const visible = records
    .filter((r) =>
      [r.title, r.artist, r.catalogNumber, r.label].some((v) =>
        v.toLowerCase().includes(term),
      ),
    )
    .sort((a, b) =>
      $("sort").value === "year"
        ? b.year.localeCompare(a.year)
        : a[$("sort").value].localeCompare(b[$("sort").value]),
    );
  $("count").textContent = records.length;
  $("records").replaceChildren();
  for (const r of visible) {
    const b = el("button", null, "record");
    b.append(
      cover(r),
      el("strong", r.title),
      el("span", r.artist),
      el("span", [r.year, r.format, r.country].filter(Boolean).join(" · ")),
    );
    b.onclick = () => showDetail(r);
    $("records").append(b);
  }
  $("empty").hidden = records.length > 0;
  if (records.length && !visible.length)
    $("records").append(el("p", "No records match your search."));
  renderPending();
}
function renderPending() {
  $("pending-section").hidden = !pending.length;
  $("pending").replaceChildren();
  for (const item of pending) {
    const row = el("div", null, "pending-row");
    const info = el("div", null, "info");
    info.append(
      el("strong", `${item.record.artist} — ${item.record.title}`),
      el(
        "p",
        item.state === "queued"
          ? "Queued · awaiting publication"
          : item.state === "sending"
            ? "Sending…"
            : "Draft · saved on this device",
      ),
    );
    const send = el(
      "button",
      item.state === "queued" ? "Retry" : "Send",
      "quiet",
    );
    send.disabled = item.state === "sending";
    send.onclick = () => sendRecord(item);
    const remove = el("button", "Dismiss", "quiet");
    remove.disabled = item.state === "sending";
    remove.onclick = () => {
      pending = pending.filter((p) => p !== item);
      persist();
      renderPending();
    };
    row.append(info, send, remove);
    $("pending").append(row);
  }
}
async function refresh() {
  $("refresh").disabled = true;
  try {
    const response = await fetch(`data/records.json?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) throw Error();
    const data = await response.json();
    records = data.map(validateRecord);
    pending = pending.filter((p) => !records.some((r) => r.id === p.record.id));
    persist();
    render();
    $("status").textContent = navigator.onLine
      ? "Your shelf is up to date."
      : "Offline · showing your saved shelf.";
  } catch {
    $("status").textContent =
      "Could not load the catalog. Check your connection and refresh.";
    render();
  } finally {
    $("refresh").disabled = false;
  }
}
function showDetail(r) {
  const box = $("detail");
  box.replaceChildren(cover(r), el("h3", r.title), el("p", r.artist));
  const dl = el("dl");
  for (const [key, label] of Object.entries({
    year: "Year",
    format: "Format",
    country: "Country",
    label: "Label",
    catalogNumber: "Catalog no.",
    barcode: "Barcode",
  })) {
    dl.append(el("dt", label), el("dd", r[key] || "Not listed"));
  }
  const link = el("a", "View release on MusicBrainz ↗");
  link.href = `https://musicbrainz.org/release/${r.id}`;
  link.target = "_blank";
  link.rel = "noopener";
  box.append(dl, link);
  $("detail-dialog").showModal();
}
function signIn() {
  if (config.admin) {
    location.assign("/");
    return;
  }
  try {
    const url = new URL(config.adminUrl);
    if (url.protocol !== "https:" || url.username || url.password)
      throw Error();
    location.assign(url.href);
  } catch {
    $("settings-status").textContent =
      "Sign-in is not available yet. The owner needs to finish setting it up.";
    if (!$("settings-dialog").open) $("settings-dialog").showModal();
  }
}
function expireSession(
  message = "Your session has expired. Sign in again to send drafts.",
) {
  sessionReady = false;
  $("account-status").textContent = message;
  $("sign-in-again").hidden = false;
}
async function checkSession() {
  try {
    const session = await readSession();
    sessionReady = true;
    $("account-status").textContent = `Signed in as ${session.email}`;
    $("sign-in-again").hidden = true;
    clearTimeout(sessionTimer);
    sessionTimer = setTimeout(
      expireSession,
      Math.min(2147483647, Math.max(0, session.expiresAt * 1000 - Date.now())),
    );
  } catch {
    expireSession(
      "Sign in again to send records. Existing drafts are safe on this device.",
    );
  }
}
function openAdd() {
  if (!config.admin) {
    signIn();
    return;
  }
  $("add-dialog").showModal();
}
$("add-button").onclick = $("empty-add").onclick = openAdd;
$("sign-in").onclick = $("sign-in-again").onclick = signIn;
$("settings-button").onclick = () => {
  $("settings-status").textContent = config.admin
    ? sessionReady
      ? "You are signed in. New records will be sent to your shelf."
      : "Sign in again to send your saved drafts."
    : config.adminUrl
      ? "Sign in with your approved email address to add records."
      : "Sign-in is not available yet. The owner needs to finish setting it up.";
  $("sign-in").hidden = config.admin && sessionReady;
  $("settings-dialog").showModal();
};
for (const d of document.querySelectorAll("dialog")) {
  d.querySelector(".close").onclick = () => d.close();
  d.addEventListener("close", stopCamera);
}
if (config.admin) {
  $("account-row").hidden = false;
  $("account-status").textContent = "Checking your sign-in…";
  $("public-catalog").href = config.publicCatalogUrl;
  $("import-label").hidden = false;
  $("offline-note").textContent = "Use your public shelf for offline browsing.";
  checkSession();
} else {
  $("add-button").textContent = "Sign in to add records";
  $("empty-add").textContent = "Sign in to add your first record ↗";
}
$("filter").oninput = $("sort").onchange = render;
$("refresh").onclick = refresh;
$("mode").onchange = () => {
  $("query").placeholder =
    $("mode").value === "catalog"
      ? "e.g. BSK 3472"
      : $("mode").value === "barcode"
        ? "Enter barcode digits"
        : "e.g. Fleetwood Mac Rumours";
  $("query").inputMode = $("mode").value === "barcode" ? "numeric" : "text";
};
$("lookup").onsubmit = (e) => {
  e.preventDefault();
  try {
    currentQuery = searchQuery($("mode").value, $("query").value);
    offset = 0;
    lookup(false);
  } catch (err) {
    $("lookup-status").textContent = err.message;
  }
};
$("more").onclick = () => lookup(true);
async function lookup(append) {
  if (searching) return;
  searching = true;
  $("search-button").disabled = true;
  $("query").disabled = true;
  $("mode").disabled = true;
  $("more").hidden = true;
  if (!append) $("results").replaceChildren();
  $("lookup-status").textContent = "Looking through MusicBrainz…";
  try {
    await new Promise((r) =>
      setTimeout(r, Math.max(0, 1100 - (Date.now() - lastSearch))),
    );
    lastSearch = Date.now();
    const url = new URL("https://musicbrainz.org/ws/2/release/");
    url.search = new URLSearchParams({
      query: currentQuery,
      fmt: "json",
      limit: "20",
      offset: String(offset),
    });
    const headers = { Accept: "application/json" };
    if (config.musicBrainzContact)
      headers["User-Agent"] = `SideA/1.0 (${config.musicBrainzContact})`;
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok)
      throw Error(
        res.status === 503
          ? "MusicBrainz is busy. Please try again shortly."
          : "Lookup failed. Please try again.",
      );
    const data = await res.json();
    let shown = 0;
    for (const raw of data.releases || []) {
      let r;
      try {
        r = fromRelease(raw);
      } catch {
        continue;
      }
      shown++;
      const row = el("div", null, "result");
      const info = el("div", null, "info");
      info.append(
        el("strong", r.title),
        el("p", r.artist),
        el(
          "p",
          [r.year, r.country, r.label, r.catalogNumber, r.format]
            .filter(Boolean)
            .join(" · "),
        ),
      );
      const exists =
        records.some((v) => v.id === r.id) ||
        pending.some((v) => v.record.id === r.id);
      const b = el("button", exists ? "Added" : "＋ Add", "primary");
      b.disabled = exists;
      b.onclick = () => {
        const item = { record: r, state: "draft" };
        pending.push(item);
        persist();
        renderPending();
        b.textContent = "Added";
        b.disabled = true;
        if (config.admin && sessionReady && navigator.onLine) sendRecord(item);
        else
          $("lookup-status").textContent =
            "Saved as a local draft. Sign in again or reconnect to send it.";
      };
      row.append(cover(r), info, b);
      $("results").append(row);
    }
    offset += (data.releases || []).length;
    $("more").hidden = offset >= data.count;
    $("lookup-status").textContent = shown
      ? "Choose the pressing that matches your sleeve."
      : "No matching vinyl releases found. Try an artist/title or a different catalog number.";
  } catch (err) {
    $("lookup-status").textContent =
      err.name === "TimeoutError"
        ? "Search timed out. Try again."
        : err.message;
  } finally {
    searching = false;
    $("search-button").disabled = false;
    $("query").disabled = false;
    $("mode").disabled = false;
  }
}
async function sendRecord(item) {
  if (item.state === "sending") return;
  if (!config.admin) {
    $("settings-status").textContent =
      "Export your drafts here, then import the backup on the signed-in page.";
    if (!$("settings-dialog").open) $("settings-dialog").showModal();
    return;
  }
  if (!sessionReady) {
    expireSession();
    $("status").textContent = "Sign in again to send your drafts.";
    return;
  }
  const previous = item.state;
  item.state = "sending";
  renderPending();
  try {
    await submitRecord(item.record);
    item.state = "queued";
    $("status").textContent =
      "Queued for publication. Refresh in a minute to confirm.";
  } catch (err) {
    item.state = previous;
    if (err instanceof SessionError) expireSession(err.message);
    $("status").textContent =
      err instanceof TypeError
        ? "Could not reach saving. Your draft is safe. Reconnect, or sign in again if your session expired."
        : err.message || "Unable to send. Retry when online.";
    if (err instanceof TypeError) $("sign-in-again").hidden = false;
  }
  persist();
  renderPending();
}
$("retry-all").onclick = async () => {
  for (const item of [...pending].filter((p) => p.state === "draft"))
    await sendRecord(item);
};
function stopCamera() {
  scanVersion++;
  controls?.stop();
  controls = null;
  const stream = $("video").srcObject;
  stream?.getTracks().forEach((t) => t.stop());
  $("video").srcObject = null;
  $("camera").hidden = true;
  $("scan").disabled = false;
}
$("stop-camera").onclick = stopCamera;
let scannerLibrary;
function loadScanner() {
  if (!scannerLibrary)
    scannerLibrary = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "assets/zxing-browser.min.js";
      s.onload = resolve;
      s.onerror = () => {
        scannerLibrary = null;
        s.remove();
        reject(
          Error(
            "Scanner could not load. Build the site first or enter the barcode digits.",
          ),
        );
      };
      document.head.append(s);
    });
  return scannerLibrary;
}
$("scan").onclick = async () => {
  stopCamera();
  const version = scanVersion;
  $("scan").disabled = true;
  try {
    if (!navigator.mediaDevices?.getUserMedia)
      throw Error(
        "Camera requires HTTPS and a supported browser. Enter the barcode digits instead.",
      );
    await loadScanner();
    if (version !== scanVersion) return;
    $("camera").hidden = false;
    const reader = new window.ZXingBrowser.BrowserMultiFormatReader();
    const c = await reader.decodeFromConstraints(
      { video: { facingMode: { ideal: "environment" } }, audio: false },
      $("video"),
      (result, error, scanControls) => {
        if (result && version === scanVersion) {
          scanControls.stop();
          stopCamera();
          $("mode").value = "barcode";
          $("query").value = result.getText();
          $("lookup").requestSubmit();
        }
      },
    );
    if (version !== scanVersion) c.stop();
    else controls = c;
  } catch (err) {
    if (version !== scanVersion) return;
    stopCamera();
    $("lookup-status").textContent =
      err.name === "NotAllowedError"
        ? "Camera permission was denied. Allow access or type the barcode digits."
        : err.message;
  }
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopCamera();
});
$("export").onclick = () => {
  const blob = new Blob(
    [
      JSON.stringify(
        { records, drafts: pending.map((p) => p.record) },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const a = el("a");
  a.href = URL.createObjectURL(blob);
  a.download = "side-a-backup.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$("import-drafts").onchange = async (event) => {
  const file = event.target.files[0];
  if (!file || !config.admin) return;
  try {
    if (file.size > 2 * 1024 * 1024)
      throw Error("Choose a backup smaller than 2 MB.");
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.drafts) || data.drafts.length > 1000)
      throw Error("Choose a Side A backup with at most 1,000 drafts.");
    const imported = data.drafts.map(validateRecord);
    let count = 0;
    for (const record of imported) {
      if (
        !records.some((r) => r.id === record.id) &&
        !pending.some((p) => p.record.id === record.id)
      ) {
        pending.push({ record, state: "draft" });
        count++;
      }
    }
    const stored = persist();
    renderPending();
    $("settings-status").textContent = stored
      ? `Imported ${count} drafts. Use Send drafts to submit them.`
      : "Drafts are available in this window, but device storage failed. Keep your backup.";
  } catch (err) {
    $("settings-status").textContent = `Import failed: ${err.message}`;
  }
  event.target.value = "";
};
window.addEventListener("online", () => {
  refresh();
  if (config.admin) checkSession();
});

window.addEventListener("offline", () => {
  $("status").textContent =
    "Offline · browsing your saved shelf. Sending and lookup need a connection.";
});
if (!config.admin && "serviceWorker" in navigator)
  navigator.serviceWorker.register("./sw.js").catch(() => {});
refresh();
