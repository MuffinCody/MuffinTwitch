import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export type Layout = "grid" | "focus";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const GAP = 6;
const RATIO = 16 / 9;

/** Raster mit möglichst großen 16:9-Kacheln. */
function gridRects(n: number, W: number, H: number): Rect[] {
  let best = { cols: 1, w: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = Math.min((W - GAP * (cols - 1)) / cols, ((H - GAP * (rows - 1)) / rows) * RATIO);
    if (w > best.w) best = { cols, w };
  }
  const cols = best.cols;
  const rows = Math.ceil(n / cols);
  const w = best.w;
  const h = w / RATIO;
  const totalH = rows * h + (rows - 1) * GAP;
  const y0 = (H - totalH) / 2;
  const rects: Rect[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const inRow = r === rows - 1 ? n - r * cols : cols;
    const rowW = inRow * w + (inRow - 1) * GAP;
    const c = i % cols;
    rects.push({ x: (W - rowW) / 2 + c * (w + GAP), y: y0 + r * (h + GAP), w, h });
  }
  return rects;
}

/** Ein großer Stream + kleine Streams darunter bzw. daneben. */
function focusRects(n: number, focusIdx: number, W: number, H: number): Rect[] {
  if (n === 1) return gridRects(1, W, H);
  const others = n - 1;
  const side = W / H > 2.0; // sehr breit → Leiste rechts
  const rects: Rect[] = new Array(n);
  if (side) {
    const stripW = Math.min(W * 0.28, 420);
    const mainW = W - stripW - GAP;
    const main = fit(mainW, H);
    rects[focusIdx] = { x: (mainW - main.w) / 2, y: (H - main.h) / 2, ...main };
    const small = gridRects(others, stripW, H).map((r) => ({ ...r, x: r.x + mainW + GAP }));
    let k = 0;
    for (let i = 0; i < n; i++) if (i !== focusIdx) rects[i] = small[k++];
  } else {
    const stripH = Math.min(H * 0.24, 220);
    const mainH = H - stripH - GAP;
    const main = fit(W, mainH);
    rects[focusIdx] = { x: (W - main.w) / 2, y: 0, ...main };
    const small = gridRects(others, W, stripH).map((r) => ({ ...r, y: r.y + main.h + GAP }));
    let k = 0;
    for (let i = 0; i < n; i++) if (i !== focusIdx) rects[i] = small[k++];
  }
  return rects;
}

function fit(W: number, H: number) {
  const w = Math.min(W, H * RATIO);
  return { w, h: w / RATIO };
}

interface Props {
  channels: string[];
  layout: Layout;
  focused: string | null;
  fullscreen: string | null;
  renderTile(login: string, style: CSSProperties): ReactNode;
  empty: ReactNode;
}

export function MultiView({ channels, layout, focused, fullscreen, renderTile, empty }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = channels.length;
  const focusIdx = Math.max(0, focused ? channels.indexOf(focused) : 0);
  const fsIdx = fullscreen ? channels.indexOf(fullscreen) : -1;
  let rects: (Rect | null)[] = [];
  if (size.w && n) {
    if (fsIdx >= 0) {
      // Vollbild: eine Kachel füllt alles, die anderen laufen unsichtbar weiter
      rects = channels.map((_, i) => (i === fsIdx ? { x: 0, y: 0, w: size.w, h: size.h } : null));
    } else {
      rects = layout === "focus" ? focusRects(n, focusIdx, size.w, size.h) : gridRects(n, size.w, size.h);
    }
  }

  return (
    <div ref={ref} className="multiview">
      {n === 0 && empty}
      {channels.map((c, i) => {
        const r = rects[i];
        const style: CSSProperties = r
          ? { left: r.x, top: r.y, width: r.w, height: r.h }
          : { left: 0, top: 0, width: 160, height: 90, visibility: "hidden" };
        return <div key={c} style={{ display: "contents" }}>{renderTile(c, style)}</div>;
      })}
    </div>
  );
}
