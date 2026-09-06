# Side A — your vinyl record catalog

A mobile-first, single-page record shelf built with HTML, CSS and vanilla JavaScript. GitHub Pages serves the catalog; one Cloudflare Worker authenticates writes and triggers GitHub Actions. There is no database and no frontend framework.

## What works

- Search MusicBrainz by catalog number, typed barcode, or artist/title. Choose the matching vinyl pressing from paginated results.
- Scan barcodes with the rear phone camera using locally bundled ZXing. Type digits if camera access is unavailable.
- Fetch artwork from Cover Art Archive, with a local fallback for missing covers.
- Browse, filter, sort and inspect the collection in `data/records.json`.
- Install a home-screen app; browse the cached catalog offline. Lookup and submission require a connection. Remote artwork is not cached for offline use.
- Keep drafts on the current device, export a backup, and send them after unlocking saving.
- Track queued records until a refreshed published catalog confirms them.
- Validate at both the endpoint and Action, deduplicate by MusicBrainz release ID, retry concurrent Git pushes, and publish automatically after successful saves.

The catalog starts empty intentionally. Different pressings remain separate; multiple copies of the same pressing are treated as one record. Cover-photo OCR, collection editing/deleting, and arbitrary manual record entry are not included. Artist/title search is supported.

## Local preview

Requires Node.js 20+ (22 recommended), npm and Python 3 for the preview server.

```sh
npm ci
npm test
npm run build
python3 -m http.server 8080 --directory dist
```

Open http://localhost:8080. Rebuild after edits. Serve `dist`, not the repository root: the build copies the pinned scanner bundle into the public assets. No secrets or Worker source enter the deployment. A localhost camera test uses your computer camera; test the deployed HTTPS site on an actual phone before relying on scanning.

## 1. Publish to GitHub Pages

1. Create a GitHub repository named `record-catalog` with default branch `main`. Copy **all this folder's contents, including `.github`**, into it, commit and push. Do not commit `node_modules`, `dist`, or secrets.
2. In repository **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source.
3. Allow GitHub Actions to run. The save workflow explicitly requests `contents: write`; an organization policy or branch rule must also permit that bot to commit to `main`. If your branch requires pull requests, this direct-write design needs an approved bot bypass or a dedicated catalog repository.
4. Run **Publish catalog** under Actions if the initial push happened before enabling Pages.
5. Visit `https://YOUR-NAME.github.io/record-catalog/`. Relative assets and manifest scope support project subpaths and custom domains.

Both workflows use `main`. If your branch has another name, replace `main` throughout both workflow files and in the Worker's `GITHUB_REF`. The workflow files must exist on the default branch.

## 2. Configure the authenticated save endpoint

The default is a personal owner key: a random 256-bit bearer credential, entered into Settings each browser session. The GitHub token never goes to the browser. CORS restricts browser origins; the owner key is the actual authorization mechanism.

1. In GitHub **Settings → Developer settings → Personal access tokens → Fine-grained tokens**, create an expiring token restricted to this repository with repository **Actions: Read and write** (plus automatic Metadata read). The Worker only needs to dispatch `save-record.yml`; it does not need Contents write. The Action gets its own short-lived `GITHUB_TOKEN` with Contents write.
2. Sign into Cloudflare and install/use its official Wrangler CLI:

   ```sh
   npx wrangler login
   ```

3. Edit `worker/wrangler.toml`:

   ```toml
   [vars]
   ALLOWED_ORIGIN = "https://YOUR-NAME.github.io"
   GITHUB_REPOSITORY = "YOUR-NAME/record-catalog"
   GITHUB_REF = "main"
   ```

   `ALLOWED_ORIGIN` is the exact scheme + hostname (+ port if needed), **without** the `/record-catalog` path or trailing slash. Use your custom domain's origin if applicable.

4. Generate an owner key in your own terminal, then keep it in your password manager:

   ```sh
   openssl rand -hex 32
   ```

5. Store both secrets through Wrangler's interactive prompts:

   ```sh
   cd worker
   npx wrangler secret put OWNER_KEY
   npx wrangler secret put GITHUB_TOKEN
   npx wrangler deploy
   cd ..
   ```

   Paste the random owner key into the first prompt and the fine-grained GitHub token into the second. Never paste them into `config.js`, the TOML file, Actions inputs, a commit or a URL. Rotate the owner key with the same command if needed. Rotate the GitHub token before it expires.

6. Edit public `config.js`:

   ```js
   export default {
     title: 'Side A',
     saveEndpoint: 'https://side-a-save.YOUR-SUBDOMAIN.workers.dev/records',
     musicBrainzContact: 'https://github.com/YOUR-NAME/record-catalog',
   };
   ```

7. Commit and push the configuration change. After publication, open **Settings** in the catalog, enter the **owner key** (not the GitHub token), and unlock saving.
8. Find a record and add it. It first appears under “Waiting to join the shelf.” Check GitHub Actions for **Save record** followed by **Publish catalog**. Refresh the catalog after publication: the queued card is replaced by a catalog card.

No Cloudflare account or repository has been provisioned by this project. Service availability, quotas and account billing are controlled by those providers.

## How a save works

```text
Phone → POST /records + owner key → Cloudflare Worker
      → GitHub workflow_dispatch → Save record Action
      → validate + deduplicate → commit + push data/records.json
      → Publish catalog workflow → GitHub Pages
      → Refresh → confirmed record
```

`202 Accepted` means queued, not committed. A failed Action remains visible as queued on the device: inspect Actions, resolve the error and use Retry. Repeated submissions are safe because the MusicBrainz release ID is the deduplication key. A timeout can occur after dispatch; retry remains safe. Dismissing a queued item only removes the local indicator, **not** the submitted job or published record.

The Pages workflow uses `workflow_run` after a successful Save record workflow. This is deliberate: a push made with GitHub's `GITHUB_TOKEN` normally does **not** trigger another push workflow. The deploy job checks out the latest `main`. Pages deploys may coalesce when many saves arrive; the latest deployment includes the latest committed catalog.

Concurrent saves each fetch the latest branch, reapply their validated record and retry a rejected push up to five times. There is no save-level concurrency group that could silently cancel queued submissions.

## Data and safety

The Action and Worker share `lib/record.js`. Unknown fields, malformed IDs, oversized strings, control characters, invalid years/barcodes and non-vinyl formats are rejected. The endpoint bounds the body to 4 KB, requires an exact allowed origin, checks a hashed owner credential, and dispatches only to the configured repository, workflow and branch. Upstream errors do not expose the GitHub token or private response bodies. Records render as text; artwork URLs derive from validated IDs.

Example shape (illustrative ID, not an actual MusicBrainz release):

```json
{
  "id": "12345678-1234-1234-1234-123456789abc",
  "title": "Album title",
  "artist": "Artist name",
  "year": "1984",
  "country": "US",
  "catalogNumber": "ABC 123",
  "label": "Label name",
  "barcode": "0123456789012",
  "format": "12\" Vinyl"
}
```

Validation checks shape, not the historical correctness of metadata. Only unlock with a trusted owner. Anyone with the owner key can submit catalog records; there is no multi-user login, revocation per device, or account recovery. Do not use a memorable password as the key. Deploy behind additional rate limits/Cloudflare Access if your needs extend beyond a personal collection. No automatic retry loop sends drafts without an explicit send action.

Your published catalog is public on GitHub Pages. Drafts use localStorage, are scoped to the site's path, and disappear if browser site data is cleared. The key stays only in JavaScript memory. Export produces `{ records, drafts }`; there is no automatic import UI. Recover drafts by submitting their individual validated objects using the Save record workflow, or carefully merging records by ID in `data/records.json` and committing. Export does not contain credentials.

## PWA behavior and maintenance

On iPhone, use Safari → Share → Add to Home Screen. On Android, use the browser's Install/Add to Home Screen option. HTTPS is required outside localhost. Offline browsing becomes available after the service worker finishes installing; an initial visit needs a connection. Missing offline artwork uses the local placeholder.

The service worker uses network-first requests for a small allowlist of same-origin files, with cached fallback. It never caches POSTs, credentials or endpoint responses. On app-shell changes, bump the cache version in `sw.js`; close and reopen existing app windows to let an updated worker activate. Browser/OS storage eviction can remove offline data. Refresh reconciles pending entries with the published JSON; it does not poll private Action status.

To rename the installed app, also edit `manifest.webmanifest`. Icons are in `assets/`. Update dependency lockfiles when upgrading ZXing and retest scanning on your phone.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Search empty | Try fewer artist/title words, catalog number or barcode; not every pressing is in MusicBrainz. |
| Lookup busy / unavailable | Wait and retry. Calls are spaced by at least 1.1 seconds within a page; multiple devices share upstream limits. |
| Camera unavailable | Use HTTPS, allow camera access, open in Safari/Chrome, or type barcode digits. Scanning stops on close, cancel or backgrounding. |
| Scanner cannot load locally | Run `npm ci` and `npm run build`, then serve `dist`. |
| Save returns 401 | Re-enter the owner key; it is not your GitHub token. |
| Save is blocked by CORS | Compare the browser origin exactly to `ALLOWED_ORIGIN`. |
| Save returns 502 | Check token expiry, Actions write permission, repository, branch and workflow filename. |
| Queued indefinitely | Inspect Save record and Publish catalog logs; branch protections, workflow permissions or Pages settings may be blocking it. Retry after fixing. |
| Stale app | Close all installed/browser windows, reopen online and refresh. |

## Verification

`npm test` covers invalid input, release mapping, search escaping, duplicate retries versus distinct pressings, authentication, CORS, payload bounds, dispatch routing and upstream failure handling. `npm run build` produces only the static deployment files. A real phone camera and live authenticated GitHub/Cloudflare deployment require final testing in your accounts.

## Primary references

- [MusicBrainz release search fields](https://musicbrainz.org/doc/MusicBrainz_API/Search)
- [MusicBrainz API and request limits](https://musicbrainz.org/doc/MusicBrainz_API)
- [Cover Art Archive API](https://musicbrainz.org/doc/Cover_Art_Archive/API)
- [ZXing browser camera API](https://github.com/zxing-js/browser)
- [GitHub workflow triggering and token behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
