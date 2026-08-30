import { useEffect, useState, useMemo, type CSSProperties } from 'react';
import { motion } from 'framer-motion';

export type Mood = 'idle' | 'thinking' | 'happy' | 'error';

/* 16x16 pixel map. . = empty, D = outline, B = body, E = eye, P = blush,
   M = mouth, G = sprout, W = eye shine */
const BASE = [
  '................',
  '.......GG.......',
  '......GG........',
  '...DDDDDDDDDD...',
  '..DBBBBBBBBBBD..',
  '..DBBBBBBBBBBD..',
  '..DBEEBBBBEEBD..',
  '..DBEEBBBBEEBD..',
  '..DPBBBBBBBBPD..',
  '..DBBBMMMMBBBD..',
  '..DBBBBBBBBBBD..',
  '...DBBBBBBBBD...',
  '....DDDDDDDD....',
  '.....D....D.....',
  '....DD....DD....',
  '................',
];

/* eyes shut: top eye row becomes body, bottom row becomes a thin lid */
const BLINK = BASE.map((row, y) => (y === 6 ? '..DBBBBBBBBBBD..' : row));
/* squinty happy eyes + wider grin */
const HAPPY = BASE.map((row, y) =>
  y === 6 ? '..DBBBBBBBBBBD..' : y === 9 ? '..DBBMMMMMMBBD..' : row,
);
/* worried: small flat mouth, eyes low */
const WORRIED = BASE.map((row, y) => (y === 9 ? '..DBBBBMMBBBBD..' : row));

const PALETTE: Record<string, string> = {
  D: '#1b1f3a',
  B: '#7fb2ff',
  E: '#0b0d24',
  P: '#ff8fb1',
  M: '#1b1f3a',
  G: '#37c96c',
  W: '#ffffff',
};

function rowsToRects(rows: string[], body: string) {
  const out: { x: number; y: number; w: number; f: string }[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      if (c === '.') { x++; continue; }
      let w = 1;
      while (x + w < row.length && row[x + w] === c) w++;
      out.push({ x, y, w, f: c === 'B' ? body : PALETTE[c] ?? body });
      x += w;
    }
  });
  return out;
}

export function Mascot({
  mood = 'idle',
  size = 64,
  frame = true,
  body,
}: {
  mood?: Mood;
  size?: number;
  /** draw the Tamagotchi shell around the sprite */
  frame?: boolean;
  body?: string;
}) {
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    if (mood !== 'idle') { setBlink(false); return; }
    let openT: number | undefined;
    let closeT: number | undefined;
    const schedule = () => {
      closeT = window.setTimeout(() => {
        setBlink(true);
        openT = window.setTimeout(() => { setBlink(false); schedule(); }, 130);
      }, 3000 + Math.random() * 2000);
    };
    schedule();
    return () => { window.clearTimeout(openT); window.clearTimeout(closeT); };
  }, [mood]);

  const bodyColor = body ?? (mood === 'error' ? '#ff8fb1' : mood === 'happy' ? '#b8f55e' : '#7fb2ff');
  const rows =
    mood === 'happy' ? HAPPY : mood === 'error' ? WORRIED : blink ? BLINK : BASE;
  const rects = useMemo(() => rowsToRects(rows, bodyColor), [rows, bodyColor]);

  const sprite = (
    <motion.div
      className="p05-mascot__sprite"
      style={{ width: size, height: size }}
      animate={
        mood === 'happy'
          ? { y: [0, -7, 0, -3, 0], rotate: [0, -4, 3, 0] }
          : mood === 'thinking'
            ? { rotate: [-3, 3, -3], y: [0, -1.5, 0] }
            : mood === 'error'
              ? { x: [0, -2, 2, -1, 0] }
              : { y: [0, -1.5, 0] }
      }
      transition={
        mood === 'happy'
          ? { duration: 0.55, ease: 'easeOut' }
          : mood === 'thinking'
            ? { duration: 1.4, repeat: Infinity, ease: 'easeInOut' }
            : mood === 'error'
              ? { duration: 0.4 }
              : { duration: 3.2, repeat: Infinity, ease: 'easeInOut' }
      }
    >
      <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" aria-hidden="true">
        {rects.map((r, i) => (
          <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.f} />
        ))}
        {mood === 'idle' && !blink && (
          <>
            <rect x={4} y={6} width={1} height={1} fill="#fff" opacity={0.9} />
            <rect x={10} y={6} width={1} height={1} fill="#fff" opacity={0.9} />
          </>
        )}
        {mood === 'error' && (
          <g className="p05-sweat">
            <rect x={13} y={4} width={1} height={2} fill="#7fb2ff" />
            <rect x={13} y={6} width={1} height={1} fill="#e8ecff" />
          </g>
        )}
      </svg>
      {mood === 'thinking' && (
        <div className="p05-mascot__dots" aria-label="thinking">
          <i /><i /><i />
        </div>
      )}
    </motion.div>
  );

  if (!frame) return sprite;

  return (
    <div className={`p05-mascot p05-mascot--${mood}`} style={{ '--m-size': `${size}px` } as CSSProperties}>
      <div className="p05-mascot__shell">
        <div className="p05-mascot__screen scanlines">{sprite}</div>
        <div className="p05-mascot__btns">
          <span /><span />
        </div>
      </div>
    </div>
  );
}

export default Mascot;
