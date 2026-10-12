import React, { useState } from 'react';
import TranscriptView from './TranscriptView';

export default function TranscriptPanel({ onSeek, onSeekSegment
}) {
  const handleSeek = onSeekSegment || onSeek;
  return <TranscriptView onSeekSegment={handleSeek} />;
}