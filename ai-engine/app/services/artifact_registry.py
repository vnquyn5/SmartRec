"""AI-side preparation ONLY: no Backend URLs, DTOs, lifecycle assumptions.

The protocol below is an internal port, not a proposed HTTP API. No production
adapter exists until BE confirms registration, allocation, uniqueness, status,
lineage and reconciliation contracts. Existing StorageClient is unchanged.
"""

import hashlib
import json
from dataclasses import asdict, dataclass, replace
from typing import Callable, Protocol


class RegistryBlockedError(RuntimeError):
    pass


@dataclass(frozen=True)
class ArtifactIntent:
    meeting_id: str
    job_id: str
    stage: str
    output_role: str
    model: str
    model_version: str
    input_identities: tuple[str, ...]
    content_sha256: str
    revision: str = "1"
    parent_artifact_ids: tuple[str, ...] = ()
    owner_reference: str | None = None

    def __post_init__(self):
        for name in ("meeting_id", "job_id", "stage", "output_role", "model", "model_version", "revision"):
            if not isinstance(getattr(self, name), str) or not getattr(self, name).strip():
                raise ValueError(f"Missing artifact intent field: {name}")
        if len(self.content_sha256) != 64 or any(c not in "0123456789abcdef" for c in self.content_sha256):
            raise ValueError("content_sha256 must be a lowercase SHA-256 digest")
        if not self.input_identities:
            raise ValueError("Stable input identities are required")
        for values in (self.input_identities, self.parent_artifact_ids):
            if not isinstance(values, tuple) or any(not isinstance(v, str) or not v.strip() for v in values):
                raise ValueError("Identities must be a tuple of non-empty strings")

    @property
    def idempotency_key(self) -> str:
        """Same logical output -> same key; no execution UUID or attempt number.

        Input identities should be role-qualified. Order is irrelevant, but
        changed bytes/model/version/revision/job/role create a distinct key.
        Uniqueness still requires a real registry guarantee.
        """
        value = asdict(self)
        value["input_identities"] = sorted(set(self.input_identities))
        value["parent_artifact_ids"] = sorted(set(self.parent_artifact_ids))
        encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        return "ai-output-v1:" + hashlib.sha256(encoded.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class UploadedObject:
    """Caller-supplied storage ACK; this module never allocates a key/uploads."""
    bucket: str
    object_key: str
    sha256: str


@dataclass(frozen=True)
class ArtifactReference:
    """An ID received from a real adapter ACK (or explicitly a test fake)."""
    artifact_id: str
    meeting_id: str
    job_id: str
    object: UploadedObject


class RegistryPort(Protocol):
    def register(self, intent: ArtifactIntent, uploaded: UploadedObject) -> ArtifactReference: ...
    def resolve(self, artifact_id: str) -> ArtifactReference: ...
    def update_status(self, artifact_id: str, backend_status: str) -> None: ...
    def record_lineage(self, artifact_id: str, parent_artifact_ids: tuple[str, ...]) -> None: ...


class BlockedRegistry:
    """Fail closed without network I/O. Never install a fake in the worker."""
    def _blocked(self, *args, **kwargs):
        raise RegistryBlockedError("BLOCKED BY BE: registry contract/adapter is not available")

    register = resolve = update_status = record_lineage = _blocked


@dataclass(frozen=True)
class PublicationCheckpoint:
    """Local recovery facts, NOT Backend lifecycle status values.

    The owner must durably save checkpoints before retry/worker cleanup. These
    are not marked persisted, and are never sent through the job callback.
    """
    intent: ArtifactIntent
    uploaded: UploadedObject | None = None
    registry_ack: ArtifactReference | None = None
    lineage_ack: bool = False
    reconciliation_required: bool = False
    last_error: str | None = None
    attempted_bucket: str | None = None
    attempted_object_key: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, value: dict) -> "PublicationCheckpoint":
        intent = dict(value["intent"])
        for name in ("input_identities", "parent_artifact_ids"):
            intent[name] = tuple(intent.get(name, ()))
        uploaded = UploadedObject(**value["uploaded"]) if value.get("uploaded") else None
        reference = value.get("registry_ack")
        ack = None
        if reference:
            ack = ArtifactReference(**{**reference, "object": UploadedObject(**reference["object"])})
        state = cls(ArtifactIntent(**intent), uploaded, ack, value.get("lineage_ack", False),
                    value.get("reconciliation_required", False), value.get("last_error"),
                    value.get("attempted_bucket"), value.get("attempted_object_key"))
        _validate_checkpoint(state)
        return state

    def upload_succeeded(self, uploaded: UploadedObject) -> "PublicationCheckpoint":
        if self.registry_ack or self.uploaded:
            raise ValueError("Do not overwrite an acknowledged output; replay its checkpoint")
        if self.attempted_object_key is not None and (
            uploaded.bucket, uploaded.object_key
        ) != (self.attempted_bucket, self.attempted_object_key):
            raise ValueError("Reconcile the original upload before reallocating its object key")
        result = replace(self, uploaded=uploaded, last_error=None, reconciliation_required=False)
        _validate_checkpoint(result)
        return result

    def upload_failed(self, reason: str, *, bucket: str, object_key: str) -> "PublicationCheckpoint":
        # A timeout may have written bytes. Keep the intent for reconciliation;
        # do not infer absence, reallocate a key, or delete a potentially used object.
        if self.uploaded or self.registry_ack:
            raise ValueError("Cannot replace an acknowledged upload with failure")
        if not bucket or not object_key:
            raise ValueError("Retain the attempted bucket/key for reconciliation")
        if (self.attempted_bucket is not None or self.attempted_object_key is not None) and (
            bucket, object_key
        ) != (self.attempted_bucket, self.attempted_object_key):
            raise ValueError("Reconcile the original upload before changing its bucket or object key")
        return replace(self, last_error=reason, reconciliation_required=True,
                       attempted_bucket=bucket, attempted_object_key=object_key)


def _validate_checkpoint(state: PublicationCheckpoint) -> None:
    if state.uploaded:
        if not state.uploaded.bucket or not state.uploaded.object_key:
            raise ValueError("Storage ACK needs bucket and object key")
        if state.uploaded.sha256 != state.intent.content_sha256:
            raise ValueError("Uploaded content differs from artifact intent")
    if state.registry_ack:
        ack = state.registry_ack
        if (not ack.artifact_id or ack.object != state.uploaded or
            (ack.meeting_id, ack.job_id) != (state.intent.meeting_id, state.intent.job_id)):
            raise ValueError("Registry ACK does not match uploaded output/scope")
    if state.lineage_ack and state.registry_ack is None:
        raise ValueError("Lineage cannot be acknowledged before registration")


def register_uploaded_output(
    state: PublicationCheckpoint, registry: RegistryPort,
    save_checkpoint: Callable[[PublicationCheckpoint], None],
) -> PublicationCheckpoint:
    """Explicit internal coordinator; exercised only with fakes until BE exists.

    Requires a prior upload ACK. Checkpoint persistence must succeed before any
    registry call. On timeout/failure retain the object and replay the same key;
    no destructive compensation. This is NOT an exactly-once guarantee.
    """
    _validate_checkpoint(state)
    if state.uploaded is None:
        raise ValueError("Cannot register an output without a storage ACK")
    save_checkpoint(state)
    try:
        if state.registry_ack is None:
            ack = registry.register(state.intent, state.uploaded)
            if not isinstance(ack, ArtifactReference):
                raise ValueError("Registry did not acknowledge an artifact reference")
            candidate = replace(state, registry_ack=ack)
            _validate_checkpoint(candidate)
            state = candidate
            save_checkpoint(state)
        if not state.lineage_ack:
            if state.intent.parent_artifact_ids:
                registry.record_lineage(state.registry_ack.artifact_id, state.intent.parent_artifact_ids)
            state = replace(state, lineage_ack=True)
        state = replace(state, reconciliation_required=False, last_error=None)
    except Exception as exc:
        # Registration/lineage may have committed before a timeout. Never claim
        # rollback or remove shared source/output objects on this ambiguous path.
        state = replace(state, reconciliation_required=True,
                        last_error=f"{type(exc).__name__}: {exc}")
    save_checkpoint(state)
    return state
