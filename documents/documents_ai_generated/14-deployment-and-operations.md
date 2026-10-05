# SmartRec - Deployment and Operations

**Trạng thái:** Development deployment notes and production checklist; not a production runbook/SLA.

## 1. Development topology

Compose services: PostgreSQL, Redis, MinIO, MinIO initialization helper, ChromaDB and AI Engine. Backend and frontend are started separately according to root README.

Default development ports:

| Service | Port |
|---|---:|
| Spring Boot | 8082 |
| Vite | 5173 |
| AI Engine | 8000 |
| ChromaDB host mapping | 8001 |
| PostgreSQL | 5432 |
| Redis | 6379 |
| MinIO API / console | 9000 / 9001 |

Do not expose all these ports publicly in customer production.

## 2. Local start/stop

From repository root:

```powershell
docker compose up -d
docker compose ps
```

Run backend in another terminal:

```powershell
.\mvnw.cmd spring-boot:run
```

Run frontend:

```powershell
Set-Location .\Frontend\smartrec-frontend
npm ci
npm run dev
```

Stop local services:

```powershell
Set-Location D:\SMART_REC\SmartRec
docker compose down
```

`docker compose down` keeps named volumes unless `-v` is added. Do not use `-v` where persistent data must be retained.

## 3. Configuration inventory

| Variable/property | Purpose | Default/current note |
|---|---|---|
| `SPRING_DATASOURCE_URL/USERNAME/PASSWORD` | PostgreSQL | YAML contains local development defaults |
| `REDIS_HOST/PORT` | Redis | localhost in standalone defaults; Compose service host internally |
| `MINIO_ENDPOINT/ACCESS_KEY/SECRET_KEY/BUCKET` | Object storage | Defaults are development-only |
| `JWT_SECRET/EXPIRATION` | Token signing/expiry | Never use repository default secret in production |
| `CORS_ALLOWED_ORIGINS` | Browser origins | Local Vite origins default |
| `TRASH_RETENTION_DAYS` | Trash retention | Defaults 30 days |
| `TRASH_PURGE_CRON` | Scheduled purge | Defaults daily at 02:00 |
| `CHROMA_HOST/PORT` | AI vector DB | Compose sets service host |

Document actual target values only in protected deployment system, not in this file.

## 4. Production readiness checklist

- [ ] Customer topology, DNS, TLS, ingress, firewall and network segmentation approved.
- [ ] Secrets provisioned outside source and rotated; no default credentials.
- [ ] MinIO bucket policy reviewed. Compose init currently includes anonymous public policy; disable unless specifically approved.
- [ ] CORS limited to exact customer origins and needed methods/headers.
- [ ] Database schema migration/backup plan replaces unreviewed `ddl-auto: update` where required.
- [ ] SQL/bind parameter logging disabled or approved for production; log retention/access defined.
- [ ] Multipart limits, proxy limits, storage quotas and abuse protections aligned.
- [ ] Persistent volumes backed up and restore tested; define RPO/RTO.
- [ ] Health checks, metrics, alerts, log aggregation and on-call ownership configured.
- [ ] Trash retention and purge timezone approved; test MinIO failure behavior.
- [ ] AI Engine/ChromaDB deployed only if needed; current service integration requirements documented.
- [ ] Load, security and UAT testing signed off.

## 5. Health and basic triage

- Check container/service state: `docker compose ps`.
- Inspect one service at a time: `docker compose logs --tail=200 <service>`.
- AI Engine endpoints: `GET /` and `GET /health` at its configured address.
- Backend API route checks require valid path prefix and authentication where protected.
- For failed upload, correlate timestamp, upload session ID and redacted application logs.

Never copy access tokens, secrets, presigned URLs or user media into shared operational channels.

## 6. Backup/restore

Compose named volumes provide persistence, not a complete backup strategy. Define database consistency, MinIO object backup, Redis recovery expectations, encryption, retention, offsite policy and restore order in the customer-specific runbook. Conduct restore drills and record measured RPO/RTO before claiming recovery objectives.

## 7. Incident handling

1. Identify affected component and environment.
2. Preserve relevant logs/metrics while redacting sensitive values.
3. Check dependency health and recent deployment/config changes.
4. Avoid destructive restart/volume deletion without incident owner approval.
5. Recover using approved runbook; verify API, object access and user flows.
6. Record incident timeline, impact, resolution and follow-up.
