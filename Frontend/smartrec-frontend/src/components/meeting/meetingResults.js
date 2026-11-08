import { formatTranscriptTime, mapTranscriptResults } from './transcriptData.js';

const arrayOrEmpty = (value) => Array.isArray(value) ? value : [];
const activeStatuses = new Set(['pending', 'queued', 'processing', 'retrying', 'pause-requested', 'cancel-requested']);

export function getSummaryViewState({ summary, aiStatus, loading, error }) {
  if (error) return 'error';
  if (loading) return 'loading';
  if (summary) return 'success';
  const status = String(aiStatus || '').toLowerCase();
  if (activeStatuses.has(status)) return 'processing';
  if (status === 'failed') return 'failed';
  if (status === 'enrichment_failed') return 'enrichment_failed';
  if (status === 'enrichment_disabled') return 'enrichment_disabled';
  if (status === 'unprocessed') return 'unprocessed';
  return 'unavailable';
}

export function getTasksViewState({ tasks, hasSummary, aiStatus, loading, error }) {
  if (error) return 'error';
  if (loading) return 'loading';
  if (tasks.length > 0) return 'success';
  const status = String(aiStatus || '').toLowerCase();
  if (activeStatuses.has(status)) return 'processing';
  if (status === 'failed') return 'failed';
  if (status === 'enrichment_failed') return 'enrichment_failed';
  if (status === 'enrichment_disabled') return 'enrichment_disabled';
  if (status === 'unprocessed') return 'unprocessed';
  return hasSummary ? 'empty' : 'unavailable';
}

export function mapMeetingResults(payload) {
  const summary = payload?.summary ?? null;
  const details = summary?.details ?? {};

  return {
    meetingId: payload?.meetingId ?? null,
    jobId: payload?.jobId ?? null,
    jobStatus: payload?.jobStatus ?? null,
    llmStatus: payload?.llmStatus ?? null,
    llmFailureCode: payload?.llmFailureCode ?? null,
    llmFallbackUsed: payload?.llmFallbackUsed ?? null,
    llmProvider: payload?.llmProvider ?? null,
    transcripts: arrayOrEmpty(payload?.transcripts),
    summary: summary ? {
      executiveSummary: summary.executiveSummary ?? details.executive_summary ?? null,
      executiveSummaryRefs: arrayOrEmpty(details.executive_summary_refs),
      decisions: arrayOrEmpty(details.decisions),
      keyPoints: arrayOrEmpty(details.key_points),
      openIssues: arrayOrEmpty(details.open_issues),
      nextSteps: arrayOrEmpty(details.next_steps),
    } : null,
    actionItems: arrayOrEmpty(payload?.actionItems).map((item) => ({
      id: item?.id ?? `${item?.title ?? "task"}-${item?.sourceTranscriptId ?? "source"}`,
      title: item?.title ?? "",
      assigneeName: item?.assigneeName ?? null,
      assigneeSpeakerId: item?.assigneeSpeakerId ?? null,
      assignmentProvenance: item?.assignmentProvenance ?? null,
      status: item?.status ?? "OPEN",
      dueDate: item?.dueDate ?? null,
      deadlineRaw: item?.deadlineRaw ?? null,
      sourceTranscriptId: item?.sourceTranscriptId ?? null,
      sourceRefs: arrayOrEmpty(item?.sourceRefs),
    })),
  };
}

export function formatActionDeadline(task) {
  if (task?.dueDate) {
    const date = new Date(task.dueDate);
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString();
  }
  return task?.deadlineRaw || null;
}

export function evidenceReferences(item) {
  return arrayOrEmpty(item?.source_refs ?? item?.sourceRefs);
}

export function resolveEvidenceReferences(references, transcripts) {
  const segments = mapTranscriptResults({ transcripts: arrayOrEmpty(transcripts) });
  const byId = new Map(segments.map((segment) => [String(segment.id), segment]));
  const seen = new Set();

  return arrayOrEmpty(references).flatMap((rawReference) => {
    if (typeof rawReference !== 'string' || !rawReference.trim() || seen.has(rawReference)) return [];
    seen.add(rawReference);
    const match = rawReference.match(/^TRANSCRIPT:(.+)$/i);
    const transcriptId = match ? match[1] : rawReference;
    const segment = match ? byId.get(transcriptId) : null;
    if (!segment) {
      return [{
        sourceRef: rawReference,
        transcriptId: null,
        label: match ? 'Transcript source unavailable' : 'Source unavailable',
        available: false,
      }];
    }
    const start = formatTranscriptTime(segment.startTimeMs);
    const end = formatTranscriptTime(segment.endTimeMs);
    return [{
      sourceRef: rawReference,
      transcriptId: segment.id,
      label: `Transcript · ${start}${start === end ? '' : `–${end}`}`,
      available: true,
    }];
  });
}
