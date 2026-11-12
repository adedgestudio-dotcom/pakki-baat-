"use client";
import type { Job } from "@/lib/data";

const actions = [
  { group: "Money", rows: [["payment", "Add payment", "Record money received", "₹"], ["fix", "Fix amount", "Correct a payment amount", "✎"], ["receipt", "Receipt", "View or share receipt", "▤"], ["reminder", "Reminder", "Set a follow-up", "◷"], ["whatsapp", "WhatsApp", "Send a message", "◉"]] },
  { group: "Entry", rows: [["photo", "Add photo", "Attach to this entry", "▧"], ["edit", "Edit entry", "Change entry details", "✎"], ["history", "History of changes", "See previous edits", "↺"]] },
] as const;

export function EntryActionMenu({ onChoose, hasEntry, hasHistory, canFix, jobs = [], selected = "", onSelect }: { onChoose: (choice: string) => void; hasEntry: boolean; hasHistory: boolean; canFix: boolean; jobs?: Job[]; selected?: string; onSelect?: (id: string) => void }) {
  const index = jobs.findIndex(job => job.id === selected);
  return <div className="hisaab-actions" aria-label="Entry actions">
    {jobs.length > 0 && <label className="hisaab-entry-chip">For: Entry {index + 1} · {jobs[index]?.work || jobs.at(-1)?.work}<select aria-label="Choose entry" value={selected} onChange={event => onSelect?.(event.target.value)}>{jobs.map((job, i) => <option key={job.id} value={job.id}>Entry {i + 1} · {job.work}</option>)}</select><span aria-hidden="true">⌄</span></label>}
    {actions.map(group => <section key={group.group}><h3>{group.group}</h3><div className="hisaab-action-group">{group.rows.map(([id, label, hint, icon]) => <button key={id} type="button" disabled={id === "history" ? !hasHistory : id === "fix" ? !canFix : !hasEntry} onClick={() => onChoose(id)}><span className="hisaab-action-icon" aria-hidden="true">{icon}</span><span className="hisaab-action-copy"><strong>{label}</strong><small>{hint}</small></span><span className="hisaab-action-chevron" aria-hidden="true">›</span></button>)}</div></section>)}
    <button className="hisaab-action-delete" type="button" disabled={!hasEntry} onClick={() => onChoose("delete")}><span className="hisaab-action-icon" aria-hidden="true">⌫</span><strong>Delete entry</strong><span className="hisaab-action-chevron" aria-hidden="true">›</span></button>
  </div>;
}

const clips = [["camera", "Camera", "◉"], ["gallery", "Gallery", "▧"], ["paste", "Paste message", "▤"], ["screenshot", "Screenshot", "▣"]] as const;
export function ClipMenu({ onChoose }: { onChoose: (choice: string) => void }) {
  return <div className="hisaab-attach-grid" aria-label="Attach options">{clips.map(([id, label, icon]) => <button key={id} type="button" disabled={id === "screenshot"} onClick={() => onChoose(id)}><span className="hisaab-attach-icon" aria-hidden="true">{icon}</span><span>{label}</span>{id === "screenshot" && <small>Coming soon</small>}</button>)}</div>;
}

export function ChatBottomBar({ onActions, onAdd, onAttach }: { onActions: () => void; onAdd: () => void; onAttach: () => void }) {
  return <div className="hisaab-bottom-bar" aria-label="Entry tools"><button type="button" aria-label="Entry actions" onClick={onActions}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg></button><button type="button" className="primary hisaab-add" onClick={onAdd}>+ Add entry</button><button type="button" aria-label="Attach" onClick={onAttach}><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l8-8"/></svg></button></div>;
}
