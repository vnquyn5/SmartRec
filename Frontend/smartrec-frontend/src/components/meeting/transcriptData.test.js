import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  filterTranscriptSegments,
  findActiveTranscriptSegment,
  findActiveSpeakerSegment,
  formatTranscriptTime,
  formatMediaTimeSeconds,
  isTranscriptScrollKey,
  mapTranscriptResults,
  mapSpeakerTimeline,
  scrollTranscriptRowNearTop,
  shouldAutoScrollTranscriptSegment,
  seekMediaToSeconds,
  subscribeTranscriptMedia,
  subscribeSpeakerTimelineMedia,
} from './transcriptData.js';

function transcriptSegments() {
  return mapTranscriptResults({ transcripts: [
    { id: 'seg-15', startTimeMs: 15000, endTimeMs: 21000, textContent: 'First sentence.', speakerId: 'speaker-1', speakerLabel: 'An' },
    { id: 'seg-21', startTimeMs: 21000, endTimeMs: 28000, textContent: 'Second sentence.', speakerId: 'speaker-2', speakerLabel: 'Mai' },
  ] });
}

class FakeMedia extends EventTarget {
  constructor(time = 0, tagName = 'VIDEO') {
    super();
    this.currentTime = time;
    this.tagName = tagName;
    this.src = 'blob:smartrec-media';
    this.readyState = 1;
    this.paused = true;
    this.ended = false;
    this.playCalls = 0;
  }

  play() {
    this.playCalls += 1;
    this.paused = false;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  }
}

test('maps persisted Results API records, stable ids and real millisecond timestamps', () => {
  const result = mapTranscriptResults({ transcripts: [
    { id: 'later', startTimeMs: 2500, endTimeMs: 4000, textContent: 'Sau', speakerId: 'speaker-2', speakerLabel: 'Mai' },
    { id: 'first', startTimeMs: 500, endTimeMs: 1200, textContent: 'Trước', speakerId: 'speaker-1', speakerLabel: 'An' },
  ] });
  assert.deepEqual(result.map((segment) => segment.id), ['first', 'later']);
  assert.equal(result[0].speaker, 'An');
  assert.equal(result[0].text, 'Trước');
  assert.equal(result[0].startTimeMs / 1000, 0.5);
  assert.equal(formatTranscriptTime(15000), '00:15');
});

test('boundary-crossing transcripts map to an explicit ambiguous attribution label', () => {
  const [segment] = mapTranscriptResults({ transcripts: [
    { id: 'cross', startTimeMs: 17500, endTimeMs: 19000, textContent: 'Crossing',
      attributionStatus: 'CROSS_SPEAKER_BOUNDARY', speakerId: null, speakerLabel: null },
  ] });
  assert.equal(segment.speaker, 'Multiple speakers');
  assert.equal(segment.attributionStatus, 'CROSS_SPEAKER_BOUNDARY');
});

test('Transcript and Speaker Timeline share floor-to-second display at exact turn boundaries', () => {
  const segments = mapSpeakerTimeline([
    { id: 's3', segments: [{ startSeconds: 12.620, endSeconds: 18.037 }] },
    { id: 's2', segments: [{ startSeconds: 18.037, endSeconds: 22.002 }] },
    { id: 's0', segments: [{ startSeconds: 22.002, endSeconds: 22.120 }] },
  ]);
  assert.equal(formatTranscriptTime(18037), formatMediaTimeSeconds(18.037));
  assert.equal(formatMediaTimeSeconds(18.037), '00:18');
  assert.equal(findActiveSpeakerSegment(segments, 18.036999), 's3-0');
  assert.equal(findActiveSpeakerSegment(segments, 18.037), 's2-0');
  assert.equal(findActiveSpeakerSegment(segments, 22.001999), 's2-0');
  assert.equal(findActiveSpeakerSegment(segments, 22.002), 's0-0');
  assert.equal(findActiveSpeakerSegment(segments, 22.12), null);
});

test('transcript highlighting changes at exact millisecond speaker boundaries', () => {
  const transcript = mapTranscriptResults({ transcripts: [
    { id: 'at-boundary', startTimeMs: 18037, endTimeMs: 22002, textContent: 'Turn',
      attributionStatus: 'ATTRIBUTED', speakerId: 'speaker-b', speakerLabel: 'Speaker B' },
  ] });
  assert.equal(findActiveTranscriptSegment(transcript, 18.036999), null);
  assert.equal(findActiveTranscriptSegment(transcript, 18.037), 'at-boundary');
  assert.equal(findActiveTranscriptSegment(transcript, 22.001999), 'at-boundary');
  assert.equal(findActiveTranscriptSegment(transcript, 22.002), null);
});

test('Speaker Timeline follows the same media clock through playback and backward seeking', () => {
  const media = new FakeMedia(18.037);
  const segments = mapSpeakerTimeline([
    { id: 'a', segments: [{ startSeconds: 12.620, endSeconds: 18.037 }] },
    { id: 'b', segments: [{ startSeconds: 18.037, endSeconds: 22.002 }] },
  ]);
  const changes = [];
  const cleanup = subscribeSpeakerTimelineMedia(media, segments, (key) => changes.push(key));
  assert.equal(changes.at(-1), 'b-0');
  media.currentTime = 17.5;
  media.dispatchEvent(new Event('seeked'));
  assert.equal(changes.at(-1), 'a-0');
  media.currentTime = 23;
  media.dispatchEvent(new Event('timeupdate'));
  assert.equal(changes.at(-1), null);
  cleanup();
});

test('preserves unresolved speaker identity and formats long timestamps', () => {
  const [segment] = mapTranscriptResults({ transcripts: [
    { id: 'id', startTimeMs: 3661000, endTimeMs: 3662000, textContent: 'Hello', speakerId: '12345678-abcd' },
  ] });
  assert.equal(segment.speaker, 'Speaker 12345678');
  assert.equal(formatTranscriptTime(segment.startTimeMs), '01:01:01');
});

test('empty or malformed transcript results stay empty rather than becoming mock data', () => {
  assert.deepEqual(mapTranscriptResults({ transcripts: [] }), []);
  assert.deepEqual(mapTranscriptResults({ transcripts: [{ textContent: 'missing timestamps' }] }), []);
});

test('segment seeking uses seconds and starts playback for video and audio media', async (t) => {
  for (const [extension, tagName] of [['mp4', 'VIDEO'], ['mp3', 'AUDIO']]) {
    await t.test(`.${extension}`, () => {
      const media = new FakeMedia(0, tagName);
      assert.equal(seekMediaToSeconds(media, 15), true);
      assert.equal(media.currentTime, 15);
      assert.equal(media.playCalls, 1);
    });
  }
});

test('click seek waits for media metadata and does not create another player', async () => {
  const media = new FakeMedia();
  media.readyState = 0;
  assert.equal(seekMediaToSeconds(media, 15), true);
  assert.equal(media.currentTime, 0);
  media.readyState = 1;
  media.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(media.currentTime, 15);
  assert.equal(media.playCalls, 1);
});

test('timeupdate highlights the segment containing currentTime and seeking backward resyncs', () => {
  const media = new FakeMedia(21);
  const changes = [];
  const cleanup = subscribeTranscriptMedia(media, transcriptSegments(), (id) => changes.push(id));
  assert.equal(changes.at(-1), 'seg-21');
  media.currentTime = 17;
  media.dispatchEvent(new Event('timeupdate'));
  assert.equal(changes.at(-1), 'seg-15');
  media.currentTime = 21;
  media.dispatchEvent(new Event('seeked'));
  assert.equal(changes.at(-1), 'seg-21');
  cleanup();
});

test('repeated timeupdate events in one segment do not trigger repeated active changes', () => {
  const media = new FakeMedia(16);
  const changes = [];
  const cleanup = subscribeTranscriptMedia(media, transcriptSegments(), (id) => changes.push(id));
  media.currentTime = 17;
  media.dispatchEvent(new Event('timeupdate'));
  media.currentTime = 19;
  media.dispatchEvent(new Event('timeupdate'));
  assert.deepEqual(changes, ['seg-15']);
  media.currentTime = 21;
  media.dispatchEvent(new Event('timeupdate'));
  assert.deepEqual(changes, ['seg-15', 'seg-21']);
  cleanup();
});

test('timestamp gaps and ended media clear active segment', () => {
  const segments = transcriptSegments();
  assert.equal(findActiveTranscriptSegment(segments, 14.99), null);
  assert.equal(findActiveTranscriptSegment(segments, 20.999), 'seg-15');
  assert.equal(findActiveTranscriptSegment(segments, 28), null);
  const media = new FakeMedia(22);
  const changes = [];
  const cleanup = subscribeTranscriptMedia(media, segments, (id) => changes.push(id));
  media.currentTime = 29;
  media.ended = true;
  media.dispatchEvent(new Event('ended'));
  assert.equal(changes.at(-1), null);
  cleanup();
});

test('transcript timestamp seek retains millisecond precision although labels show whole seconds', () => {
  const media = new FakeMedia(0);
  assert.equal(formatTranscriptTime(18037), '00:18');
  assert.equal(seekMediaToSeconds(media, 18.037), true);
  assert.equal(media.currentTime, 18.037);
});

test('search and speaker filters still narrow real transcript segments', () => {
  const segments = transcriptSegments();
  assert.deepEqual(filterTranscriptSegments(segments, 'SECOND', 'All').map((segment) => segment.id), ['seg-21']);
  assert.deepEqual(filterTranscriptSegments(segments, '', 'An').map((segment) => segment.id), ['seg-15']);
  assert.deepEqual(filterTranscriptSegments(segments, 'missing', 'All'), []);
});

test('active row scroll targets only its container without scroll-event feedback handling', () => {
  const calls = [];
  const container = {
    scrollTop: 100,
    clientTop: 0,
    scrollHeight: 900,
    clientHeight: 500,
    getBoundingClientRect: () => ({ top: 20 }),
    scrollTo: (options) => { calls.push(options); container.scrollTop = options.top; },
  };
  const row = { getBoundingClientRect: () => ({ top: 80 }) };
  const target = scrollTranscriptRowNearTop(container, row, 'smooth');
  assert.equal(target, 144);
  assert.equal(container.scrollTop, 144);
  assert.deepEqual(calls, [{ top: 144, behavior: 'smooth' }]);
});

test('transcript scrolling clamps to the container and reduced motion can request instant movement', () => {
  const calls = [];
  const container = {
    scrollTop: 0, clientTop: 0, scrollHeight: 700, clientHeight: 500,
    getBoundingClientRect: () => ({ top: 0 }),
    scrollTo: (options) => calls.push(options),
  };
  const row = { getBoundingClientRect: () => ({ top: 900 }) };
  assert.equal(scrollTranscriptRowNearTop(container, row, 'auto'), 200);
  assert.deepEqual(calls, [{ top: 200, behavior: 'auto' }]);
});

test('same active segment is not scheduled for repeated auto-scroll until follow is resumed', () => {
  const lastScrolledId = { current: null };
  assert.equal(shouldAutoScrollTranscriptSegment(lastScrolledId, 'seg-15'), true);
  assert.equal(shouldAutoScrollTranscriptSegment(lastScrolledId, 'seg-15'), false);
  lastScrolledId.current = null;
  assert.equal(shouldAutoScrollTranscriptSegment(lastScrolledId, 'seg-15'), true);
});

test('keyboard scroll intent is recognized without treating media/programmatic events as input', () => {
  for (const key of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']) {
    assert.equal(isTranscriptScrollKey({ key }), true);
  }
  assert.equal(isTranscriptScrollKey({ key: 'Enter' }), false);
  assert.equal(isTranscriptScrollKey(null), false);
});

test('meeting layout puts Transcript below the single media player and keeps only three right tabs', () => {
  const meetingDetail = readFileSync(new URL('./MeetingDetail.jsx', import.meta.url), 'utf8');
  const meetingTabs = readFileSync(new URL('./MeetingTabs.jsx', import.meta.url), 'utf8');
  const speakerPanel = readFileSync(new URL('./SpeakerManagementPanel.jsx', import.meta.url), 'utf8');
  const detailPage = readFileSync(new URL('../../pages/meeting/MeetingDetailPage.jsx', import.meta.url), 'utf8');
  assert.ok(meetingDetail.indexOf('<MeetingVideoPlayer') < meetingDetail.indexOf('<TranscriptPanel'));
  assert.ok(meetingDetail.indexOf('<TranscriptPanel') < meetingDetail.indexOf('<MeetingTabs'));
  assert.equal((meetingTabs.match(/label: '(AI Summary|Task|Speaker)'/g) || []).length, 3);
  assert.doesNotMatch(meetingTabs, /TranscriptPanel|label: 'Transcript'/);
  assert.match(meetingTabs, /id: 'summary'/);
  assert.match(meetingTabs, /id: 'task'/);
  assert.match(meetingTabs, /id: 'speaker'/);
  assert.match(meetingDetail, /mediaRef=\{mediaRef\}/);
  assert.match(meetingTabs, /mediaRef=\{mediaRef\}/);
  assert.match(speakerPanel, /subscribeSpeakerTimelineMedia\(mediaRef\.current, speakerTimeline/);
  assert.match(detailPage, /formatMediaTimeSeconds\(value\)/);
  assert.match(speakerPanel, /onSeekSegment\?\.\(Number\(seg\.startSeconds\)\)/);
});

test('transcript rows are keyboard buttons with a visible focus style and accessible seek label', () => {
  const panel = readFileSync(new URL('./TranscriptPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /<button\s+key=\{segment\.id\}/);
  assert.match(panel, /focus-visible:outline/);
  assert.match(panel, /aria-label=\{`Seek to/);
  assert.match(panel, /onClick=\{\(\) => handleSegmentClick\(segment\)\}/);
  assert.match(panel, /useState\(true\)/);
  assert.match(panel, /onWheel=\{suspendAutoFollow\}/);
  assert.match(panel, /onTouchStart=\{suspendAutoFollow\}/);
  assert.match(panel, /onPointerDown=\{suspendAutoFollow\}/);
  assert.match(panel, /onMouseDown=\{suspendAutoFollow\}/);
  assert.match(panel, /onKeyDown=\{\(event\) => \{ if \(isTranscriptScrollKey\(event\)\) suspendAutoFollow\(\); \}\}/);
  assert.match(panel, /matchMedia\?\.\('\(prefers-reduced-motion: reduce\)'\)\?\.matches === true/);
  assert.match(panel, /filtered, scrollActiveSegmentIntoView/);
  assert.match(panel, /segment\.attributionStatus === 'CROSS_SPEAKER_BOUNDARY'/);
  assert.doesNotMatch(panel, /onScroll=/);
});

test('desktop Meeting Details constrains the app shell and keeps the viewport content shrinkable', () => {
  const styles = readFileSync(new URL('../../assets/styles/index.css', import.meta.url), 'utf8');
  const layout = readFileSync(new URL('../layout/DashboardLayout.jsx', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../../pages/meeting/MeetingDetailPage.jsx', import.meta.url), 'utf8');
  assert.match(layout, /meeting-details-shell/);
  assert.match(styles, /\.dashboard-shell\.meeting-details-shell\s*\{[^}]*height:\s*100dvh/s);
  assert.match(styles, /\.meeting-details-content\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(styles, /\.meeting-details-page\s*\{[^}]*height:\s*100%/s);
  assert.match(styles, /@media \(max-width: 1279px\)[\s\S]*?\.meeting-details-content\s*\{[^}]*overflow:\s*visible/s);
  assert.match(page, /meeting-details-page[^\n]*min-h-0/);
});

test('tab header stays separate from the speaker scroll region and actions remain outside it', () => {
  const tabs = readFileSync(new URL('./MeetingTabs.jsx', import.meta.url), 'utf8');
  const speakers = readFileSync(new URL('./SpeakerManagementPanel.jsx', import.meta.url), 'utf8');
  assert.match(tabs, /role="tablist"[\s\S]*?overflow-y-hidden/);
  assert.match(tabs, /activeTab === 'speaker' \? 'overflow-hidden' : 'overflow-y-auto'/);
  assert.match(speakers, /aria-label="Speaker cards" tabIndex=\{0\} className="[^"]*overflow-y-auto/);
  assert.match(speakers, /pb-64/);
  assert.ok(speakers.indexOf('aria-label="Speaker cards"') < speakers.indexOf('/* Global Checkbox */'));
  assert.ok(speakers.indexOf('/* Global Checkbox */') < speakers.indexOf('/* Footer Actions */'));
  assert.match(speakers, /aria-expanded=\{isOpen\}/);
  assert.match(speakers, /role="listbox" aria-label="Workspace members"/);
  assert.match(speakers, /role="option"[\s\S]*?aria-selected=\{isSelected\}/);
  assert.match(speakers, /focus-visible:outline/);
});

test('transcript and media keep independent usable areas without restricting mobile page flow', () => {
  const panel = readFileSync(new URL('./TranscriptPanel.jsx', import.meta.url), 'utf8');
  const media = readFileSync(new URL('./MeetingVideoPlayer.jsx', import.meta.url), 'utf8');
  const detail = readFileSync(new URL('./MeetingDetail.jsx', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../../assets/styles/index.css', import.meta.url), 'utf8');
  assert.match(panel, /className="[^"]*xl:flex-1[^"]*flex flex-col overflow-hidden/);
  assert.match(panel, /role="region"[\s\S]*?tabIndex=\{0\}[\s\S]*?overflow-y-auto/);
  assert.match(panel, /scrollContainerRef/);
  assert.match(media, /shrink-0/);
  assert.match(media, /max-h-\[36vh\]/);
  assert.match(detail, /xl:flex-row/);
  assert.match(styles, /@media \(max-width: 1279px\)[\s\S]*?\.meeting-details-page\s*\{[^}]*overflow:\s*visible/s);
});
