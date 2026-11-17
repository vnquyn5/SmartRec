import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import mockSummaryData from '../../mocks/mock_summary.json';
import {
  formatTimestamp,
  normalizeTimestampInput,
  parseTimeToSeconds,
} from '../../utils/timeFormat';
import {
  hasSavedMeetingTasks,
  loadMeetingTasks,
  resetMeetingTasks,
  saveMeetingTasks,
} from '../../services/meetingReviewService';

const DEFAULT_MEMBERS = [
  'dev_team',
  'dev_team_lead',
  'Alex Nguyen',
  'Sarah Lee',
  'Michael Scott',
  'David Park',
  'Jessica Taylor',
  'Văn Quyền',
  'Bách Khoa',
  'Yến Nhi',
];

const PRIORITY_OPTIONS = ['High', 'Medium', 'Low'];

const PRIORITY_STYLES = {
  High: 'border-rose-500/50 bg-rose-950/40 text-rose-300',
  Medium: 'border-amber-500/50 bg-amber-950/40 text-amber-300',
  Low: 'border-emerald-500/50 bg-emerald-950/40 text-emerald-300',
};

const MAX_TASK_CONTENT_LENGTH = 500;

function EditPencilIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function getTodayLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isDeadlineOverdue(deadline) {
  if (!deadline) return false;
  return deadline < getTodayLocalDateString();
}

function normalizeTask(task, index) {
  const safeIndex = Number(task?.task_index) || index + 1;
  return {
    _uid: task?._uid || `task-${safeIndex}-${index}`,
    task_index: safeIndex,
    timestamp: task?.timestamp || '00:00',
    content: task?.content || '',
    assignee: task?.assignee || '',
    responsible: task?.responsible || '',
    deadline: task?.deadline || '',
    priority: PRIORITY_OPTIONS.includes(task?.priority) ? task.priority : 'Medium',
  };
}

function serializeTasks(tasks) {
  return tasks.map((task, idx) => {
    const clean = {
      ...task,
      task_index: idx + 1,
      content: String(task.content || '').trim(),
    };
    delete clean._uid;
    return clean;
  });
}

function areTasksEqual(a, b) {
  return JSON.stringify(serializeTasks(a)) === JSON.stringify(serializeTasks(b));
}

function isSameRowValues(a, b) {
  if (!a || !b) return false;
  return (
    a.content === b.content &&
    a.assignee === b.assignee &&
    a.responsible === b.responsible &&
    a.deadline === b.deadline &&
    a.priority === b.priority &&
    a.timestamp === b.timestamp
  );
}

function TaskContentCell({
  value,
  isEditing,
  error,
  onStartEdit,
  onCommit,
  onQuickSave,
  onCancel,
}) {
  const [draft, setDraft] = useState(value);
  const textareaRef = useRef(null);

  useEffect(() => {
    setDraft(value);
  }, [value, isEditing]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [isEditing]);

  if (isEditing) {
    return (
      <div className="flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
        <textarea
          ref={textareaRef}
          rows={2}
          maxLength={MAX_TASK_CONTENT_LENGTH}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onCommit(draft)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
              e.preventDefault();
              e.stopPropagation();
              onQuickSave(draft);
            } else if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onCommit(draft);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setDraft(value);
              onCancel();
            }
          }}
          placeholder="Nhập nội dung công việc..."
          aria-label="Nội dung công việc"
          className={`w-full min-w-[240px] rounded-lg bg-[#080e1d] border px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none resize-y leading-relaxed ${
            error
              ? 'border-rose-500 ring-1 ring-rose-500/40'
              : 'border-[#38bdf8] ring-1 ring-[#38bdf8]/30'
          }`}
        />
        <div className="flex items-center justify-between text-[10px] text-slate-400">
          <span>Enter lưu ô · Ctrl+S lưu bảng · Esc hủy</span>
          <span>
            {draft.length}/{MAX_TASK_CONTENT_LENGTH}
          </span>
        </div>
        {error && <span className="text-[11px] text-rose-400">{error}</span>}
      </div>
    );
  }

  return (
    <div className="group/cell flex flex-col gap-1">
      <div
        role="button"
        tabIndex={0}
        onClick={onStartEdit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onStartEdit();
          }
        }}
        title="Nhấp để chỉnh sửa tên công việc"
        className={`flex items-start justify-between gap-2 rounded-lg px-2 py-1 -mx-2 -my-1 cursor-text transition hover:bg-[#16223e] focus:outline-none focus:ring-1 focus:ring-[#38bdf8] ${
          error ? 'ring-1 ring-rose-500/70 bg-rose-950/20' : ''
        }`}
      >
        <span
          className={`leading-relaxed break-words ${
            value ? 'text-slate-200 font-medium' : 'text-amber-300/80 italic'
          }`}
        >
          {value || 'Chưa có tên công việc (nhấp để nhập)...'}
        </span>
        <span className="opacity-0 group-hover/cell:opacity-100 text-slate-400 hover:text-[#38bdf8] shrink-0 pt-0.5 transition-opacity">
          <EditPencilIcon />
        </span>
      </div>
      {error && <span className="text-[11px] text-rose-400">{error}</span>}
    </div>
  );
}

function TaskTimestampCell({
  value,
  isEditing,
  onStartEdit,
  onCommit,
  onCancel,
  onSeek,
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    setDraft(value);
    setError('');
  }, [value, isEditing]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const tryCommit = (raw) => {
    const normalized = normalizeTimestampInput(raw);
    if (!normalized) {
      setError('Định dạng mm:ss');
      return;
    }
    setError('');
    onCommit(normalized);
  };

  if (isEditing) {
    return (
      <div className="flex flex-col items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError('');
          }}
          onBlur={() => {
            const normalized = normalizeTimestampInput(draft);
            if (normalized) {
              onCommit(normalized);
            } else {
              setDraft(value);
              setError('');
              onCancel();
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              tryCommit(draft);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setDraft(value);
              setError('');
              onCancel();
            }
          }}
          placeholder="mm:ss"
          aria-label="Mốc thời gian"
          className={`w-20 rounded-md bg-[#080e1d] border px-2 py-1 text-center font-mono text-[11px] text-[#38bdf8] focus:outline-none ${
            error ? 'border-rose-500' : 'border-[#38bdf8]'
          }`}
        />
        {error && <span className="text-[10px] text-rose-400">{error}</span>}
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-1 group/ts">
      <button
        type="button"
        onClick={() => onSeek(value)}
        className="inline-flex items-center gap-1.5 whitespace-nowrap bg-[#101b30] hover:bg-[#1c3057] text-[#38bdf8] font-mono font-bold px-2.5 py-1 rounded border border-[#233a69] transition text-[11px]"
        title="Nhấp để tua media đến mốc này"
      >
        ▶ {value}
      </button>
      <button
        type="button"
        onClick={onStartEdit}
        title="Chỉnh sửa mốc thời gian (mm:ss)"
        aria-label={`Sửa mốc thời gian ${value}`}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded text-slate-500 hover:text-[#38bdf8] hover:bg-[#14203b] transition"
      >
        <EditPencilIcon className="w-3 h-3" />
      </button>
    </div>
  );
}

function TaskTableRow({
  task,
  index,
  isModified,
  editingField,
  error,
  availableMembers,
  onStartEditCell,
  onCancelEditCell,
  onCommitContent,
  onQuickSaveContent,
  onCommitTimestamp,
  onUpdateField,
  onDelete,
  onSeek,
}) {
  const overdue = isDeadlineOverdue(task.deadline);

  return (
    <tr
      data-testid="task-editor-row"
      className={`group transition ${
        isModified ? 'bg-[#101a33]/80 hover:bg-[#142140]' : 'hover:bg-[#121c33]'
      }`}
    >
      {/* Index */}
      <td className="py-3.5 px-3 text-center font-bold text-slate-400 whitespace-nowrap align-top">
        <div className="flex flex-col items-center gap-1">
          <span>{index + 1}</span>
          {isModified && (
            <span
              title="Dòng đã được chỉnh sửa"
              className="w-1.5 h-1.5 rounded-full bg-amber-400"
            />
          )}
        </div>
      </td>

      {/* Task Content */}
      <td className="py-3.5 px-4 align-top">
        <TaskContentCell
          value={task.content}
          isEditing={editingField === 'content'}
          error={error}
          onStartEdit={() => onStartEditCell(task._uid, 'content')}
          onCommit={(val) => onCommitContent(task._uid, val)}
          onQuickSave={(val) => onQuickSaveContent(task._uid, val)}
          onCancel={onCancelEditCell}
        />
      </td>

      {/* Timestamp */}
      <td className="py-3.5 px-3 text-center whitespace-nowrap align-top">
        <TaskTimestampCell
          value={task.timestamp}
          isEditing={editingField === 'timestamp'}
          onStartEdit={() => onStartEditCell(task._uid, 'timestamp')}
          onCommit={(val) => onCommitTimestamp(task._uid, val)}
          onCancel={onCancelEditCell}
          onSeek={onSeek}
        />
      </td>

      {/* Assignee */}
      <td className="py-3.5 px-4 whitespace-nowrap align-top">
        <select
          aria-label={`Người thực hiện cho việc ${index + 1}`}
          value={task.assignee}
          onChange={(e) => onUpdateField(task._uid, 'assignee', e.target.value)}
          className={`w-full rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#38bdf8] cursor-pointer transition [color-scheme:dark] ${
            task.assignee
              ? 'border border-[#1f3054] bg-[#0a1122] text-slate-200'
              : 'border border-amber-500/60 bg-amber-950/40 text-amber-300 font-medium'
          }`}
        >
          <option value="" className="bg-[#0b1325] text-amber-400 font-semibold">
            -- Chưa gán --
          </option>
          {availableMembers.map((member) => (
            <option
              key={member}
              value={member}
              className="bg-[#0b1325] text-slate-200 font-normal"
            >
              {member}
            </option>
          ))}
        </select>
      </td>

      {/* Responsible */}
      <td className="py-3.5 px-4 whitespace-nowrap align-top">
        <select
          aria-label={`Người giám sát cho việc ${index + 1}`}
          value={task.responsible}
          onChange={(e) => onUpdateField(task._uid, 'responsible', e.target.value)}
          className="w-full rounded-lg border border-[#1f3054] bg-[#0a1122] px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-[#38bdf8] cursor-pointer transition [color-scheme:dark]"
        >
          <option value="" className="bg-[#0b1325] text-slate-400">
            -- Chưa xác định --
          </option>
          {availableMembers.map((member) => (
            <option key={member} value={member} className="bg-[#0b1325] text-slate-200">
              {member}
            </option>
          ))}
        </select>
      </td>

      {/* Deadline */}
      <td className="py-3.5 px-4 whitespace-nowrap align-top">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <input
              type="date"
              aria-label={`Hạn chót cho việc ${index + 1}`}
              value={task.deadline}
              onChange={(e) => onUpdateField(task._uid, 'deadline', e.target.value)}
              className={`w-full rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[#38bdf8] transition [color-scheme:dark] cursor-pointer ${
                overdue
                  ? 'border border-rose-500/60 bg-rose-950/30 text-rose-300'
                  : task.deadline
                  ? 'border border-[#1f3054] bg-[#0a1122] text-slate-200'
                  : 'border border-amber-500/60 bg-amber-950/40 text-amber-300 font-medium'
              }`}
            />
            {task.deadline && (
              <button
                type="button"
                onClick={() => onUpdateField(task._uid, 'deadline', '')}
                title="Xóa hạn chót"
                aria-label={`Xóa hạn chót cho việc ${index + 1}`}
                className="p-1 text-slate-500 hover:text-slate-200 rounded transition"
              >
                ✕
              </button>
            )}
          </div>
          {overdue && (
            <span className="text-[10px] font-semibold text-rose-400">Quá hạn</span>
          )}
        </div>
      </td>

      {/* Priority */}
      <td className="py-3.5 px-3 text-center whitespace-nowrap align-top">
        <select
          aria-label={`Độ ưu tiên cho việc ${index + 1}`}
          value={task.priority}
          onChange={(e) => onUpdateField(task._uid, 'priority', e.target.value)}
          className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none cursor-pointer border transition [color-scheme:dark] ${
            PRIORITY_STYLES[task.priority] || PRIORITY_STYLES.Medium
          }`}
        >
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p} value={p} className="bg-[#0b1325] text-slate-200 font-medium">
              {p}
            </option>
          ))}
        </select>
      </td>

      {/* Delete Row */}
      <td className="py-3.5 px-3 text-center whitespace-nowrap align-top">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onDelete(task._uid)}
          title="Xóa công việc này"
          aria-label={`Xóa công việc ${index + 1}`}
          className="opacity-40 group-hover:opacity-100 focus:opacity-100 p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition"
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6" />
          </svg>
        </button>
      </td>
    </tr>
  );
}

export default function TaskTableEditor({
  meetingId,
  initialTasks,
  memberOptions = DEFAULT_MEMBERS,
  currentTime = 0,
  onSeekSegment,
  onSaveTasks,
  onTasksChange,
}) {
  const defaultTasks = useMemo(() => {
    const raw = Array.isArray(initialTasks)
      ? initialTasks
      : (mockSummaryData?.task || []);
    return raw.map((item, idx) => normalizeTask(item, idx));
  }, [initialTasks]);

  const baseTasks = useMemo(() => {
    const loaded = loadMeetingTasks(meetingId, defaultTasks);
    return loaded.map((item, idx) => normalizeTask(item, idx));
  }, [meetingId, defaultTasks]);

  const [tasks, setTasks] = useState(baseTasks);
  const [savedSnapshot, setSavedSnapshot] = useState(baseTasks);
  const [hasCustomSaved, setHasCustomSaved] = useState(() => hasSavedMeetingTasks(meetingId));
  const [editingCell, setEditingCell] = useState(null); // { uid, field }
  const [rowErrors, setRowErrors] = useState({});
  const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'reset' | 'error'
  const [saveError, setSaveError] = useState('');
  const uidCounterRef = useRef(baseTasks.length + 1);

  useEffect(() => {
    setTasks(baseTasks);
    setSavedSnapshot(baseTasks);
    setHasCustomSaved(hasSavedMeetingTasks(meetingId));
    setEditingCell(null);
    setRowErrors({});
    setSaveStatus('idle');
    setSaveError('');
  }, [baseTasks, meetingId]);

  useEffect(() => {
    onTasksChange?.(tasks);
  }, [tasks, onTasksChange]);

  const isDirty = useMemo(
    () => !areTasksEqual(tasks, savedSnapshot),
    [tasks, savedSnapshot]
  );

  const canResetToAiDefault = useMemo(
    () => hasCustomSaved || !areTasksEqual(tasks, defaultTasks),
    [hasCustomSaved, tasks, defaultTasks]
  );

  const availableMembers = useMemo(() => {
    const set = new Set(memberOptions);
    tasks.forEach((t) => {
      if (t.assignee) set.add(t.assignee);
      if (t.responsible) set.add(t.responsible);
    });
    return Array.from(set);
  }, [memberOptions, tasks]);

  const savedByUid = useMemo(
    () => new Map(savedSnapshot.map((t) => [t._uid, t])),
    [savedSnapshot]
  );

  const modifiedRowCount = useMemo(() => {
    let count = 0;
    tasks.forEach((t) => {
      const baseline = savedByUid.get(t._uid);
      if (!isSameRowValues(t, baseline)) count += 1;
    });
    const currentUids = new Set(tasks.map((t) => t._uid));
    savedSnapshot.forEach((t) => {
      if (!currentUids.has(t._uid)) count += 1;
    });
    return count;
  }, [tasks, savedByUid, savedSnapshot]);

  const updateTaskField = useCallback((uid, field, value) => {
    setTasks((prev) =>
      prev.map((task) => (task._uid === uid ? { ...task, [field]: value } : task))
    );
    setSaveStatus((prev) => (prev === 'saved' || prev === 'reset' ? 'idle' : prev));
    if (field === 'content') {
      setRowErrors((prev) => {
        if (!prev[uid]) return prev;
        const next = { ...prev };
        delete next[uid];
        return next;
      });
    }
  }, []);

  const handleCommitContent = useCallback(
    (uid, nextValue) => {
      const trimmed = String(nextValue || '').trim();
      updateTaskField(uid, 'content', trimmed);
      if (!trimmed) {
        setRowErrors((prev) => ({
          ...prev,
          [uid]: 'Tên công việc không được để trống.',
        }));
      }
      setEditingCell(null);
    },
    [updateTaskField]
  );

  const handleCommitTimestamp = useCallback(
    (uid, normalizedTimestamp) => {
      updateTaskField(uid, 'timestamp', normalizedTimestamp);
      setEditingCell(null);
    },
    [updateTaskField]
  );

  const validateTaskList = (list) => {
    const errors = {};
    list.forEach((task) => {
      if (!String(task.content || '').trim()) {
        errors[task._uid] = 'Tên công việc không được để trống.';
      }
    });
    setRowErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveAll = useCallback(
    async (overrideList = null) => {
      const targetTasks = Array.isArray(overrideList) ? overrideList : tasks;
      if (!validateTaskList(targetTasks)) {
        setSaveStatus('error');
        setSaveError('Vui lòng nhập đầy đủ tên công việc trước khi lưu.');
        return;
      }

      setSaveStatus('saving');
      setSaveError('');
      const cleanPayload = serializeTasks(targetTasks);
      try {
        if (typeof onSaveTasks === 'function') {
          await onSaveTasks(cleanPayload);
        } else {
          await saveMeetingTasks(meetingId, cleanPayload);
          setHasCustomSaved(true);
        }
        const nextSnapshot = cleanPayload.map((item, idx) =>
          normalizeTask({ ...item, _uid: targetTasks[idx]?._uid }, idx)
        );
        setTasks(nextSnapshot);
        setSavedSnapshot(nextSnapshot);
        setSaveStatus('saved');
      } catch (err) {
        setSaveStatus('error');
        setSaveError(err?.message || 'Không thể lưu bảng công việc. Vui lòng thử lại.');
      }
    },
    [meetingId, onSaveTasks, tasks]
  );

  const handleQuickSaveContent = useCallback(
    (uid, nextValue) => {
      const trimmed = String(nextValue || '').trim();
      const nextList = tasks.map((task) =>
        task._uid === uid ? { ...task, content: trimmed } : task
      );
      setTasks(nextList);
      setEditingCell(null);
      void handleSaveAll(nextList);
    },
    [handleSaveAll, tasks]
  );

  const handleAddTask = () => {
    const nextNum = uidCounterRef.current++;
    const newUid = `task-new-${Date.now()}-${nextNum}`;
    const newTask = normalizeTask(
      {
        _uid: newUid,
        task_index: tasks.length + 1,
        timestamp: formatTimestamp(currentTime),
        content: '',
        assignee: '',
        responsible: '',
        deadline: '',
        priority: 'Medium',
      },
      tasks.length
    );

    setTasks((prev) => [...prev, newTask]);
    setEditingCell({ uid: newUid, field: 'content' });
    setSaveStatus('idle');
  };

  const handleDeleteTask = (uid) => {
    setTasks((prev) =>
      prev
        .filter((task) => task._uid !== uid)
        .map((task, idx) => ({ ...task, task_index: idx + 1 }))
    );
    setRowErrors((prev) => {
      if (!prev[uid]) return prev;
      const next = { ...prev };
      delete next[uid];
      return next;
    });
    if (editingCell?.uid === uid) setEditingCell(null);
    setSaveStatus('idle');
  };

  const handleRevertAll = () => {
    setTasks(savedSnapshot);
    setEditingCell(null);
    setRowErrors({});
    setSaveStatus('idle');
    setSaveError('');
  };

  const handleResetToDefault = () => {
    resetMeetingTasks(meetingId);
    setHasCustomSaved(false);
    setTasks(defaultTasks);
    setSavedSnapshot(defaultTasks);
    setEditingCell(null);
    setRowErrors({});
    setSaveStatus('reset');
    setSaveError('');
  };

  const handleSeek = (timeStr) => {
    if (typeof onSeekSegment === 'function' && timeStr) {
      onSeekSegment(parseTimeToSeconds(timeStr));
    }
  };

  return (
    <div
      className="w-full flex flex-col gap-4 text-slate-300"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          if (isDirty && saveStatus !== 'saving') {
            void handleSaveAll();
          }
        }
      }}
    >
      {/* Header & Action Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#1b2640]">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <span className="w-1.5 h-4 bg-[#38bdf8] rounded-full inline-block" />
            Ma trận Công việc & Hành động (Task Matrix)
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#14203b] text-[#38bdf8] border border-[#233866]">
              {tasks.length} việc
            </span>
          </h3>
          <p className="text-xs text-slate-400 mt-1 pl-3.5">
            Nhấp trực tiếp vào tên việc, mốc thời gian, người thực hiện hoặc hạn chót để chỉnh sửa inline.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
          {canResetToAiDefault && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleResetToDefault}
              disabled={saveStatus === 'saving'}
              title="Khôi phục danh sách công việc gốc trích xuất từ AI"
              className="px-2.5 py-1.5 rounded-lg border border-[#253559] bg-[#0e172b] hover:bg-[#172544] text-slate-300 hover:text-amber-300 text-xs font-medium transition disabled:opacity-50"
            >
              Khôi phục gốc AI
            </button>
          )}
          <button
            type="button"
            onClick={handleAddTask}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#142340] hover:bg-[#1c3259] text-[#38bdf8] hover:text-white border border-[#243d70] text-xs font-semibold transition"
          >
            <span className="text-sm leading-none">+</span>
            <span>Thêm công việc</span>
          </button>
        </div>
      </div>

      {/* Dirty / Feedback Banner */}
      {(isDirty || saveStatus === 'saved' || saveStatus === 'reset' || saveStatus === 'error') && (
        <div
          className={`flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-xl border text-xs ${
            saveStatus === 'error'
              ? 'bg-rose-950/30 border-rose-500/40 text-rose-300'
              : (saveStatus === 'saved' || saveStatus === 'reset') && !isDirty
              ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
              : 'bg-amber-950/25 border-amber-500/40 text-amber-300'
          }`}
        >
          <span className="font-medium">
            {saveStatus === 'error'
              ? saveError
              : saveStatus === 'saved' && !isDirty
              ? '✓ Đã lưu thay đổi bảng công việc.'
              : saveStatus === 'reset' && !isDirty
              ? '✓ Đã khôi phục bảng công việc gốc từ AI.'
              : `Có ${Math.max(1, modifiedRowCount)} thay đổi chưa lưu · Nhấn Ctrl+S để lưu nhanh.`}
          </span>

          {isDirty && (
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleRevertAll}
                disabled={saveStatus === 'saving'}
                className="px-3 py-1 rounded-lg border border-[#283659] bg-[#11182c] hover:bg-[#192440] text-slate-200 text-xs font-medium transition disabled:opacity-50"
              >
                Hoàn tác
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSaveAll()}
                disabled={saveStatus === 'saving'}
                className="px-3.5 py-1 rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-xs font-semibold transition shadow-sm disabled:opacity-50"
              >
                {saveStatus === 'saving' ? 'Đang lưu...' : 'Lưu thay đổi'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Task Matrix Table */}
      <div className="w-full overflow-x-auto rounded-2xl border border-[#1b2742] bg-[#0d1526] shadow-xl">
        <table className="w-full min-w-[940px] text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-[#18233d] bg-[#090f1d] text-slate-400 font-semibold uppercase tracking-wider text-[11px] whitespace-nowrap">
              <th className="py-3.5 px-3 w-12 text-center">#</th>
              <th className="py-3.5 px-4 min-w-[280px]">Nhiệm vụ (Task)</th>
              <th className="py-3.5 px-3 w-32 text-center">Thời gian</th>
              <th className="py-3.5 px-4 w-44">Người thực hiện</th>
              <th className="py-3.5 px-4 w-40">Người giám sát</th>
              <th className="py-3.5 px-4 w-44">Hạn chót</th>
              <th className="py-3.5 px-3 w-32 text-center">Độ ưu tiên</th>
              <th className="py-3.5 px-3 w-12 text-center">
                <span className="sr-only">Thao tác</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#152037]">
            {tasks.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-10 px-4 text-center text-slate-400">
                  Chưa có công việc nào. Nhấn{' '}
                  <strong className="text-[#38bdf8]">+ Thêm công việc</strong> để tạo mới.
                </td>
              </tr>
            ) : (
              tasks.map((task, idx) => (
                <TaskTableRow
                  key={task._uid}
                  task={task}
                  index={idx}
                  isModified={!isSameRowValues(task, savedByUid.get(task._uid))}
                  editingField={editingCell?.uid === task._uid ? editingCell.field : null}
                  error={rowErrors[task._uid]}
                  availableMembers={availableMembers}
                  onStartEditCell={(uid, field) => setEditingCell({ uid, field })}
                  onCancelEditCell={() => setEditingCell(null)}
                  onCommitContent={handleCommitContent}
                  onQuickSaveContent={handleQuickSaveContent}
                  onCommitTimestamp={handleCommitTimestamp}
                  onUpdateField={updateTaskField}
                  onDelete={handleDeleteTask}
                  onSeek={handleSeek}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
