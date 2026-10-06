const DATABASE_NAME = "smartrec-upload-recovery";
const STORE_NAME = "file-handles";
const DATABASE_VERSION = 1;

const openDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open IndexedDB"));
  });

const withStore = async <T>(
  mode: IDBTransactionMode,
  operation: string,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  let database: IDBDatabase | undefined;
  try {
    database = await openDatabase();
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      let result: T;
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    });
  } catch (error) {
    console.error("[file-handle-storage:operation-failed]", {
      operation,
      name: (error as Error)?.name || "Error",
      message: (error as Error)?.message || String(error),
    });
    throw error;
  } finally {
    database?.close();
  }
};

export const saveFileHandle = (recoveryKey: string, fileHandle: FileSystemFileHandle) =>
  withStore<IDBValidKey>("readwrite", "put", (store) => store.put(fileHandle, recoveryKey));

export const getFileHandle = (recoveryKey: string) =>
  withStore<FileSystemFileHandle | undefined>("readonly", "get", (store) => store.get(recoveryKey));

export const removeFileHandle = (recoveryKey: string) =>
  withStore<undefined>("readwrite", "delete", (store) => store.delete(recoveryKey));

export const clearInvalidHandle = removeFileHandle;

export const listStoredFileHandles = async () => {
  const database = await openDatabase();
  try {
    return await new Promise<Array<{ key: IDBValidKey; name: string }>>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const keysRequest = store.getAllKeys();
      const valuesRequest = store.getAll();
      transaction.oncomplete = () => {
        const values = valuesRequest.result as FileSystemFileHandle[];
        resolve(keysRequest.result.map((key, index) => ({
          key,
          name: values[index]?.name || "",
        })));
      };
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
    });
  } finally {
    database.close();
  }
};
