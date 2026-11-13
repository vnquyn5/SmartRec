import React, { useState } from "react";
import MeetingTasksTab from "./MeetingTasksTab";
import MeetingSummaryTab from "./MeetingSummaryTab";
import SpeakerManagementPanel from "./SpeakerManagementPanel";

function JobProcessingNotice({
  aiStatus,
  jobLoading,
  aiError,
  onRetry,
  onPause,
  onResume,
  onCancel,
  lifecycleAction,
  onStartProcessing,
  startingProcess,
  retrying,
}) {
  const messages = {
    unprocessed: "Cuộc họp chưa được xử lý AI.",
    queued: "Job đang chờ worker xử lý.",
    processing: "Hệ thống đang phân tích âm thanh và nhận diện người nói.",
    paused: "Job đang tạm dừng. Có thể tiếp tục xử lý bất cứ lúc nào.",
    "pause-requested":
      "Yêu cầu tạm dừng sẽ được áp dụng tại ranh giới xử lý gần nhất.",
    "cancel-requested": "Yêu cầu hủy đang được xử lý.",
    failed: aiError || "Xử lý âm thanh thất bại.",
    error: aiError || "Không thể tải trạng thái hoặc kết quả Audio AI.",
    enrichment_failed:
      "Transcript đã xử lý xong nhưng phần tóm tắt AI chưa khả dụng.",
    enrichment_disabled:
      "Xử lý transcript hoàn tất; phần tóm tắt AI đang bị tắt.",
  };
  const message = jobLoading
    ? "Đang tải trạng thái xử lý…"
    : messages[aiStatus];
  const hasActions =
    onStartProcessing || onPause || onResume || onCancel || onRetry;
  if (!message && !hasActions) return null;

  const isError = aiStatus === "failed" || aiStatus === "error";
  const actionClass =
    "rounded-lg border border-[#263653] bg-[#111b30] px-2.5 py-1 text-[10px] font-semibold text-slate-200 transition hover:border-sky-400/60 hover:bg-[#17233c] disabled:cursor-wait disabled:opacity-50";

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-1 py-1">
      {message && (
        <p
          role={
            isError
              ? "alert"
              : jobLoading ||
                  [
                    "queued",
                    "processing",
                    "paused",
                    "pause-requested",
                    "cancel-requested",
                  ].includes(aiStatus)
                ? "status"
                : undefined
          }
          className={`min-w-0 flex-1 text-[11px] ${isError ? "text-amber-200" : "text-slate-400"}`}
        >
          {message}
        </p>
      )}
      <div className="flex shrink-0 items-center gap-1.5">
        {onStartProcessing && (
          <button
            type="button"
            onClick={onStartProcessing}
            disabled={startingProcess}
            className={actionClass}
          >
            {startingProcess ? "Đang bắt đầu…" : "Xử lý ngay"}
          </button>
        )}
        {onPause && (
          <button
            type="button"
            onClick={onPause}
            disabled={lifecycleAction}
            className={actionClass}
          >
            Tạm dừng
          </button>
        )}
        {onResume && (
          <button
            type="button"
            onClick={onResume}
            disabled={lifecycleAction}
            className={actionClass}
          >
            Tiếp tục
          </button>
        )}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={lifecycleAction}
            className={actionClass}
          >
            Hủy
          </button>
        )}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className={`${actionClass} border-rose-500/40 text-rose-200 hover:border-rose-400/60`}
          >
            {retrying ? "Đang gửi…" : "Thử lại"}
          </button>
        )}
      </div>
    </div>
  );
}

export default function MeetingTabs({
  speakers = [],
  mediaRef,
  onSaveSpeakers,
  onSeekSegment,
  onEvidenceClick,
  aiStatus = "processing",
  jobLoading,
  aiError,
  speakerError,
  speakerLoading,
  results,
  resultsLoading,
  resultsError,
  onRetry,
  onPause,
  onResume,
  onCancel,
  lifecycleAction,
  onStartProcessing,
  startingProcess,
  retrying,
}) {
  const [activeTab, setActiveTab] = useState("speaker");

  // Khai báo các tab theo yêu cầu
  const tabs = [
    {
      id: "summary",
      label: "AI Summary",
      icon: (
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      ),
    },
    {
      id: "task",
      label: "Task",
      count: results?.actionItems?.length,
      icon: (
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
        </svg>
      ),
    },
    {
      id: "speaker",
      label: "Speaker",
      icon: (
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      ),
    },
  ];

  return (
    <div className="w-full h-full min-h-0 flex flex-col bg-[#090f1d] border border-[#1b2640] rounded-2xl overflow-hidden shadow-xl">
      <div className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-b border-[#18233c] bg-[#0a1122] px-4 py-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${["completed", "empty"].includes(aiStatus) ? "bg-emerald-400" : aiStatus === "failed" || aiStatus === "error" ? "bg-rose-400" : "bg-sky-400"}`}
          />
          <h2 className="truncate text-xs font-bold text-slate-100 sm:text-sm">
            Không gian phân tích AI
          </h2>
        </div>
        {results?.llmProvider && (
          <span
            className="max-w-[48%] shrink-0 truncate rounded-full border border-[#20304e] bg-[#101a2d] px-2.5 py-1 text-[10px] text-slate-300"
            title={`AI provider: ${results.llmProvider}`}
          >
            <span className="text-slate-500">Provider:</span>{" "}
            <span className="font-semibold text-sky-300">
              {results.llmProvider}
            </span>
          </span>
        )}
      </div>
      {/* Tab Navigation Header chuẩn Figma */}
      <div
        role="tablist"
        aria-label="Meeting detail sections"
        className="flex items-center gap-6 px-6 border-b border-[#18233c] shrink-0 bg-[#0a1122] overflow-x-auto overflow-y-hidden"
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={`py-3.5 flex items-center gap-2 text-xs font-semibold border-b-2 transition-all relative top-[1px] whitespace-nowrap shrink-0 ${
                isActive
                  ? "border-[#38bdf8] text-[#38bdf8]"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <span className="shrink-0">{tab.icon}</span>
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                    isActive
                      ? "bg-[#2563eb] text-white shadow-sm"
                      : "bg-[#18243c] text-slate-400"
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content Display Area */}
      <div
        className={`flex-1 min-h-0 min-w-0 p-3 bg-[#090f1d] sm:p-4 ${activeTab === "speaker" ? "overflow-hidden" : "overflow-y-auto"}`}
      >
        {activeTab === "summary" && (
          <MeetingSummaryTab
            summary={results?.summary}
            llmProvider={results?.llmProvider}
            fallbackUsed={results?.llmFallbackUsed}
            transcripts={results?.transcripts || []}
            onEvidenceClick={onEvidenceClick}
            aiStatus={aiStatus}
            loading={resultsLoading}
            error={resultsError}
          />
        )}
        {activeTab === "task" && (
          <MeetingTasksTab
            tasks={results?.actionItems || []}
            transcripts={results?.transcripts || []}
            onEvidenceClick={onEvidenceClick}
            hasSummary={Boolean(results?.summary)}
            aiStatus={aiStatus}
            loading={resultsLoading}
            error={resultsError}
          />
        )}
        {activeTab === "speaker" && (
          <div className="h-full min-h-0 flex flex-col gap-4 overflow-hidden">
            <JobProcessingNotice
              aiStatus={aiStatus}
              jobLoading={jobLoading}
              aiError={aiError}
              onRetry={onRetry}
              onPause={onPause}
              onResume={onResume}
              onCancel={onCancel}
              lifecycleAction={lifecycleAction}
              onStartProcessing={onStartProcessing}
              startingProcess={startingProcess}
              retrying={retrying}
            />

            {aiStatus === "unprocessed" ? (
              <p className="rounded-xl border border-[#1e2742] bg-[#0c101d] px-5 py-8 text-center text-sm text-slate-400">
                Cuộc họp chưa được xử lý AI.
              </p>
            ) : aiStatus === "processing" || aiStatus === "queued" ? (
              <p className="rounded-xl border border-[#1e2742] bg-[#0c101d] px-5 py-8 text-center text-sm text-slate-400">
                Hệ thống đang phân tích âm thanh và nhận diện người nói.
              </p>
            ) : aiStatus === "failed" ? (
              <p
                role="alert"
                className="rounded-xl border border-rose-500/30 bg-rose-950/20 px-5 py-8 text-center text-sm text-rose-200"
              >
                Xử lý âm thanh thất bại. Kết quả người nói không khả dụng.
              </p>
            ) : aiStatus === "error" ? (
              <p
                role="alert"
                className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-5 py-8 text-center text-sm text-amber-200"
              >
                Không thể tải trạng thái hoặc kết quả Audio AI.
              </p>
            ) : speakerLoading ? (
              <p className="rounded-xl border border-[#1e2742] bg-[#0c101d] px-5 py-8 text-center text-sm text-slate-400">
                Đang tải kết quả người nói…
              </p>
            ) : speakerError ? (
              <p
                role="alert"
                className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-5 py-8 text-center text-sm text-amber-200"
              >
                {speakerError}
              </p>
            ) : speakers.length === 0 ? (
              <div className="rounded-xl border border-[#1e2742] bg-[#0c101d] px-5 py-8 text-center">
                <h3 className="text-sm font-semibold text-white">
                  Không phát hiện người nói
                </h3>
                <p className="mt-2 text-sm text-slate-400">
                  Hệ thống đã hoàn tất xử lý nhưng không tìm thấy đoạn phát ngôn
                  phù hợp.
                </p>
              </div>
            ) : (
              <SpeakerManagementPanel
                key={speakers.map((speaker) => speaker.id).join("|")}
                initialSpeakers={speakers}
                mediaRef={mediaRef}
                onSave={onSaveSpeakers}
                onSeekSegment={onSeekSegment}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
