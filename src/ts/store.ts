import {
  collection, doc, onSnapshot, updateDoc, getDoc, setDoc, writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { PLACE_IDS, WEAPON_TYPE_IDS } from './data';
import { Find, FindData, FindStatus, Quest, QuestData, QuestStatus, Rating, Sortie } from './types';
import { isSafeImageDataUrl, MAX_PHOTO_CHARS, MAX_THUMB_CHARS } from './image';

export const MAX_TITLE = 60;
export const MAX_WANT = 200;
export const MAX_NAME = 60;
export const MAX_SHOP = 40;
export const MAX_MEMO = 2000;
export const MAX_RATING_NOTE = 500;
export const MAX_PHOTOS = 1;
export const MAX_PRICE = 99_999_999;

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const msOrNull = (v: unknown): number | null => (typeof v === 'number' && v > 0 ? v : null);

const QUEST_STATUSES: QuestStatus[] = ['open', 'cleared'];
export const FIND_STATUSES: FindStatus[] = ['candidate', 'got', 'passed'];
const RATINGS: Rating[] = ['', 'hit', 'ok', 'miss'];

const safeQuestStatus = (v: unknown): QuestStatus => (QUEST_STATUSES.includes(v as QuestStatus) ? (v as QuestStatus) : 'open');
export const safeFindStatus = (v: unknown): FindStatus => (FIND_STATUSES.includes(v as FindStatus) ? (v as FindStatus) : 'candidate');
export const safeRating = (v: unknown): Rating => (RATINGS.includes(v as Rating) ? (v as Rating) : '');
const safePlace = (v: unknown): string => (typeof v === 'string' && PLACE_IDS.includes(v) ? v : '');
export const safeWeaponType = (v: unknown): string => (typeof v === 'string' && WEAPON_TYPE_IDS.includes(v) ? v : '');

function safePlaces(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  v.forEach((p) => {
    const id = safePlace(p);
    if (id && !out.includes(id)) out.push(id);
  });
  return out;
}

export function safeDate(v: unknown): string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}

/** 0〜上限の整数（円）だけを受け付ける。それ以外は未入力扱い */
export function safePrice(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_PRICE ? Math.floor(v) : null;
}

const safeId = (v: unknown): string => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : '');

function sanitizeQuest(d: QuestData): QuestData {
  return {
    title: d.title.trim().slice(0, MAX_TITLE),
    want: d.want.trim().slice(0, MAX_WANT),
    budget: safePrice(d.budget),
    places: safePlaces(d.places),
    memo: d.memo.slice(0, MAX_MEMO),
    status: safeQuestStatus(d.status),
    clearedAt: d.status === 'cleared' ? msOrNull(d.clearedAt) ?? Date.now() : null,
    clearedBy: d.status === 'cleared' ? safeId(d.clearedBy) : '',
  };
}

function sanitizeFind(d: FindData): FindData {
  return {
    questId: safeId(d.questId),
    name: d.name.trim().slice(0, MAX_NAME),
    price: safePrice(d.price),
    place: safePlace(d.place),
    shop: d.shop.trim().slice(0, MAX_SHOP),
    memo: d.memo.slice(0, MAX_MEMO),
    status: safeFindStatus(d.status),
    weaponType: safeWeaponType(d.weaponType),
    rating: safeRating(d.rating),
    ratingNote: d.ratingNote.trim().slice(0, MAX_RATING_NOTE),
    foundAt: safeDate(d.foundAt),
    gotAt: safeDate(d.gotAt),
    thumb: isSafeImageDataUrl(d.thumb, MAX_THUMB_CHARS) ? d.thumb : '',
    photoCount: Math.max(0, Math.min(MAX_PHOTOS, Math.floor(d.photoCount) || 0)),
  };
}

// ============================================================
// Quests
// ============================================================
const questsCol = (uid: string) => collection(db, 'users', uid, 'quests');
const questDoc = (uid: string, id: string) => doc(db, 'users', uid, 'quests', id);

export function subscribeQuests(uid: string, onData: (list: Quest[]) => void, onError: (err: Error) => void): () => void {
  return onSnapshot(questsCol(uid), (snap) => {
    const list: Quest[] = [];
    snap.forEach((d) => {
      const data = d.data();
      const createdAt = msOrNull(data.createdAt);
      const title = str(data.title, MAX_TITLE).trim();
      if (!createdAt || !title) return;
      const status = safeQuestStatus(data.status);
      list.push({
        id: d.id,
        title,
        want: str(data.want, MAX_WANT),
        budget: safePrice(data.budget),
        places: safePlaces(data.places),
        memo: str(data.memo, MAX_MEMO),
        status,
        clearedAt: status === 'cleared' ? msOrNull(data.clearedAt) : null,
        clearedBy: safeId(data.clearedBy),
        createdAt,
        updatedAt: msOrNull(data.updatedAt) ?? createdAt,
      });
    });
    onData(list);
  }, onError);
}

export async function createQuest(uid: string, data: QuestData): Promise<string> {
  const now = Date.now();
  const ref = doc(questsCol(uid));
  await setDoc(ref, { ...sanitizeQuest(data), createdAt: now, updatedAt: now });
  return ref.id;
}

export function updateQuest(uid: string, id: string, data: QuestData): Promise<void> {
  return updateDoc(questDoc(uid, id), { ...sanitizeQuest(data), updatedAt: Date.now() });
}

/** クエストのクリア／探索に戻す */
export function setQuestStatus(uid: string, id: string, status: QuestStatus, clearedBy = ''): Promise<void> {
  const cleared = status === 'cleared';
  return updateDoc(questDoc(uid, id), {
    status: safeQuestStatus(status),
    clearedAt: cleared ? Date.now() : null,
    clearedBy: cleared ? safeId(clearedBy) : '',
    updatedAt: Date.now(),
  });
}

export function updateQuestMemo(uid: string, id: string, memo: string): Promise<void> {
  return updateDoc(questDoc(uid, id), { memo: memo.slice(0, MAX_MEMO), updatedAt: Date.now() });
}

/** クエストを削除する。ひもづく候補・武器は消さずに「クエストなし」に戻す */
export async function deleteQuest(uid: string, id: string, findIds: string[]): Promise<void> {
  for (let i = 0; i < findIds.length; i += 400) {
    const batch = writeBatch(db);
    findIds.slice(i, i + 400).forEach((fid) => batch.update(findDoc(uid, fid), { questId: '' }));
    await batch.commit();
  }
  const batch = writeBatch(db);
  batch.delete(questDoc(uid, id));
  await batch.commit();
}

// ============================================================
// Finds（候補・武器）
// ============================================================
const findsCol = (uid: string) => collection(db, 'users', uid, 'finds');
const findDoc = (uid: string, id: string) => doc(db, 'users', uid, 'finds', id);
const photosDoc = (uid: string, id: string) => doc(db, 'users', uid, 'findPhotos', id);

export function subscribeFinds(uid: string, onData: (list: Find[]) => void, onError: (err: Error) => void): () => void {
  return onSnapshot(findsCol(uid), (snap) => {
    const list: Find[] = [];
    snap.forEach((d) => {
      const data = d.data();
      const createdAt = msOrNull(data.createdAt);
      const name = str(data.name, MAX_NAME).trim();
      if (!createdAt || !name) return;
      list.push({
        id: d.id,
        questId: safeId(data.questId),
        name,
        price: safePrice(data.price),
        place: safePlace(data.place),
        shop: str(data.shop, MAX_SHOP),
        memo: str(data.memo, MAX_MEMO),
        status: safeFindStatus(data.status),
        weaponType: safeWeaponType(data.weaponType),
        rating: safeRating(data.rating),
        ratingNote: str(data.ratingNote, MAX_RATING_NOTE),
        foundAt: safeDate(data.foundAt),
        gotAt: safeDate(data.gotAt),
        thumb: isSafeImageDataUrl(data.thumb, MAX_THUMB_CHARS) ? data.thumb : '',
        photoCount: typeof data.photoCount === 'number' ? Math.max(0, Math.min(MAX_PHOTOS, Math.floor(data.photoCount))) : 0,
        createdAt,
        updatedAt: msOrNull(data.updatedAt) ?? createdAt,
      });
    });
    onData(list);
  }, onError);
}

export async function createFind(uid: string, data: FindData, photos: string[]): Promise<string> {
  const now = Date.now();
  const ref = doc(findsCol(uid));
  const batch = writeBatch(db);
  const clean = photos.filter((p) => isSafeImageDataUrl(p, MAX_PHOTO_CHARS)).slice(0, MAX_PHOTOS);
  batch.set(ref, { ...sanitizeFind({ ...data, photoCount: clean.length }), createdAt: now, updatedAt: now });
  if (clean.length) batch.set(photosDoc(uid, ref.id), { photos: clean });
  await batch.commit();
  return ref.id;
}

/** 基本情報と写真をまとめて更新する（photos が null のときは写真に触らない） */
export async function updateFind(uid: string, id: string, data: FindData, photos: string[] | null): Promise<void> {
  const batch = writeBatch(db);
  if (photos) {
    const clean = photos.filter((p) => isSafeImageDataUrl(p, MAX_PHOTO_CHARS)).slice(0, MAX_PHOTOS);
    batch.update(findDoc(uid, id), { ...sanitizeFind({ ...data, photoCount: clean.length }), updatedAt: Date.now() });
    if (clean.length) batch.set(photosDoc(uid, id), { photos: clean });
    else batch.delete(photosDoc(uid, id));
  } else {
    batch.update(findDoc(uid, id), { ...sanitizeFind(data), updatedAt: Date.now() });
  }
  await batch.commit();
}

export interface FindPatch {
  status?: FindStatus;
  gotAt?: string;
  weaponType?: string;
  rating?: Rating;
  ratingNote?: string;
  memo?: string;
}

/** 状態・種類・評価・メモだけをすばやく変える（詳細画面のボタン用） */
export function patchFind(uid: string, id: string, patch: FindPatch): Promise<void> {
  const data: Record<string, unknown> = { updatedAt: Date.now() };
  if (patch.status !== undefined) data.status = safeFindStatus(patch.status);
  if (patch.gotAt !== undefined) data.gotAt = safeDate(patch.gotAt);
  if (patch.weaponType !== undefined) data.weaponType = safeWeaponType(patch.weaponType);
  if (patch.rating !== undefined) data.rating = safeRating(patch.rating);
  if (patch.ratingNote !== undefined) data.ratingNote = patch.ratingNote.trim().slice(0, MAX_RATING_NOTE);
  if (patch.memo !== undefined) data.memo = patch.memo.slice(0, MAX_MEMO);
  return updateDoc(findDoc(uid, id), data);
}

export async function deleteFind(uid: string, id: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(findDoc(uid, id));
  batch.delete(photosDoc(uid, id));
  await batch.commit();
}

export async function loadPhotos(uid: string, id: string): Promise<string[]> {
  const snap = await getDoc(photosDoc(uid, id));
  if (!snap.exists()) return [];
  const photos = snap.data().photos;
  if (!Array.isArray(photos)) return [];
  return photos.filter((p): p is string => isSafeImageDataUrl(p, MAX_PHOTO_CHARS)).slice(0, MAX_PHOTOS);
}

// ============================================================
// Sorties（出撃）
// ============================================================
const sortiesCol = (uid: string) => collection(db, 'users', uid, 'sorties');

export function subscribeSorties(uid: string, onData: (list: Sortie[]) => void, onError: (err: Error) => void): () => void {
  return onSnapshot(sortiesCol(uid), (snap) => {
    const list: Sortie[] = [];
    snap.forEach((d) => {
      const data = d.data();
      const date = safeDate(data.date);
      const createdAt = msOrNull(data.createdAt);
      if (!date || !createdAt) return;
      list.push({ id: d.id, date, places: safePlaces(data.places), createdAt });
    });
    list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    onData(list);
  }, onError);
}

/** その日の出撃を記録する（同じ日は1件にまとめ、行き先を上書きする） */
export function saveSortie(uid: string, date: string, places: string[], createdAt?: number): Promise<void> {
  const d = safeDate(date);
  if (!d) return Promise.reject(new Error('日付が正しくありません'));
  return setDoc(doc(db, 'users', uid, 'sorties', d), { date: d, places: safePlaces(places), createdAt: createdAt ?? Date.now() });
}

export function deleteSortie(uid: string, id: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'users', uid, 'sorties', id));
  return batch.commit();
}
