import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARTIFACT_INTEGRITY_STATUS,
  ARTIFACT_LIFECYCLE,
  RETENTION_PURGE_DECISION,
  evaluateArtifactIntegrity,
  evaluateArtifactRegistrySnapshot,
  evaluateRetentionPurgeGuard,
  isValidSemVer,
  isValidSha256,
} from './artifactRetentionValidator.js';

const VALID_SHA = 'a'.repeat(64);
const OTHER_SHA = 'b'.repeat(64);
const FIXED_NOW_MS = Date.parse('2026-11-25T12:00:00Z');

function createArtifact(overrides = {}) {
  return {
    id: 'art-001',
    name: 'smartrec_task_ground_truth',
    artifactType: 'GROUND_TRUTH',
    version: '1.2.0',
    expectedVersion: '1.2.0',
    parentVersion: '1.1.0',
    objectKey: 'datasets/ground-truth/smartrec-task/v1.2.0/labels.json',
    objectExists: true,
    checksumSha256: VALID_SHA,
    expectedChecksumSha256: VALID_SHA,
    sizeBytes: 128000,
    lifecycleStatus: ARTIFACT_LIFECYCLE.ACTIVE,
    legalHold: false,
    retainUntil: '2027-01-01T00:00:00Z',
    purgeAt: null,
    sourceRef: 'eval-batch-q4',
    ...overrides,
  };
}

test('TC01: Missing or invalid snapshot returns UNVERIFIED with zero fabricated rows (BR03)', () => {
  const result = evaluateArtifactRegistrySnapshot(null);
  assert.equal(result.status, ARTIFACT_INTEGRITY_STATUS.UNVERIFIED);
  assert.equal(result.policyApproved, false);
  assert.equal(result.items.length, 0);
  assert.equal(result.counts.total, 0);
});

test('TC02: Valid SemVer, SHA-256, and existing objectKey evaluate as VERIFIED (BR01)', () => {
  assert.equal(isValidSemVer('v1.2.0'), true);
  assert.equal(isValidSemVer('1.2'), false);
  assert.equal(isValidSha256(VALID_SHA), true);
  assert.equal(isValidSha256('short-hash'), false);

  const result = evaluateArtifactIntegrity(createArtifact());
  assert.equal(result.status, ARTIFACT_INTEGRITY_STATUS.VERIFIED);
  assert.equal(result.reasons.length, 0);
});

test('TC03: Version mismatch or invalid SemVer evaluates as VERSION_MISMATCH', () => {
  const mismatch = evaluateArtifactIntegrity(
    createArtifact({ version: '1.2.0', expectedVersion: '1.3.0' })
  );
  assert.equal(mismatch.status, ARTIFACT_INTEGRITY_STATUS.VERSION_MISMATCH);
  assert.ok(mismatch.reasons.some((r) => r.includes('Sai lệch phiên bản')));

  const badSemver = evaluateArtifactIntegrity(
    createArtifact({ version: 'draft-final', expectedVersion: null })
  );
  assert.equal(badSemver.status, ARTIFACT_INTEGRITY_STATUS.VERSION_MISMATCH);
});

test('TC04: Checksum mismatch evaluates as VERSION_MISMATCH', () => {
  const result = evaluateArtifactIntegrity(
    createArtifact({ checksumSha256: VALID_SHA, expectedChecksumSha256: OTHER_SHA })
  );
  assert.equal(result.status, ARTIFACT_INTEGRITY_STATUS.VERSION_MISMATCH);
  assert.ok(result.reasons.some((r) => r.includes('SHA-256')));
});

test('TC05: Missing objectKey, deleted MinIO object, or PURGED status returns MISSING_ARTIFACT', () => {
  const deletedObj = evaluateArtifactIntegrity(createArtifact({ objectExists: false }));
  assert.equal(deletedObj.status, ARTIFACT_INTEGRITY_STATUS.MISSING_ARTIFACT);

  const noKey = evaluateArtifactIntegrity(createArtifact({ objectKey: null }));
  assert.equal(noKey.status, ARTIFACT_INTEGRITY_STATUS.MISSING_ARTIFACT);

  const purged = evaluateArtifactIntegrity(
    createArtifact({ lifecycleStatus: ARTIFACT_LIFECYCLE.PURGED })
  );
  assert.equal(purged.status, ARTIFACT_INTEGRITY_STATUS.MISSING_ARTIFACT);
});

test('TC06: Destructive purge is BLOCKED when retention policy is not approved', () => {
  const expiredTrashed = createArtifact({
    lifecycleStatus: ARTIFACT_LIFECYCLE.TRASHED,
    retainUntil: '2026-10-01T00:00:00Z',
    purgeAt: '2026-11-01T00:00:00Z',
  });
  const guard = evaluateRetentionPurgeGuard({
    artifact: expiredTrashed,
    policyApproved: false,
    user: { role: 'ADMIN' },
    nowMs: FIXED_NOW_MS,
  });
  assert.equal(guard.decision, RETENTION_PURGE_DECISION.BLOCKED);
  assert.equal(guard.allowed, false);
  assert.ok(guard.reasons.some((r) => r.includes('retention policy')));
});

test('TC07: Purge is BLOCKED when legalHold, ACTIVE lifecycle, or retainUntil not expired (BR02)', () => {
  const held = evaluateRetentionPurgeGuard({
    artifact: createArtifact({
      lifecycleStatus: ARTIFACT_LIFECYCLE.TRASHED,
      legalHold: true,
      retainUntil: '2026-10-01T00:00:00Z',
      purgeAt: '2026-11-01T00:00:00Z',
    }),
    policyApproved: true,
    user: { role: 'ADMIN' },
    nowMs: FIXED_NOW_MS,
  });
  assert.equal(held.allowed, false);
  assert.ok(held.reasons.some((r) => r.includes('Legal Hold')));

  const notExpired = evaluateRetentionPurgeGuard({
    artifact: createArtifact({
      lifecycleStatus: ARTIFACT_LIFECYCLE.TRASHED,
      retainUntil: '2026-12-30T00:00:00Z',
      purgeAt: '2026-11-01T00:00:00Z',
    }),
    policyApproved: true,
    user: { role: 'ADMIN' },
    nowMs: FIXED_NOW_MS,
  });
  assert.equal(notExpired.allowed, false);
  assert.ok(notExpired.reasons.some((r) => r.includes('retainUntil')));
});

test('TC08: Purge is BLOCKED for non-admin users (TR02)', () => {
  const guard = evaluateRetentionPurgeGuard({
    artifact: createArtifact({
      lifecycleStatus: ARTIFACT_LIFECYCLE.TRASHED,
      retainUntil: '2026-10-01T00:00:00Z',
      purgeAt: '2026-11-01T00:00:00Z',
    }),
    policyApproved: true,
    user: { role: 'USER' },
    nowMs: FIXED_NOW_MS,
  });
  assert.equal(guard.allowed, false);
  assert.ok(guard.reasons.some((r) => r.includes('ADMIN')));
});

test('TC09: Purge ALLOWED only when ADMIN + approved policy + TRASHED + expired + no hold', () => {
  const snapshot = evaluateArtifactRegistrySnapshot(
    {
      bucketName: 'smartrec-media',
      policyApproved: true,
      policyVersion: 'ret-v1.0',
      defaultRetentionDays: 30,
      items: [
        createArtifact({ id: 'a1' }),
        createArtifact({ id: 'a2', version: '1.2.0', expectedVersion: '2.0.0' }),
        createArtifact({ id: 'a3', objectExists: false }),
        createArtifact({
          id: 'a4',
          lifecycleStatus: ARTIFACT_LIFECYCLE.TRASHED,
          retainUntil: '2026-10-01T00:00:00Z',
          purgeAt: '2026-11-01T00:00:00Z',
        }),
      ],
    },
    { user: { role: 'ROLE_ADMIN' }, nowMs: FIXED_NOW_MS }
  );

  assert.equal(snapshot.counts.total, 4);
  assert.equal(snapshot.counts.verified, 2);
  assert.equal(snapshot.counts.versionMismatch, 1);
  assert.equal(snapshot.counts.missingArtifact, 1);
  assert.equal(snapshot.counts.purgeEligible, 1);
  assert.equal(snapshot.counts.retentionProtected, 3);
  assert.equal(snapshot.items[3].purgeGuard.decision, RETENTION_PURGE_DECISION.ALLOWED);
});

