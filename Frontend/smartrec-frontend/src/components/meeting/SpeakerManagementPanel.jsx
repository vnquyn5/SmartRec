import React, { useState, useEffect, useRef } from 'react';

function CheckCircleIcon({ className = "w-4 h-4", ...props }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function AlertCircleIcon({ className = "w-4 h-4", ...props }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function SpinnerIcon({ className = "w-4 h-4", ...props }) {
  return (
    <svg className={`${className} animate-spin`} width="16" height="16" viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="9" className="opacity-25" stroke="currentColor" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function UserIcon({ className = "w-4 h-4", ...props }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function ClockIcon({ className = "w-3.5 h-3.5", ...props }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function ChevronDownIcon({ className = "w-3.5 h-3.5", ...props }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon({ className = "w-3.5 h-3.5", ...props }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

const DOT_COLORS = ['#2563eb', '#818cf8', '#f97316', '#10b981'];

const WORKSPACE_MEMBERS = [
  { name: 'Anh Quyền', role: 'CEO', initials: 'AQ', bg: 'bg-[#4f46e5]' },
  { name: 'Chị Lan', role: 'Trưởng phòng Marketing', initials: 'CL', bg: 'bg-[#ec4899]' },
  { name: 'Anh Hùng', role: 'Kỹ thuật', initials: 'AH', bg: 'bg-[#10b981]' },
  { name: 'Nguyễn Văn A', role: 'Product Manager', initials: 'NA', bg: 'bg-[#3b82f6]' },
  { name: 'Trần Văn B', role: 'UI/UX Designer', initials: 'TB', bg: 'bg-[#8b5cf6]' },
];

function SpeakerDropdown({ value, onChange, originalLabel, error, isOpen, onToggle, onClose }) {
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  const selectedMember = WORKSPACE_MEMBERS.find(
    m => m.name.toLowerCase() === (value || '').trim().toLowerCase()
  );

  return (
    <div className={`relative w-full ${isOpen ? 'z-50' : 'z-10'}`} ref={dropdownRef}>
      {/* Dropdown Trigger Box */}
      <div
        onClick={onToggle}
        className={`w-full h-9 px-3 bg-[#0c101d] border rounded-lg flex items-center justify-between cursor-pointer select-none transition-all ${
          isOpen
            ? 'border-[#5452f6] ring-1 ring-[#5452f6]'
            : error
            ? 'border-rose-500'
            : 'border-[#2a385c] hover:border-[#5452f6]'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {selectedMember ? (
            <div className={`w-5 h-5 rounded-full ${selectedMember.bg} text-white text-[9px] font-bold flex items-center justify-center shrink-0`}>
              {selectedMember.initials}
            </div>
          ) : (
            <UserIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          )}
          <span className={`text-xs truncate font-medium ${value ? 'text-white' : 'text-slate-500'}`}>
            {value || 'Chọn tên người nói...'}
          </span>
        </div>

        <ChevronDownIcon
          className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform duration-200 ${
            isOpen ? 'rotate-180 text-[#5452f6]' : ''
          }`}
        />
      </div>

      {error && (
        <p className="text-[11px] text-rose-400 mt-1">{error}</p>
      )}

      {/* Dropdown Floating Menu */}
      {isOpen && (
        <div className="absolute top-full right-0 mt-1.5 w-72 bg-[#0c101d] border border-[#25355e] rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.9)] z-50 p-2 font-sans">
          {/* Custom Input */}
          <div className="mb-2 pb-2 border-b border-[#1b2542]">
            <input
              type="text"
              value={value || ''}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Hoặc nhập tên tùy chỉnh..."
              className="w-full h-8 px-2.5 bg-[#141a2e] border border-[#2a385c] focus:border-[#5452f6] rounded-md text-xs text-white placeholder-slate-500 focus:outline-none"
              onClick={(e) => e.stopPropagation()}
              autoFocus
            />
          </div>

          {/* Section: ĐÃ DÙNG TRONG KHÔNG GIAN LÀM VIỆC */}
          <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            ĐÃ DÙNG TRONG KHÔNG GIAN LÀM VIỆC
          </div>

          <div className="space-y-0.5 mt-1 max-h-48 overflow-y-auto">
            {WORKSPACE_MEMBERS.map((member, mIdx) => {
              const isSelected = value?.trim().toLowerCase() === member.name.toLowerCase();
              return (
                <div
                  key={mIdx}
                  onClick={() => {
                    onChange(member.name);
                    onClose();
                  }}
                  className={`flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-[#161f38] cursor-pointer transition-colors ${isSelected ? 'bg-[#151c34]' : ''
                    }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className={`w-6 h-6 rounded-full ${member.bg} text-white text-[10px] font-bold flex items-center justify-center shrink-0`}>
                      {member.initials}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-white">{member.name}</div>
                      <div className="text-[10px] text-slate-400">{member.role}</div>
                    </div>
                  </div>
                  {isSelected && (
                    <CheckIcon className="w-3.5 h-3.5 text-[#818cf8]" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Reset Option */}
          <div className="mt-1 pt-1.5 border-t border-[#1b2542]">
            <div
              onClick={() => {
                onChange(originalLabel);
                onClose();
              }}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[#161f38] cursor-pointer text-[11px] text-slate-400 hover:text-white transition-colors"
            >
              <span>Đặt lại về mặc định ({originalLabel})</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SpeakerManagementPanel({
  initialSpeakers = [],
  onSave
}) {
  const [names, setNames] = useState({});
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState('default'); // 'default' | 'editing' | 'saving' | 'success' | 'error'
  const [errorMessage, setErrorMessage] = useState('');
  const [applyToAll, setApplyToAll] = useState(false);
  const [activeDropdownId, setActiveDropdownId] = useState(null);

  useEffect(() => {
    const map = {};
    initialSpeakers.forEach(s => {
      map[s.id] = s.name || s.originalLabel || '';
    });
    setNames(map);
    setErrors({});
    setStatus('default');
  }, [initialSpeakers]);

  const handleChange = (id, val) => {
    setNames(prev => ({ ...prev, [id]: val }));
    setStatus('editing');
    if (errors[id]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const validate = () => {
    const errs = {};
    let valid = true;
    initialSpeakers.forEach(s => {
      const val = names[s.id];
      if (!val || val.trim() === '') {
        errs[s.id] = 'Speaker name is required.';
        valid = false;
      } else if (val.trim().length > 50) {
        errs[s.id] = 'Speaker name cannot exceed 50 characters.';
        valid = false;
      }
    });
    setErrors(errs);
    return valid;
  };

  const hasChanges = () => {
    return initialSpeakers.some(s => {
      const current = names[s.id] || '';
      const original = s.name || s.originalLabel || '';
      return current.trim() !== original.trim();
    });
  };

  const handleCancel = () => {
    const map = {};
    initialSpeakers.forEach(s => {
      map[s.id] = s.name || s.originalLabel || '';
    });
    setNames(map);
    setErrors({});
    setStatus('default');
  };

  const handleSave = async () => {
    if (!validate()) return;
    if (!hasChanges()) return;

    setStatus('saving');
    setErrorMessage('');
    try {
      const payload = initialSpeakers.map(s => ({
        ...s,
        id: s.id,
        name: (names[s.id] || '').trim()
      }));

      if (onSave) {
        await onSave(payload, applyToAll);
      }
      setStatus('success');
      setTimeout(() => setStatus('default'), 3500);
    } catch (err) {
      setStatus('error');
      setErrorMessage(err?.message || 'Unable to save speaker names. Please try again.');
    }
  };

  const isSaving = status === 'saving';
  const isEditing = status === 'editing' && hasChanges();

  return (
    <div className="w-full bg-[#0c101d] border border-[#1e2742] rounded-2xl shadow-xl font-sans relative">
      {/* Header */}
      <div className="p-5 border-b border-[#1b2542] flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#0f1426]/50">
        <div>
          <h2 className="text-base font-bold text-white tracking-tight">
            Speaker Management
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Quản lý tên hiển thị của nhiều Speaker và theo dõi dòng thời gian phát biểu tương ứng.
          </p>
        </div>

        <span className="text-xs font-semibold px-3 py-1 rounded-full bg-[#16203a] text-[#38bdf8] border border-[#25355e] self-start sm:self-auto">
          {initialSpeakers.length} Speakers
        </span>
      </div>

      <div className="p-5 space-y-5">
        {/* Status Alerts */}
        {isEditing && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
            <AlertCircleIcon className="w-4 h-4 shrink-0" />
            <span>You have unsaved changes.</span>
          </div>
        )}

        {status === 'success' && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs">
            <CheckCircleIcon className="w-4 h-4 shrink-0" />
            <span>✓ Speaker names updated successfully.</span>
          </div>
        )}

        {status === 'error' && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">
            <AlertCircleIcon className="w-4 h-4 shrink-0" />
            <span>✕ {errorMessage}</span>
          </div>
        )}

        {/* Speaker Rename List Items */}
        <div className="space-y-4">
          {initialSpeakers.map((speaker, index) => {
            const dotColor = DOT_COLORS[index % DOT_COLORS.length];
            const originalLabel = speaker.originalLabel || `Speaker ${index + 1}`;
            const initials = originalLabel.replace(/[^0-9a-zA-Z]/g, '').slice(0, 2).toUpperCase() || `S${index + 1}`;
            const value = names[speaker.id] !== undefined ? names[speaker.id] : (speaker.name || '');
            const error = errors[speaker.id];
            const isDropdownOpen = activeDropdownId === speaker.id;

            return (
              <div
                key={speaker.id}
                className={`bg-[#121729] border border-[#1e2742] hover:border-[#2a385c] rounded-xl p-4 transition-all relative ${
                  isDropdownOpen ? 'z-30 shadow-2xl border-[#5452f6]/40' : 'z-10'
                }`}
              >
                {/* Speaker Info + Dropdown Row */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-full text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-sm"
                      style={{ backgroundColor: dotColor }}
                    >
                      {initials}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">
                        {originalLabel}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {speaker.segments?.length || 0} speaking segments
                      </div>
                    </div>
                  </div>

                  {/* Dropdown Field */}
                  <div className="w-full md:w-72">
                    <SpeakerDropdown
                      value={value}
                      onChange={(newVal) => handleChange(speaker.id, newVal)}
                      originalLabel={originalLabel}
                      error={error}
                      isOpen={isDropdownOpen}
                      onToggle={() => setActiveDropdownId(isDropdownOpen ? null : speaker.id)}
                      onClose={() => setActiveDropdownId(null)}
                    />
                  </div>
                </div>

                {/* Speaking Timeline under Speaker */}
                <div className="mt-3 pt-3 border-t border-[#1a233b]">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                    <ClockIcon className="w-3 h-3 text-[#38bdf8]" />
                    <span>Speaking Timeline</span>
                  </div>

                  {speaker.segments && speaker.segments.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {speaker.segments.map((seg, sIdx) => (
                        <div
                          key={sIdx}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#161d33] border border-[#222d4d] text-[11px] font-mono text-slate-300"
                        >
                          <div
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: dotColor }}
                          />
                          <span className="text-white">{seg.start}</span>
                          <span className="text-slate-500">→</span>
                          <span className="text-slate-300">{seg.end}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 italic">Chưa có đoạn phát ngôn nào.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Global Checkbox */}
        <div className="pt-3 border-t border-[#1a233b]">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={applyToAll}
              onChange={(e) => setApplyToAll(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-[#2a385c] bg-[#0c101d] text-[#5452f6] focus:ring-0 cursor-pointer"
            />
            <div>
              <span className="text-xs text-slate-300 font-medium">
                Áp dụng thay đổi này cho tất cả các bản ghi khác trong dự án
              </span>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Thao tác này sẽ cập nhật tên trên toàn bộ các cuộc họp trước đó có cùng người nói này.
              </p>
            </div>
          </label>
        </div>

        {/* Footer Actions */}
        <div className="pt-4 border-t border-[#1a233b] flex items-center justify-end gap-3">
          {(isEditing || isSaving || status === 'error') && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={isSaving}
              className="px-5 py-2 rounded-lg border border-[#24304f] bg-[#141a2e] hover:bg-[#1a233d] text-white text-xs font-medium transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={!hasChanges() || isSaving}
            className={`flex items-center gap-2 px-6 py-2 rounded-lg text-xs font-semibold text-white transition-all ${!hasChanges() || isSaving
                ? 'bg-[#5452f6]/40 text-white/50 cursor-not-allowed border border-[#5452f6]/20'
                : 'bg-[#5452f6] hover:bg-[#4338ca] shadow-lg shadow-indigo-500/25 border border-transparent'
              }`}
          >
            {isSaving && <SpinnerIcon className="w-3.5 h-3.5 text-white" />}
            <span>{isSaving ? 'Saving...' : 'Save Changes'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
