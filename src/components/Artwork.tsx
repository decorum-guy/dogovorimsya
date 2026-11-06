export function LoveLetter() {
  return <svg className="love-letter" viewBox="0 0 390 310" fill="none" aria-hidden="true">
    <defs>
      <filter id="paper-shadow"><feDropShadow dx="0" dy="9" stdDeviation="10" floodColor="#634437" floodOpacity=".12" /></filter>
      <linearGradient id="heart-gradient" x1="180" y1="80" x2="280" y2="230" gradientUnits="userSpaceOnUse"><stop stopColor="#efb0bc"/><stop offset="1" stopColor="#cf728d"/></linearGradient>
      <pattern id="lines" width="220" height="23" patternUnits="userSpaceOnUse"><path d="M0 22h220" stroke="#d7cdbb" strokeOpacity=".6"/></pattern>
    </defs>
    <circle cx="202" cy="167" r="123" fill="#efe7da"/>
    <g transform="rotate(12 205 160)" filter="url(#paper-shadow)"><rect x="116" y="48" width="180" height="224" rx="5" fill="#eee5d5"/><path d="M137 76h134M137 93h134" stroke="#d7c6b4"/></g>
    <g transform="rotate(-9 180 165)" filter="url(#paper-shadow)"><rect x="84" y="48" width="192" height="227" rx="4" fill="#fffcf4"/><rect x="103" y="94" width="153" height="151" fill="url(#lines)"/><path d="M115 66v191" stroke="#e2adb1" strokeOpacity=".6"/><circle cx="101" cy="67" r="3" fill="#ded4c5"/><circle cx="101" cy="85" r="3" fill="#ded4c5"/>
    <path d="M182 207c-100-56-78-121-35-105 18 7 28 21 35 34 6-14 18-29 34-34 48-15 62 53-34 105" fill="url(#heart-gradient)"/>
    <path d="M140 126c-13 2-16 15-10 28" stroke="#fbd4d9" strokeWidth="6" strokeLinecap="round"/>
    <path d="m194 225 12 3m-56 7 18-3" stroke="#bd9191" strokeWidth="2" strokeLinecap="round"/>
    </g>
    <g transform="rotate(13 275 226)"><circle cx="275" cy="226" r="42" fill="#c98e54"/><circle cx="275" cy="226" r="35" stroke="#f9e4bd" strokeWidth="1.5" strokeDasharray="2 3"/><path d="m275 203 7 14 16 3-12 11 3 16-14-8-14 8 3-16-12-11 16-3z" fill="#f8e2b6"/></g>
    <path d="m66 96 4 10 11 2-8 7 2 11-9-5-10 5 2-11-8-7 12-2m242-35 4 11 12 2-9 8 2 12-9-6-11 6 3-12-9-8 12-2M60 227l7 7m0-7-7 7m264-40 6 6m0-6-6 6" stroke="#b18b51" strokeWidth="2" strokeLinecap="round"/>
    <path d="M311 133c17-17 33 3 13 16-15 10-28 1-19-10" stroke="#aa7b8d" strokeWidth="2" strokeLinecap="round"/>
    <path d="M40 174c3-12 8-20 18-22m-17 38 8 2" stroke="#b7949c" strokeWidth="2" strokeLinecap="round"/>
    <text x="42" y="287" transform="rotate(-7 42 287)" fill="#a4867a" fontFamily="Caveat, cursive" fontSize="22">всё серьёзно. почти.</text>
  </svg>;
}

export function DevilHeart({ className = '' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 180 150" aria-hidden="true">
    <defs><linearGradient id="devil-heart" x2=".5" y2="1"><stop stopColor="#ff9b6e"/><stop offset="1" stopColor="#e23d42"/></linearGradient></defs>
    <path d="M35 55C9 34 30 6 30 6s-2 30 29 30m66 17c29-20 5-47 5-47s1 30-27 29" fill="#ee614c"/>
    <path d="M90 139C-34 63 25-7 70 38l20 22 20-22c50-47 104 26-20 101" fill="url(#devil-heart)"/>
    <path d="m52 67 20 11m56-11-20 11" stroke="#6e2439" strokeWidth="6" strokeLinecap="round"/>
    <path d="M69 94q21 20 42 0" fill="none" stroke="#6e2439" strokeWidth="4" strokeLinecap="round"/>
    <path d="M143 111c50 11 25-34 14-13m0 0 1-11 11 6" fill="none" stroke="#ec6e52" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M46 45q-12-3-17 8" fill="none" stroke="#ffc0a0" strokeWidth="6" strokeLinecap="round"/>
  </svg>;
}
