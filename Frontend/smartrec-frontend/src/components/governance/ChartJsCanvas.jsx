import React, { useEffect, useRef } from 'react';
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';

Chart.register(
  LineController,
  BarController,
  DoughnutController,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Filler,
  Tooltip,
  Legend
);

export default function ChartJsCanvas({
  type = 'line',
  data,
  options,
  ariaLabel = 'Biểu đồ Chart.js',
  className = 'w-full h-full',
}) {
  const canvasRef = useRef(null);
  const chartInstanceRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof window === 'undefined') return undefined;

    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
      chartInstanceRef.current = null;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    chartInstanceRef.current = new Chart(ctx, {
      type,
      data,
      options,
    });

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [type, data, options]);

  return <canvas ref={canvasRef} aria-label={ariaLabel} className={className} />;
}

