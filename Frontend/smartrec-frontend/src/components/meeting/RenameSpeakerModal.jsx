import React, { useEffect, useState } from 'react';

function UserIcon({ className = 'w-4 h-4', ...props }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function ChevronDownIcon({ className = 'w-3.5 h-3.5', ...props }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon({ className = 'w-4 h-4', ...props }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

const DEFAULT_WORKSPACE_MEMBERS = [
  { name: 'Anh Quyền', role: 'CEO', initials: 'AQ', bg: 'bg-[#4f46e5]' },
  { name: 'Chị Lan', role: 'Trưởng phòng Marketing', initials: 'CL', bg: 'bg-[#ec4899]' },
  { name: 'Anh Hùng', role: 'Kỹ thuật', initials: 'AH', bg: 'bg-[#10b981]' },
];

const FALLBACK_PREVIEWS = [
  'Vâng, mình nghĩ chúng ta nên chốt kế hoạch trong tuần này.',
  'Để mình gửi lại tài liệu tổng hợp sau cuộc họp nhé.',
];

const MAX_SPEAKER_NAME_LENGTH = 50;

function extractInitials(name, fallback) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  return parts.map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export default function RenameSpeakerModal({
  isOpen,
  speaker,
  sampleUtterances = [],
  workspaceMembers = DEFAULT_WORKSPACE_MEMBERS,
  onClose,
  onApply,
}) {
  const [newName, setNewName] = useState('');
  const [applyToAll, setApplyToAll] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen || !speaker) return;
    setNewName(speaker.name || speaker.originalLabel || '');
    setApplyToAll(false);
    setValidationError('');
    setSubmitting(false);
  }, [isOpen, speaker]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !submitting) {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, submitting, onClose]);

  if (!isOpen || !speaker) return null;

  const speakerLabel = speaker.originalLabel || speaker.name || `Speaker ${speaker.id || '1'}`;
  const currentDisplayName = speaker.name || speakerLabel;
  const speakerInitials = speakerLabel.replace(/[^0-9a-zA-Z]/g, '').slice(0, 2).toUpperCase() || 'S1';
  const speakerSegmentsCount = speaker.segments?.length ?? speaker.utteranceCount ?? 0;
  const currentInitials = extractInitials(newName, speakerInitials);

  const previewLines = sampleUtterances.length > 0
    ? sampleUtterances.slice(0, 2)
    : FALLBACK_PREVIEWS;

  const validateName = (value) => {
    const trimmed = value.trim();
    if (!trimmed) return 'Tên người nói không được để trống.';
    if (trimmed.length > MAX_SPEAKER_NAME_LENGTH) {
      return `Tên người nói tối đa ${MAX_SPEAKER_NAME_LENGTH} ký tự.`;
    }
    return '';
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    const trimmed = newName.trim();
    const error = validateName(newName);
    if (error) {
      setValidationError(error);
      return;
    }

    setSubmitting(true);
    setValidationError('');
    try {
      await onApply?.(speaker.id, trimmed, applyToAll);
      onClose?.();
    } catch (err) {
      setValidationError(err?.message || 'Không thể đổi tên người nói. Vui lòng thử lại.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-speaker-modal-title"
      onClick={() => {
        if (!submitting) onClose?.();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[460px] bg-[#0c101d] border border-[#1e2742] rounded-2xl shadow-2xl p-6 relative font-sans text-left my-8"
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <h2 id="rename-speaker-modal-title" className="text-white text-lg font-bold">
            Đổi tên người nói
          </h2>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            aria-label="Đóng hộp thoại"
            className="w-7 h-7 rounded-full bg-[#182035] hover:bg-[#222d4a] text-slate-400 hover:text-white flex items-center justify-center transition-colors -mr-1 -mt-1 disabled:opacity-50"
          >
            <span className="text-xs leading-none">✕</span>
          </button>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed mt-1.5 mb-5">
          Đổi tên sẽ được áp dụng cho toàn bộ đoạn hội thoại của người này trong bản ghi hiện tại.
        </p>

        {/* Current Speaker Box */}
        <div className="bg-[#141a2e] border border-[#1e2742] rounded-xl p-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[#5b5dfa] text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-sm">
            {speakerInitials}
          </div>
          <div className="flex items-baseline gap-1.5 flex-1 min-w-0">
            <span className="text-white font-semibold text-sm truncate">{currentDisplayName}</span>
            <span className="text-xs text-slate-400 shrink-0">({speakerSegmentsCount} lượt phát biểu)</span>
          </div>
        </div>

        {/* Down Arrow separator */}
        <div className="flex justify-center -my-2.5 relative z-10">
          <div className="w-6 h-6 rounded-full bg-[#161c30] border border-[#222d48] flex items-center justify-center text-slate-400 shadow-md">
            <ChevronDownIcon />
          </div>
        </div>

        {/* New Name Input */}
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="rename-speaker-input" className="block text-xs text-slate-400 font-medium">
              Tên mới
            </label>
            <span className="text-[11px] text-slate-500">
              {newName.trim().length}/{MAX_SPEAKER_NAME_LENGTH}
            </span>
          </div>
          <div className="relative">
            <input
              id="rename-speaker-input"
              type="text"
              autoFocus
              maxLength={MAX_SPEAKER_NAME_LENGTH}
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                if (validationError) setValidationError('');
              }}
              placeholder="Nhập tên mới..."
              className={`w-full h-10 px-3.5 pr-10 bg-[#0f1424] border rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 transition-all ${
                validationError
                  ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500'
                  : 'border-[#2a385c] focus:border-[#5b5dfa] focus:ring-[#5b5dfa]'
              }`}
            />
            <UserIcon className="w-4 h-4 text-slate-400 absolute right-3.5 top-3 pointer-events-none" />
          </div>
          {validationError && (
            <p role="alert" className="text-[11px] text-rose-400 mt-1.5">
              {validationError}
            </p>
          )}
        </div>

        {/* Workspace Members Suggestions */}
        <div className="mt-2.5 rounded-xl border border-dashed border-[#38bdf8]/60 bg-[#0d1222] overflow-hidden">
          <div className="px-3.5 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-[#12182b] border-b border-[#1b2542]">
            ĐÃ DÙNG TRONG KHÔNG GIAN LÀM VIỆC
          </div>
          <div>
            {workspaceMembers.map((member, index) => {
              const isSelected = newName.trim() === member.name;
              return (
                <button
                  key={member.name || index}
                  type="button"
                  onClick={() => {
                    setNewName(member.name);
                    setValidationError('');
                  }}
                  className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between hover:bg-[#161f38] cursor-pointer transition-colors border-b border-[#1a233b] last:border-0 ${
                    isSelected ? 'bg-[#151c34]' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-7 h-7 rounded-full ${member.bg} text-white flex items-center justify-center text-[10px] font-bold shrink-0`}>
                      {member.initials}
                    </div>
                    <div>
                      <div className="text-white text-xs font-semibold">{member.name}</div>
                      <div className="text-[11px] text-slate-400">{member.role}</div>
                    </div>
                  </div>
                  {isSelected && <CheckIcon className="w-4 h-4 text-[#818cf8]" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Preview Section */}
        <div className="mt-4">
          <div className="text-xs text-slate-400 font-medium mb-2">Xem trước</div>
          <div className="bg-[#101526] border border-[#1a233b] rounded-xl p-3.5 space-y-3">
            {previewLines.map((line, index) => (
              <div key={index} className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-[#4f46e5] text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {currentInitials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] mb-1 truncate">
                    <span className="text-slate-500 line-through mr-1">{currentDisplayName}</span>
                    <span className="text-slate-400">→</span>
                    <span className="text-indigo-400 font-semibold ml-1">{newName.trim() || '...'}</span>
                  </div>
                  <div className="text-xs text-slate-300 leading-relaxed line-clamp-2">
                    {line}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Global Apply Checkbox */}
        <div className="mt-4 pt-3.5 border-t border-[#1a233b]">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={applyToAll}
              onChange={(e) => setApplyToAll(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-[#2a385c] bg-[#0f1424] text-[#4f46e5] focus:ring-0 cursor-pointer"
            />
            <div>
              <span className="text-xs text-slate-300 font-medium">
                Áp dụng thay đổi này cho tất cả các bản ghi khác có cùng {speakerLabel} trong dự án
              </span>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-normal">
                Thao tác này sẽ cập nhật tên trên toàn bộ các cuộc họp trước đó có cùng người nói này.
              </p>
            </div>
          </label>
        </div>

        {/* Footer Actions */}
        <div className="mt-5 pt-4 border-t border-[#1a233b] flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="px-6 py-2 rounded-lg border border-[#24304f] bg-[#141a2e] hover:bg-[#1a233d] text-white text-xs font-medium transition-colors disabled:opacity-50"
          >
            Hủy
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2 rounded-lg bg-[#5452F6] hover:bg-[#4338ca] text-white text-xs font-semibold shadow-lg shadow-indigo-500/25 transition-all disabled:opacity-50"
          >
            {submitting ? 'Đang áp dụng...' : 'Áp dụng'}
          </button>
        </div>
      </form>
    </div>
  );
}
