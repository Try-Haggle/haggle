"use client";

import { useEffect, useState } from "react";

const COLORS = [
  "#22d3ee", // cyan-400
  "#34d399", // emerald-400
  "#60a5fa", // blue-400
  "#a78bfa", // violet-400
  "#fb923c", // orange-400
  "#f472b6", // pink-400
  "#fbbf24", // amber-400
];

interface Particle {
  id: number;
  x: number;
  color: string;
  size: number;
  delay: number;
  duration: number;
  drift: number;
}

function createParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    size: 4 + Math.random() * 6,
    delay: Math.random() * 0.8,
    duration: 1.5 + Math.random() * 1.5,
    drift: (Math.random() - 0.5) * 60,
  }));
}

export function Celebration() {
  const [visible, setVisible] = useState(true);
  const [particles] = useState(() => createParticles(30));

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 3500);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 50 }}
      aria-hidden="true"
    >
      {particles.map((p) => (
        <span
          key={p.id}
          className="absolute"
          style={{
            left: `${p.x}%`,
            bottom: "-10px",
            width: `${p.size}px`,
            height: `${p.size}px`,
            backgroundColor: p.color,
            borderRadius: Math.random() > 0.5 ? "50%" : "2px",
            animation: `confetti-rise ${p.duration}s ease-out ${p.delay}s forwards`,
            opacity: 0,
            ["--drift" as string]: `${p.drift}px`,
          }}
        />
      ))}
    </div>
  );
}
