import { useEffect, useRef, useState } from 'react';

// Gráfico de colunas simples (uma série), em SVG, sem biblioteca.
// Colunas finas (≤ 24px), topo arredondado 4px, grade discreta, tooltip ao passar o mouse/tocar,
// rótulo só no maior valor e no último (os demais ficam no tooltip e na tabela abaixo do gráfico).

function niceStep(v) {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

function barPath(x, y, w, h, r) {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

export default function BarChart({ data, format = (v) => v, height = 220, color = 'var(--chart-1)', ariaLabel }) {
  const wrap = useRef(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, e.contentRect.width)));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const values = data.map((d) => d.value).filter((v) => v !== null && v !== undefined);
  if (!values.length) return <div className="empty">Sem dados suficientes para o gráfico.</div>;

  const pad = { top: 22, right: 8, bottom: 26, left: 44 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const step = niceStep((Math.max(...values) * 1.05) / 4);
  const max = Math.max(step, Math.ceil((Math.max(...values) * 1.05) / step) * step);
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const band = w / data.length;
  const bw = Math.min(24, Math.max(4, band * 0.6));
  const maxIdx = data.findIndex((d) => d.value === Math.max(...values));
  const lastIdx = data.map((d) => d.value !== null && d.value !== undefined).lastIndexOf(true);
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(w / 46)));

  return (
    <div ref={wrap} className="chart" style={{ position: 'relative' }}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel} style={{ display: 'block' }}>
        {ticks.map((t) => {
          const y = pad.top + h - (t / max) * h;
          return (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="var(--chart-grid)" strokeWidth="1" />
              <text x={pad.left - 6} y={y + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
                {format(t, true)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const x = pad.left + i * band + (band - bw) / 2;
          const v = d.value ?? 0;
          const bh = (v / max) * h;
          const y = pad.top + h - bh;
          const showLabel = d.value !== null && d.value !== undefined && (i === maxIdx || i === lastIdx);
          return (
            <g key={i}>
              {d.value !== null && d.value !== undefined && (
                <path d={barPath(x, y, bw, bh, 4)} fill={color} opacity={hover === null || hover === i ? 1 : 0.55} />
              )}
              {showLabel && (
                <text x={x + bw / 2} y={y - 6} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--text)">
                  {format(d.value)}
                </text>
              )}
              {i % labelEvery === 0 && (
                <text x={pad.left + i * band + band / 2} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">
                  {d.label}
                </text>
              )}
              {/* área de toque maior que a coluna */}
              <rect
                x={pad.left + i * band}
                y={pad.top}
                width={band}
                height={h}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setHover(i)}
              />
            </g>
          );
        })}
        <line x1={pad.left} x2={width - pad.right} y1={pad.top + h} y2={pad.top + h} stroke="var(--line)" strokeWidth="1" />
      </svg>
      {hover !== null && data[hover] && (
        <div
          className="chart-tip"
          style={{
            left: Math.min(Math.max(pad.left + hover * band + band / 2, 70), width - 70),
            top: 4,
          }}
        >
          <strong>{data[hover].label}</strong>
          <div>{data[hover].value === null || data[hover].value === undefined ? 'sem média' : format(data[hover].value)}</div>
          {data[hover].extra && <div className="muted">{data[hover].extra}</div>}
        </div>
      )}
    </div>
  );
}
