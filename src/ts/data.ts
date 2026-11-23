// 固定のマスターデータ（開発者定義。SVGはユーザー入力を含まない）

export interface PlaceDef {
  id: string;
  label: string;
}

export const PLACES: PlaceDef[] = [
  { id: '100yen', label: '100円ショップ' },
  { id: 'home', label: 'ホームセンター' },
  { id: 'muji', label: '無印良品' },
  { id: 'denki', label: '家電量販店' },
  { id: 'furniture', label: 'ニトリ・家具店' },
  { id: 'drug', label: 'ドラッグストア' },
  { id: 'super', label: 'スーパー' },
  { id: 'zakka', label: '雑貨店' },
  { id: 'outdoor', label: 'アウトドア店' },
  { id: 'stationery', label: '文具店' },
  { id: 'net', label: 'ネット通販' },
  { id: 'other', label: 'その他' },
];

export const PLACE_IDS = PLACES.map((p) => p.id);

export function placeLabel(id: string): string {
  return PLACES.find((p) => p.id === id)?.label ?? '';
}

export interface WeaponTypeDef {
  id: string;
  label: string; // 武器としての名前
  role: string; // 日常での役割
  icon: string; // 64x64 座標の線画
}

export const WEAPON_TYPES: WeaponTypeDef[] = [
  {
    id: 'sword', label: '剣', role: '時短・効率化',
    icon: '<path d="M22 36 L48 10 H54 V16 L28 42 Z"/><path d="M16 34 L30 48"/><path d="M23 41 L13 51"/><circle cx="11" cy="53" r="3"/>',
  },
  {
    id: 'shield', label: '盾', role: 'トラブル予防',
    icon: '<path d="M32 8 L52 16 V30 C52 44 43 52 32 56 C21 52 12 44 12 30 V16 Z"/><path d="M32 18 V46"/>',
  },
  {
    id: 'bag', label: '道具袋', role: '収納・整理',
    icon: '<path d="M14 24 H50 L46 54 H18 Z"/><path d="M24 24 V18 C24 13 28 10 32 10 C36 10 40 13 40 18 V24"/>',
  },
  {
    id: 'potion', label: '回復薬', role: '癒し・休息',
    icon: '<path d="M26 8 H38"/><path d="M28 8 V22 L16 44 C13 50 17 56 24 56 H40 C47 56 51 50 48 44 L36 22 V8"/><path d="M20 40 H44"/>',
  },
  {
    id: 'ring', label: '指輪', role: '快適・便利',
    icon: '<circle cx="32" cy="40" r="14"/><path d="M26 14 H38 L42 20 L32 27 L22 20 Z"/>',
  },
  {
    id: 'secret', label: '秘密兵器', role: 'その他',
    icon: '<path d="M32 8 L38.5 24 L56 25.5 L42.5 36.5 L47 54 L32 44.5 L17 54 L21.5 36.5 L8 25.5 L25.5 24 Z"/>',
  },
];

export const WEAPON_TYPE_IDS = WEAPON_TYPES.map((w) => w.id);

export function weaponType(id: string): WeaponTypeDef | undefined {
  return WEAPON_TYPES.find((w) => w.id === id);
}

export const RATING_LABEL: Record<'hit' | 'ok' | 'miss', string> = {
  hit: '効いた！',
  ok: 'まあまあ',
  miss: 'ハズレ',
};

export const STATUS_LABEL: Record<'candidate' | 'got' | 'passed', string> = {
  candidate: '候補',
  got: '入手',
  passed: '見送り',
};
