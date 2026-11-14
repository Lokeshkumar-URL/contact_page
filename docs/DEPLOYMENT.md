# Deploy contact_page_automation independently

Deploy only this repository. With CAPTCHA_PROVIDER=capsolver, the backend calls https://api.capsolver.com directly. Do not upload C:\Users\USER\captcha, its virtual environment, or its model service. Existing OhMyCaptcha adapter files in this repository are inactive when CapSolver is selected; they do not start a Python process.

## Server requirements

- A persistent Node.js host or VPS with outbound HTTPS to CapSolver, target websites, Google APIs, and Anthropic if configured.
- Chrome for Puppeteer with its Linux system dependencies, or the corresponding Windows browser installation. Use a current Node LTS version compatible with the locked dependencies.
- Persistent writable backend/storage for run history, screenshots, and field mappings.
- One backend process/replica: jobs and locks use in-process memory and JSON persistence. Do not enable clustered workers or multiple replicas without shared storage and job coordination.

This is a browser automation worker, so static-only hosting cannot run the backend. A server without a display must use Headless browser mode. Visible mode needs an actual desktop/display and is not an interactive browser on the remote dashboard.

## Environment

Copy deploy/production.env.example to backend/.env on the server, replace its sample values, and keep it out of source control. Configure secrets through the hosting platform instead if it provides environment-variable management.

Required production choices:

```dotenv
NODE_ENV=production
CAPTCHA_PROVIDER=capsolver
CAPTCHA_SOLVING_ENABLED=true
CAPSOLVER_API_KEY=your-actual-capsolver-key
PUPPETEER_HEADLESS=true
CAPTCHA_MANUAL_ENTRY_TIMEOUT_SECONDS=0
API_AUTH_TOKEN=your-long-random-backend-secret
FRONTEND_ORIGIN=https://your-dashboard-domain
AUTOMATION_DRY_RUN=true
```

Use the provider-issued CapSolver key, not the self-generated Python CLIENT_KEY. The last account check returned HTTP 401 / ERROR_KEY_DENIED_ACCESS; replace or correct that key before expecting automatic solving. A live server does not fix provider authentication or guarantee accepted CAPTCHA tokens.

Keep Google Sheets and optional Anthropic credentials server-side. Grant the Google service-account email access to the selected sheet.

## Install and start

Upload/clone the contact_page_automation source, package-lock.json, and workspace package files. Exclude local node_modules, .env files, generated screenshots, old run history unless intentionally migrating it, and build/cache directories. Install on the destination OS; do not copy Windows dependencies to Linux.

From the repository root:

```sh
npm ci
```

On Debian/Ubuntu, install Puppeteer's matching browser and OS dependencies using the documented command (dependency installation needs administrator/root access):

```sh
npx puppeteer browsers install chrome --install-deps
```

If the dependency install is performed by root, ensure the downloaded browser is installed in a cache directory accessible to the actual backend service user. Configure PUPPETEER_CACHE_DIR consistently at install and runtime when needed. Do not disable Chrome's sandbox merely to work around missing installation or permissions.

Start from backend so dotenv finds backend/.env:

```sh
cd backend
npm start
```

Configure the server's service manager with backend as its working directory, environment variables, automatic restart, and sufficient shutdown time for the app to persist state. Check GET /api/health before running any jobs.

## Frontend and access

Build the frontend with VITE_API_BASE_URL=/api and VITE_API_AUTH_TOKEN unset/empty when using the same-origin reverse-proxy layout below. Run `npm run build --workspace frontend` from the repository root, then serve frontend/dist.

VITE_* variables are included in browser JavaScript. Do not put CapSolver, Google, Anthropic, or a private backend authentication secret in the frontend build. The current application has no operator login screen; protect the dashboard and API with an authenticated HTTPS reverse proxy or an identity gateway before public access.

One suitable single-server layout is:

```text
Operator -> authenticated HTTPS reverse proxy
  /       -> frontend/dist
  /api/   -> Node backend on private port 5173
Node backend -> CapSolver API, Google Sheets, target websites
```

The proxy must authenticate operator requests, then replace the upstream Authorization header with `Bearer <API_AUTH_TOKEN>` so the backend remains protected without embedding that token in the JavaScript bundle. Keep the Node port inaccessible from the public network. A Basic-auth proxy must use HTTPS and authenticate every request, including API, event-stream, and screenshot requests. Preserve /api in forwarded paths.

For the /api/ route, disable proxy buffering and configure a long read timeout for server-sent events. The frontend subscribes to live progress and otherwise may appear stalled despite a running worker. Use TLS and the actual dashboard domain in FRONTEND_ORIGIN.

## First server check

1. Verify API health, operator authentication, screenshot access, and streamed progress.
2. Verify CapSolver authentication/balance using its getBalance endpoint; this is not a billable solve.
3. In the dashboard select Headless mode. A saved browserMode=visible from an earlier session overrides the environment default.
4. Run one dry run. CAPTCHA preparation can consume provider credit even in dry-run mode; it does not prove website acceptance.
5. Test one intended live submission and confirm its receipt before broadening a run. Do not automatically repeat uncertain submissions.

CapSolver here supports reCAPTCHA v2, explicit Turnstile widgets, and image-text CAPTCHAs. hCaptcha and full-page Cloudflare challenges remain unsupported by this adapter. Without an on-server desktop, unsupported or failed challenges go to manual review rather than waiting for an operator who cannot see the browser.

See [CapSolver setup](CAPSOLVER.md), [Puppeteer installation](https://pptr.dev/guides/installation), and [browser/system dependency installation](https://pptr.dev/browsers-api).
