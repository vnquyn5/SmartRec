# SmartRec - Glossary

| Term | Definition in this documentation |
|---|---|
| API | Application Programming Interface exposed by a service |
| Backend | Spring Boot service handling authenticated business APIs |
| Chunk | Part of a file sent as an individual upload request |
| Direct upload | Multipart upload to backend or browser upload through a presigned MinIO URL |
| JWT | JSON Web Token used as Bearer credential |
| MediaFile | Metadata record identifying a stored media object |
| Meeting | Business record associated with one media file in current model |
| MinIO | S3-compatible object storage used for media and temporary chunks |
| NFR | Non-Functional Requirement |
| Presigned URL | Time-limited URL granting a specific storage operation |
| Redis | In-memory datastore used for upload session state/progress |
| Soft delete | Mark a media item as Trash without immediately removing object bytes |
| UAT | User Acceptance Testing |
| Upload session | Persistent/runtime state representing one chunked upload |
| Workspace | Ownership grouping represented by `workspace_id`; sharing behavior requires confirmation |
| ChromaDB | Vector database configured for AI Engine; user-facing integration not verified |
| AI Engine | FastAPI service; current verified HTTP API is root/health check |
