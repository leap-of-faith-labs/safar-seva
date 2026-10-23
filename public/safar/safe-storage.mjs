// Accessing window.localStorage itself can throw in embedded and private browsers.
export function createSafeStorage(access = () => window.localStorage, onUnavailable = () => {}) {
  const memory = new Map();
  let persistent = true;
  const failed = () => {
    if (persistent) {
      persistent = false;
      onUnavailable();
    }
  };
  return {
    get persistent() {
      return persistent;
    },
    getItem(key) {
      if (persistent) {
        try {
          const value = access().getItem(key);
          if (value !== null) memory.set(key, value);
          else memory.delete(key);
          return value;
        } catch {
          failed();
        }
      }
      return memory.get(key) ?? null;
    },
    setItem(key, value) {
      memory.set(key, String(value));
      if (persistent) {
        try {
          access().setItem(key, String(value));
        } catch {
          failed();
        }
      }
      return persistent;
    },
    removeItem(key) {
      memory.delete(key);
      if (persistent) {
        try {
          access().removeItem(key);
        } catch {
          failed();
        }
      }
      return persistent;
    },
  };
}
