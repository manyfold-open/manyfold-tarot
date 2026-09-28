/**
 * The Fortune Stick's own mark (its favicon: a torii on pale wood), drawn
 * inline next to every link that leaves for the Stick, so the destination is
 * recognisable before the click. Decorative: the link text already says where
 * it goes.
 */
export default function StickIcon() {
  return (
    <svg className="taro-app-icon" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="taro-stick-icon-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f7ecd6" />
          <stop offset="1" stopColor="#e9d5b0" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#taro-stick-icon-ground)" />
      <rect x="15" y="24" width="7" height="34" fill="#c23d26" />
      <rect x="42" y="24" width="7" height="34" fill="#c23d26" />
      <rect x="14" y="51" width="9" height="7" fill="#2c211c" />
      <rect x="41" y="51" width="9" height="7" fill="#2c211c" />
      <rect x="9" y="33" width="46" height="5" fill="#b8321f" />
      <path d="M8 20 Q32 27 56 20 L56 24 Q32 31 8 24 Z" fill="#b8321f" />
      <path d="M3 12 Q32 21 61 12 L60 19 Q32 27 4 19 Z" fill="#2c211c" />
    </svg>
  );
}
