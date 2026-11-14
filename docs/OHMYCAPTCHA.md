Run OhMyCaptcha beside the contact automation backend. No Python code is imported into Node.

In PowerShell, start the service:

```powershell
cd C:\Users\USER\captcha
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python -m playwright install chromium
$env:CLIENT_KEY="choose-a-local-secret"
$env:LOCAL_BASE_URL="http://localhost:30000/v1"
$env:LOCAL_MODEL="Qwen/Qwen3.5-2B"
.\.venv\Scripts\python main.py
```

LOCAL_BASE_URL must point to a running OpenAI-compatible vision model server. Browser solvers can also require CLOUD_BASE_URL, CLOUD_API_KEY and CLOUD_MODEL for audio recognition; see the captcha project README. The Python service is not a bundled model.

Set these entries in contact_page_automation/backend/.env, then restart the backend:

```dotenv
CAPTCHA_SOLVING_ENABLED=true
OHMYCAPTCHA_URL=http://127.0.0.1:8000
OHMYCAPTCHA_CLIENT_KEY=choose-a-local-secret
OHMYCAPTCHA_TIMEOUT_MS=120000
```

The client key must match CLIENT_KEY on the Python service. Test health with Invoke-RestMethod http://127.0.0.1:8000/api/v1/health and start with a dry run on a website you control.

Image CAPTCHAs use ImageToTextTask. Explicit .g-recaptcha, .h-captcha and .cf-turnstile widgets with data-sitekey use the corresponding browser task. Answers are entered before the existing submission and confirmation checks. No success is assumed from merely receiving an answer.

If OHMYCAPTCHA_URL is unset, the existing FastCaptcha path remains available. Automatic solving still requires CAPTCHA_SOLVING_ENABLED=true. Failed solving falls back to manual completion in Visible browser mode, or manual review in Headless mode. CAPTCHA_MANUAL_ENTRY_TIMEOUT_SECONDS controls the manual wait.

Passive reCAPTCHA v3 remains site-managed. Full-page Cloudflare browser challenges still require a person. Widgets without an explicit site key, response field, or named callback also need manual completion. Tokens from a separate browser may be rejected by the target site; this integration does not guarantee acceptance across websites.

The companion captcha/src/services/recognition.py change adds a text-transcription response to the model prompt. Keep that change when updating the Python service; older prompts only describe coordinate-based challenges.
