
import { hasGovernanceAdminRole } from './loraPocGateEvaluator.js';

export const ARTIFACT_TYPES = Object.freeze([
  'ALL',
  'RAW_MEDIA',
  'AI_OUTPUT',
  'EVAL_DATASET',
  'GROUND_TRUTH',
  'ADAPTER_ARTIFACT',
]);

export const ARTIFACT_LIFECYCLE = Object.freeze({
  ACTIVE: 'ACTIVE',
  PINNED_BASELINE: 'PINNED_BASELINE',
  DEPRECATED: 'DEPRECATED',
  TRASHED: 'TRASHED',
  PURGED: 'PURGED',
});

export const ARTIFACT_INTEGRITY_STATUS = Object.freeze({
  VERIFIED: 'VERIFIED',
  VERSION_MISMATCH: 'VERSION_MISMATCH',
  MISSING_ARTIFACT: 'MISSING_ARTIFACT',
  UNVERIFIED: 'UNVERIFIED',
});

export const RETENTION_PURGE_DECISION = Object.freeze({
  ALLOWED: 'ALLOWED',
  BLOCKED: 'BLOCKED',
});

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256_PATTERN = /^[a-fA-F0-9]{64}$/;
const VALID_ARTIFACT_TYPE_SET = new Set(ARTIFACT_TYPES.filter((type) => type !== 'ALL'));
const VALID_LIFECYCLE_SET = new Set(Object.values(ARTIFACT_LIFECYCLE));

function normalizeVersionToken(rawVersion) {
  const cleaned = String(rawVersion || '').trim();
  if (!cleaned) return null;
  return cleaned.replace(/^v(?=\d)/i, '');
}

function normalizeHashToken(rawHash) {
  const cleaned = String(rawHash || '').trim().toLowerCase();
  return cleaned || null;
}

function parseTimestampMs(isoValue) {
  if (!isoValue) return null;
  const parsed = Date.parse(isoValue);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isValidSemVer(version) {
  const normalized = normalizeVersionToken(version);
  return Boolean(normalized && SEMVER_PATTERN.test(normalized));
}

export function isValidSha256(hash) {
  const normalized = normalizeHashToken(hash);
  return Boolean(normalized && SHA256_PATTERN.test(normalized));
}

export function normalizeArtifactRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const rawType = String(raw.artifactType || '').trim().toUpperCase();
  const artifactType = VALID_ARTIFACT_TYPE_SET.has(rawType) ? rawType : 'AI_OUTPUT';

  const rawLifecycle = String(raw.lifecycleStatus || '').trim().toUpperCase();
  const lifecycleStatus = VALID_LIFECYCLE_SET.has(rawLifecycle)
    ? rawLifecycle
    : ARTIFACT_LIFECYCLE.ACTIVE;

  const sizeValue = Number(raw.sizeBytes ?? 0);

  return {
    id: String(raw.id || '').trim() || null,
    name: String(raw.name || '').trim() || 'Không tên',
    artifactType,
    version: normalizeVersionToken(raw.version),
    expectedVersion: normalizeVersionToken(raw.expectedVersion),
    parentVersion: normalizeVersionToken(raw.parentVersion),
    objectKey: raw.objectKey ? String(raw.objectKey).trim() : null,
    objectExists: raw.objectExists !== false,
    checksumSha256: normalizeHashToken(raw.checksumSha256),
    expectedChecksumSha256: normalizeHashToken(raw.expectedChecksumSha256),
    sizeBytes: Number.isFinite(sizeValue) && sizeValue >= 0 ? sizeValue : 0,
    lifecycleStatus,
    legalHold: Boolean(raw.legalHold),
    retainUntil: raw.retainUntil || null,
    purgeAt: raw.purgeAt || null,
    linkedJobId: raw.linkedJobId ? String(raw.linkedJobId).trim() : null,
    linkedMeetingId: raw.linkedMeetingId ? String(raw.linkedMeetingId).trim() : null,
    sourceRef: raw.sourceRef ? String(raw.sourceRef).trim() : null,
    createdBy: raw.createdBy ? String(raw.createdBy).trim() : null,
    createdAt: raw.createdAt || null,
  };
}


export function evaluateArtifactIntegrity(rawArtifact) {
  const artifact = normalizeArtifactRecord(rawArtifact);
  if (!artifact) {
    return {
      status: ARTIFACT_INTEGRITY_STATUS.UNVERIFIED,
      reasons: ['Thiếu metadata artifact hợp lệ để đối soát.'],
    };
  }

  if (
    !artifact.objectKey ||
    !artifact.objectExists ||
    artifact.lifecycleStatus === ARTIFACT_LIFECYCLE.PURGED
  ) {
    const missingReasons = [];
    if (!artifact.objectKey) missingReasons.push('Thiếu objectKey tham chiếu trên storage.');
    if (!artifact.objectExists) missingReasons.push('Object không tồn tại hoặc đã bị xóa khỏi MinIO.');
    if (artifact.lifecycleStatus === ARTIFACT_LIFECYCLE.PURGED) {
      missingReasons.push('Artifact đã ở trạng thái PURGED.');
    }
    return {
      status: ARTIFACT_INTEGRITY_STATUS.MISSING_ARTIFACT,
      reasons: missingReasons,
    };
  }

  const mismatchReasons = [];
  if (artifact.version && !isValidSemVer(artifact.version)) {
    mismatchReasons.push(`Version "${artifact.version}" không đúng chuẩn SemVer (MAJOR.MINOR.PATCH).`);
  }
  if (
    artifact.expectedVersion &&
    artifact.version &&
    artifact.version !== artifact.expectedVersion
  ) {
    mismatchReasons.push(
      `Sai lệch phiên bản: lưu trữ v${artifact.version} khác bản tham chiếu v${artifact.expectedVersion}.`
    );
  }
  if (artifact.checksumSha256 && !isValidSha256(artifact.checksumSha256)) {
    mismatchReasons.push('Checksum SHA-256 không đúng định dạng 64 ký tự hex.');
  }
  if (
    artifact.expectedChecksumSha256 &&
    artifact.checksumSha256 &&
    artifact.checksumSha256 !== artifact.expectedChecksumSha256
  ) {
    mismatchReasons.push('Checksum SHA-256 không khớp với manifest/baseline đã xác nhận.');
  }

  if (mismatchReasons.length > 0) {
    return {
      status: ARTIFACT_INTEGRITY_STATUS.VERSION_MISMATCH,
      reasons: mismatchReasons,
    };
  }

  if (!artifact.version || !artifact.checksumSha256) {
    const missingMeta = [];
    if (!artifact.version) missingMeta.push('Thiếu thông tin version.');
    if (!artifact.checksumSha256) missingMeta.push('Thiếu checksum SHA-256 để xác minh toàn vẹn.');
    return {
      status: ARTIFACT_INTEGRITY_STATUS.UNVERIFIED,
      reasons: missingMeta,
    };
  }

  return {
    status: ARTIFACT_INTEGRITY_STATUS.VERIFIED,
    reasons: [],
  };
}


export function evaluateRetentionPurgeGuard({
  artifact: rawArtifact,
  policyApproved = false,
  user = null,
  nowMs = Date.now(),
}) {
  const artifact = normalizeArtifactRecord(rawArtifact);
  const reasons = [];

  if (!artifact) {
    return {
      decision: RETENTION_PURGE_DECISION.BLOCKED,
      allowed: false,
      reasons: ['Không tìm thấy bản ghi artifact hợp lệ.'],
    };
  }

  if (!hasGovernanceAdminRole(user)) {
    reasons.push('Chỉ tài khoản quản trị (ADMIN) mới có quyền thực hiện purge theo retention.');
  }

  if (!policyApproved) {
    reasons.push('Chưa có retention policy được phê duyệt — chặn mọi thao tác xóa vĩnh viễn.');
  }

  if (artifact.legalHold || artifact.lifecycleStatus === ARTIFACT_LIFECYCLE.PINNED_BASELINE) {
    reasons.push('Artifact đang được khóa bảo vệ (Legal Hold / Pinned Baseline).');
  }

  if (artifact.lifecycleStatus === ARTIFACT_LIFECYCLE.PURGED) {
    reasons.push('Artifact đã được purge trước đó.');
  } else if (artifact.lifecycleStatus !== ARTIFACT_LIFECYCLE.TRASHED) {
    reasons.push(
      `Artifact đang ở trạng thái ${artifact.lifecycleStatus} — phải chuyển sang TRASHED trước khi xét purge.`
    );
  }

  const retainUntilMs = parseTimestampMs(artifact.retainUntil);
  if (retainUntilMs === null) {
    reasons.push('Thiếu mốc thời hạn lưu giữ (retainUntil) nên chưa thể xác minh đủ điều kiện purge.');
  } else if (nowMs < retainUntilMs) {
    reasons.push('Artifact vẫn đang trong thời hạn bảo lưu (retainUntil chưa hết hạn).');
  }

  const purgeAtMs = parseTimestampMs(artifact.purgeAt);
  if (purgeAtMs === null) {
    reasons.push('Thiếu mốc lịch xóa (purgeAt) hợp lệ.');
  } else if (nowMs < purgeAtMs) {
    reasons.push('Chưa tới thời điểm được phép xóa vĩnh viễn (purgeAt).');
  }

  const allowed = reasons.length === 0;
  return {
    decision: allowed ? RETENTION_PURGE_DECISION.ALLOWED : RETENTION_PURGE_DECISION.BLOCKED,
    allowed,
    reasons,
  };
}


export function evaluateArtifactRegistrySnapshot(
  rawSnapshot,
  { user = null, nowMs = Date.now() } = {}
) {
  if (!rawSnapshot || typeof rawSnapshot !== 'object' || !Array.isArray(rawSnapshot.items)) {
    return {
      status: ARTIFACT_INTEGRITY_STATUS.UNVERIFIED,
      bucketName: 'smartrec-media',
      policyApproved: false,
      policyVersion: null,
      defaultRetentionDays: 30,
      items: [],
      counts: {
        total: 0,
        verified: 0,
        versionMismatch: 0,
        missingArtifact: 0,
        unverified: 0,
        retentionProtected: 0,
        purgeEligible: 0,
      },
    };
  }

  const policyApproved = Boolean(rawSnapshot.policyApproved);
  const retentionDays = Number(rawSnapshot.defaultRetentionDays);
  const defaultRetentionDays =
    Number.isFinite(retentionDays) && retentionDays > 0 ? Math.floor(retentionDays) : 30;

  const counts = {
    total: 0,
    verified: 0,
    versionMismatch: 0,
    missingArtifact: 0,
    unverified: 0,
    retentionProtected: 0,
    purgeEligible: 0,
  };

  const items = rawSnapshot.items
    .map((raw) => normalizeArtifactRecord(raw))
    .filter(Boolean)
    .map((artifact) => {
      const integrity = evaluateArtifactIntegrity(artifact);
      const purgeGuard = evaluateRetentionPurgeGuard({
        artifact,
        policyApproved,
        user,
        nowMs,
      });

      counts.total += 1;
      if (integrity.status === ARTIFACT_INTEGRITY_STATUS.VERIFIED) counts.verified += 1;
      else if (integrity.status === ARTIFACT_INTEGRITY_STATUS.VERSION_MISMATCH) {
        counts.versionMismatch += 1;
      } else if (integrity.status === ARTIFACT_INTEGRITY_STATUS.MISSING_ARTIFACT) {
        counts.missingArtifact += 1;
      } else {
        counts.unverified += 1;
      }

      if (purgeGuard.allowed) counts.purgeEligible += 1;
      else counts.retentionProtected += 1;

      return {
        ...artifact,
        integrity,
        purgeGuard,
      };
    });

  const snapshotStatus = !policyApproved
    ? ARTIFACT_INTEGRITY_STATUS.UNVERIFIED
    : counts.missingArtifact > 0
      ? ARTIFACT_INTEGRITY_STATUS.MISSING_ARTIFACT
      : counts.versionMismatch > 0
        ? ARTIFACT_INTEGRITY_STATUS.VERSION_MISMATCH
        : ARTIFACT_INTEGRITY_STATUS.VERIFIED;

  return {
    status: snapshotStatus,
    bucketName: String(rawSnapshot.bucketName || 'smartrec-media').trim(),
    policyApproved,
    policyVersion: rawSnapshot.policyVersion ? String(rawSnapshot.policyVersion).trim() : null,
    defaultRetentionDays,
    items,
    counts,
  };
}

