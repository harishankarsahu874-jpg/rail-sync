import React from 'react';

export default function RailwayArt() {
  return (
    <div className="hero-art" aria-hidden="true">
      <svg width="100%" height="100%" viewBox="0 0 1200 520" preserveAspectRatio="xMidYMax slice">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f6faf9" /><stop offset="1" stopColor="#e7f5f2" />
          </linearGradient>
        </defs>
        <rect width="1200" height="520" fill="url(#sky)" />
        {/* sleepers */}
        {Array.from({ length: 14 }).map((_, i) => {
          const t = i / 14;
          const y = 210 + Math.pow(t, 1.9) * 310;
          const half = 8 + Math.pow(t, 1.8) * 330;
          return <rect key={i} x={600 - half} y={y} width={half * 2} height={2 + t * 7} rx="2" fill="#0d9488" opacity={0.10 + t * 0.10} />;
        })}
        {/* rails */}
        <path d="M600 208 L260 520" stroke="#0f766e" strokeWidth="3.4" opacity=".5" fill="none" />
        <path d="M600 208 L940 520" stroke="#0f766e" strokeWidth="3.4" opacity=".5" fill="none" />
        <path d="M600 208 L470 520" stroke="#14b8a6" strokeWidth="1.6" opacity=".35" fill="none" />
        <path d="M600 208 L730 520" stroke="#14b8a6" strokeWidth="1.6" opacity=".35" fill="none" />
        {/* catenary masts */}
        {[150, 330, 870, 1050].map((x, i) => (
          <g key={x} stroke="#94a3b8" strokeWidth="2" opacity=".4">
            <path d={`M${x} ${520 - i * 8} V ${300 - i * 14}`} />
            <path d={`M${x} ${308 - i * 14} h ${x < 600 ? 46 : -46}`} />
          </g>
        ))}
        {/* distant train silhouette */}
        <g opacity=".5" transform="translate(588 176)">
          <rect x="0" y="0" width="24" height="14" rx="4" fill="#0f766e" />
          <rect x="3" y="3" width="5" height="5" rx="1" fill="#e7f5f2" />
          <rect x="10" y="3" width="5" height="5" rx="1" fill="#e7f5f2" />
          <circle cx="6" cy="16" r="2.4" fill="#334155" /><circle cx="18" cy="16" r="2.4" fill="#334155" />
        </g>
        <circle cx="600" cy="208" r="26" fill="#14b8a6" opacity=".12" />
      </svg>
    </div>
  );
}

/** Soft teal ring that follows the pointer and grows over interactive bits. */
