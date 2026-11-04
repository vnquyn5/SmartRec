import React, { useState, useRef, useEffect } from "react";

export default function PasscodeVerificationView({
  meetingTitle,
  onVerify,
  verifying = false,
  error = "",
}) {
  const [passcode, setPasscode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState("");
  const [isShaking, setIsShaking] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  useEffect(() => {
    if (error) {
      setLocalError(error);
      setIsShaking(true);
      const timer = setTimeout(() => setIsShaking(false), 600);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    const clean = passcode.trim();
    if (!clean) {
      setLocalError("Vui lòng nhập mật mã truy cập.");
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 600);
      return;
    }
    setLocalError("");
    onVerify(clean);
  };

  return (
    <div className="min-h-screen w-full bg-[#070b14] flex flex-col items-center justify-center p-4 relative overflow-hidden select-none font-sans">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-1/4 left-1/3 -translate-x-1/2 w-[350px] h-[350px] bg-amber-500/10 rounded-full blur-[100px] pointer-events-none"></div>

      <div className="mb-6 flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white font-black text-lg shadow-lg shadow-blue-500/20">
          S
        </div>
        <span className="text-xl font-bold tracking-tight text-white">SmartRec</span>
      </div>

      <div
        className={`w-full max-w-md bg-[#0f172a]/90 border border-slate-800 rounded-3xl p-8 shadow-2xl shadow-black/80 backdrop-blur-xl relative z-10 transition-transform duration-300 ${
          isShaking ? "animate-bounce" : ""
        }`}
      >
        <div className="flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-500/20 to-amber-400/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-5 shadow-inner">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>

          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 mb-2.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
            Bảo vệ bằng mật mã
          </span>

          <h1 className="text-xl font-bold text-white tracking-tight mb-2">
            Mở khóa nội dung cuộc họp
          </h1>

          {meetingTitle && (
            <p className="text-sm font-medium text-slate-300 truncate max-w-xs mb-3 px-3 py-1 bg-slate-800/50 rounded-lg border border-slate-700/50">
              {meetingTitle}
            </p>
          )}

          <p className="text-xs text-slate-400 leading-relaxed mb-6 max-w-sm">
            Cuộc họp này đã được cài đặt mật mã bảo mật (Passcode). Vui lòng nhập đúng mã được cung cấp để tiếp tục.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <input
              ref={inputRef}
              type={showPassword ? "text" : "password"}
              value={passcode}
              onChange={(e) => {
                setPasscode(e.target.value);
                if (localError) setLocalError("");
              }}
              placeholder="Nhập Passcode..."
              className={`w-full bg-[#18233c] text-white text-center text-lg font-mono tracking-widest px-4 py-3.5 rounded-xl border outline-none transition shadow-inner placeholder:text-slate-500 placeholder:text-sm placeholder:tracking-normal ${
                localError
                  ? "border-red-500/80 focus:border-red-400"
                  : "border-slate-700 focus:border-blue-500"
              }`}
              disabled={verifying}
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition p-1"
              aria-label={showPassword ? "Ẩn mật mã" : "Hiện mật mã"}
            >
              {showPassword ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>

          {localError && (
            <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-red-400 animate-fadeIn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{localError}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={verifying}
            className="w-full py-3.5 px-4 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:scale-[0.99] transition shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {verifying ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Đang kiểm tra...</span>
              </>
            ) : (
              <>
                <span>Mở khóa cuộc họp</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </>
            )}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-slate-800 text-center">
          <p className="text-xs text-slate-500">
            Chưa có mật mã hoặc không thể truy cập?
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Vui lòng liên hệ người chủ trì cuộc họp để được chia sẻ mã Passcode.
          </p>
        </div>
      </div>
    </div>
  );
}

