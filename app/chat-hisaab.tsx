"use client";
import { Children, createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Job, Payment } from "@/lib/data";
import { formatMoneyRupees as money } from "@/lib/money";
import SimpleVoiceButton from "./simple-voice-button";
import HisaabEntryPhoto from "./hisaab-entry-photo";
import ChatSheet from "./chat-sheet";
import "./chat-hisaab.css";

type Props = {
  customer: string; pending: number; jobs: Job[]; payments: Payment[];
  ownerId: string | null; canUpload: boolean; children: ReactNode;
  onBack: () => void; onAdd: () => void; onQuick: () => void;
  onReceipt: (job: Job) => void; onWhatsApp: (job: Job) => void; onReminder: (job: Job) => void;
  onDelete: (job: Job) => void; onEdit: (job: Job) => void; onHistory: () => void; hasHistory: boolean;
  onPayment: (job: Job) => void; onToast: (text: string) => void;
  message: string; onMessage: (text: string) => void; onCapture: () => void;
  onVoice: (file: File, duration: number, transcript: string) => Promise<void>;
  voiceBusy: boolean; voiceSeconds: number;
};
const ChatContext = createContext<(Props & { detail: string; navigate: (id: string) => void }) | null>(null);
function Icon({ name, size }: { name: string; size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">{name === "plus" ? <path d="M12 5v14M5 12h14"/> : name === "copy" ? <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></> : <path d="m4 16 12-12 4 4L8 20H4v-4ZM14 6l4 4"/>}</svg>;
}
export function ClipMenu({ onChoose }: { onChoose: (choice: string) => void }) {
  return <div className="hisaab-clip-options">
    <button onClick={() => onChoose("camera")}>Camera</button>
    <button onClick={() => onChoose("gallery")}>Gallery</button>
    <button onClick={() => onChoose("paste")}>Paste message</button>
    <button disabled>Screenshot <small>Coming soon</small></button>
  </div>;
}
export function EntryActionMenu({ onChoose, hasEntry, hasHistory }: { onChoose: (choice: string) => void; hasEntry: boolean; hasHistory: boolean }) {
  return <div className="hisaab-clip-options" aria-label="Entry actions">
    <button disabled={!hasEntry} onClick={() => onChoose("photo")}>Add photo</button>
    <button disabled={!hasEntry} onClick={() => onChoose("receipt")}>Receipt</button>
    <button disabled={!hasEntry} onClick={() => onChoose("whatsapp")}>WhatsApp</button>
    <button disabled={!hasEntry} onClick={() => onChoose("reminder")}>Reminder</button>
    <button disabled={!hasEntry} onClick={() => onChoose("payment")}>Add payment</button>
    <button disabled={!hasEntry} onClick={() => onChoose("edit")}>Edit entry</button>
    <button disabled={!hasHistory} onClick={() => onChoose("history")}>History of changes</button>
    <button disabled={!hasEntry} onClick={() => onChoose("delete")}>Delete entry</button>
  </div>;
}
export function ChatBottomBar({ onClip, onAdd, onMode, keyboard }: { onClip: () => void; onAdd: () => void; onMode: () => void; keyboard: boolean }) {
  return <div className="hisaab-bottom-bar" aria-label="Entry tools">
    <button aria-label="More entry actions" onClick={onClip}><Icon name="plus" size={24}/></button>
    <button className="primary hisaab-add" onClick={onAdd}>+ Add entry</button>
    <button aria-label={keyboard ? "Switch to keyboard" : "Voice entry"} onClick={onMode}>{keyboard ? <span aria-hidden="true">⌨</span> : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3"/></svg>}</button>
  </div>;
}
export default function ChatCustomer(props: Props) {
  const [detail, setDetail] = useState("");
  const [menu, setMenu] = useState(false), [keyboard, setKeyboard] = useState(true), [voice, setVoice] = useState(false);
  const [photo, setPhoto] = useState(""), [photoEntry, setPhotoEntry] = useState("");
  useEffect(() => {
    history.replaceState({ ...history.state, pakkiBaat: true, tab: "Hisaab", customer: props.customer, customerChatOpen: false }, "");
    const read = () => setDetail(new URL(location.href).searchParams.get("hisaabEntry") || "");
    read(); window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, [props.customer]);
  function navigate(id: string) {
    const url = new URL(location.href);
    if (id) url.searchParams.set("hisaabEntry", id); else url.searchParams.delete("hisaabEntry");
    history.pushState(history.state, "", url); setDetail(id);
  }
  const actionJob = props.jobs.find(job => job.id === (detail || photoEntry)) || props.jobs.at(-1);
  function chooseAction(choice: string) {
    setMenu(false);
    if (choice === "paste") { setKeyboard(true); setVoice(false); return; }
    if (choice === "camera" || choice === "gallery" || choice === "photo") { setPhoto(choice === "camera" ? "camera" : "gallery"); setPhotoEntry(actionJob?.id || ""); return; }
    if (choice === "history") { props.onHistory(); return; }
    if (!actionJob) return;
    if (choice === "receipt") props.onReceipt(actionJob);
    if (choice === "whatsapp") props.onWhatsApp(actionJob);
    if (choice === "reminder") props.onReminder(actionJob);
    if (choice === "payment") props.onPayment(actionJob);
    if (choice === "edit") props.onEdit(actionJob);
    if (choice === "delete") props.onDelete(actionJob);
  }
  return <ChatContext.Provider value={{ ...props, detail, navigate }}><section className={`customer-detail chat-hisaab${detail ? " has-detail" : ""}`}>
    <header className="hisaab-chat-head"><button aria-label="Back to Hisaab customers" onClick={() => { const url = new URL(location.href); url.searchParams.delete("hisaabEntry"); history.replaceState(history.state, "", url); props.onBack(); }}><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="m15 18-6-6 6-6M9 12h12"/></svg></button><h1>{props.customer}</h1><span>Pending {money(props.pending)}</span>{detail && <button aria-label="More entry actions" onClick={() => setMenu(true)}><Icon name="plus" size={24}/></button>}</header>
    {props.children}
    {!detail && <footer className="hisaab-compose">
      {keyboard && <form className="hisaab-inline-message" onSubmit={e => { e.preventDefault(); props.onCapture(); }}><input aria-label="Message to organise" placeholder="Type a message…" maxLength={6000} value={props.message} onChange={e => props.onMessage(e.target.value)}/><button disabled={props.voiceBusy || !props.message.trim()}>Send</button></form>}
      {voice && <div className="hisaab-voice"><span>{props.voiceBusy ? "Transcribing…" : "Tap to record your entry"}</span><SimpleVoiceButton remainingSeconds={props.voiceSeconds} onError={props.onToast} onRecordingComplete={async (blob, duration, transcript = "") => {
        if (props.voiceBusy) return;
        const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
        try { await props.onVoice(new File([blob], `voice.${ext}`, { type: blob.type }), duration, transcript); setVoice(false); } catch (error) { props.onToast(error instanceof Error ? error.message : "Voice failed. Please retry."); }
      }}/></div>}
      <ChatBottomBar keyboard={voice} onClip={() => setMenu(true)} onAdd={props.onAdd} onMode={() => { setKeyboard(voice); setVoice(!voice); }}/>
    </footer>}
    <ChatSheet open={menu} label="Entry actions" onClose={() => setMenu(false)}><h2>Entry actions</h2>{props.jobs.length > 1 && !detail && <label>Entry<select value={actionJob?.id || ""} onChange={e => setPhotoEntry(e.target.value)}>{props.jobs.map(job => <option key={job.id} value={job.id}>{job.work}</option>)}</select></label>}<EntryActionMenu onChoose={chooseAction} hasEntry={!!actionJob} hasHistory={props.hasHistory}/><h3>Add to this customer</h3><ClipMenu onChoose={chooseAction}/></ChatSheet>
    <ChatSheet open={!!photo} label="Attach photo" onClose={() => setPhoto("")}><h2>{photo === "camera" ? "Camera" : "Gallery"}</h2>{props.jobs.length ? <><label>Attach to entry<select value={photoEntry} onChange={e => setPhotoEntry(e.target.value)}>{props.jobs.map(job => <option key={job.id} value={job.id}>{job.work}</option>)}</select></label><HisaabEntryPhoto key={`${props.ownerId}:${photoEntry}:${photo}`} ownerId={props.ownerId} entryId={photoEntry} canUpload={props.canUpload} capture={photo === "camera" ? "environment" : undefined}/></> : <p>Add an entry first to attach its photo.</p>}</ChatSheet>
  </section></ChatContext.Provider>;
}
export function ChatEntryBubble({ job, number, payments, photo, onOpen, onPayment, onCopy }: { job: Job; number: number; payments: Payment[]; photo?: ReactNode; onOpen: () => void; onPayment: () => void; onCopy: () => void }) {
  return <article className="hisaab-chat-entry" data-entry-id={job.id}>
    <button className="hisaab-bubble" onClick={onOpen}><small>Entry {number}</small><strong>{job.work}</strong><span>Total {money(job.total)}</span><b>Pending {money(job.total - job.paid)}</b><small>{payments.length} payments</small>{photo}</button>
    <div className="hisaab-bubble-actions"><button aria-label="Add payment" onClick={onPayment}><Icon name="plus" size={16}/></button><button aria-label="Copy entry" onClick={onCopy}><Icon name="copy" size={16}/></button><button aria-label="Edit entry" onClick={onOpen}><Icon name="edit" size={16}/></button></div>
  </article>;
}
export function ChatHistory({ children }: { children: ReactNode }) {
  const ctx = useContext(ChatContext)!;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!ctx.detail) { const log = end.current?.parentElement; log?.scrollTo({ top: log.scrollHeight }); } }, [ctx.jobs.length, ctx.detail]);
  const cards = Children.toArray(children);
  if (ctx.detail) {
    const index = ctx.jobs.findIndex(job => job.id === ctx.detail);
    return <div className="hisaab-entry-page">{index < 0 ? <p>This entry is no longer available.</p> : cards[index]}</div>;
  }
  const ordered = [...ctx.jobs].sort((a, b) => (Date.parse(a.createdAt || "") || Infinity) - (Date.parse(b.createdAt || "") || Infinity) || a.id.localeCompare(b.id));
  return <div className="hisaab-chat-log" aria-label="Customer entries">{ordered.length === 0 && <p className="hisaab-chat-empty">Your entries will appear here. Add your first entry below.</p>}{ordered.map((job, index) => <ChatEntryBubble key={job.id} job={job} number={index + 1} payments={ctx.payments.filter(p => p.jobId === job.id && p.customer === job.customer)} onOpen={() => ctx.navigate(job.id)} onPayment={() => ctx.onPayment(job)} onCopy={async () => { try { await navigator.clipboard.writeText(`Entry ${index + 1}\n${job.customer}\n${job.work}\nTotal ${money(job.total)}\nPending ${money(job.total - job.paid)}`); ctx.onToast("Entry copied"); } catch { ctx.onToast("Could not copy. Please allow clipboard access."); } }} photo={<HisaabEntryPhoto ownerId={ctx.ownerId} entryId={job.id} canUpload={false} countOnly/>}/>)}<div ref={end}/></div>;
}
