import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { addDays } from "../lib/dates";
import { onCommand } from "../lib/shortcuts";
import { countTasks, selectVisibleTasks } from "../lib/taskLogic";
import { useImeSafeSubmit } from "../lib/useImeSafeSubmit";
import { useToday } from "../lib/useToday";
import { actions, useApp } from "../state/app";
import type { Filter, Task } from "../types";
import { CheckIcon, CloseIcon, PlusIcon, SearchIcon } from "./Icons";
import { TaskEditor } from "./TaskEditor";
import { TaskItem } from "./TaskItem";
import { EmptyState, IconButton } from "./ui";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "today", label: "오늘" },
  { value: "upcoming", label: "예정" },
  { value: "completed", label: "완료" },
];

const EMPTY: Record<Filter, { title: string; hint: string }> = {
  all: { title: "할 일이 없습니다", hint: "아래 입력창에 할 일을 적고 Enter를 누르세요." },
  today: { title: "오늘 마감인 할 일이 없습니다", hint: "여기서 추가하면 오늘 마감으로 등록됩니다." },
  upcoming: { title: "예정된 할 일이 없습니다", hint: "마감일을 지정하면 이곳에 표시됩니다." },
  completed: { title: "완료한 할 일이 없습니다", hint: "체크한 할 일이 여기에 모입니다." },
};

export function TaskView() {
  const tasks = useApp((s) => s.tasks);
  const plans = useApp((s) => s.plans);
  const filter = useApp((s) => s.settings.filter);
  const sort = useApp((s) => s.settings.sort);
  const today = useToday();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dragId = useRef<string | null>(null);

  const { active, done } = useMemo(
    () => selectVisibleTasks(tasks, filter, sort, today, searchOpen ? query : ""),
    [tasks, filter, sort, today, query, searchOpen],
  );
  const counts = useMemo(() => countTasks(tasks, today), [tasks, today]);
  const planTitles = useMemo(() => new Map(plans.map((p) => [p.id, p.title])), [plans]);
  const editing = editingId ? tasks.find((t) => t.id === editingId) : undefined;
  const canReorder = sort === "manual" && filter !== "upcoming";

  useEffect(
    () =>
      onCommand((cmd) => {
        if (cmd === "new") {
          setEditingId(null);
          requestAnimationFrame(() => addRef.current?.focus());
        } else {
          setSearchOpen(true);
          requestAnimationFrame(() => searchRef.current?.select());
        }
      }),
    [],
  );

  const closeEditor = useCallback(() => {
    setEditingId(null);
    requestAnimationFrame(() => addRef.current?.focus());
  }, []);

  const submitProps = useImeSafeSubmit(() => {
    const input = addRef.current;
    if (!input) return;
    const dueDate = filter === "today" ? today : filter === "upcoming" ? addDays(today, 1) : null;
    if (actions.addTask(input.value, { dueDate })) {
      input.value = "";
      if (filter === "completed") actions.setSetting("filter", "all");
    }
    input.focus();
  });

  // ----- Reordering (event delegation: rows stay dumb and memoized) -----
  function rowOf(target: EventTarget): HTMLLIElement | null {
    return (target as HTMLElement).closest?.("li[data-id]") ?? null;
  }
  function clearDropMarks(ul: HTMLElement) {
    ul.querySelectorAll(".drop-before,.drop-after").forEach((el) => el.classList.remove("drop-before", "drop-after"));
  }
  function onDragStart(e: DragEvent<HTMLUListElement>) {
    const li = rowOf(e.target);
    if (!li || !canReorder) return;
    dragId.current = li.dataset.id ?? null;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", li.dataset.id ?? "");
  }
  function onDragOver(e: DragEvent<HTMLUListElement>) {
    const li = rowOf(e.target);
    if (!dragId.current || !li || !active.some((t) => t.id === li.dataset.id)) return;
    e.preventDefault();
    const rect = li.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    if (!li.classList.contains(before ? "drop-before" : "drop-after")) {
      clearDropMarks(e.currentTarget);
      li.classList.add(before ? "drop-before" : "drop-after");
    }
  }
  function onDrop(e: DragEvent<HTMLUListElement>) {
    e.preventDefault();
    const li = rowOf(e.target);
    const id = dragId.current;
    clearDropMarks(e.currentTarget);
    dragId.current = null;
    if (!li || !id) return;
    const from = active.findIndex((t) => t.id === id);
    const over = active.findIndex((t) => t.id === li.dataset.id);
    if (from < 0 || over < 0) return;
    const rect = li.getBoundingClientRect();
    const insertAt = e.clientY < rect.top + rect.height / 2 ? over : over + 1;
    actions.moveTask(id, insertAt > from ? insertAt - 1 : insertAt, active);
  }
  function onDragEnd(e: DragEvent<HTMLUListElement>) {
    dragId.current = null;
    clearDropMarks(e.currentTarget);
  }

  function onListKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    const li = rowOf(e.target);
    if (!li?.dataset.id || (e.target as HTMLElement).tagName === "INPUT") return;
    const id = li.dataset.id;
    if (e.key === "Delete") {
      e.preventDefault();
      const next = li.nextElementSibling ?? li.previousElementSibling;
      actions.deleteTask(id);
      (next?.querySelector("[data-row-main]") as HTMLElement | null)?.focus();
    } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const idx = active.findIndex((t) => t.id === id);
      if (idx >= 0 && canReorder) actions.moveTask(id, idx + (e.key === "ArrowUp" ? -1 : 1), active);
    } else if (!e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const rows = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-row-main]")];
      const i = rows.findIndex((r) => r.closest("li") === li);
      rows[i + (e.key === "ArrowUp" ? -1 : 1)]?.focus();
    }
  }

  const renderRows = (list: Task[], reorder: boolean) =>
    list.map((t) => (
      <TaskItem
        key={t.id}
        task={t}
        today={today}
        planTitle={t.planId ? planTitles.get(t.planId) : undefined}
        draggable={reorder}
        onEdit={setEditingId}
      />
    ));

  const empty = active.length === 0 && done.length === 0;

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 px-2 pt-2 pb-1">
        <div role="tablist" aria-label="필터" className="flex min-w-0 flex-1 gap-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={filter === f.value}
              onClick={() => actions.setSetting("filter", f.value)}
              className={`flex min-w-0 items-center gap-1 rounded-full px-2 py-1 text-xs whitespace-nowrap transition-colors ${
                filter === f.value ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-surface-2 hover:text-fg"
              }`}
            >
              {f.label}
              <span className="text-[10px] tabular-nums opacity-70">{counts[f.value]}</span>
            </button>
          ))}
        </div>
        <IconButton
          label="검색 (Ctrl+F)"
          active={searchOpen}
          onClick={() => {
            setSearchOpen((o) => !o);
            requestAnimationFrame(() => searchRef.current?.focus());
          }}
        >
          <SearchIcon width={15} height={15} />
        </IconButton>
      </div>

      {searchOpen && (
        <div className="mx-2 mb-1 flex shrink-0 items-center gap-1 rounded-md border border-line bg-surface px-2">
          <SearchIcon width={13} height={13} className="shrink-0 text-muted" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setQuery("");
                setSearchOpen(false);
                addRef.current?.focus();
              }
            }}
            placeholder="할 일 검색"
            aria-label="할 일 검색"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] outline-none placeholder:text-muted/70"
          />
          {query && (
            <button type="button" aria-label="검색어 지우기" className="text-muted hover:text-fg" onClick={() => setQuery("")}>
              <CloseIcon width={13} height={13} />
            </button>
          )}
        </div>
      )}

      <div className="scroll-area min-h-0 flex-1 px-1.5 pb-2">
        {empty ? (
          query && searchOpen ? (
            <EmptyState icon={<SearchIcon />} title="검색 결과가 없습니다" hint={`'${query}'와 일치하는 할 일이 없습니다.`} />
          ) : (
            <EmptyState icon={<CheckIcon />} {...EMPTY[filter]} />
          )
        ) : (
          <ul
            aria-label="할 일 목록"
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragEnd={onDragEnd}
            onKeyDown={onListKeyDown}
          >
            {renderRows(active, canReorder)}
            {done.length > 0 && filter === "all" && (
              <li className="px-2 pt-3 pb-1 text-[11px] font-medium text-muted" aria-hidden="true">
                완료됨 · {done.length}
              </li>
            )}
            {renderRows(done, false)}
          </ul>
        )}
      </div>

      <form {...submitProps} className="flex shrink-0 items-center gap-1.5 border-t border-line bg-surface px-2 py-2">
        <input
          id="quick-add"
          ref={addRef}
          autoFocus
          maxLength={200}
          placeholder={filter === "today" ? "오늘 할 일 추가 (Enter)" : "할 일 추가 (Enter)"}
          aria-label="새 할 일"
          className="min-w-0 flex-1 rounded-md bg-surface-2 px-2.5 py-1.5 text-[13px] outline-none placeholder:text-muted/80 focus:ring-1 focus:ring-accent"
        />
        <button
          type="submit"
          aria-label="할 일 추가"
          title="할 일 추가 (Ctrl+N)"
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-white hover:brightness-110"
        >
          <PlusIcon />
        </button>
      </form>

      {editing && <TaskEditor key={editing.id} task={editing} onClose={closeEditor} />}
    </div>
  );
}
