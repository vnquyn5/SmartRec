import React from 'react';
import TranscriptEditor from './TranscriptEditor';

export default function TranscriptPanel({ onSeek, onSeekSegment, ...rest }) {
  const handleSeek = onSeekSegment || onSeek;
  return <TranscriptEditor onSeekSegment={handleSeek} {...rest} />;
}