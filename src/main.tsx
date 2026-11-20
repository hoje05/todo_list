import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyCachedTheme } from "./lib/theme";
import { installCloseGuard, installProductionGuards } from "./lib/window";
import { actions, store } from "./state/app";
import "./index.css";

applyCachedTheme();
installProductionGuards();
installCloseGuard(actions.flush, () => store.set((s) => ({ ...s, closeBlocked: true })));
void actions.init();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
