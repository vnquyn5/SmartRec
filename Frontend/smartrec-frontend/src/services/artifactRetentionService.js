import { api as httpClient } from '../lib/http/client.js';
import {
  ARTIFACT_INTEGRITY_STATUS,
  ARTIFACT_LIFECYCLE,
  ARTIFACT_TYPES,
  ARTIFACT_VERSION_ENDPOINTS,
  RETENTION_PURGE_DECISION,
  compareArtifactWithBaseline,
  evaluateArtifactIntegrity,
  evaluateArtifactRegistrySnapshot,
  evaluateRetentionPurgeGuard,
  executeGuardedArtifactPurge,
  fetchArtifactVersionsWithClient,
  redactSensitiveObjectRef,
} from './artifactRetentionValidator.js';

export {
  ARTIFACT_INTEGRITY_STATUS,
  ARTIFACT_LIFECYCLE,
  ARTIFACT_TYPES,
  ARTIFACT_VERSION_ENDPOINTS,
  RETENTION_PURGE_DECISION,
  compareArtifactWithBaseline,
  evaluateArtifactIntegrity,
  evaluateArtifactRegistrySnapshot,
  evaluateRetentionPurgeGuard,
  redactSensitiveObjectRef,
};

export async function getArtifactVersionsRegistry(options = {}, client = httpClient) {
  return fetchArtifactVersionsWithClient(options, client);
}

export async function requestArtifactPurge(options = {}, client = httpClient) {
  return executeGuardedArtifactPurge(options, client);
}

