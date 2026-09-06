# Side A — your vinyl record catalog

A mobile-first record shelf using HTML, CSS and vanilla JavaScript, with `data/records.json` as the catalog. [Public catalog](https://therightjon.github.io/record-catalog/) · [Repository](https://github.com/therightjon/record-catalog).

Anyone can browse the public GitHub Pages site. **Adding records happens on a separate Cloudflare Worker page protected by Cloudflare Access email sign-in.** That page and its save endpoint share one origin, so authentication works without cross-site cookies or CORS exceptions.

The code is ready for Access, but Cloudflare account setup is still required. Until you configure the Worker address, the public sign-in button explains that setup is pending. The Worker denies all access until its authentication configuration is complete.

## Features

- MusicBrainz lookup by catalog number, barcode digits, or artist/title; choose the matching vinyl pressing from paginated results.
- Rear-camera barcode scanning with a locally bundled ZXing library and typed-digit fallback.
- Cover Art Archive artwork with a local placeholder for missing covers.
- Collection filtering, sorting, release details and offline browsing on the public site.
- Signed-in owner page with visible account identity, session expiration, sign-out, local drafts, backup export and draft import.
- Authenticated GitHub Action validates, deduplicates by release ID, commits and pushes the catalog. A second workflow publishes Pages.

Different pressings remain separate; repeat submissions of the same release ID are safe. Cover-photo OCR, arbitrary manual entry, editing/deleting records and multi-copy counts are not included.

## Local preview and checks

Use Node.js 22+ and npm. Python 3 is only needed for the static preview.

```sh
npm ci
npm test
npm run build
python3 -m http.server 8080 --directory dist
```

Open http://localhost:8080. This previews the public shelf. The authenticated owner page requires Cloudflare Access. There is deliberately no local authentication bypass in production code. Tests use locally generated RSA keys and signed fixture sessions.

The build copies only frontend files, metadata and bundled scanner assets to `dist`. Worker source, JWT code, tests and secrets are excluded. `jose` is bundled into the Worker separately by Wrangler.

## Set up Cloudflare Access

### 1. Create the Worker

Sign into [Cloudflare](https://dash.cloudflare.com/). From the repository root:

```sh
npm ci
cd worker
npx wrangler login
npx wrangler deploy
```

Complete the browser login. The deploy command automatically builds the static assets. If asked, choose a workers.dev subdomain. Copy the resulting URL, such as `https://side-a-save.YOUR-SUBDOMAIN.workers.dev`.

At this stage, opening the URL returns a setup error. This is intentional: unconfigured authentication denies access.

### 2. Protect the whole Worker hostname with Access

Open **Cloudflare Zero Trust** and complete its initial account/team setup if needed. Then:

1. Under **Access → Applications**, add a **Self-hosted** application named **Side A owner**.
2. Set the application domain to the complete Worker hostname, such as `side-a-save.YOUR-SUBDOMAIN.workers.dev`. Leave the path empty so the page, assets, `/session` and `/records` are all protected.
3. Choose a session duration, for example **24 hours**.
4. Add an **Allow** policy whose **Include → Emails** rule contains only the exact email address you will use. Do not select Everyone or allow an entire email provider's domain.
5. Enable **One-time PIN** as a login method. Cloudflare sends approved users a code by email. If it is not available in the application, add it under the account's login/identity-provider settings first.
6. Save the application. Copy its **Application Audience (AUD)** value and your team domain, such as `https://YOUR-TEAM.cloudflareaccess.com`.

Use a hostname-based self-hosted application as described above. The Worker independently validates Access JWTs and rejects requests through any hostname other than its configured `ADMIN_ORIGIN`. Preview URLs are disabled.

### 3. Fill in the Worker configuration

Edit `worker/wrangler.toml` with the four account-specific values:

```toml
ADMIN_ORIGIN = "https://side-a-save.YOUR-SUBDOMAIN.workers.dev"
ACCESS_TEAM_DOMAIN = "https://YOUR-TEAM.cloudflareaccess.com"
ACCESS_AUD = "YOUR-APPLICATION-AUDIENCE"
ALLOWED_EMAILS = "your-approved-email@example.com"
```

Both origin/domain values have **no trailing slash**. `ALLOWED_EMAILS` must match the email in the Access policy; use comma-separated exact addresses to allow more owners. These values are configuration, not bearer credentials. Only commit email addresses you are comfortable including in the public repository.

These repository settings are already filled in:

```toml
GITHUB_REPOSITORY = "therightjon/record-catalog"
GITHUB_REF = "main"
PUBLIC_CATALOG_URL = "https://therightjon.github.io/record-catalog/"
```

The public catalog URL needs its trailing slash. Never set `assets.run_worker_first` to false: the Worker must verify identity before serving static assets.

### 4. Add the GitHub secret and deploy

Create an expiring [fine-grained GitHub token](https://github.com/settings/personal-access-tokens/new) with:

- Resource owner: `therightjon`.
- Repository access: only `record-catalog`.
- Repository permission: **Actions: Read and write** (plus automatic Metadata read).

In the `worker` directory, run:

```sh
npx wrangler secret put GITHUB_TOKEN
npx wrangler deploy
```

Paste the token at the prompt. The Worker uses this token only to dispatch the save workflow. The GitHub Action uses its own short-lived `GITHUB_TOKEN` with Contents write to commit records. Store the fine-grained token in your password manager and replace it before expiration.

**The old `OWNER_KEY` is no longer used or accepted.** If you previously stored one, remove it after deploying this version:

```sh
npx wrangler secret delete OWNER_KEY
```

Skip that command if you never created the secret. The old `ALLOWED_ORIGIN` setting and frontend `saveEndpoint` setting have also been replaced.

### 5. Connect the public sign-in button

Edit the repository's `config.js` and set the **Worker home page**, including its trailing slash:

```js
adminUrl: "https://side-a-save.YOUR-SUBDOMAIN.workers.dev/",
```

Commit and push this change. Do not add `/records` to this URL. After **Publish catalog** completes, the public **Sign in to add records** button navigates to the Worker. Cloudflare presents the email-code login before serving the page.

### 6. Verify the complete flow

1. Open the public catalog in a private browser window. Browsing should need no login.
2. Select **Sign in to add records**. Sign in with your allowed email; confirm the owner page shows that email.
3. Find and add a record. It should say queued until **Save record** and **Publish catalog** finish in [GitHub Actions](https://github.com/therightjon/record-catalog/actions).
4. Refresh the owner page or public shelf. The record should be confirmed in the catalog. The owner page reads the latest public JSON, so it does not need redeploying after each save.
5. Sign out, and verify the owner page requires sign-in again. An unapproved email must not be allowed to save.
6. Test scanning on your actual phone over HTTPS.

Email delivery, Access policy configuration and an authenticated live dispatch must be checked in your Cloudflare account; automated local tests do not provision an account or send real login emails.

## Drafts, sessions and offline browsing

A selected record is saved locally before submission. If a session expires or the network fails, the draft stays on the device. Use **Sign in again**, then **Send drafts**. A login redirect or an HTML login page can never count as a successful submission; only a JSON `202` response is accepted.

Drafts are scoped to the page's origin/path. To move drafts from the old public page to the new owner page: open **Settings → Export collection + drafts**, sign in, then choose **Settings → Import drafts from a backup**. Import validates and deduplicates drafts and does not send them automatically. Backups contain `{ records, drafts }`; only the `drafts` array is imported. Imported drafts are limited to 1,000 records and files under 2 MB.

Signing out does not delete drafts. Clearing browser site data can delete them; export a backup before doing so. Dismissing a queued card removes only the local indicator, not its GitHub job or published record.

The public catalog has a network-first service worker for offline browsing after the first successful visit. Artwork is fetched remotely and can fall back to the placeholder offline. The owner page does not register a service worker, and its responses use `private, no-store`; sign-in and saving require a connection. Install the public site through your phone browser's Add to Home Screen option.

## Security and workflow design

The Worker verifies the `Cf-Access-Jwt-Assertion` signature with Cloudflare's team signing keys using `jose`. It checks RS256, issuer, application audience, expiry/not-before, required claims, application token type, and the configured email allowlist. A plain email header or legacy owner key cannot authorize a request. Missing configuration fails closed.

All Worker routes, including its assets and `/session`, require authentication. JSON writes also require a matching same-origin `Origin` header and JSON content type, preventing cross-site form submissions. No cross-origin write permissions are granted. The GitHub secret and Access session token are never included in frontend configuration, backups, or GitHub workflow inputs. Worker responses disable caching and framing.

The Worker and Action share strict record validation in `lib/record.js`. Requests are limited to 4 KB. Unknown fields, invalid IDs/years/barcodes, control characters and non-vinyl formats are rejected. This checks shape, not metadata's historical accuracy. Catalog content renders as text; artwork URLs derive from validated release IDs.

The save workflow fetches the latest `main`, reapplies a validated record and retries rejected Git pushes up to five times. It has no concurrency group that could cancel queued saves. Deduplication uses normalized MusicBrainz release IDs.

The Pages workflow runs after a successful save through `workflow_run`, because pushes made with GitHub's `GITHUB_TOKEN` normally do not trigger another push workflow. It checks out the latest `main`. Both workflows assume `main` is the default branch and the bot can write to it. Branch rules or organization policies requiring pull requests need an approved bot exception or a separate catalog repository.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Public sign-in says setup pending | Set `adminUrl`, commit it and wait for Pages publication. |
| Worker setup error / 503 | Fill all four Access settings and redeploy. Add the GitHub secret for saves. |
| No login screen; 401 instead | Configure an Access application covering the entire Worker hostname. |
| Sign-in succeeds, Worker denies access | Check exact team URL, AUD, allowed email, and canonical Worker origin. |
| Owner page is blank or asset requests fail | Build and deploy with the `[assets]` binding intact; ensure the whole hostname uses the same Access application. |
| Save rejected / draft remains | Sign in again, check connectivity, then retry. If the Worker reports GitHub failure, check token expiry and Actions write permission. |
| Queued indefinitely | Inspect both workflows; fix branch/Pages permissions and retry. |
| Search unavailable | MusicBrainz is rate limited. Wait, retry, or use fewer search terms. |
| Camera unavailable | Use HTTPS, allow camera access, or type the barcode digits. |

Run `npm test` for signed-session, authorization, CSRF, input validation, dispatch, response-handling and catalog tests. Run `npm run build` to build assets. To validate the Worker bundle without deploying, run `npx wrangler deploy --dry-run` from `worker/`.

## Primary references

- [Cloudflare Access for Worker hostnames](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- [Cloudflare one-time PIN login](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)
- [Validating Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Worker-first static assets](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
- [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [GitHub workflow triggering](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- [MusicBrainz search](https://musicbrainz.org/doc/MusicBrainz_API/Search), [API limits](https://musicbrainz.org/doc/MusicBrainz_API), [Cover Art Archive](https://musicbrainz.org/doc/Cover_Art_Archive/API), [ZXing](https://github.com/zxing-js/browser)
