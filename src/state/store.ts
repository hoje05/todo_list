import { useSyncExternalStore } from "react";

export interface Store<S> {
  get(): S;
  set(update: (s: S) => S): void;
  subscribe(listener: () => void): () => void;
}

/** Minimal observable store; components subscribe to slices with `useStore`. */
export function createStore<S>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(update) {
      const next = update(state);
      if (next === state) return;
      state = next;
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** `selector` must return an existing reference (a slice), not a new object. */
export function useStore<S, T>(store: Store<S>, selector: (s: S) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}
