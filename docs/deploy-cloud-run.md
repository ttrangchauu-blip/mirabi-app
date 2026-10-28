# Test deployment: Cloud Run + Firebase App Distribution

Backend and AI Engine run on Google Cloud Run, data lives in PostgreSQL, and testers install the Android APK / iOS
IPA from Firebase App Distribution. Everything below runs in **Google Cloud Shell** (browser terminal with `gcloud`
preinstalled), so nothing has to be installed on your computer except Node (already used for `mobile/`).

```
phone (APK/IPA) ──https──> Cloud Run "mirabi-api"  (app.main:app)
                                 │ X-AI-Service-Token
                                 v
                           Cloud Run "mirabi-ai"   (ai_engine.app:app) ──> OpenAI
                both ──> PostgreSQL (Neon / Supabase / Cloud SQL)
```

## 0. Prerequisites
- A Firebase project on the **Blaze** plan (Cloud Run needs billing). The Firebase project *is* a Google Cloud
  project with the same ID.
- An Expo account (free) for EAS cloud builds: https://expo.dev/signup
- iOS only: an Apple Developer account (paid). Ad hoc IPAs install only on devices whose UDID is registered.

## 1. PostgreSQL
SQLite does not work on Cloud Run: the container disk is wiped on every restart and deploy.

Create a Postgres database, for example on Neon (free tier, pick region *Singapore*), and copy its connection
string. Change the scheme to the psycopg driver:

```
postgresql://user:pass@host/db?sslmode=require
postgresql+psycopg://user:pass@host/db?sslmode=require      <- use this as DATABASE_URL
```

Cloud SQL works too (`--add-cloudsql-instances`), but has no free tier.

The backend creates all tables on first start (`app/migrations.py`). Lessons are seeded automatically.

## 2. Deploy to Cloud Run (Cloud Shell)
Open https://console.cloud.google.com/?cloudshell=true with the Firebase project selected, then:

```bash
gcloud config set project <PROJECT_ID>
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
git clone https://github.com/ttrangchauu-blip/mirabi-app.git && cd mirabi-app
python3 -c "import secrets; print(secrets.token_urlsafe(48))"   # run twice: JWT secret + AI service token
```

Create the env files **outside** the repository so they are never committed or uploaded
(`--env-vars-file` is used because `--set-env-vars` splits values on commas):

```yaml
# ~/mirabi-ai.env.yaml
APP_MODULE: ai_engine.app:app
ENVIRONMENT: production
AI_SERVICE_ROLE: engine
DATABASE_URL: postgresql+psycopg://...
JWT_SECRET: <jwt secret>
AI_SERVICE_TOKEN: <ai service token>
OPENAI_API_KEY: sk-...
OPENAI_MODEL: gpt-4.1-mini
```

```yaml
# ~/mirabi-api.env.yaml
ENVIRONMENT: production
DATABASE_URL: postgresql+psycopg://...
JWT_SECRET: <jwt secret>
BACKEND_AI_SERVICE_TOKEN: <ai service token>
AI_SERVICE_URL: https://mirabi-ai-xxxx.asia-southeast1.run.app   # filled in after the AI deploy
EMAIL_BACKEND: disabled
CORS_ORIGINS: https://<PROJECT_ID>.web.app
AI_ADMIN_EMAILS: you@example.com
```

Deploy the AI Engine first, then put its URL into `AI_SERVICE_URL` and deploy the API:

```bash
gcloud run deploy mirabi-ai --source . --region asia-southeast1 --allow-unauthenticated \
  --max-instances 1 --env-vars-file ~/mirabi-ai.env.yaml
gcloud run deploy mirabi-api --source . --region asia-southeast1 --allow-unauthenticated \
  --max-instances 1 --timeout 3600 --env-vars-file ~/mirabi-api.env.yaml
curl https://mirabi-api-xxxx.asia-southeast1.run.app/health        # {"status":"healthy"}
```

Why these flags:
- `--max-instances 1`: rate limits, realtime rooms and background sweeps are per process (README, *Known
  limitations*). One instance keeps them consistent.
- `--timeout 3600`: Study Together WebSockets are closed when the request timeout is reached; the app reconnects
  or falls back to polling.
- The AI Engine URL is public but every call needs `X-AI-Service-Token`. For stricter isolation put both services
  behind a VPC with `--ingress internal`.
- With scale to zero, the first request after idle time waits for a cold start (startup seeds lessons). Add
  `--min-instances 1` for faster tests at extra cost.

For anything beyond testing, move `JWT_SECRET`, `OPENAI_API_KEY` and `DATABASE_URL` to Secret Manager
(`--set-secrets`).

Redeploy after a code change: `git pull` in Cloud Shell and run the same `gcloud run deploy` command.

## 3. Build the APK / IPA (EAS)
Set the API URL in [`mobile/eas.json`](../mobile/eas.json) (`build.preview.env.EXPO_PUBLIC_API_URL`) to the
`mirabi-api` URL. It is compiled into the app, so changing it requires a new build. Then, on your computer:

```bash
cd mobile
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile preview      # -> .apk download link
npx eas-cli@latest device:create                           # iOS: register each test device first
npx eas-cli@latest build -p ios --profile preview          # -> .ipa (ad hoc), asks for Apple login
```

Bundle ID / package name: `com.mirabi.app` (`mobile/app.json`). Bump `expo.version` for each new test release so
testers can tell builds apart.

## 4. Firebase App Distribution
1. Firebase console → Project settings → *Add app*: Android `com.mirabi.app` and iOS `com.mirabi.app`. No
   `google-services.json` / `GoogleService-Info.plist` is needed (the app uses only local notifications).
2. Release & Monitor → **App Distribution** → pick the app → drag in the `.apk` / `.ipa` → add testers' emails
   (or a tester group) → *Distribute*.
3. Testers get an email, accept the invite and install. Android testers must allow installs from unknown sources.
   iOS testers can only install if their device UDID was registered before the build; App Distribution can
   collect UDIDs from invited testers (*Testers & Groups* → export UDIDs → `eas device:create` → rebuild).

Command line alternative:
`npx firebase-tools@latest appdistribution:distribute app.apk --app <FIREBASE_APP_ID> --testers "a@x.com,b@y.com"`.
