# SmartRec - Developer Guide

**Trạng thái:** Local development guide, based on repository layout; dependency/tool versions can change.

## 1. Repository layout

```text
SmartRec/
├── src/main/java/                 Spring Boot backend
├── src/test/java/                 Backend tests
├── Frontend/smartrec-frontend/    React/Vite frontend
├── ai-engine/                     FastAPI AI service
├── documents/                     Project/customer documentation
├── docker-compose.yml             Local dependency stack
├── pom.xml                         Maven project
└── mvnw.cmd                        Maven Wrapper for Windows
```

## 2. Prerequisites

- Java 17+
- Maven Wrapper included (`mvnw.cmd` on Windows)
- Node.js/npm compatible with frontend package lock
- Python version compatible with `ai-engine` requirements
- Docker Desktop with Compose

Confirm actual supported versions with CI/build environment before onboarding.

## 3. Start local dependencies

From repository root in PowerShell:

```powershell
docker compose up -d
docker compose ps
```

Compose starts PostgreSQL, Redis, MinIO, ChromaDB and AI Engine. The Spring backend and Vite frontend are started separately. Avoid production credentials/configuration in local shared environments.

## 4. Run backend

```powershell
.\mvnw.cmd spring-boot:run
```

Default local backend port is `8082`; context path is `/api/v1`. Spring profile defaults to `dev`. Environment variables/configuration may override application YAML.

Run backend tests:

```powershell
.\mvnw.cmd test
```

Current repository includes at least a user service unit test; do not assume broad integration coverage without inspecting test reports.

## 5. Run frontend

```powershell
Set-Location .\Frontend\smartrec-frontend
npm ci
npm run dev
```

Vite defaults to port `5173`. Other scripts:

```powershell
npm run build
npm run lint
npm run preview
```

Frontend lint command targets JS/JSX; check whether TypeScript sources receive separate static checks.

## 6. Run AI Engine independently (optional)

Use a project-approved Python environment; do not install packages into a shared/system interpreter. On Windows, create/activate a venv in a developer-local location and install dependencies from `ai-engine/requirements.txt`, then:

```powershell
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Alternatively use the Compose service. Existing endpoints are `/` and `/health`; test `/health` for service and FFmpeg information. Pipeline files do not imply production AI workflow integration.

## 7. Configuration and local ports

See [Deployment and Operations](./14-deployment-and-operations.md). Never commit `.env`, credentials, production URLs or tokens. Use placeholders in examples. The root README and application context path should be cross-checked when constructing API URLs.

## 8. Code navigation

- Controller -> HTTP contracts and routing.
- Service interfaces/implementations -> business behavior and ownership checks.
- Repository/entity -> persistence model.
- `security/` and `config/` -> JWT, security chain, CORS, storage clients.
- Frontend `pages/`, `features/`, `hooks/`, `api/`, `services/` -> UI workflows and API wiring.
- `ai-engine/app/api/routes.py` -> current FastAPI routes.

## 9. Development quality gates

Before submitting a change:

1. Add or update focused tests for changed behavior.
2. Run the narrow relevant tests; then backend test suite when appropriate.
3. Run frontend lint/build for frontend changes.
4. Review API contracts, ownership/security, error handling, and docs.
5. Record command and result; never label unrun tests as passed.

## 10. Troubleshooting

| Symptom | Checks |
|---|---|
| Backend cannot connect DB/Redis/MinIO | Compose status, ports, env overrides, container logs |
| Browser CORS error | Allowed origin config and MinIO bucket CORS for presigned upload |
| 401 on API | Token header, expiry, configured context path, security logs |
| MinIO bucket missing | MinIO init container status and configured bucket |
| AI health unavailable | AI container logs, FFmpeg availability, port 8000 |
| Frontend dependency mismatch | `npm ci` from lockfile; do not replace lockfile casually |
