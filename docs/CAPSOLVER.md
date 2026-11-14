# CapSolver setup

This provider runs directly from the Node backend in contact_page_automation. The Python captcha service and local AI models are not needed for this provider.

In backend/.env set:

```dotenv
CAPTCHA_PROVIDER=capsolver
CAPTCHA_SOLVING_ENABLED=true
CAPSOLVER_API_KEY=your-provider-issued-api-key
CAPSOLVER_TIMEOUT_MS=180000
CAPTCHA_MANUAL_ENTRY_TIMEOUT_SECONDS=90
```

Get the API key from your CapSolver account dashboard. Your self-created CLIENT_KEY, the OhMyCaptcha key, and the Anthropic key are separate credentials and cannot be used as CAPSOLVER_API_KEY. Do not commit or share the key. Trial credit must be approved/available in your provider account before billable solving requests can succeed.

From the project root, restart the backend with `npm run dev:backend` and run the frontend with `npm run dev:frontend`. In Visible mode a failed request can fall back to manual completion; in Headless mode it stops for review. Setting CAPTCHA_SOLVING_ENABLED=false prevents provider calls.

## Supported by this integration

- reCAPTCHA v2, including explicit enterprise and invisible v2 widgets with discoverable site keys. The adapter reads explicit widget attributes and rendered anchor iframe parameters, fills the associated response field, and invokes an associated named or discoverable registered callback.
- Cloudflare Turnstile form widgets with explicit site keys. Action and cdata attributes are passed to CapSolver.
- Image-to-text CAPTCHAs through CapSolver's synchronous OCR endpoint, using the existing image capture and entry flow.

hCaptcha, passive reCAPTCHA v3, full-page Cloudflare challenges, and integrations whose response/callback cannot be located are not implemented for CapSolver here. They remain site-managed or require manual review. The adapter does not claim support for every provider product.

## What success means

A returned token is a response prepared for submission. It may not visually tick the checkbox. The backend verifies that it is still present, belongs to the selected form and current URL, and is under 90 seconds old. It does not reuse receipts across pages. A new widget, cleared response, or outstanding unsupported challenge blocks the prepared response from passing the final check.

A dry run does not submit or establish acceptance. For a live run the website must return a positive confirmation; visible validation errors take priority. CAPTCHA rejection is a failed/uncertain submission, never automatically retried. Check delivery before manually retrying any live submission.

First validate locally using the test commands below, then test one intended website. Real provider calls consume credits, including dry-run CAPTCHA preparation. No live provider call or third-party form submission is performed by the automated tests.

```powershell
cd backend
node --test test/capSolver.test.js test/capSolver.browser.test.js test/websiteProcessor.test.js test/ohMyCaptcha.test.js test/submissionVerifier.test.js test/formSubmitter.test.js
```

The browser tests use local HTML with mocked provider responses and block external requests. They verify response field scoping, named callbacks, dynamic reCAPTCHA detection, registered callbacks, and Turnstile metadata.

## Troubleshooting

- CAPSOLVER_KEY_MISSING: add the provider-issued key to backend/.env and restart the backend.
- ERROR_ZERO_BALANCE: confirm your provider balance or trial credit in the dashboard.
- CAPTCHA unsupported / callback missing: use Visible mode for manual completion; share the sanitized error code when investigating.
- Token rejected by the website: confirm site-key, enterprise type, action, and any additional parameters with the provider. CapSolver may need site-specific configuration; successful API responses do not guarantee the target website will accept them.

API references: [reCAPTCHA v2](https://docs.capsolver.com/en/guide/captcha/ReCaptchaV2/), [Turnstile](https://docs.capsolver.com/en/guide/captcha/cloudflare_turnstile/), [createTask](https://docs.capsolver.com/en/guide/api-createtask/), [getTaskResult](https://docs.capsolver.com/en/guide/api-gettaskresult/), [OCR](https://docs.capsolver.com/en/guide/recognition/ImageToTextTask/).
