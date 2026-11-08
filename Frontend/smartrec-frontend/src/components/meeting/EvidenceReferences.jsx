import React from 'react';
import { resolveEvidenceReferences } from './meetingResults';

export default function EvidenceReferences({ references = [], transcripts = [], onNavigate }) {
  const resolved = resolveEvidenceReferences(references, transcripts);
  if (resolved.length === 0) return null;

  return (
    <div aria-label="Evidence references" className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] text-slate-500">Nguồn:</span>
      {resolved.map((reference) => reference.available ? (
        <button
          key={reference.sourceRef}
          type="button"
          onClick={() => onNavigate?.(reference.transcriptId)}
          aria-label={`Open transcript evidence at ${reference.label.replace('Transcript · ', '')}`}
          className="rounded border border-sky-800/70 bg-sky-950/30 px-1.5 py-0.5 text-[10px] text-sky-300 hover:bg-sky-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38bdf8]"
        >
          {reference.label}
        </button>
      ) : (
        <span
          key={reference.sourceRef}
          aria-label={reference.label}
          title={reference.label}
          className="rounded border border-slate-700 bg-slate-900/40 px-1.5 py-0.5 text-[10px] text-slate-500"
        >
          {reference.label}
        </span>
      ))}
    </div>
  );
}
