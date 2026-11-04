"""AI-only contract tests with an in-memory fake; NOT Backend integration."""
import hashlib
import json
from dataclasses import replace
from unittest.mock import MagicMock

import pytest

from app.services.artifact_registry import (
    ArtifactIntent, ArtifactReference, BlockedRegistry, PublicationCheckpoint,
    RegistryBlockedError, UploadedObject, register_uploaded_output,
)
from app.services.storage_client import StorageClient


class MemoryRegistry:
    """Test-only semantics. BE uniqueness/lineage guarantees are still missing."""
    def __init__(self):
        self.rows = {}
        self.edges = set()
        self.register_calls = 0
        self.timeout_after_commit = False
        self.fail_lineage = False
        self.delete = MagicMock(side_effect=RuntimeError("cleanup unavailable"))

    def register(self, intent, uploaded):
        self.register_calls += 1
        key = intent.idempotency_key
        if key not in self.rows:
            # Fixed fixture IDs only; never used in the production worker.
            self.rows[key] = ArtifactReference(f"fixture-artifact-{len(self.rows)}",
                                               intent.meeting_id, intent.job_id, uploaded)
        if self.timeout_after_commit:
            self.timeout_after_commit = False
            raise TimeoutError("ACK lost after fake registry commit")
        return self.rows[key]

    def resolve(self, artifact_id):
        return next(row for row in self.rows.values() if row.artifact_id == artifact_id)

    def record_lineage(self, artifact_id, parent_artifact_ids):
        if self.fail_lineage:
            raise ConnectionError("lineage unavailable")
        self.edges.update((artifact_id, parent) for parent in parent_artifact_ids)


@pytest.fixture
def state():
    digest = hashlib.sha256(b"output").hexdigest()
    intent = ArtifactIntent("meeting", "job", "OCR", "normalized-text", "paddle", "test-version",
                            ("video:sha256:input", "image:sha256:frame"), digest,
                            parent_artifact_ids=("existing-parent",), owner_reference="existing-owner")
    return PublicationCheckpoint(intent).upload_succeeded(UploadedObject("test-bucket", "allocated-key", digest))


def test_stable_key_does_not_depend_on_attempt_or_input_order(state):
    reordered = replace(state.intent, input_identities=tuple(reversed(state.intent.input_identities)))
    assert state.intent.idempotency_key == reordered.idempotency_key
    assert state.intent.idempotency_key == PublicationCheckpoint.from_dict(
        json.loads(json.dumps(state.to_dict()))).intent.idempotency_key


@pytest.mark.parametrize("change", [
    {"job_id": "other-job"}, {"stage": "another-stage"}, {"output_role": "another-output"},
    {"revision": "2"}, {"model_version": "next-model"},
    {"input_identities": ("video:sha256:other",)}, {"content_sha256": "a" * 64},
])
def test_new_output_identity_changes_key(state, change):
    assert replace(state.intent, **change).idempotency_key != state.intent.idempotency_key


def test_registry_unavailable_preserves_object_and_recovery_details(state):
    journal = []
    result = register_uploaded_output(state, BlockedRegistry(), journal.append)
    assert result.registry_ack is None and result.reconciliation_required
    assert result.uploaded == state.uploaded
    assert "BLOCKED BY BE" in result.last_error
    assert journal[0] == state and journal[-1] == result


@pytest.mark.parametrize("operation", ["register", "resolve", "update_status", "record_lineage"])
def test_default_adapter_cannot_claim_integration(operation):
    with pytest.raises(RegistryBlockedError, match="BLOCKED BY BE"):
        getattr(BlockedRegistry(), operation)("anything")


def test_ack_lost_retry_uses_same_key_and_fake_registry_deduplicates(state):
    registry = MemoryRegistry()
    registry.timeout_after_commit = True
    journal = []
    first = register_uploaded_output(state, registry, journal.append)
    assert first.registry_ack is None and first.reconciliation_required
    # Simulate process restart from a durable checkpoint representation.
    replay = PublicationCheckpoint.from_dict(json.loads(json.dumps(first.to_dict())))
    second = register_uploaded_output(replay, registry, journal.append)
    assert len(registry.rows) == 1 and registry.register_calls == 2
    assert second.registry_ack and second.lineage_ack and not second.reconciliation_required
    assert registry.resolve(second.registry_ack.artifact_id) == second.registry_ack
    registry.delete.assert_not_called()


def test_duplicate_stage_replay_does_not_register_twice_after_ack(state):
    registry = MemoryRegistry()
    done = register_uploaded_output(state, registry, lambda _: None)
    again = register_uploaded_output(done, registry, lambda _: None)
    assert again == done and registry.register_calls == 1 and len(registry.edges) == 1


def test_shared_parent_and_partial_lineage_failure(state):
    registry = MemoryRegistry()
    registry.fail_lineage = True
    first = register_uploaded_output(state, registry, lambda _: None)
    assert first.registry_ack and not first.lineage_ack and first.reconciliation_required
    registry.fail_lineage = False
    completed = register_uploaded_output(first, registry, lambda _: None)
    other_intent = replace(state.intent, output_role="layout")
    other = replace(state, intent=other_intent)
    register_uploaded_output(other, registry, lambda _: None)
    assert completed.lineage_ack and registry.register_calls == 2
    assert len(registry.edges) == 2 and {p for _, p in registry.edges} == {"existing-parent"}
    registry.delete.assert_not_called()


def test_upload_success_registry_failure_keeps_bytes_for_reconciliation(tmp_path, state):
    source = tmp_path / "output.json"
    source.write_bytes(b"output")
    minio = MagicMock()
    storage = StorageClient(client=minio, bucket="test-bucket")
    key = storage.upload_file(str(source), state.uploaded.object_key)
    result = register_uploaded_output(state, BlockedRegistry(), lambda _: None)
    assert key == result.uploaded.object_key and source.read_bytes() == b"output"
    minio.fput_object.assert_called_once()
    minio.remove_object.assert_not_called()
    assert result.reconciliation_required and result.registry_ack is None


def test_upload_failure_cannot_register_even_if_registry_is_available(state):
    pending = PublicationCheckpoint(state.intent).upload_failed(
        "storage timeout; outcome unknown", bucket="test-bucket", object_key="allocated-key")
    assert pending.attempted_bucket == "test-bucket"
    registry = MemoryRegistry()
    with pytest.raises(ValueError, match="storage ACK"):
        register_uploaded_output(pending, registry, lambda _: None)
    assert registry.register_calls == 0 and pending.reconciliation_required
    restored = PublicationCheckpoint.from_dict(json.loads(json.dumps(pending.to_dict())))
    assert restored.attempted_bucket == "test-bucket"
    assert restored.attempted_object_key == "allocated-key"


def test_upload_retry_failure_at_same_location_preserves_reconciliation(state):
    first = PublicationCheckpoint(state.intent).upload_failed(
        "first timeout", bucket="test-bucket", object_key="allocated-key")

    retry = first.upload_failed(
        "retry timeout", bucket="test-bucket", object_key="allocated-key")

    assert retry.attempted_bucket == first.attempted_bucket == "test-bucket"
    assert retry.attempted_object_key == first.attempted_object_key == "allocated-key"
    assert retry.reconciliation_required is True
    assert retry.last_error == "retry timeout"
    assert first.last_error == "first timeout"


@pytest.mark.parametrize("bucket,object_key", [
    ("other-bucket", "allocated-key"),
    ("test-bucket", "new-key"),
])
def test_upload_retry_failure_at_different_location_is_rejected(state, bucket, object_key):
    pending = PublicationCheckpoint(state.intent).upload_failed(
        "first timeout", bucket="test-bucket", object_key="allocated-key")

    with pytest.raises(ValueError, match="Reconcile the original upload"):
        pending.upload_failed("retry timeout", bucket=bucket, object_key=object_key)

    assert pending.attempted_bucket == "test-bucket"
    assert pending.attempted_object_key == "allocated-key"
    assert pending.last_error == "first timeout"
    assert pending.reconciliation_required is True


def test_upload_failure_cannot_replace_successful_upload_or_registry_ack(state):
    registry = MemoryRegistry()
    acknowledged = register_uploaded_output(state, registry, lambda _: None)

    with pytest.raises(ValueError, match="acknowledged upload"):
        state.upload_failed("late failure", bucket="other-bucket", object_key="new-key")
    with pytest.raises(ValueError, match="acknowledged upload"):
        acknowledged.upload_failed("late failure", bucket="other-bucket", object_key="new-key")

    assert state.uploaded is not None
    assert acknowledged.uploaded == state.uploaded
    assert acknowledged.registry_ack is not None
    assert acknowledged.registry_ack == registry.resolve(acknowledged.registry_ack.artifact_id)


def test_checkpoint_failure_prevents_external_call(state):
    registry = MemoryRegistry()
    def cannot_save(_):
        raise OSError("journal unavailable")
    with pytest.raises(OSError):
        register_uploaded_output(state, registry, cannot_save)
    assert registry.register_calls == 0


def test_untrusted_ack_is_not_accepted(state):
    registry = MemoryRegistry()
    registry.register = lambda *args: ArtifactReference("foreign", "other-meeting", "other-job", state.uploaded)
    result = register_uploaded_output(state, registry, lambda _: None)
    assert result.registry_ack is None and result.reconciliation_required
    assert "does not match" in result.last_error


def test_orphan_cleanup_unavailable_never_deletes_possible_references(state):
    registry = MemoryRegistry()
    registry.timeout_after_commit = True
    result = register_uploaded_output(state, registry, lambda _: None)
    registry.delete.assert_not_called()
    assert result.reconciliation_required and result.uploaded.object_key == "allocated-key"
    # No cleanup/reconciliation API is fabricated; unresolved ownership remains.
    assert len(registry.rows) == 1


def test_rejects_replacing_acknowledged_object(state):
    with pytest.raises(ValueError, match="overwrite"):
        state.upload_succeeded(state.uploaded)


def test_empty_registry_ack_never_means_registered(state):
    registry = MemoryRegistry()
    registry.register = lambda *args: None
    result = register_uploaded_output(state, registry, lambda _: None)
    assert result.registry_ack is None and not result.lineage_ack
    assert result.reconciliation_required


def test_unknown_upload_outcome_cannot_silently_allocate_another_key(state):
    pending = PublicationCheckpoint(state.intent).upload_failed(
        "timeout", bucket="test-bucket", object_key="allocated-key")
    with pytest.raises(ValueError, match="Reconcile"):
        pending.upload_succeeded(replace(state.uploaded, object_key="new-random-key"))
