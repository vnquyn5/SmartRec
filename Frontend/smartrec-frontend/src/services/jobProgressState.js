export function acceptJobProgressSequence(sequences, jobId, candidate) {
  const sequence = Number(candidate);
  const previous = sequences.get(jobId) ?? -1;
  if (!Number.isFinite(sequence) || sequence <= previous) return false;
  sequences.set(jobId, sequence);
  return true;
}

export function acceptJobProgressMessage(sequences, message, expectedMeetingId, expectedJobId) {
  if (!message || message.jobId !== expectedJobId || message.meetingId !== expectedMeetingId) {
    return null;
  }
  const sequence = Number(message.sequence ?? message.event_sequence ?? 0);
  if (!acceptJobProgressSequence(sequences, expectedJobId, sequence)) return null;
  return {
    jobId: expectedJobId,
    meetingId: expectedMeetingId,
    status: message.status,
    currentStage: message.current_stage ?? message.currentStage ?? null,
    progressPercent: message.progress_percent ?? message.progressPercent ?? null,
    sequence,
    updatedAt: message.timestamp ?? message.updatedAt ?? null,
  };
}

export function mergeWorkspaceJobProgress(meeting, progress) {
  if (!meeting || meeting.id !== progress?.meetingId || meeting.activeJobId !== progress?.jobId) {
    return meeting;
  }
  const status = String(progress.status || "").trim().toUpperCase();
  if (!status) return meeting;
  return {
    ...meeting,
    status: status === "SUCCESS" || status === "SUCCEEDED" ? "COMPLETED" : status,
    progressPercent: progress.progressPercent,
    currentStage: progress.currentStage,
    progressSequence: progress.sequence,
  };
}

export function getReconnectDelay(attempt, random = Math.random) {
  const base = Math.min(30_000, 500 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.8 + random() * 0.4));
}
