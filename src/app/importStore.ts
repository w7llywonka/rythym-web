// Imported songs live on this computer only (IndexedDB): the song + its analysis in one store, the
// original audio file in another (read only when the song is played). Nothing is uploaded.
import type { Song } from '../types.ts';

const DB_NAME = 'lineRush.imports';
const SONGS = 'songs', AUDIO = 'audio';

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(SONGS)) d.createObjectStore(SONGS, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(AUDIO)) d.createObjectStore(AUDIO);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function run<T>(stores: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  return db().then(d => new Promise((resolve, reject) => {
    const tx = d.transaction(stores, mode);
    const req = fn(tx);
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

/** saves still being written, by id: removing an import waits for its save so the save can't land after it */
const saving = new Map<string, Promise<unknown>>();

/** keep an import (song + original file). Asks the browser not to evict our storage. */
export async function saveImport(song: Song, file: Blob) {
  // one transaction for both, so there's never a song without its audio (or the other way round)
  const done = run([SONGS, AUDIO], 'readwrite', tx => {
    tx.objectStore(AUDIO).put(file, song.id);
    tx.objectStore(SONGS).put({ id: song.id, song, savedAt: Date.now() });
  });
  saving.set(song.id, done);
  try { await done; } finally { if (saving.get(song.id) === done) saving.delete(song.id); }
  void navigator.storage?.persist?.().catch(() => {});
}

/** every saved import's song data, oldest first */
export async function loadImports(): Promise<Song[]> {
  const rows = (await run<{ id: string; song: Song; savedAt: number }[]>([SONGS], 'readonly', tx => tx.objectStore(SONGS).getAll())) ?? [];
  return rows.sort((a, b) => a.savedAt - b.savedAt).map(r => r.song);
}

/** the original audio file of an import */
export async function loadImportAudio(id: string): Promise<ArrayBuffer | null> {
  const blob = await run<Blob>([AUDIO], 'readonly', tx => tx.objectStore(AUDIO).get(id));
  return blob ? blob.arrayBuffer() : null;
}

export async function removeImport(id: string) {
  await saving.get(id)?.catch(() => {});
  await run([SONGS, AUDIO], 'readwrite', tx => {
    tx.objectStore(SONGS).delete(id);
    tx.objectStore(AUDIO).delete(id);
  });
}
