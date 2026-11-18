import React from 'react';

export default function SmartRecDocLogo({
  size = 36,
  organizationName = 'SmartRec AI Workspace',
  showWordmark = true,
}) {
  return (
    <div className="inline-flex items-center gap-2.5">
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="SmartRec Logo"
        className="shrink-0"
      >
        <defs>
          <linearGradient id="smartrecDocGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#2563eb" />
            <stop offset="100%" stopColor="#00d1ff" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="36" height="36" rx="10" fill="url(#smartrecDocGrad)" />
        <circle
          cx="20"
          cy="20"
          r="7.5"
          fill="rgba(255,255,255,0.22)"
          stroke="#ffffff"
          strokeWidth="2.5"
        />
      </svg>
      {showWordmark && (
        <div className="leading-tight">
          <div className="text-base font-extrabold tracking-tight text-slate-900">
            Smart<span className="text-sky-600">Rec</span>
          </div>
          <div className="text-[10px] font-medium text-slate-500">{organizationName}</div>
        </div>
      )}
    </div>
  );
}

