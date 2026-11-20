import { openDatabase } from "../db/connection";
import { createApp } from "./actions";
import { useStore as useSlice } from "./store";
import type { AppState } from "./appState";

/** The single app instance (store + actions) used by the UI. */
export const { store, actions } = createApp(openDatabase);

export const useApp = <T,>(selector: (s: AppState) => T): T => useSlice(store, selector);
