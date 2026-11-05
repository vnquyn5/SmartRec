export function mapTranscriptResults(response) {
  const segments = Array.isArray(response?.transcripts) ? response.transcripts : [];
  return segments
    .filter((segment) => segment && segment.id != null && Number.isFinite(Number(segment.startTimeMs)) &&
      Number.isFinite(Number(segment.endTimeMs)) && typeof segment.textContent === "string")
    .map((segment) => ({
      id: segment.id,
      startTimeMs: Number(segment.startTimeMs),
      endTimeMs: Number(segment.endTimeMs),
      text: segment.textContent,
      speakerId: segment.speakerId ?? null,
      attributionStatus: segment.attributionStatus || 'ATTRIBUTED',
      speaker: segment.attributionStatus === 'CROSS_SPEAKER_BOUNDARY'
        ? 'Multiple speakers'
        : segment.attributionStatus === 'UNRESOLVED'
          ? 'Speaker attribution unavailable'
          : segment.speakerLabel || (segment.speakerId ? `Speaker ${String(segment.speakerId).slice(0, 8)}` : "Speaker chưa xác định"),
    }))
    .sort((left, right) => left.startTimeMs - right.startTimeMs || left.endTimeMs - right.endTimeMs);
}

export function findActiveTranscriptSegment(segments, currentTimeSeconds) {
  const current = Number(currentTimeSeconds);
  if (!Number.isFinite(current) || current < 0) return null;
  let low = 0;
  let high = segments.length - 1;
  let candidate = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (segments[middle].startTimeMs / 1000 <= current) {
      candidate = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  for (let index = candidate; index >= 0; index -= 1) {
    if (current < segments[index].endTimeMs / 1000) return segments[index].id;
  }
  return null;
}

export function mapSpeakerTimeline(speakers) {
  return (speakers || []).flatMap((speaker) => (speaker.segments || []).map((segment, index) => ({
    key: `${speaker.id}-${index}`,
    speakerId: speaker.id,
    startSeconds: Number(segment.startSeconds),
    endSeconds: Number(segment.endSeconds),
  })).filter((segment) => Number.isFinite(segment.startSeconds)
    && Number.isFinite(segment.endSeconds) && segment.startSeconds >= 0
    && segment.endSeconds > segment.startSeconds))
    .sort((left, right) => left.startSeconds - right.startSeconds
      || left.endSeconds - right.endSeconds || left.key.localeCompare(right.key));
}

export function findActiveSpeakerSegment(segments, currentTimeSeconds) {
  const current = Number(currentTimeSeconds);
  if (!Number.isFinite(current) || current < 0) return null;
  let low = 0;
  let high = segments.length - 1;
  let candidate = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (segments[middle].startSeconds <= current) {
      candidate = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  for (let index = candidate; index >= 0; index -= 1) {
    if (current < segments[index].endSeconds) return segments[index].key;
  }
  return null;
}

export function subscribeSpeakerTimelineMedia(media, segments, onActiveChange) {
  if (!media) return () => {};
  let lastActiveKey = Symbol('uninitialized');
  const update = () => {
    const nextKey = findActiveSpeakerSegment(segments, media.currentTime);
    if (lastActiveKey !== nextKey) {
      lastActiveKey = nextKey;
      onActiveChange(nextKey);
    }
  };
  const events = ['timeupdate', 'seeking', 'seeked', 'play', 'playing', 'pause', 'ended', 'loadedmetadata'];
  events.forEach((eventName) => media.addEventListener(eventName, update));
  update();
  return () => events.forEach((eventName) => media.removeEventListener(eventName, update));
}

export function seekMediaToSeconds(media, seconds) {
  const target = Number(seconds);
  if (!media || !Number.isFinite(target) || target < 0 || !media.src) return false;

  const seekAndPlay = () => {
    try {
      media.currentTime = target;
      const playRequest = media.play();
      if (playRequest && typeof playRequest.catch === 'function') playRequest.catch(() => {});
    } catch {
      // The media may become unavailable while the timestamp is being selected.
    }
  };

  if (media.readyState >= 1) seekAndPlay();
  else media.addEventListener('loadedmetadata', seekAndPlay, { once: true });
  return true;
}

export function subscribeTranscriptMedia(media, segments, onActiveChange, onPlayingChange = () => {}) {
  if (!media) return () => {};
  let lastActiveId = Symbol('uninitialized');
  const update = () => {
    const nextActiveId = findActiveTranscriptSegment(segments, media.currentTime);
    if (lastActiveId !== nextActiveId) {
      lastActiveId = nextActiveId;
      onActiveChange(nextActiveId);
    }
    onPlayingChange(!media.paused && !media.ended);
  };
  const events = ['timeupdate', 'seeking', 'seeked', 'play', 'playing', 'pause', 'ended', 'loadedmetadata'];
  events.forEach((eventName) => media.addEventListener(eventName, update));
  update();
  return () => events.forEach((eventName) => media.removeEventListener(eventName, update));
}

export function filterTranscriptSegments(segments, searchTerm, selectedSpeaker) {
  const query = String(searchTerm || '').toLocaleLowerCase();
  return segments.filter((segment) =>
    (selectedSpeaker === 'All' || segment.speaker === selectedSpeaker) &&
    `${segment.speaker} ${segment.text}`.toLocaleLowerCase().includes(query));
}

export function scrollTranscriptRowNearTop(container, row, behavior = 'smooth') {
  if (!container || !row) return null;
  const containerRect = container.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const unclampedTarget = Math.max(
    0,
    container.scrollTop + rowRect.top - containerRect.top - container.clientTop - 16,
  );
  const maxScrollTop = Number.isFinite(container.scrollHeight) && Number.isFinite(container.clientHeight)
    ? Math.max(0, container.scrollHeight - container.clientHeight)
    : unclampedTarget;
  const target = Math.min(unclampedTarget, maxScrollTop);
  if (Math.abs(container.scrollTop - target) >= 2) {
    if (typeof container.scrollTo === 'function') container.scrollTo({ top: target, behavior });
    else container.scrollTop = target;
  }
  return target;
}

export function isTranscriptScrollKey(event) {
  return ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event?.key);
}

export function shouldAutoScrollTranscriptSegment(lastScrolledIdRef, segmentId) {
  if (segmentId == null || lastScrolledIdRef.current === segmentId) return false;
  lastScrolledIdRef.current = segmentId;
  return true;
}

export function formatTranscriptTime(milliseconds) {
  const totalSeconds = Math.floor(Math.max(0, Number(milliseconds) || 0) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatMediaTimeSeconds(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return '00:00';
  return formatTranscriptTime(Math.floor(value * 1000));
}
