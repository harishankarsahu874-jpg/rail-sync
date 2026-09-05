import { useCallback, useEffect, useState } from 'react';

/** Small localStorage-backed list used for recent train searches. */
export function useLocalList(key, max = 8) {
  const [items, setItems] = useState(() => {
    try {
      const value = JSON.parse(window.localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try { window.localStorage.setItem(key, JSON.stringify(items)); } catch {}
  }, [key, items]);

  const add = useCallback((item) => {
    setItems((previous) => [
      item,
      ...previous.filter((row) => row.number !== item.number),
    ].slice(0, max));
  }, [max]);

  const remove = useCallback((number) => {
    setItems((previous) => previous.filter((row) => row.number !== number));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  return { items, add, remove, clear };
}
