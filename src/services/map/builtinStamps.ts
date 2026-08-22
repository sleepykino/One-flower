/**
 * 内置地图素材包（P4.1-M1）：简约矢量 SVG 贴图（缩放无损）
 * 首次启动经 MapAssetService.ensureBuiltin() 写入 {appData}/map-assets/ 并标记 builtin=1
 */

export interface BuiltinStamp {
  id: string;
  name: string;
  category: string;
  svg: string;
}

const S = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`;

export const BUILTIN_STAMPS: BuiltinStamp[] = [
  // ---- 地形 ----
  { id: 'st-mountain', name: '山峰', category: '地形', svg: S('<path d="M8 52 L26 16 L38 36 L46 24 L58 52 Z" fill="#8d8578" stroke="#5f5850" stroke-width="2" stroke-linejoin="round"/><path d="M26 16 L33 30 L20 30 Z" fill="#ffffff" opacity="0.85"/>') },
  { id: 'st-mountains', name: '群峰', category: '地形', svg: S('<path d="M4 52 L18 22 L28 42 L36 28 L48 52 Z" fill="#9a9284" stroke="#5f5850" stroke-width="2" stroke-linejoin="round"/><path d="M28 52 L40 30 L52 46 L60 38 L64 52 Z" fill="#847c6f" stroke="#5f5850" stroke-width="2" stroke-linejoin="round"/>') },
  { id: 'st-volcano', name: '火山', category: '地形', svg: S('<path d="M8 54 L26 20 L38 20 L56 54 Z" fill="#7a6a5c" stroke="#4d4238" stroke-width="2"/><path d="M26 20 L32 8 L38 20 Z" fill="#e2604a"/><path d="M30 22 Q28 30 33 34 Q30 40 34 44" stroke="#f2a05a" stroke-width="3" fill="none"/>') },
  { id: 'st-dune', name: '沙丘', category: '地形', svg: S('<path d="M4 46 Q20 24 36 42 Q48 54 62 44 L62 56 L4 56 Z" fill="#e8cf9a" stroke="#c9a86a" stroke-width="2"/><path d="M12 50 Q24 36 34 48" stroke="#c9a86a" stroke-width="1.5" fill="none"/>') },
  { id: 'st-canyon', name: '峡谷', category: '地形', svg: S('<path d="M4 12 L24 12 L16 32 L26 52 L6 52 Z" fill="#b08a6a" stroke="#7a5a40" stroke-width="2"/><path d="M60 12 L40 12 L48 32 L38 52 L58 52 Z" fill="#a67c5e" stroke="#7a5a40" stroke-width="2"/>') },
  // ---- 水文 ----
  { id: 'st-lake', name: '湖泊', category: '水文', svg: S('<ellipse cx="32" cy="34" rx="24" ry="16" fill="#7db8e8" stroke="#3f7fc4" stroke-width="2"/><ellipse cx="24" cy="30" rx="8" ry="4" fill="#ffffff" opacity="0.5"/>') },
  { id: 'st-river', name: '河流', category: '水文', svg: S('<path d="M8 8 Q28 20 20 34 Q14 46 30 52 Q46 58 52 60" stroke="#5aa0dd" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M10 12 Q26 22 20 33" stroke="#a8d0f0" stroke-width="2" fill="none"/>') },
  { id: 'st-waterfall', name: '瀑布', category: '水文', svg: S('<path d="M14 10 L50 10 L50 24 Q32 44 14 24 Z" fill="#9cc8ee" stroke="#3f7fc4" stroke-width="2"/><path d="M22 14 L22 30 M32 14 L32 36 M42 14 L42 28" stroke="#ffffff" stroke-width="2" opacity="0.7"/><path d="M10 46 Q32 58 54 46 L54 54 L10 54 Z" fill="#7db8e8"/>') },
  { id: 'st-spring', name: '泉水', category: '水文', svg: S('<circle cx="32" cy="34" r="14" fill="#7db8e8" stroke="#3f7fc4" stroke-width="2"/><circle cx="32" cy="34" r="6" fill="#cfe8fa"/><path d="M32 8 L32 18 M24 12 L28 19 M40 12 L36 19" stroke="#5aa0dd" stroke-width="2" stroke-linecap="round"/>') },
  // ---- 植被 ----
  { id: 'st-forest', name: '森林', category: '植被', svg: S('<rect x="29" y="40" width="6" height="12" fill="#7a5a3a"/><circle cx="22" cy="32" r="11" fill="#3f8f5a"/><circle cx="40" cy="28" r="13" fill="#357f4f"/><circle cx="32" cy="40" r="10" fill="#2f7347"/>') },
  { id: 'st-tree', name: '大树', category: '植被', svg: S('<rect x="29" y="38" width="7" height="16" rx="2" fill="#8a6a44"/><circle cx="32" cy="26" r="16" fill="#4a9c63"/><circle cx="24" cy="32" r="9" fill="#3d8a54"/><circle cx="41" cy="31" r="9" fill="#57ab70"/>') },
  { id: 'st-pines', name: '松林', category: '植被', svg: S('<path d="M16 52 L24 24 L32 52 Z M30 52 L40 20 L50 52 Z" fill="#2f7050" stroke="#1f5238" stroke-width="1.5"/><rect x="23" y="50" width="3" height="6" fill="#6a4e30"/><rect x="38" y="50" width="3" height="6" fill="#6a4e30"/>') },
  { id: 'st-jungle', name: '丛林', category: '植被', svg: S('<ellipse cx="32" cy="40" rx="26" ry="14" fill="#3e8f52"/><circle cx="18" cy="36" r="8" fill="#55a468"/><circle cx="44" cy="34" r="9" fill="#2f7a44"/><path d="M32 26 L32 16 M32 20 Q26 16 24 12 M32 20 Q38 16 40 12" stroke="#2f7a44" stroke-width="2.5" fill="none"/>') },
  // ---- 聚居 ----
  { id: 'st-city', name: '城市', category: '聚居', svg: S('<rect x="12" y="28" width="12" height="24" fill="#b8b2a6"/><rect x="28" y="16" width="14" height="36" fill="#cfc9bc"/><rect x="46" y="32" width="10" height="20" fill="#b8b2a6"/><rect x="31" y="10" width="3" height="6" fill="#8a8070"/><path d="M6 52 L58 52" stroke="#8a8070" stroke-width="3"/><rect x="15" y="32" width="3" height="4" fill="#5f6f8a"/><rect x="19" y="38" width="3" height="4" fill="#5f6f8a"/><rect x="32" y="22" width="4" height="5" fill="#5f6f8a"/>') },
  { id: 'st-town', name: '城镇', category: '聚居', svg: S('<path d="M10 52 L10 32 L24 22 L38 32 L38 52 Z" fill="#d9c9a8" stroke="#a08a5e" stroke-width="2"/><rect x="42" y="36" width="14" height="16" fill="#cbb894" stroke="#a08a5e" stroke-width="2"/><path d="M16 52 L16 40 L22 40 L22 52" fill="#8a6a44"/><rect x="46" y="40" width="4" height="4" fill="#5f6f8a"/>') },
  { id: 'st-village', name: '村庄', category: '聚居', svg: S('<path d="M8 44 L20 32 L32 44 Z" fill="#c46a4a" stroke="#8f4a30" stroke-width="2"/><rect x="12" y="44" width="16" height="10" fill="#e0d2b4"/><path d="M36 48 L46 38 L56 48 Z" fill="#c46a4a" stroke="#8f4a30" stroke-width="2"/><rect x="39" y="48" width="14" height="8" fill="#e0d2b4"/>') },
  { id: 'st-ruins', name: '废墟', category: '聚居', svg: S('<path d="M10 52 L10 30 L18 30 L18 40 L28 40 L28 24 L36 24 L36 44 L46 44 L46 32 L54 32 L54 52 Z" fill="#b0a894" stroke="#7a7260" stroke-width="2"/><path d="M6 52 L58 52" stroke="#7a7260" stroke-width="3"/>') },
  { id: 'st-camp', name: '营地', category: '聚居', svg: S('<path d="M12 48 L20 20 L28 48 Z" fill="#c47a4a"/><path d="M36 48 L44 20 L52 48 Z" fill="#c47a4a"/><path d="M8 48 L56 48" stroke="#8a6a44" stroke-width="2"/><circle cx="32" cy="42" r="4" fill="#e8a04a"/>') },
  { id: 'st-farm', name: '农田', category: '聚居', svg: S('<rect x="8" y="24" width="48" height="28" rx="3" fill="#d9b56a" stroke="#a8842e" stroke-width="2"/><path d="M20 24 L20 52 M32 24 L32 52 M44 24 L44 52 M8 38 L56 38" stroke="#a8842e" stroke-width="1.5"/><path d="M8 24 Q32 12 56 24" fill="#8fc06a" stroke="#5f8a3a" stroke-width="1.5"/>') },
  // ---- 建筑 ----
  { id: 'st-castle', name: '城堡', category: '建筑', svg: S('<path d="M14 52 L14 26 L20 26 L20 32 L26 32 L26 26 L32 26 L32 18 L38 26 L38 32 L44 32 L44 26 L50 26 L50 52 Z" fill="#c8c2b4" stroke="#8a8070" stroke-width="2"/><path d="M32 18 L32 8" stroke="#8a8070" stroke-width="2"/><path d="M32 8 L38 11 L32 14 Z" fill="#c44a4a"/><rect x="28" y="42" width="8" height="10" fill="#6a5a44"/>') },
  { id: 'st-tower', name: '高塔', category: '建筑', svg: S('<path d="M24 52 L27 20 L37 20 L40 52 Z" fill="#c8c2b4" stroke="#8a8070" stroke-width="2"/><path d="M25 20 L32 8 L39 20 Z" fill="#8a4a3a"/><rect x="29" y="42" width="6" height="10" fill="#6a5a44"/><circle cx="32" cy="30" r="2.5" fill="#5f6f8a"/>') },
  { id: 'st-temple', name: '神殿', category: '建筑', svg: S('<path d="M10 52 L10 48 L54 48 L54 52 Z" fill="#c8c2b4"/><rect x="14" y="30" width="36" height="18" fill="#ded8ca" stroke="#8a8070" stroke-width="2"/><path d="M8 30 L32 16 L56 30 Z" fill="#b8a888" stroke="#8a8070" stroke-width="2"/><rect x="28" y="36" width="8" height="12" fill="#6a5a44"/>') },
  { id: 'st-bridge', name: '桥梁', category: '建筑', svg: S('<path d="M6 34 Q32 18 58 34 L58 44 Q32 28 6 44 Z" fill="#b0906a" stroke="#7a5a3a" stroke-width="2"/><path d="M6 44 Q32 28 58 44" stroke="#7a5a3a" stroke-width="2" fill="none"/><path d="M16 36 L16 44 M28 32 L28 40 M40 32 L40 40 M50 36 L50 44" stroke="#7a5a3a" stroke-width="1.5"/>') },
  // ---- 军事 ----
  { id: 'st-fortress', name: '要塞', category: '军事', svg: S('<path d="M10 52 L10 24 L18 24 L18 30 L26 30 L26 24 L34 24 L34 30 L42 30 L42 24 L50 24 L50 52 Z" fill="#a8a094" stroke="#6a6254" stroke-width="2"/><path d="M10 24 L50 24 L50 18 L42 18 L42 14 L34 14 L18 14 L18 18 L10 18 Z" fill="#8f877a"/><rect x="26" y="40" width="12" height="12" fill="#4a4238"/>') },
  // ---- 奇幻 ----
  { id: 'st-crystal', name: '水晶', category: '奇幻', svg: S('<path d="M32 6 L42 24 L38 52 L26 52 L22 24 Z" fill="#a8d8f0" stroke="#5a9ac8" stroke-width="2"/><path d="M32 6 L32 52" stroke="#ffffff" stroke-width="1.5" opacity="0.8"/><path d="M22 24 L42 24" stroke="#ffffff" stroke-width="1.5" opacity="0.6"/>') },
  { id: 'st-dragon', name: '龙巢', category: '奇幻', svg: S('<circle cx="32" cy="40" r="16" fill="#7a6a5c" stroke="#4d4238" stroke-width="2"/><path d="M20 30 Q28 18 40 24 Q48 28 46 36" stroke="#4d4238" stroke-width="3" fill="none"/><circle cx="32" cy="38" r="6" fill="#e2604a"/><path d="M26 12 L30 8 M38 12 L34 8" stroke="#e2604a" stroke-width="2.5" stroke-linecap="round"/>') },
  { id: 'st-gate', name: '传送门', category: '奇幻', svg: S('<ellipse cx="32" cy="32" rx="14" ry="22" fill="#7c5acc" opacity="0.75"/><ellipse cx="32" cy="32" rx="14" ry="22" fill="none" stroke="#4a2f8a" stroke-width="3"/><ellipse cx="32" cy="32" rx="7" ry="14" fill="#b8a0f0" opacity="0.8"/><circle cx="28" cy="24" r="2" fill="#ffffff"/><circle cx="36" cy="40" r="1.5" fill="#ffffff"/>') },
  { id: 'st-mine', name: '矿坑', category: '奇幻', svg: S('<path d="M10 52 L18 20 L46 20 L54 52 Z" fill="#8a8070" stroke="#544c40" stroke-width="2"/><path d="M24 52 L24 34 Q32 28 40 34 L40 52 Z" fill="#2a2620"/><circle cx="22" cy="30" r="3" fill="#e8b84a"/><circle cx="44" cy="28" r="3" fill="#c8c8d8"/>') }
];
