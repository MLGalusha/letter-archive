/** Transient page progress stays outside React's selected-page state. */
export function createPageMotion() {
  let position: number | null = null;
  const listeners = new Set<(value: number | null) => void>();
  return {
    get: () => position,
    publish(value: number | null) {
      position = value;
      listeners.forEach(listener => listener(value));
    },
    subscribe(listener: (value: number | null) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
export type PageMotion = ReturnType<typeof createPageMotion>;
