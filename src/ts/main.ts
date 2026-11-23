import { User } from 'firebase/auth';
import { loginWithGoogle, logout, onAuthChange } from './auth';
import { submitFeedback } from './feedback';
import { cancelCropper, chooseSquareCrop } from './cropper';
import { loadImage, processPhoto, thumbFromDataUrl } from './image';
import {
  createFind, createQuest, deleteFind, deleteQuest, deleteSortie, FindPatch, loadPhotos,
  MAX_MEMO, MAX_PHOTOS, MAX_PRICE, MAX_RATING_NOTE, patchFind, saveSortie, setQuestStatus,
  subscribeFinds, subscribeQuests, subscribeSorties, updateFind, updateQuest, updateQuestMemo,
} from './store';
import { Find, FindData, FindStatus, Quest, QuestData, Rating, Sortie } from './types';
import { PLACES, PLACE_IDS, placeLabel, RATING_LABEL, STATUS_LABEL, WEAPON_TYPES, weaponType } from './data';
import { closeOverlay, iconEl, openOverlay, showToast, textEl } from './ui';
import { announceRankUp, celebrate, renderRankCard, showPopup } from './wakuwaku';
import { XP_HINT, computeRank } from './buki-waku';
import { initClickTracking, track } from './analytics';
import { initTextareas, InlineEditController, makeInlineEditable } from './memo-ui';

initClickTracking();

// ============================================================
// 固定アイコン（開発者定義のSVGのみ。ユーザー入力は含めない）
// ============================================================
const svg = (inner: string, size = 18): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICON_APP = '<path d="M24 36 L46 14 H52 V20 L30 42 Z"/><path d="M18 34 L32 48"/><path d="M25 41 L16 50"/><circle cx="14" cy="52" r="3"/><path d="M18 10 V22"/><path d="M12 16 H24"/>';
const ICON_PIN = '<path d="M32 56 C32 56 14 38 14 26 C14 16 22 8 32 8 C42 8 50 16 50 26 C50 38 32 56 32 56 Z"/><circle cx="32" cy="26" r="7"/>';
const ICON_QUESTION = '<path d="M24 24 C24 18 28 14 32 14 C37 14 40 18 40 22 C40 28 32 29 32 36"/><path d="M32 46 V47"/>';

type Tab = 'quests' | 'sortie' | 'armory';
type QuestFilter = 'open' | 'cleared' | 'all';

const TAB_KEY = 'kyujitsu-buki:tab';
const QUEST_FILTER_KEY = 'kyujitsu-buki:quest-filter';
const SORTIE_PLACES_KEY = 'kyujitsu-buki:sortie-places';
const TABS: Tab[] = ['quests', 'sortie', 'armory'];
const QUEST_FILTERS: { id: QuestFilter; label: string }[] = [
  { id: 'open', label: '探索中' },
  { id: 'cleared', label: 'クリア' },
  { id: 'all', label: 'すべて' },
];
const ALL_TYPES = '__all__';

// ============================================================
// 状態
// ============================================================
let currentUser: User | null = null;
let quests: Quest[] = [];
let finds: Find[] = [];
let sorties: Sortie[] = [];
const loaded = { quests: false, finds: false, sorties: false };
let unsubs: (() => void)[] = [];

let currentTab: Tab = (TABS as string[]).includes(lsGet(TAB_KEY)) ? (lsGet(TAB_KEY) as Tab) : 'quests';
let questFilter: QuestFilter = (['open', 'cleared', 'all'] as string[]).includes(lsGet(QUEST_FILTER_KEY))
  ? (lsGet(QUEST_FILTER_KEY) as QuestFilter)
  : 'open';
let sortiePlaces: string[] = readSortiePlaces();
let armoryType = ALL_TYPES;

let questDetailId: string | null = null;
let findDetailId: string | null = null;
let findDetailPhotos: string[] = [];
let findPhotoToken = 0;

let questEditingId: string | null = null;
let questEditorPlaces: string[] = [];
let questEditorSnapshot = '';
let questEditorBusy = false;

let findEditingId: string | null = null;
let findEditorPhotos: string[] = [];
let findEditorPhotosLoaded = true;
let findEditorPhotosChanged = false;
let findEditorSnapshot = '';
let findEditorBusy = false;
let photoBusy = false;
/** 破棄確認の対象 */
let discardTarget: 'quest' | 'find' | null = null;

let confirmAction: (() => Promise<void>) | null = null;
let sortieBusy = false;

// ============================================================
// DOM
// ============================================================
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つかりません`);
  return el as T;
};

const loginScreen = $('login-screen');
const appEl = $('app');
const loadingEl = $('loading');

const questDetailOverlay = $('quest-detail-overlay');
const questEditorOverlay = $('quest-editor-overlay');
const findDetailOverlay = $('find-detail-overlay');
const findEditorOverlay = $('find-editor-overlay');
const cropOverlay = $('crop-overlay');
const discardOverlay = $('discard-dialog-overlay');
const confirmOverlay = $('confirm-dialog-overlay');
const feedbackOverlay = $('feedback-modal-overlay');

const qeTitle = $<HTMLInputElement>('qe-title');
const qeWant = $<HTMLTextAreaElement>('qe-want');
const qeBudget = $<HTMLInputElement>('qe-budget');
const qePlaces = $('qe-places');
const qeMemo = $<HTMLTextAreaElement>('qe-memo');
const qeSave = $<HTMLButtonElement>('btn-qe-save');

const photoPicker = $('photo-picker');
const photoAdd = $('photo-add');
const photoInput = $<HTMLInputElement>('input-photo');
const feName = $<HTMLInputElement>('fe-name');
const fePrice = $<HTMLInputElement>('fe-price');
const feQuest = $<HTMLSelectElement>('fe-quest');
const fePlace = $<HTMLSelectElement>('fe-place');
const feShop = $<HTMLInputElement>('fe-shop');
const feStatus = $<HTMLSelectElement>('fe-status');
const feFound = $<HTMLInputElement>('fe-found');
const feType = $<HTMLSelectElement>('fe-type');
const feMemo = $<HTMLTextAreaElement>('fe-memo');
const feSave = $<HTMLButtonElement>('btn-fe-save');

// ============================================================
// ユーティリティ
// ============================================================
function lsGet(key: string): string {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* プライベートモードなどでは保存しない */
  }
}

function readSortiePlaces(): string[] {
  try {
    const v = JSON.parse(lsGet(SORTIE_PLACES_KEY) || '[]');
    return Array.isArray(v) ? v.filter((p): p is string => typeof p === 'string' && PLACE_IDS.includes(p)) : [];
  } catch {
    return [];
  }
}

function toDateStr(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const todayStr = (): string => toDateStr(Date.now());
const formatYen = (n: number): string => `¥${n.toLocaleString('ja-JP')}`;

function formatDate(s: string): string {
  const [y, m, d] = s.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

function formatShortWithDay(s: string): string {
  const [y, m, d] = s.split('-').map(Number);
  const w = '日月火水木金土'[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}（${w}）`;
}

/** 「12,800」「１２８００円」「¥12800」などを数値にする。空欄は null、読めなければ NaN */
function parsePrice(raw: string): number | null {
  const s = raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s,，、¥￥円]/g, '');
  if (!s) return null;
  return /^\d+$/.test(s) ? Number(s) : NaN;
}

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

const allLoaded = (): boolean => loaded.quests && loaded.finds && loaded.sorties;
const questById = (id: string | null): Quest | undefined => (id ? quests.find((q) => q.id === id) : undefined);
const findById = (id: string | null): Find | undefined => (id ? finds.find((f) => f.id === id) : undefined);
const findsOfQuest = (qid: string): Find[] => finds.filter((f) => f.questId === qid);

function chip(text: string, className: string): HTMLElement {
  return textEl('span', `chip ${className}`, text);
}

function statusChip(status: FindStatus): HTMLElement {
  return chip(STATUS_LABEL[status], `chip--${status}`);
}

function typeChip(id: string): HTMLElement | null {
  const t = weaponType(id);
  if (!t) return null;
  const el = document.createElement('span');
  el.className = 'chip chip--type';
  el.append(iconEl(svg(t.icon, 14), 'chip__icon'), document.createTextNode(t.label));
  return el;
}

function ratingChip(r: Rating): HTMLElement | null {
  if (!r) return null;
  return chip(RATING_LABEL[r], `chip--rating-${r}`);
}

function thumbBox(f: Find, className: string): HTMLElement {
  const box = document.createElement('div');
  box.className = className;
  if (f.thumb) {
    const img = document.createElement('img');
    img.src = f.thumb;
    img.alt = '';
    img.loading = 'lazy';
    box.append(img);
  } else {
    const t = weaponType(f.weaponType);
    box.append(iconEl(svg(t ? t.icon : ICON_APP, 32), `${className}-placeholder`));
  }
  return box;
}

// ============================================================
// 描画
// ============================================================
function render(): void {
  if (!currentUser) return;
  const ready = allLoaded();
  loadingEl.classList.toggle('hidden', ready);
  document.querySelectorAll<HTMLButtonElement>('.tabs__btn').forEach((b) => {
    const active = b.dataset.tab === currentTab;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-selected', String(active));
  });
  TABS.forEach((t) => $(`panel-${t}`).classList.toggle('hidden', !ready || t !== currentTab));
  if (!ready) return;

  renderRank();
  if (currentTab === 'quests') renderQuests();
  else if (currentTab === 'sortie') renderSortie();
  else renderArmory();

  if (questDetailOverlay.classList.contains('is-open')) renderQuestDetail();
  if (findDetailOverlay.classList.contains('is-open')) renderFindDetail();
}

function renderRank(): void {
  const box = $('rank-box');
  const r = computeRank(quests, finds, sorties);
  renderRankCard(box, r, XP_HINT);
  announceRankUp('kyujitsu-buki:rank', r, allLoaded(), '暮らしが、また少し強くなりました。');
}

// ---------- クエスト ----------
function renderQuests(): void {
  const bar = $('quest-filter');
  bar.textContent = '';
  QUEST_FILTERS.forEach((f) => {
    const count = f.id === 'all' ? quests.length : quests.filter((q) => q.status === f.id).length;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'filter-chip' + (questFilter === f.id ? ' is-active' : '');
    b.setAttribute('aria-pressed', String(questFilter === f.id));
    b.append(document.createTextNode(f.label), textEl('span', 'filter-chip__count', String(count)));
    b.addEventListener('click', () => {
      questFilter = f.id;
      lsSet(QUEST_FILTER_KEY, f.id);
      renderQuests();
    });
    bar.append(b);
  });

  const list = $<HTMLUListElement>('quest-list');
  list.textContent = '';
  const shown = quests
    .filter((q) => questFilter === 'all' || q.status === questFilter)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
      if (a.status === 'cleared') return (b.clearedAt ?? 0) - (a.clearedAt ?? 0);
      return b.createdAt - a.createdAt;
    });
  shown.forEach((q) => list.append(renderQuestCard(q)));
  $('empty-quests').classList.toggle('hidden', quests.length > 0);
  $('empty-quests-filter').classList.toggle('hidden', quests.length === 0 || shown.length > 0);
}

function questProgressText(q: Quest): string {
  const fs = findsOfQuest(q.id);
  if (!fs.length) return 'まだ候補なし';
  const c = fs.filter((f) => f.status === 'candidate').length;
  const g = fs.filter((f) => f.status === 'got').length;
  const parts = [`候補 ${c}`];
  if (g) parts.push(`入手 ${g}`);
  return parts.join('・');
}

function placesText(places: string[]): string {
  return places.length ? places.map(placeLabel).join('・') : 'どこでも';
}

function renderQuestCard(q: Quest): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'quest-card' + (q.status === 'cleared' ? ' is-cleared' : '');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'quest-card__btn';
  btn.addEventListener('click', () => openQuestDetail(q.id));

  const top = document.createElement('div');
  top.className = 'quest-card__top';
  top.append(chip(q.status === 'cleared' ? 'クリア' : '探索中', q.status === 'cleared' ? 'chip--cleared' : 'chip--open'));
  if (q.budget !== null) top.append(textEl('span', 'quest-card__budget', `予算 ${formatYen(q.budget)}`));
  btn.append(top, textEl('span', 'quest-card__title', q.title));
  if (q.want) btn.append(textEl('span', 'quest-card__want', q.want));

  const foot = document.createElement('span');
  foot.className = 'quest-card__foot';
  const place = document.createElement('span');
  place.className = 'quest-card__places';
  place.append(iconEl(svg(ICON_PIN, 14), 'inline-icon'), document.createTextNode(placesText(q.places)));
  foot.append(place, textEl('span', 'quest-card__progress', questProgressText(q)));
  btn.append(foot);
  li.append(btn);
  return li;
}

// ---------- 出撃 ----------
function matchesPlaces(q: Quest): boolean {
  if (!sortiePlaces.length) return true;
  return q.places.length === 0 || q.places.some((p) => sortiePlaces.includes(p));
}

function renderSortie(): void {
  const bar = $('sortie-places');
  bar.textContent = '';
  PLACES.forEach((p) => {
    const on = sortiePlaces.includes(p.id);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'filter-chip' + (on ? ' is-active' : '');
    b.setAttribute('aria-pressed', String(on));
    b.textContent = p.label;
    b.addEventListener('click', () => {
      sortiePlaces = on ? sortiePlaces.filter((x) => x !== p.id) : [...sortiePlaces, p.id];
      lsSet(SORTIE_PLACES_KEY, JSON.stringify(sortiePlaces));
      renderSortie();
    });
    bar.append(b);
  });

  const today = sorties.find((s) => s.date === todayStr());
  const status = $('sortie-status');
  const recordBtn = $<HTMLButtonElement>('btn-sortie-record');
  if (today) {
    status.textContent = `今日の出撃は記録済み（${placesText(today.places)}）`;
    recordBtn.textContent = '行き先を更新する';
  } else {
    status.textContent = sortiePlaces.length ? `${sortiePlaces.length}か所を選択中` : 'お店を選んでから記録しよう';
    recordBtn.textContent = '出撃を記録する';
  }
  recordBtn.disabled = sortieBusy || sortiePlaces.length === 0;

  const open = quests.filter((q) => q.status === 'open');
  const targets = open.filter(matchesPlaces).sort((a, b) => b.createdAt - a.createdAt);
  $('sortie-quests-desc').textContent = !open.length
    ? '探索中のクエストがありません。クエストのタブで困りごとを登録しよう。'
    : sortiePlaces.length
      ? `選んだお店で探せるクエストが ${targets.length}件（「どこでも」を含む）`
      : `探索中のクエスト ${targets.length}件。お店を選ぶと絞り込めます`;
  const list = $<HTMLUListElement>('sortie-quests');
  list.textContent = '';
  targets.forEach((q) => list.append(renderSortieQuest(q)));

  renderSortieHistory();
}

function renderSortieQuest(q: Quest): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'sortie-quest card-surface';
  const body = document.createElement('button');
  body.type = 'button';
  body.className = 'sortie-quest__body';
  body.addEventListener('click', () => openQuestDetail(q.id));
  body.append(textEl('span', 'sortie-quest__title', q.title));
  const sub: string[] = [];
  if (q.want) sub.push(q.want);
  if (q.budget !== null) sub.push(`予算 ${formatYen(q.budget)}`);
  if (sub.length) body.append(textEl('span', 'sortie-quest__want', sub.join(' ／ ')));
  body.append(textEl('span', 'sortie-quest__meta', `${placesText(q.places)} ・ ${questProgressText(q)}`));

  const found = document.createElement('button');
  found.type = 'button';
  found.className = 'btn btn--primary sortie-quest__found';
  found.textContent = '見つけた！';
  found.addEventListener('click', () => {
    const place = q.places.find((p) => sortiePlaces.includes(p)) ?? sortiePlaces[0] ?? '';
    openFindEditor(null, { questId: q.id, place });
  });
  li.append(body, found);
  return li;
}

function renderSortieHistory(): void {
  const list = $<HTMLUListElement>('sortie-history');
  list.textContent = '';
  if (!sorties.length) {
    list.append(textEl('li', 'mini-list__empty', 'まだ出撃の記録はありません。休日の買い物に出かけたら記録しよう。'));
    return;
  }
  sorties.slice(0, 8).forEach((s) => {
    const li = document.createElement('li');
    li.className = 'sortie-history__item';
    const dayFinds = finds.filter((f) => f.foundAt === s.date);
    const got = dayFinds.filter((f) => f.status === 'got').length;
    li.append(
      textEl('span', 'sortie-history__date', formatShortWithDay(s.date)),
      textEl('span', 'sortie-history__places', placesText(s.places)),
      textEl('span', 'sortie-history__count', dayFinds.length ? `発見 ${dayFinds.length}${got ? `・入手 ${got}` : ''}` : '発見なし'),
    );
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'icon-btn is-danger';
    del.setAttribute('aria-label', `${formatShortWithDay(s.date)}の出撃記録を削除`);
    del.textContent = '×';
    del.addEventListener('click', () => {
      askConfirm('出撃の記録を削除しますか？', `${formatDate(s.date)}の出撃記録を削除します。見つけた候補は消えません。`, async () => {
        if (!currentUser) return;
        await deleteSortie(currentUser.uid, s.id);
        showToast('削除しました');
      });
    });
    li.append(del);
    list.append(li);
  });
}

async function recordSortie(): Promise<void> {
  if (!currentUser || sortieBusy || !sortiePlaces.length) return;
  sortieBusy = true;
  renderSortie();
  const date = todayStr();
  const existing = sorties.find((s) => s.date === date);
  try {
    await saveSortie(currentUser.uid, date, sortiePlaces, existing?.createdAt);
    if (existing) {
      showToast('行き先を更新しました');
    } else {
      track('sortie_record', { place_count: sortiePlaces.length });
      showPopup('出撃！', `${placesText(sortiePlaces)}へ。いい武器が見つかりますように（+10 XP）`, 'いってきます');
    }
  } catch (err) {
    console.error(err);
    showToast('記録に失敗しました。通信環境を確認してください');
  } finally {
    sortieBusy = false;
    renderSortie();
  }
}

// ---------- 武器庫 ----------
function renderArmory(): void {
  const got = finds.filter((f) => f.status === 'got');
  const rated = got.filter((f) => f.rating);
  const hits = got.filter((f) => f.rating === 'hit').length;
  const spent = got.reduce((s, f) => s + (f.price ?? 0), 0);
  const cleared = quests.filter((q) => q.status === 'cleared').length;

  const stats = $('armory-stats');
  stats.textContent = '';
  const statItems: [string, string][] = [
    ['武器', `${got.length}`],
    ['クリア', `${cleared}`],
    ['効いた率', rated.length ? `${Math.round((hits / rated.length) * 100)}%` : '—'],
    ['出撃', `${sorties.length}回`],
  ];
  statItems.forEach(([label, value]) => {
    const d = document.createElement('div');
    d.className = 'armory-stats__item';
    d.append(textEl('span', 'armory-stats__value', value), textEl('span', 'armory-stats__label', label));
    stats.append(d);
  });
  if (spent > 0) stats.append(textEl('p', 'armory-stats__note', `武器に使った金額 ${formatYen(spent)}`));

  // 図鑑
  const zukan = $<HTMLUListElement>('zukan');
  zukan.textContent = '';
  WEAPON_TYPES.forEach((t) => {
    const count = got.filter((f) => f.weaponType === t.id).length;
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    const active = armoryType === t.id;
    b.className = 'zukan__slot' + (count ? ' is-found' : '') + (active ? ' is-active' : '');
    b.setAttribute('aria-pressed', String(active));
    b.append(iconEl(svg(count ? t.icon : ICON_QUESTION, 30), 'zukan__icon'));
    b.append(textEl('span', 'zukan__name', count ? t.label : '？？？'));
    b.append(textEl('span', 'zukan__role', t.role));
    b.append(textEl('span', 'zukan__count', count ? `${count}本` : '未発見'));
    b.addEventListener('click', () => {
      armoryType = active ? ALL_TYPES : t.id;
      renderArmory();
    });
    li.append(b);
    zukan.append(li);
  });

  // 一覧
  const shown = got
    .filter((f) => armoryType === ALL_TYPES || f.weaponType === armoryType)
    .sort((a, b) => (b.gotAt || toDateStr(b.createdAt)).localeCompare(a.gotAt || toDateStr(a.createdAt)) || b.createdAt - a.createdAt);
  const t = weaponType(armoryType);
  $('armory-list-title').textContent = t ? `手に入れた武器：${t.label}（${t.role}）` : '手に入れた武器';
  const list = $<HTMLUListElement>('armory-list');
  list.textContent = '';
  shown.forEach((f) => list.append(renderFindCard(f)));
  const empty = $('empty-armory');
  empty.classList.toggle('hidden', shown.length > 0);
  if (!shown.length && t && got.length) empty.querySelector('p')!.textContent = 'この種類の武器はまだありません。';
  else empty.querySelector('p')!.textContent = 'まだ武器がありません。候補を「入手」にすると、ここに並びます。';

  // お店ごとの発見数
  const shopList = $<HTMLUListElement>('shop-stats');
  shopList.textContent = '';
  const counts = PLACES.map((p) => ({ p, n: finds.filter((f) => f.place === p.id).length, g: got.filter((f) => f.place === p.id).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  if (!counts.length) {
    shopList.append(textEl('li', 'mini-list__empty', '候補を登録すると、お店ごとの発見数がわかります。'));
  } else {
    const max = counts[0].n;
    counts.forEach(({ p, n, g }) => {
      const li = document.createElement('li');
      li.className = 'shop-stats__row';
      const bar = document.createElement('span');
      bar.className = 'shop-stats__bar';
      const fill = document.createElement('span');
      fill.className = 'shop-stats__fill';
      fill.style.width = `${Math.max(6, Math.round((n / max) * 100))}%`;
      bar.append(fill);
      li.append(textEl('span', 'shop-stats__label', p.label), bar, textEl('span', 'shop-stats__num', g ? `${n}（入手${g}）` : `${n}`));
      shopList.append(li);
    });
  }

  // 見送ったもの
  const passed = finds.filter((f) => f.status === 'passed').sort((a, b) => b.updatedAt - a.updatedAt);
  const saved = passed.reduce((s, f) => s + (f.price ?? 0), 0);
  $('passed-desc').textContent = passed.length
    ? `${passed.length}件を見送り${saved ? `、衝動買いせずに済んだ金額 ${formatYen(saved)}` : ''}。比べて選んだ証です。`
    : '候補を「見送り」にすると、ここに残ります。';
  const pl = $<HTMLUListElement>('passed-list');
  pl.textContent = '';
  passed.slice(0, 20).forEach((f) => pl.append(renderMiniFind(f)));
}

function renderFindCard(f: Find): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'find-card';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'find-card__btn';
  btn.addEventListener('click', () => openFindDetail(f.id));
  btn.append(thumbBox(f, 'find-card__thumb'));
  const body = document.createElement('span');
  body.className = 'find-card__body';
  const badges = document.createElement('span');
  badges.className = 'find-card__badges';
  const tc = typeChip(f.weaponType);
  if (tc) badges.append(tc);
  const rc = ratingChip(f.rating);
  if (rc) badges.append(rc);
  if (badges.childElementCount) body.append(badges);
  body.append(textEl('span', 'find-card__name', f.name));
  const meta: string[] = [];
  if (f.price !== null) meta.push(formatYen(f.price));
  if (f.shop || f.place) meta.push(f.shop || placeLabel(f.place));
  if (meta.length) body.append(textEl('span', 'find-card__meta', meta.join(' ・ ')));
  if (!f.rating) body.append(textEl('span', 'find-card__todo', '実戦評価がまだ'));
  btn.append(body);
  li.append(btn);
  return li;
}

function renderMiniFind(f: Find, showQuest = true): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'mini-find' + (f.status === 'passed' ? ' is-passed' : '');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mini-find__btn';
  btn.addEventListener('click', () => openFindDetail(f.id));
  btn.append(thumbBox(f, 'mini-find__thumb'));
  const body = document.createElement('span');
  body.className = 'mini-find__body';
  const head = document.createElement('span');
  head.className = 'mini-find__head';
  head.append(statusChip(f.status));
  const rc = ratingChip(f.rating);
  if (rc) head.append(rc);
  body.append(head, textEl('span', 'mini-find__name', f.name));
  const meta: string[] = [];
  if (f.shop || f.place) meta.push(f.shop || placeLabel(f.place));
  if (f.foundAt) meta.push(formatShortWithDay(f.foundAt));
  if (showQuest) {
    const q = questById(f.questId);
    if (q) meta.push(`クエスト：${q.title}`);
  }
  if (meta.length) body.append(textEl('span', 'mini-find__meta', meta.join(' ・ ')));
  btn.append(body);
  btn.append(textEl('span', 'mini-find__price', f.price !== null ? formatYen(f.price) : '—'));
  li.append(btn);
  return li;
}

// ============================================================
// クエスト詳細
// ============================================================
let questMemoCtl: InlineEditController | null = null;

function openQuestDetail(id: string): void {
  if (!questById(id)) return;
  if (questDetailId !== id) questMemoCtl?.reset();
  questDetailId = id;
  renderQuestDetail();
  openOverlay(questDetailOverlay);
}

function closeQuestDetail(): void {
  questDetailId = null;
  questMemoCtl?.reset();
  closeOverlay(questDetailOverlay);
}

function renderQuestDetail(): void {
  const q = questById(questDetailId);
  if (!q) {
    closeQuestDetail();
    return;
  }
  const st = $('qd-status');
  st.className = 'chip ' + (q.status === 'cleared' ? 'chip--cleared' : 'chip--open');
  st.textContent = q.status === 'cleared' ? 'クリア' : '探索中';
  $('qd-title').textContent = q.title;
  const meta: string[] = [];
  if (q.budget !== null) meta.push(`予算 ${formatYen(q.budget)}`);
  meta.push(`登録 ${formatDate(toDateStr(q.createdAt))}`);
  if (q.status === 'cleared' && q.clearedAt) meta.push(`クリア ${formatDate(toDateStr(q.clearedAt))}`);
  $('qd-meta').textContent = meta.join(' ・ ');

  $('qd-want-section').classList.toggle('hidden', !q.want);
  $('qd-want').textContent = q.want;

  const places = $('qd-places');
  places.textContent = '';
  places.append(iconEl(svg(ICON_PIN, 16), 'inline-icon qd-places__icon'));
  (q.places.length ? q.places.map(placeLabel) : ['どこでも']).forEach((l) => places.append(chip(l, 'chip--place')));

  const fs = findsOfQuest(q.id).sort((a, b) => {
    const order: Record<FindStatus, number> = { got: 0, candidate: 1, passed: 2 };
    return order[a.status] - order[b.status] || (a.price ?? Infinity) - (b.price ?? Infinity);
  });
  const list = $<HTMLUListElement>('qd-finds');
  list.textContent = '';
  if (!fs.length) list.append(textEl('li', 'mini-list__empty', 'まだ候補がありません。お店で見つけたら追加しよう。'));
  fs.forEach((f) => list.append(renderMiniFind(f, false)));

  const priced = fs.filter((f) => f.status !== 'passed' && f.price !== null) as (Find & { price: number })[];
  let compare = '';
  if (priced.length >= 2) {
    const min = Math.min(...priced.map((f) => f.price));
    const max = Math.max(...priced.map((f) => f.price));
    compare = `候補の値段は ${formatYen(min)} 〜 ${formatYen(max)}（差 ${formatYen(max - min)}）`;
  }
  if (q.budget !== null && priced.length) {
    const within = priced.filter((f) => f.price <= q.budget!).length;
    compare += `${compare ? '。' : ''}予算内は ${within}/${priced.length}件`;
  }
  $('qd-compare').textContent = compare;
  $('qd-compare').classList.toggle('hidden', !compare);

  const toggle = $<HTMLButtonElement>('btn-qd-toggle');
  toggle.textContent = q.status === 'cleared' ? '探索に戻す' : 'クリアにする';

  if (!questMemoCtl) {
    questMemoCtl = makeInlineEditable($('qd-memo'), {
      maxLength: MAX_MEMO,
      placeholder: 'サイズの条件・気になっている物など',
      emptyLabel: 'タップしてメモを追加',
      getText: () => questById(questDetailId)?.memo ?? '',
      save: async (text) => {
        const cur = questById(questDetailId);
        if (!currentUser || !cur) throw new Error('no quest');
        await updateQuestMemo(currentUser.uid, cur.id, text);
      },
      onError: () => showToast('保存に失敗しました'),
    });
  }
  questMemoCtl.refresh();
}

let questToggleBusy = false;
async function toggleQuestCleared(): Promise<void> {
  const q = questById(questDetailId);
  if (!q || !currentUser || questToggleBusy) return;
  questToggleBusy = true;
  try {
    if (q.status === 'open') {
      await setQuestStatus(currentUser.uid, q.id, 'cleared');
      track('quest_clear', { by: 'manual' });
      celebrate();
      showPopup('クエストクリア！', `「${q.title}」を倒しました（+20 XP）`);
    } else {
      await setQuestStatus(currentUser.uid, q.id, 'open');
      showToast('探索中に戻しました');
    }
  } catch {
    showToast('更新に失敗しました');
  } finally {
    questToggleBusy = false;
  }
}

// ============================================================
// クエストの登録・編集
// ============================================================
function renderQuestEditorPlaces(): void {
  qePlaces.textContent = '';
  PLACES.forEach((p) => {
    const on = questEditorPlaces.includes(p.id);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'filter-chip' + (on ? ' is-active' : '');
    b.setAttribute('aria-pressed', String(on));
    b.textContent = p.label;
    b.addEventListener('click', () => {
      questEditorPlaces = on ? questEditorPlaces.filter((x) => x !== p.id) : [...questEditorPlaces, p.id];
      renderQuestEditorPlaces();
    });
    qePlaces.append(b);
  });
}

const questEditorState = (): string =>
  JSON.stringify([qeTitle.value, qeWant.value, qeBudget.value, qeMemo.value, [...questEditorPlaces].sort()]);

function openQuestEditor(id: string | null): void {
  const q = questById(id);
  questEditingId = q ? q.id : null;
  $('qe-heading').textContent = q ? 'クエストを編集' : 'クエストを登録';
  qeTitle.value = q?.title ?? '';
  qeWant.value = q?.want ?? '';
  qeBudget.value = q?.budget != null ? q.budget.toLocaleString('ja-JP') : '';
  qeMemo.value = q?.memo ?? '';
  questEditorPlaces = q ? [...q.places] : [];
  renderQuestEditorPlaces();
  questEditorSnapshot = questEditorState();
  openOverlay(questEditorOverlay);
  if (!q) qeTitle.focus();
}

function requestCloseQuestEditor(): void {
  if (questEditorBusy) return;
  if (questEditorState() !== questEditorSnapshot) {
    discardTarget = 'quest';
    openOverlay(discardOverlay);
  } else {
    closeQuestEditor();
  }
}

function closeQuestEditor(): void {
  closeOverlay(questEditorOverlay);
  questEditingId = null;
}

async function saveQuestEditor(e: Event): Promise<void> {
  e.preventDefault();
  if (questEditorBusy || !currentUser) return;
  const title = qeTitle.value.trim();
  if (!title) {
    showToast('困りごとを入力してください');
    qeTitle.focus();
    return;
  }
  const budget = parsePrice(qeBudget.value);
  if (budget !== null && (Number.isNaN(budget) || budget > MAX_PRICE)) {
    showToast('予算は数字で入力してください（1億円未満）');
    qeBudget.focus();
    return;
  }
  const existing = questById(questEditingId);
  const data: QuestData = {
    title,
    want: qeWant.value,
    budget,
    places: questEditorPlaces,
    memo: qeMemo.value,
    status: existing?.status ?? 'open',
    clearedAt: existing?.clearedAt ?? null,
    clearedBy: existing?.clearedBy ?? '',
  };
  questEditorBusy = true;
  qeSave.disabled = true;
  qeSave.textContent = '保存中…';
  try {
    if (existing) {
      await updateQuest(currentUser.uid, existing.id, data);
      closeQuestEditor();
      showToast('保存しました');
    } else {
      const id = await createQuest(currentUser.uid, data);
      track('quest_create', { place_count: data.places.length, has_budget: budget !== null ? 1 : 0 });
      closeQuestEditor();
      showToast('クエストを登録しました');
      questFilter = questFilter === 'cleared' ? 'open' : questFilter;
      openQuestDetail(id);
    }
  } catch (err) {
    console.error(err);
    showToast('保存に失敗しました。通信環境を確認してください');
  } finally {
    questEditorBusy = false;
    qeSave.disabled = false;
    qeSave.textContent = '保存する';
  }
}

// ============================================================
// 候補・武器の詳細
// ============================================================
let findMemoCtl: InlineEditController | null = null;
let ratingNoteCtl: InlineEditController | null = null;
const findBusy = new Set<string>();

function openFindDetail(id: string): void {
  const f = findById(id);
  if (!f) return;
  if (findDetailId !== id) {
    findMemoCtl?.reset();
    ratingNoteCtl?.reset();
    findDetailPhotos = [];
    findDetailId = id;
    void fetchFindPhotos(id);
  }
  renderFindDetail();
  openOverlay(findDetailOverlay);
}

async function fetchFindPhotos(id: string): Promise<void> {
  const f = findById(id);
  if (!currentUser || !f || f.photoCount === 0) return;
  const token = ++findPhotoToken;
  try {
    const photos = await loadPhotos(currentUser.uid, id);
    if (token !== findPhotoToken || findDetailId !== id) return;
    findDetailPhotos = photos;
    renderFindPhoto();
  } catch {
    if (token === findPhotoToken) showToast('写真を読み込めませんでした');
  }
}

function closeFindDetail(): void {
  findDetailId = null;
  findMemoCtl?.reset();
  ratingNoteCtl?.reset();
  findDetailPhotos = [];
  findPhotoToken++;
  closeOverlay(findDetailOverlay);
}

function renderFindPhoto(): void {
  const f = findById(findDetailId);
  const wrap = $('fd-photo');
  wrap.textContent = '';
  if (!f) return;
  const src = findDetailPhotos[0] || f.thumb;
  wrap.classList.toggle('photo-viewer--empty', !src);
  if (!src) {
    const t = weaponType(f.weaponType);
    wrap.append(iconEl(svg(t ? t.icon : ICON_APP, 56), 'photo-viewer__placeholder'));
    return;
  }
  const img = document.createElement('img');
  img.src = src;
  img.alt = `${f.name}の写真`;
  img.className = 'photo-viewer__img' + (findDetailPhotos.length ? '' : ' is-loading');
  wrap.append(img);
}

function segButton(label: string, className: string, active: boolean, onClick: () => void, disabled: boolean): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className + (active ? ' is-active' : '');
  b.setAttribute('aria-pressed', String(active));
  b.textContent = label;
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

function renderFindDetail(): void {
  const f = findById(findDetailId);
  if (!f) {
    closeFindDetail();
    return;
  }
  const busy = findBusy.has(f.id);
  const badges = $('fd-badges');
  badges.textContent = '';
  badges.append(statusChip(f.status));
  const tc = typeChip(f.weaponType);
  if (tc && f.status === 'got') badges.append(tc);
  $('fd-name').textContent = f.name;
  const meta: string[] = [];
  if (f.price !== null) meta.push(formatYen(f.price));
  if (f.place) meta.push(placeLabel(f.place));
  if (f.shop) meta.push(f.shop);
  if (f.foundAt) meta.push(`見つけた日 ${formatDate(f.foundAt)}`);
  if (f.status === 'got' && f.gotAt) meta.push(`入手 ${formatDate(f.gotAt)}`);
  $('fd-meta').textContent = meta.join(' ・ ');
  renderFindPhoto();

  const seg = $('fd-status');
  seg.textContent = '';
  (['candidate', 'got', 'passed'] as FindStatus[]).forEach((s) => {
    seg.append(segButton(s === 'got' ? '入手した' : STATUS_LABEL[s], `status-seg__btn status-seg__btn--${s}`, f.status === s, () => void changeFindStatus(f.id, s), busy));
  });

  const q = questById(f.questId);
  $('fd-quest-row').classList.toggle('hidden', !q);
  $('fd-quest').textContent = q ? `${q.title}${q.status === 'cleared' ? '（クリア）' : ''}` : '';

  const isGot = f.status === 'got';
  $('fd-type-section').classList.toggle('hidden', !isGot);
  $('fd-rating-section').classList.toggle('hidden', !isGot);
  if (isGot) {
    const tp = $('fd-type');
    tp.textContent = '';
    WEAPON_TYPES.forEach((t) => {
      const b = segButton('', 'type-picker__btn', f.weaponType === t.id, () => void changeWeaponType(f.id, t.id), busy);
      b.append(iconEl(svg(t.icon, 22), 'type-picker__icon'), textEl('span', 'type-picker__label', t.label), textEl('span', 'type-picker__role', t.role));
      tp.append(b);
    });
    const rs = $('fd-rating');
    rs.textContent = '';
    (['hit', 'ok', 'miss'] as const).forEach((r) => {
      rs.append(segButton(RATING_LABEL[r], `rating-seg__btn rating-seg__btn--${r}`, f.rating === r, () => void changeRating(f.id, f.rating === r ? '' : r), busy));
    });
  }

  if (!findMemoCtl) {
    findMemoCtl = makeInlineEditable($('fd-memo'), {
      maxLength: MAX_MEMO,
      placeholder: 'サイズ・色・ほかの候補との違いなど',
      emptyLabel: 'タップしてメモを追加',
      getText: () => findById(findDetailId)?.memo ?? '',
      save: async (text) => {
        const cur = findById(findDetailId);
        if (!currentUser || !cur) throw new Error('no find');
        await patchFind(currentUser.uid, cur.id, { memo: text });
      },
      onError: () => showToast('保存に失敗しました'),
    });
  }
  findMemoCtl.refresh();
  if (!ratingNoteCtl) {
    ratingNoteCtl = makeInlineEditable($('fd-rating-note'), {
      maxLength: MAX_RATING_NOTE,
      placeholder: '例：朝の支度が5分早くなった',
      emptyLabel: 'タップして使ってみた感想を書く',
      getText: () => findById(findDetailId)?.ratingNote ?? '',
      save: async (text) => {
        const cur = findById(findDetailId);
        if (!currentUser || !cur) throw new Error('no find');
        await patchFind(currentUser.uid, cur.id, { ratingNote: text });
      },
      onError: () => showToast('保存に失敗しました'),
    });
  }
  ratingNoteCtl.refresh();
}

async function patchFindQuick(id: string, patch: FindPatch): Promise<boolean> {
  if (!currentUser || findBusy.has(id)) return false;
  findBusy.add(id);
  renderFindDetail();
  try {
    await patchFind(currentUser.uid, id, patch);
    return true;
  } catch {
    showToast('更新に失敗しました');
    return false;
  } finally {
    findBusy.delete(id);
    if (findDetailId === id) renderFindDetail();
  }
}

/** その種類の武器を初めて手に入れたら図鑑登録のお祝いを出す */
function announceNewType(typeId: string, excludeId: string): void {
  const t = weaponType(typeId);
  if (!t) return;
  const already = finds.some((f) => f.id !== excludeId && f.status === 'got' && f.weaponType === typeId);
  if (already) return;
  celebrate(18);
  showPopup(`図鑑に「${t.label}」が登録された！`, `${t.role}の武器を初めて手に入れました。`);
}

async function changeFindStatus(id: string, status: FindStatus): Promise<void> {
  const f = findById(id);
  if (!f || f.status === status) return;
  const patch: FindPatch = { status };
  if (status === 'got' && !f.gotAt) patch.gotAt = todayStr();
  const ok = await patchFindQuick(id, patch);
  if (!ok) return;
  track('find_status', { status });
  if (status === 'got') {
    if (f.weaponType) announceNewType(f.weaponType, f.id);
    else showToast('入手しました！武器の種類を選ぶと図鑑に載ります');
  } else if (status === 'passed') {
    showToast('見送りにしました。比べて選んだ証です');
  }
}

async function changeWeaponType(id: string, typeId: string): Promise<void> {
  const f = findById(id);
  if (!f || f.weaponType === typeId) return;
  const ok = await patchFindQuick(id, { weaponType: typeId });
  if (ok && f.status === 'got') announceNewType(typeId, id);
}

async function changeRating(id: string, rating: Rating): Promise<void> {
  const f = findById(id);
  if (!f) return;
  const ok = await patchFindQuick(id, { rating });
  if (!ok || !rating) return;
  track('find_rate', { rating });
  const q = questById(f.questId);
  if (rating === 'hit' && q && q.status === 'open' && currentUser) {
    try {
      await setQuestStatus(currentUser.uid, q.id, 'cleared', f.id);
      track('quest_clear', { by: 'rating' });
      celebrate();
      showPopup('クエストクリア！', `「${f.name}」で「${q.title}」を倒しました（+20 XP）`);
    } catch {
      showToast('クエストの更新に失敗しました');
    }
  } else if (rating === 'hit') {
    celebrate(14);
    showToast('効いた！いい武器を手に入れました');
  } else if (rating === 'miss' && q && q.status === 'open') {
    showToast('次の候補を探しに、また出撃しよう');
  }
}

// ============================================================
// 候補の登録・編集
// ============================================================
function fillFindEditorSelects(questId: string, place: string, type: string): void {
  feQuest.textContent = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'クエストなし（たまたま見つけた）';
  feQuest.append(none);
  quests
    .filter((q) => q.status === 'open' || q.id === questId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .forEach((q) => {
      const o = document.createElement('option');
      o.value = q.id;
      o.textContent = q.status === 'cleared' ? `${q.title}（クリア）` : q.title;
      feQuest.append(o);
    });
  feQuest.value = questById(questId) ? questId : '';

  fePlace.textContent = '';
  const np = document.createElement('option');
  np.value = '';
  np.textContent = '選ばない';
  fePlace.append(np);
  PLACES.forEach((p) => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.label;
    fePlace.append(o);
  });
  fePlace.value = place;

  feType.textContent = '';
  const nt = document.createElement('option');
  nt.value = '';
  nt.textContent = 'あとで決める';
  feType.append(nt);
  WEAPON_TYPES.forEach((t) => {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = `${t.label}（${t.role}）`;
    feType.append(o);
  });
  feType.value = type;
}

function renderPhotoPicker(): void {
  photoPicker.querySelectorAll('.photo-picker__item, .photo-picker__loading').forEach((el) => el.remove());
  if (!findEditorPhotosLoaded) {
    photoPicker.insertBefore(textEl('div', 'photo-picker__loading', '写真を読み込み中…'), photoAdd);
  }
  findEditorPhotos.forEach((p, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'photo-picker__item';
    const img = document.createElement('img');
    img.src = p;
    img.alt = `写真${i + 1}`;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'photo-picker__remove';
    del.setAttribute('aria-label', `写真${i + 1}を削除`);
    del.textContent = '×';
    del.addEventListener('click', () => {
      findEditorPhotos.splice(i, 1);
      findEditorPhotosChanged = true;
      renderPhotoPicker();
    });
    wrap.append(img, del);
    photoPicker.insertBefore(wrap, photoAdd);
  });
  const full = findEditorPhotos.length >= MAX_PHOTOS || !findEditorPhotosLoaded || photoBusy;
  photoAdd.classList.toggle('is-disabled', full);
  photoInput.disabled = full;
  const label = photoAdd.querySelector('span');
  if (label) label.textContent = photoBusy ? '処理中…' : findEditorPhotos.length >= MAX_PHOTOS ? '1枚まで' : '写真を追加';
}

async function onPhotoSelected(): Promise<void> {
  const file = photoInput.files?.[0];
  photoInput.value = '';
  if (!file || photoBusy || findEditorPhotos.length >= MAX_PHOTOS) return;
  photoBusy = true;
  renderPhotoPicker();
  try {
    if (!file.type.startsWith('image/')) throw new Error('画像ファイルを選んでください');
    const img = await loadImage(file);
    const crop = await chooseSquareCrop(img);
    if (crop && findEditorOverlay.classList.contains('is-open')) {
      findEditorPhotos.push(processPhoto(img, crop));
      findEditorPhotosChanged = true;
    }
  } catch (err) {
    showToast(errMessage(err, 'この画像は追加できませんでした'));
  } finally {
    photoBusy = false;
    renderPhotoPicker();
  }
}

const findEditorState = (): string =>
  JSON.stringify([
    feName.value, fePrice.value, feQuest.value, fePlace.value, feShop.value, feStatus.value, feFound.value, feType.value,
    feMemo.value, findEditorPhotosChanged,
  ]);

function openFindEditor(id: string | null, preset: { questId?: string; place?: string } = {}): void {
  const f = findById(id);
  findEditingId = f ? f.id : null;
  findEditorPhotosChanged = false;
  $('fe-heading').textContent = f ? '候補を編集' : '見つけた候補を登録';
  feName.value = f?.name ?? '';
  fePrice.value = f?.price != null ? f.price.toLocaleString('ja-JP') : '';
  const lastSortie = sorties.find((s) => s.date === todayStr());
  const defaultPlace = preset.place ?? (lastSortie?.places[0] || sortiePlaces[0] || '');
  fillFindEditorSelects(f ? f.questId : preset.questId ?? '', f ? f.place : defaultPlace, f?.weaponType ?? '');
  feShop.value = f?.shop ?? '';
  feStatus.value = f?.status ?? 'candidate';
  feFound.value = f?.foundAt || todayStr();
  feFound.max = todayStr();
  feMemo.value = f?.memo ?? '';

  if (f && f.photoCount > 0) {
    if (findDetailId === f.id && findDetailPhotos.length) {
      findEditorPhotos = [...findDetailPhotos];
      findEditorPhotosLoaded = true;
    } else {
      findEditorPhotos = [];
      findEditorPhotosLoaded = false;
      const uid = currentUser?.uid;
      if (uid) {
        loadPhotos(uid, f.id)
          .then((photos) => {
            if (findEditingId !== f.id) return;
            findEditorPhotos = photos;
            findEditorPhotosLoaded = true;
            renderPhotoPicker();
          })
          .catch(() => {
            showToast('写真を読み込めませんでした。写真以外は編集できます');
            findEditorPhotosLoaded = true;
            renderPhotoPicker();
          });
      }
    }
  } else {
    findEditorPhotos = [];
    findEditorPhotosLoaded = true;
  }
  renderPhotoPicker();
  findEditorSnapshot = findEditorState();
  openOverlay(findEditorOverlay);
  if (!f) feName.focus();
}

function requestCloseFindEditor(): void {
  if (findEditorBusy) return;
  if (findEditorState() !== findEditorSnapshot) {
    discardTarget = 'find';
    openOverlay(discardOverlay);
  } else {
    closeFindEditor();
  }
}

function closeFindEditor(): void {
  cancelCropper();
  closeOverlay(findEditorOverlay);
  findEditingId = null;
  findEditorPhotos = [];
}

async function saveFindEditor(e: Event): Promise<void> {
  e.preventDefault();
  if (findEditorBusy || !currentUser) return;
  const name = feName.value.trim();
  if (!name) {
    showToast('名前を入力してください');
    feName.focus();
    return;
  }
  if (photoBusy || !findEditorPhotosLoaded) {
    showToast('写真の処理が終わるまでお待ちください');
    return;
  }
  const price = parsePrice(fePrice.value);
  if (price !== null && (Number.isNaN(price) || price > MAX_PRICE)) {
    showToast('値段は数字で入力してください（1億円未満）');
    fePrice.focus();
    return;
  }
  const existing = findById(findEditingId);
  const status = feStatus.value as FindStatus;
  findEditorBusy = true;
  feSave.disabled = true;
  feSave.textContent = '保存中…';
  try {
    let thumb = existing?.thumb ?? '';
    if (!existing || findEditorPhotosChanged) thumb = findEditorPhotos[0] ? await thumbFromDataUrl(findEditorPhotos[0]) : '';
    const data: FindData = {
      questId: feQuest.value,
      name,
      price,
      place: fePlace.value,
      shop: feShop.value,
      memo: feMemo.value,
      status,
      weaponType: feType.value,
      rating: existing?.rating ?? '',
      ratingNote: existing?.ratingNote ?? '',
      foundAt: feFound.value || todayStr(),
      gotAt: status === 'got' ? existing?.gotAt || todayStr() : existing?.gotAt ?? '',
      thumb,
      photoCount: existing && !findEditorPhotosChanged ? existing.photoCount : findEditorPhotos.length,
    };
    const becameGot = status === 'got' && existing?.status !== 'got';
    const typeNewlySet = status === 'got' && data.weaponType && (becameGot || existing?.weaponType !== data.weaponType);
    if (existing) {
      await updateFind(currentUser.uid, existing.id, data, findEditorPhotosChanged ? findEditorPhotos : null);
      if (findEditorPhotosChanged && findDetailId === existing.id) findDetailPhotos = [...findEditorPhotos];
      closeFindEditor();
      showToast('保存しました');
      if (typeNewlySet) announceNewType(data.weaponType, existing.id);
    } else {
      const photos = [...findEditorPhotos];
      const id = await createFind(currentUser.uid, data, photos);
      track('find_create', { status, has_quest: data.questId ? 1 : 0, photo_count: photos.length, place: data.place || 'none' });
      closeFindEditor();
      showToast(status === 'got' ? '武器を手に入れた！' : '候補を登録しました（+3 XP）');
      if (typeNewlySet) announceNewType(data.weaponType, id);
      findDetailId = id;
      findDetailPhotos = photos;
      findMemoCtl?.reset();
      ratingNoteCtl?.reset();
      if (findById(id)) renderFindDetail();
      openOverlay(findDetailOverlay);
    }
  } catch (err) {
    console.error(err);
    showToast('保存に失敗しました。通信環境を確認してください');
  } finally {
    findEditorBusy = false;
    feSave.disabled = false;
    feSave.textContent = '保存する';
  }
}

// ============================================================
// 確認ダイアログ（カスタムUI）
// ============================================================
function askConfirm(title: string, text: string, action: () => Promise<void>, okLabel = '削除する'): void {
  $('confirm-dialog-title').textContent = title;
  $('confirm-dialog-text').textContent = text;
  $('btn-confirm-ok').textContent = okLabel;
  confirmAction = action;
  openOverlay(confirmOverlay);
}

async function runConfirm(): Promise<void> {
  const action = confirmAction;
  if (!action) return;
  const btn = $<HTMLButtonElement>('btn-confirm-ok');
  btn.disabled = true;
  try {
    await action();
    confirmAction = null;
    closeOverlay(confirmOverlay);
  } catch {
    showToast('処理に失敗しました。もう一度お試しください');
  } finally {
    btn.disabled = false;
  }
}

// ============================================================
// サンプル
// ============================================================
let samplesBusy = false;
async function addSamples(): Promise<void> {
  if (!currentUser || samplesBusy) return;
  samplesBusy = true;
  const btn = $<HTMLButtonElement>('btn-add-samples');
  btn.disabled = true;
  const uid = currentUser.uid;
  const base = { memo: '', status: 'open' as const, clearedAt: null, clearedBy: '' };
  const blankFind = { memo: '', weaponType: '', rating: '' as Rating, ratingNote: '', gotAt: '', thumb: '', photoCount: 0, foundAt: todayStr() };
  try {
    const q1 = await createQuest(uid, {
      ...base, title: '朝のお弁当づくりに時間がかかる', want: 'まとめて作り置きできる保存容器', budget: 2000, places: ['100yen', 'muji', 'home'],
    });
    await createQuest(uid, {
      ...base, title: '机の上でケーブルが絡まる', want: 'ケーブルをまとめて隠せる道具', budget: 1500, places: ['100yen', 'denki'],
    });
    await createFind(uid, { ...blankFind, questId: q1, name: '仕切り付き保存容器 3個セット', price: 330, place: '100yen', shop: '', status: 'candidate' }, []);
    await createFind(uid, { ...blankFind, questId: q1, name: '重なるバルブ付き保存容器', price: 1290, place: 'muji', shop: '', status: 'candidate' }, []);
    track('sample_add');
    showToast('サンプルを追加しました');
  } catch {
    showToast('追加に失敗しました');
  } finally {
    samplesBusy = false;
    btn.disabled = false;
  }
}

// ============================================================
// 認証
// ============================================================
function startSession(user: User): void {
  currentUser = user;
  loginScreen.classList.add('hidden');
  appEl.classList.remove('hidden');
  $('user-info').classList.remove('hidden');
  const avatar = $<HTMLImageElement>('user-avatar');
  if (user.photoURL) {
    avatar.src = user.photoURL;
    avatar.classList.remove('hidden');
  } else {
    avatar.classList.add('hidden');
  }
  $('user-name').textContent = user.displayName ?? '';
  render();

  const onErr = (err: Error) => {
    console.error(err);
    loadingEl.classList.remove('hidden');
    loadingEl.textContent = 'データを読み込めませんでした。ページを再読み込みしてください。';
  };
  unsubs = [
    subscribeQuests(user.uid, (list) => {
      quests = list;
      loaded.quests = true;
      render();
    }, onErr),
    subscribeFinds(user.uid, (list) => {
      finds = list;
      loaded.finds = true;
      render();
    }, onErr),
    subscribeSorties(user.uid, (list) => {
      sorties = list;
      loaded.sorties = true;
      render();
    }, onErr),
  ];
}

function endSession(): void {
  unsubs.forEach((u) => u());
  unsubs = [];
  currentUser = null;
  quests = [];
  finds = [];
  sorties = [];
  loaded.quests = loaded.finds = loaded.sorties = false;
  $('rank-box').classList.add('hidden');
  loadingEl.classList.remove('hidden');
  loadingEl.textContent = '読み込み中…';
  [questDetailOverlay, questEditorOverlay, findDetailOverlay, findEditorOverlay, cropOverlay, discardOverlay, confirmOverlay].forEach(closeOverlay);
  questDetailId = null;
  findDetailId = null;
  appEl.classList.add('hidden');
  loginScreen.classList.remove('hidden');
}

// ============================================================
// イベント
// ============================================================
function switchTab(tab: Tab): void {
  currentTab = tab;
  lsSet(TAB_KEY, tab);
  render();
}

function bindEvents(): void {
  let loginBusy = false;
  $('btn-google-login').addEventListener('click', async () => {
    if (loginBusy) return;
    loginBusy = true;
    try {
      await loginWithGoogle();
      track('login', { method: 'google' });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        showToast('ログインに失敗しました。ポップアップを許可して再度お試しください');
      }
    } finally {
      loginBusy = false;
    }
  });
  $('btn-logout').addEventListener('click', () => {
    logout().catch(() => showToast('ログアウトに失敗しました'));
  });

  document.querySelectorAll<HTMLButtonElement>('.tabs__btn').forEach((b) => {
    b.addEventListener('click', () => switchTab(b.dataset.tab as Tab));
  });

  // クエスト
  $('btn-new-quest').addEventListener('click', () => openQuestEditor(null));
  $('btn-empty-quest').addEventListener('click', () => openQuestEditor(null));
  $('btn-add-samples').addEventListener('click', () => void addSamples());
  $('btn-qd-close').addEventListener('click', closeQuestDetail);
  $('btn-qd-edit').addEventListener('click', () => openQuestEditor(questDetailId));
  $('btn-qd-toggle').addEventListener('click', () => void toggleQuestCleared());
  $('btn-qd-add-find').addEventListener('click', () => {
    const q = questById(questDetailId);
    if (!q) return;
    const place = q.places.find((p) => sortiePlaces.includes(p)) ?? (q.places.length === 1 ? q.places[0] : undefined);
    openFindEditor(null, { questId: q.id, place });
  });
  $('btn-qd-delete').addEventListener('click', () => {
    const q = questById(questDetailId);
    if (!q) return;
    const related = findsOfQuest(q.id);
    askConfirm(
      'クエストを削除しますか？',
      `「${q.title}」を削除します。元に戻せません。${related.length ? `見つけた候補・武器（${related.length}件）は消えずに「クエストなし」として残ります。` : ''}`,
      async () => {
        if (!currentUser) return;
        await deleteQuest(currentUser.uid, q.id, related.map((f) => f.id));
        track('quest_delete');
        closeQuestDetail();
        showToast('削除しました');
      },
    );
  });
  $<HTMLFormElement>('quest-editor-form').addEventListener('submit', (e) => void saveQuestEditor(e));
  $('btn-qe-close').addEventListener('click', requestCloseQuestEditor);
  $('btn-qe-cancel').addEventListener('click', requestCloseQuestEditor);

  // 出撃
  $('btn-sortie-record').addEventListener('click', () => void recordSortie());
  $('btn-lucky-find').addEventListener('click', () => openFindEditor(null, { questId: '' }));

  // 候補
  $('btn-fd-close').addEventListener('click', closeFindDetail);
  $('btn-fd-edit').addEventListener('click', () => openFindEditor(findDetailId));
  $('fd-quest').addEventListener('click', () => {
    const f = findById(findDetailId);
    if (!f || !questById(f.questId)) return;
    closeFindDetail();
    openQuestDetail(f.questId);
  });
  $('btn-fd-delete').addEventListener('click', () => {
    const f = findById(findDetailId);
    if (!f) return;
    askConfirm('削除しますか？', `「${f.name}」と、写真・評価・メモを削除します。元に戻せません。`, async () => {
      if (!currentUser) return;
      await deleteFind(currentUser.uid, f.id);
      track('find_delete');
      closeFindDetail();
      showToast('削除しました');
    });
  });
  $<HTMLFormElement>('find-editor-form').addEventListener('submit', (e) => void saveFindEditor(e));
  $('btn-fe-close').addEventListener('click', requestCloseFindEditor);
  $('btn-fe-cancel').addEventListener('click', requestCloseFindEditor);
  photoInput.addEventListener('change', () => void onPhotoSelected());

  // 破棄確認
  $('btn-discard-cancel').addEventListener('click', () => {
    discardTarget = null;
    closeOverlay(discardOverlay);
  });
  $('btn-discard-ok').addEventListener('click', () => {
    closeOverlay(discardOverlay);
    if (discardTarget === 'quest') closeQuestEditor();
    else if (discardTarget === 'find') closeFindEditor();
    discardTarget = null;
  });

  // 確認ダイアログ
  $('btn-confirm-cancel').addEventListener('click', () => {
    confirmAction = null;
    closeOverlay(confirmOverlay);
  });
  $('btn-confirm-ok').addEventListener('click', () => void runConfirm());

  // 背景クリック・Escで閉じる（上に重なっているものから）
  const closers: [HTMLElement, () => void][] = [
    [confirmOverlay, () => { confirmAction = null; closeOverlay(confirmOverlay); }],
    [discardOverlay, () => { discardTarget = null; closeOverlay(discardOverlay); }],
    [cropOverlay, cancelCropper],
    [findEditorOverlay, requestCloseFindEditor],
    [questEditorOverlay, requestCloseQuestEditor],
    [findDetailOverlay, closeFindDetail],
    [questDetailOverlay, closeQuestDetail],
    [feedbackOverlay, () => closeOverlay(feedbackOverlay)],
  ];
  closers.forEach(([overlay, close]) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.isComposing) return;
    const top = closers.find(([o]) => o.classList.contains('is-open'));
    top?.[1]();
  });

  // フィードバック
  const fbInput = $<HTMLTextAreaElement>('input-feedback-message');
  const fbSend = $<HTMLButtonElement>('btn-feedback-send');
  $('feedback-btn').addEventListener('click', () => openOverlay(feedbackOverlay));
  $('btn-feedback-close').addEventListener('click', () => closeOverlay(feedbackOverlay));
  let fbBusy = false;
  fbSend.addEventListener('click', async () => {
    const message = fbInput.value.trim();
    if (!message) {
      showToast('内容を入力してください');
      return;
    }
    if (fbBusy) return;
    fbBusy = true;
    fbSend.disabled = true;
    fbSend.textContent = '送信中…';
    const ok = await submitFeedback(message);
    fbBusy = false;
    fbSend.disabled = false;
    fbSend.textContent = '送信する';
    if (ok) {
      fbInput.value = '';
      closeOverlay(feedbackOverlay);
      showToast('送信しました。ありがとうございます');
      track('feedback_send');
    } else {
      showToast('送信に失敗しました。時間をおいて再度お試しください');
    }
  });
}

bindEvents();
initTextareas();
onAuthChange((user) => {
  if (user) {
    if (currentUser?.uid !== user.uid) {
      if (currentUser) endSession();
      startSession(user);
    }
  } else if (currentUser) {
    endSession();
  }
});
