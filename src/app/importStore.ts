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

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return db().then(d => new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

/** keep an import (song + original file). Asks the browser not to evict our storage. */
export async function saveImport(song: Song, file: Blob) {
  await run(AUDIO, 'readwrite', s => s.put(file, song.id));
  await run(SONGS, 'readwrite', s => s.put({ id: song.id, song, savedAt: Date.now() }));
  void navigator.storage?.persist?.().catch(() => {});
}

/** every saved import's song data, oldest first */
export async function loadImports(): Promise<Song[]> {
  const rows = (await run<{ id: string; song: Song; savedAt: number }[]>(SONGS, 'readonly', s => s.getAll())) ?? [];
  return rows.sort((a, b) => a.savedAt - b.savedAt).map(r => r.song);
}

/** the original audio file of an import */
export async function loadImportAudio(id: string): Promise<ArrayBuffer | null> {
  const blob = await run<Blob>(AUDIO, 'readonly', s => s.get(id));
  return blob ? blob.arrayBuffer() : null;
}

export async function removeImport(id: string) {
  await run(SONGS, 'readwrite', s => s.delete(id));
  await run(AUDIO, 'readwrite', s => s.delete(id));
}
