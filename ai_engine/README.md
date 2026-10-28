# Mirabi AI Engine

The AI execution process is separate from the business API. It owns provider credentials and invokes registered model adapters. The business backend remains responsible for end-user JWT authentication, business context authorization, admin authorization, and all Pet/task/EXP writes.

## Local setup

1. Create `backend/.env` from `backend/.env.example` and `ai_engine/.env` from this directory's `.env.example`.
2. Set the same random value in backend `BACKEND_AI_SERVICE_TOKEN` and AI Engine `AI_SERVICE_TOKEN`.
3. Put `OPENAI_API_KEY` only in `ai_engine/.env`. `DATABASE_URL` points at the existing backend SQLite database; no second database is created.
4. Start from the repository root in separate terminals:

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

```powershell
cd ..
backend\.venv\Scripts\python.exe -m uvicorn ai_engine.app:app --reload --host 127.0.0.1 --port 8002 --env-file ai_engine\.env
```

The AI service offers a public health endpoint and service-token-protected `/internal/v1/runs` API. Do not expose port 8002 to end users or the public internet. In production, place it on a private network and use a secret manager for the shared token and provider keys.

## Ownership boundary

- `backend/app`: user auth, business APIs, AI admin APIs, AI schema/migration, authorized context and service-to-service client.
- `ai_engine`: inference app, prompt rendering/input-output validation, retry/timeout execution and provider adapters.
- Both processes use the existing database. Only backend applies schema migrations. AI Engine never applies business migrations.
- To add a provider, implement `ProviderCall` in `providers.py`, register it in `PROVIDERS`, then allow it in backend admin configuration.
