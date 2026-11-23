/** 探索中 → クリア */
export type QuestStatus = 'open' | 'cleared';

/** クエスト = 日常の困りごと（倒したい敵） */
export interface QuestData {
  title: string; // 困りごと
  want: string; // 欲しい武器のイメージ
  budget: number | null; // 予算（円）
  places: string[]; // 探す場所（PLACES の id）
  memo: string;
  status: QuestStatus;
  clearedAt: number | null;
  clearedBy: string; // クリアのきっかけになった武器（find の id）
}

export interface Quest extends QuestData {
  id: string;
  createdAt: number;
  updatedAt: number;
}

/** 候補 → 入手 / 見送り */
export type FindStatus = 'candidate' | 'got' | 'passed';

/** 実戦評価: 効いた / まあまあ / ハズレ */
export type Rating = '' | 'hit' | 'ok' | 'miss';

/** 見つけた候補（入手したら武器庫へ） */
export interface FindData {
  questId: string; // '' はクエストなし（たまたま見つけた）
  name: string;
  price: number | null;
  place: string; // PLACES の id
  shop: string; // 店名
  memo: string;
  status: FindStatus;
  weaponType: string; // WEAPON_TYPES の id。'' は未設定
  rating: Rating;
  ratingNote: string;
  foundAt: string; // 'YYYY-MM-DD'
  gotAt: string; // 'YYYY-MM-DD' または ''
  thumb: string;
  photoCount: number;
}

export interface Find extends FindData {
  id: string;
  createdAt: number;
  updatedAt: number;
}

/** 出撃（休日の買い物）の記録。1日1件 */
export interface Sortie {
  id: string; // 'YYYY-MM-DD'
  date: string;
  places: string[];
  createdAt: number;
}
