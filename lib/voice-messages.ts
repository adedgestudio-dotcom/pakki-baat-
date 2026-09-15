const DB_NAME = "pakki-baat-voice-v1";
const STORE_NAME = "notes";

function openVoiceDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("This browser cannot save voice notes."));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Voice storage unavailable."));
  });
}

export async function saveVoice(id: string, file: File): Promise<void> {
  const db = await openVoiceDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(file, id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Voice note could not be saved."));
      transaction.onabort = () => reject(transaction.error || new Error("Voice note could not be saved."));
    });
  } finally {
    db.close();
  }
}

export async function loadVoice(id: string): Promise<File | undefined> {
  const db = await openVoiceDb();
  try {
    return await new Promise<File | undefined>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id);
      request.onsuccess = () => {
        const value = request.result;
        if (value instanceof File) resolve(value);
        else if (value instanceof Blob) resolve(new File([value], "pakki-baat-voice-note", { type: value.type }));
        else resolve(undefined);
      };
      request.onerror = () => reject(request.error || new Error("Voice note could not be loaded."));
    });
  } finally {
    db.close();
  }
}

export async function deleteVoice(id: string): Promise<void> {
  const db = await openVoiceDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Voice note could not be deleted."));
    });
  } finally {
    db.close();
  }
}