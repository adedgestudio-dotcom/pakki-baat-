"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

export type SelectMenuOption = { value: string; label: string; group?: string; disabled?: boolean };
export function groupSelectOptions(options: readonly SelectMenuOption[]) {
  const groups: { label: string | undefined; options: SelectMenuOption[] }[] = [];
  for (const option of options) {
    let group = groups.find(item => item.label === option.group);
    if (!group) { group = { label: option.group, options: [] }; groups.push(group); }
    group.options.push(option);
  }
  return groups;
}

export default function SelectMenu({ value, onChange, options, placeholder = "Choose…", disabled, "aria-label": label }: {
  value: string; onChange: (value: string) => void; options: SelectMenuOption[]; placeholder?: string; disabled?: boolean; "aria-label": string;
}) {
  const [open, setOpen] = useState(false), [active, setActive] = useState(value);
  const [geometry, setGeometry] = useState({ left: 0, top: 0, width: 0, maxHeight: 320 });
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const rows = groupSelectOptions(options).flatMap(group => group.options);
  const activeIndex = rows.findIndex(row => row.value === active);
  const chosen = options.find(option => option.value === value);
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const rect = trigger.current?.getBoundingClientRect(); if (!rect) return;
      const margin = 8, below = window.innerHeight - rect.bottom - margin, above = rect.top - margin;
      const desired = Math.min(320, rows.length * 48 + groupSelectOptions(options).filter(group => group.label).length * 30);
      const up = below < desired && above > below;
      const maxHeight = Math.max(0, Math.min(320, up ? above : below));
      const width = Math.min(rect.width, window.innerWidth - margin * 2);
      const next = { left: Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)), top: up ? rect.top - Math.min(desired, maxHeight) : rect.bottom, width, maxHeight };
      setGeometry(current => current.left === next.left && current.top === next.top && current.width === next.width && current.maxHeight === next.maxHeight ? current : next);
    };
    const onScroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) position(); };
    position(); window.addEventListener("resize", position); window.addEventListener("scroll", onScroll, true);
    return () => { window.removeEventListener("resize", position); window.removeEventListener("scroll", onScroll, true); };
  }, [open, options]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { const target = event.target as Node; if (!trigger.current?.contains(target) && !panel.current?.contains(target)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  useLayoutEffect(() => { if (open && activeIndex >= 0) document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" }); }, [open, activeIndex, id]);
  function select(option: SelectMenuOption) { if (!option.disabled) { onChange(option.value); setOpen(false); trigger.current?.focus(); } }
  function keyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); const enabled = rows.filter(row => !row.disabled); if (!enabled.length) return;
      const index = enabled.findIndex(row => row.value === (open ? active : value));
      const next = index < 0 ? (event.key === "ArrowDown" ? 0 : enabled.length - 1) : (index + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length;
      setActive(enabled[next].value); setOpen(true);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); if (open) { const option = rows.find(row => row.value === active); if (option) select(option); } else { setActive(value); setOpen(true); }
    }
  }
  let index = 0;
  return <div className="backup-picker shared-select-menu" style={{ minWidth: 0 }}>
    <style>{`.shared-select-menu .backup-picker-trigger{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:48px;padding:10px 13px 10px 12px;border:1px solid var(--line,#ddd);border-radius:12px;background:var(--surface,#fbf8f3);color:var(--text,#253b30);text-align:left;font:inherit}.shared-select-menu .backup-picker-trigger>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.shared-select-menu .backup-picker-chevron{flex:0 0 18px;width:18px;height:18px;background:currentColor;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none'%3E%3Cpath d='m5 7 5 5 5-5' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/18px no-repeat}.shared-select-menu .backup-picker-chevron.open{transform:rotate(180deg)}.shared-select-menu .backup-picker-panel{--picker-surface:var(--surface,#fbf8f3);overflow:hidden;border:1px solid var(--line,#ddd);border-radius:12px;background:var(--picker-surface);box-shadow:0 10px 28px #0002}.shared-select-menu .backup-picker-list{overflow-y:auto;color:var(--text,#253b30)}.shared-select-menu .backup-picker-heading{padding:10px 12px 7px;color:var(--muted,#718079);font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.shared-select-menu .backup-picker-option{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;padding:9px 12px;cursor:pointer}.shared-select-menu .backup-picker-option:hover,.shared-select-menu .backup-picker-option.highlighted{background:color-mix(in srgb,var(--teal,#16816b) 8%,var(--picker-surface))}.shared-select-menu .backup-picker-option.selected{background:color-mix(in srgb,var(--teal,#16816b) 14%,var(--picker-surface))}.shared-select-menu .backup-picker-check{color:var(--teal,#16816b);font-weight:700}`}</style>
    <style>{`.shared-select-menu,.shared-select-menu .backup-picker-trigger,.shared-select-menu .backup-picker-panel,.shared-select-menu .backup-picker-list,.shared-select-menu .backup-picker-option{min-width:0;max-width:100%;box-sizing:border-box}.shared-select-menu .backup-picker-trigger>span:first-child,.shared-select-menu .backup-picker-option>span:first-child{min-width:0;max-width:100%;white-space:normal;overflow-wrap:anywhere;overflow:visible}.shared-select-menu .backup-picker-panel,.shared-select-menu .backup-picker-option{pointer-events:auto}.shared-select-menu .backup-picker-option{width:100%;border:0;border-radius:0;background:transparent;color:inherit;text-align:left;font:inherit}`}</style>
    <button ref={trigger} type="button" className="backup-picker-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} aria-activedescendant={open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined} disabled={disabled} onKeyDown={keyDown} onClick={() => { setActive(value); setOpen(current => !current); }}><span>{chosen?.label ?? placeholder}</span><span className={`backup-picker-chevron${open ? " open" : ""}`} aria-hidden="true" /></button>
    {open && <div ref={panel} className="backup-picker-panel" style={{ position: "fixed", left: geometry.left, top: geometry.top, width: geometry.width, zIndex: 13000 }}><div id={`${id}-list`} className="backup-picker-list" role="listbox" aria-label={label} style={{ maxHeight: geometry.maxHeight }}>
      {groupSelectOptions(options).map((group, groupIndex) => <div className="backup-picker-group" key={group.label ?? `ungrouped-${groupIndex}`}>{group.label && <div className="backup-picker-heading">{group.label}</div>}{group.options.map(option => { const optionIndex = index++; return <button type="button" id={`${id}-option-${optionIndex}`} key={option.value} role="option" aria-selected={option.value === value} disabled={option.disabled} className={`backup-picker-option${option.value === value ? " selected" : ""}${option.value === active ? " highlighted" : ""}`} style={option.disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined} onClick={() => select(option)}><span>{option.label}</span>{option.value === value && <span className="backup-picker-check" aria-hidden="true">✓</span>}</button>; })}</div>)}
    </div></div>}
  </div>;
}
