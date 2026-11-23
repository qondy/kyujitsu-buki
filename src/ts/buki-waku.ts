// 休日ぶき探しのワクワク要素: 出撃・発見・入手・実戦評価・クエストクリアでハンターランクが上がる。
// 保存データは増やさず、記録（quests / finds / sorties）から計算する。
import { Find, Quest, Sortie } from './types';
import { RankDef, RankState, rankOf } from './wakuwaku';

export const RANKS: RankDef[] = [
  { name: '武器さがし見習い', min: 0 },
  { name: '駆け出しハンター', min: 60 },
  { name: '武器屋の常連', min: 160 },
  { name: '目利きハンター', min: 360 },
  { name: 'くらしの勇者', min: 700 },
  { name: '伝説のハンター', min: 1200 },
];

export const XP_HINT = '出撃 +10 / 発見 +3 / 入手 +10 / 実戦評価 +5 / クエストクリア +20';

export function computeXp(quests: Quest[], finds: Find[], sorties: Sortie[]): number {
  let xp = sorties.length * 10;
  finds.forEach((f) => {
    xp += 3;
    if (f.status === 'got') xp += 10;
    if (f.status === 'got' && f.rating) xp += 5;
  });
  quests.forEach((q) => {
    if (q.status === 'cleared') xp += 20;
  });
  return xp;
}

export function computeRank(quests: Quest[], finds: Find[], sorties: Sortie[]): RankState {
  return rankOf(computeXp(quests, finds, sorties), RANKS);
}
