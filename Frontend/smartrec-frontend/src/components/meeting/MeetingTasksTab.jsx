import React from 'react';
import TaskMatrixTable from './TaskMatrixTable';

export default function MeetingTasksTab({ onSeekSegment }) {
  return <TaskMatrixTable onSeekSegment={onSeekSegment} />;
}
