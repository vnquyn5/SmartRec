import React from 'react';
import ExportModal from './ExportModal';

export default function DocumentExporterModal(props) {
  return <ExportModal initialMode="preview" {...props} />;
}
