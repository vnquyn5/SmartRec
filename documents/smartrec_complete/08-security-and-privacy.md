# SmartRec - Security and Privacy

**Trạng thái:** Source-based overview, not a security audit or compliance certification.

## 1. Authentication observed

- Spring Security is stateless; form login and HTTP Basic are disabled.
- `/api/auth/register` and `/api/auth/login` controller mappings are public in security rules.
- JWT filter reads `Authorization: Bearer ...`, validates token, then populates authentication.
- Password service uses BCrypt encoder.
- Default token expiry is 24 hours, configurable.
- All other routes fall under `anyRequest().authenticated()`.

Full externally reachable path includes configured context path `/api/v1`; confirm runtime routing.

## 2. Authorization and ownership

Services retrieve the authenticated principal and check owner/workspace for relevant media/meeting operations. This is not evidence of a complete RBAC implementation. No admin role capabilities are described here. Access-control coverage for every endpoint, including upload-session actions and profile endpoints, must be tested.

## 3. Data and file handling

- Passwords should remain encoded; never log/return them.
- Media file names, metadata, user identifiers and access logs may be sensitive.
- Presigned PUT URLs are temporary bearer capabilities; redact from logs/tickets.
- Confirm MinIO bucket anonymous access policy before any deployment. The repository Compose init currently configures bucket CORS and `anonymous set public`; this must be reviewed and changed for customer environments if public reads are not intended.
- Use HTTPS/TLS at production ingress and for browser-to-storage traffic.

## 4. Configuration risks requiring remediation before production

The repository contains development defaults for database, MinIO and JWT. Compose also publishes service ports; application YAML enables SQL and bind-parameter logging. Do not use these defaults/logging/network exposure in production without explicit security approval.

Requirements:

1. Inject unique high-entropy secrets through protected environment/secret management.
2. Restrict inbound ports and database/storage networks; expose only required ingress.
3. Review bucket access policy, presign expiry, CORS origins and allowed methods.
4. Disable sensitive SQL/bind-value logs in production; define log access/retention.
5. Define TLS, rate limits, request limits, file scanning/content policy and abuse controls.
6. Define backup encryption, access, retention, deletion and restoration controls.
7. Perform dependency, vulnerability and authorization testing before release.

## 5. Privacy controls to specify

Not established by source alone; product owner/customer must define:

- Personal data inventory and purpose.
- Data residency and retention.
- Deletion/subject request process.
- Log and telemetry retention.
- Access by support/operator roles.
- Backup retention and behavior after user deletion.
- Whether media contents may be processed by AI or sent to external model providers.

No claim of compliance with a privacy/security standard is made by this document.

## 6. Security verification checklist

- Missing/invalid/expired JWT returns unauthenticated response.
- User A cannot list/download/rename/delete/restore User B's resources.
- Upload session IDs are owner-scoped.
- Permanent deletion refuses non-Trash media and handles MinIO failure visibly.
- Presigned URL is short-lived and restricted to intended object/method.
- Production config contains no development credentials and no secret logs.
- CORS origins and storage bucket policy match approved deployment.
