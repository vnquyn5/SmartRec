import React from "react";
import RealtimeStepper from "./RealtimeStepper";

/**
 * PipelineJobStepper (Legacy compatibility wrapper for RealtimeStepper)
 * Sprint 4: Toàn bộ tính năng đã được nâng cấp thành RealtimeStepper nhận dữ liệu WebSocket.
 */
export default function PipelineJobStepper(props) {
  return <RealtimeStepper {...props} />;
}

export { RealtimeStepper };
