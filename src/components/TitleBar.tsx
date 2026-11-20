import { actions, useApp } from "../state/app";
import { closeWindow, minimizeWindow } from "../lib/window";
import { CloseIcon, GearIcon, LogoIcon, MinusIcon, PinIcon } from "./Icons";
import { IconButton } from "./ui";

/**
 * Custom title bar. Only the elements carrying `data-tauri-drag-region` start a
 * native window drag (handled entirely by the OS — no JS runs while moving).
 * Buttons don't carry the attribute, so they never trigger dragging.
 */
export function TitleBar({ onSettings, settingsOpen }: { onSettings: () => void; settingsOpen: boolean }) {
  const alwaysOnTop = useApp((s) => s.settings.alwaysOnTop);
  return (
    <header
      data-tauri-drag-region
      className="flex h-9 shrink-0 items-center gap-0.5 border-b border-line bg-surface pr-1 pl-3"
    >
      <LogoIcon className="pointer-events-none mr-2" />
      <span data-tauri-drag-region className="flex-1 truncate text-[13px] font-semibold tracking-tight">
        DeskTodo
      </span>
      <IconButton
        label={alwaysOnTop ? "항상 위에 표시 끄기" : "항상 위에 표시"}
        active={alwaysOnTop}
        onClick={() => actions.setSetting("alwaysOnTop", !alwaysOnTop)}
      >
        <PinIcon className={alwaysOnTop ? "" : "rotate-45"} width={15} height={15} />
      </IconButton>
      <IconButton label="설정" active={settingsOpen} onClick={onSettings}>
        <GearIcon width={15} height={15} />
      </IconButton>
      <IconButton label="최소화" onClick={minimizeWindow}>
        <MinusIcon />
      </IconButton>
      <IconButton label="닫기" danger onClick={closeWindow}>
        <CloseIcon />
      </IconButton>
    </header>
  );
}
