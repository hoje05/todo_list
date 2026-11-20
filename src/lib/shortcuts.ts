/** App-wide commands raised by keyboard shortcuts and handled by the active view. */
export type Command = "new" | "find";

const EVENT = "desktodo:command";

export function emitCommand(command: Command) {
  window.dispatchEvent(new CustomEvent<Command>(EVENT, { detail: command }));
}

export function onCommand(handler: (command: Command) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<Command>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

export function isTextField(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && (el as HTMLInputElement).type !== "checkbox");
}
