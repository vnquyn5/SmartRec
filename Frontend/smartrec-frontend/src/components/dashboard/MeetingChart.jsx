import React, { useRef, useEffect, useState } from "react";

const rangeOptions = [
  { value: "day", label: "Theo ngày" },
  { value: "week", label: "Theo tuần" },
  { value: "month", label: "Theo tháng" },
  { value: "year", label: "Theo năm" },
];

const sameDay = (left, right) =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

const getChartBuckets = (range) => {
  if (range === "day") {
    return Array.from({ length: 24 }, (_, hour) => {
      const date = new Date();
      date.setMinutes(0, 0, 0);
      date.setHours(hour);
      return {
        date,
        label: `${String(hour).padStart(2, "0")}h`,
        match: (createdAt) => sameDay(createdAt, date) && createdAt.getHours() === hour,
      };
    });
  }

  if (range === "month") {
    return Array.from({ length: 30 }, (_, index) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (29 - index));
      return {
        date,
        label: date.toLocaleDateString("vi-VN", {
          day: "2-digit",
          month: "2-digit",
        }),
        match: (createdAt) => sameDay(createdAt, date),
      };
    });
  }

  if (range === "year") {
    return Array.from({ length: 12 }, (_, index) => {
      const date = new Date();
      date.setDate(1);
      date.setHours(0, 0, 0, 0);
      date.setMonth(date.getMonth() - (11 - index));
      return {
        date,
        label: date.toLocaleDateString("vi-VN", {
          month: "short",
        }),
        match: (createdAt) =>
          createdAt.getFullYear() === date.getFullYear() &&
          createdAt.getMonth() === date.getMonth(),
      };
    });
  }

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    return {
      date,
      label: date.toLocaleDateString("vi-VN", {
        weekday: "short",
      }),
      match: (createdAt) => sameDay(createdAt, date),
    };
  });
};

const getChartData = (meetings, range) => {
  const buckets = getChartBuckets(range);

  return {
    rawData: buckets.map(
      (bucket) =>
        meetings.filter((meeting) => {
          const createdAt = new Date(meeting.createdAt);
          return Number.isFinite(createdAt.getTime()) && bucket.match(createdAt);
        }).length,
    ),
    labels: buckets.map((bucket) => bucket.label),
  };
};

const MeetingChart = ({
  meetings = [],
  isLoading = false,
  range = "week",
  onRangeChange,
}) => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        setDimensions({ w: width, h: 260 });
      }
    });
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.w === 0) return;
    const { rawData, labels } = getChartData(meetings, range);

    const dpr = window.devicePixelRatio || 1;
    const w = dimensions.w;
    const h = dimensions.h;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const padLeft = 40;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 32;
    const chartW = w - padLeft - padRight;
    const chartH = h - padTop - padBottom;

    const maxDataValue = Math.max(1, ...rawData);
    const maxVal = Math.max(5, Math.ceil(maxDataValue / 5) * 5);
    const ySteps = Array.from({ length: 4 }, (_, index) =>
      Math.round((maxVal / 3) * index),
    );

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Y axis labels & grid
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ySteps.forEach((v) => {
      const y = padTop + chartH - (v / maxVal) * chartH;
      ctx.fillStyle = "#4b5672";
      ctx.fillText(v.toString(), padLeft - 10, y);
      ctx.strokeStyle = "rgba(75,86,114,0.2)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + chartW, y);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // X axis labels
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const xStep = labels.length > 1 ? chartW / (labels.length - 1) : chartW;
    const labelStep = range === "day" || range === "month" ? 4 : 1;
    labels.forEach((label, i) => {
      if (i % labelStep !== 0 && i !== labels.length - 1) return;
      const x = padLeft + i * xStep;
      ctx.fillStyle = "#4b5672";
      ctx.fillText(label, x, padTop + chartH + 10);
    });

    // Interpolate data points to the 7 day labels
    const dataLen = rawData.length;
    const points = labels.map((_, i) => {
      const dataIdx =
        labels.length > 1 ? Math.round((i / (labels.length - 1)) * (dataLen - 1)) : 0;
      const x = padLeft + i * xStep;
      const y = padTop + chartH - (rawData[dataIdx] / maxVal) * chartH;
      return { x, y };
    });

    // Smooth curve using cardinal spline
    const drawSmoothCurve = (pts) => {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(pts.length - 1, i + 2)];
        const tension = 0.3;

        const cp1x = p1.x + (p2.x - p0.x) * tension;
        const cp1y = p1.y + (p2.y - p0.y) * tension;
        const cp2x = p2.x - (p3.x - p1.x) * tension;
        const cp2y = p2.y - (p3.y - p1.y) * tension;

        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
      }
    };

    // Fill gradient area
    ctx.beginPath();
    drawSmoothCurve(points);
    ctx.lineTo(points[points.length - 1].x, padTop + chartH);
    ctx.lineTo(points[0].x, padTop + chartH);
    ctx.closePath();

    const gradient = ctx.createLinearGradient(0, padTop, 0, padTop + chartH);
    gradient.addColorStop(0, "rgba(62,137,255,0.28)");
    gradient.addColorStop(0.6, "rgba(62,137,255,0.06)");
    gradient.addColorStop(1, "rgba(62,137,255,0)");
    ctx.fillStyle = gradient;
    ctx.fill();

    // Stroke line
    ctx.beginPath();
    drawSmoothCurve(points);
    ctx.strokeStyle = "#3e89ff";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    // Dots
    points.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#3e89ff";
      ctx.fill();
      ctx.strokeStyle = "#101624";
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }, [dimensions, meetings, range]);

  return (
    <div
      className="chart-card"
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      <div className="chart-header">
        <h3>Xử lý cuộc họp</h3>
        <select
          className="chart-filter"
          value={range}
          onChange={(event) => onRangeChange?.(event.target.value)}
          disabled={isLoading}
          aria-label="Chọn khoảng thời gian biểu đồ"
        >
          {rangeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div ref={containerRef} className="chart-canvas-wrap" style={{ flex: 1 }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
};

export default MeetingChart;
