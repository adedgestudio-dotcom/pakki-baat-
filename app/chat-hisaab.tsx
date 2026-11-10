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
export function ChatBottomBar({ onClip, onAdd, onMode, keyboard }: { onClip: () => void; onAdd: () => void; onMode: () => void; keyboard: boolean }) {
  return <div className="hisaab-bottom-bar" aria-label="Entry tools">
    <button aria-label="Attach" onClick={onClip}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21 11-9 9a6 6 0 0 1-8-8l9-9a4 4 0 0 1 6 6l-9 9a2 2 0 0 1-3-3l9-9" /></svg></button>
    <button className="primary hisaab-add" onClick={onAdd}>+ Add entry</button>
    <button aria-label={keyboard ? "Switch to keyboard" : "Voice entry"} onClick={onMode}>{keyboard ? <span aria-hidden="true">⌨</span> : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3"/></svg>}</button>
  </div>;
}
export default function ChatCustomer(props: Props) {
  const [detail, setDetail] = useState("");
  const [menu, setMenu] = useState(false), [keyboard, setKeyboard] = useState(false), [voice, setVoice] = useState(false);
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
  return <ChatContext.Provider value={{ ...props, detail, navigate }}><section className={`customer-detail chat-hisaab${detail ? " has-detail" : ""}`}>
    <header className="hisaab-chat-head"><button aria-label="Back" onClick={() => detail ? navigate("") : props.onBack()}>←</button><h1>{props.customer}</h1><span>Pending {money(props.pending)}</span></header>
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
    <ChatSheet open={menu} label="Attachments" onClose={() => setMenu(false)}><h2>Add to this customer</h2><ClipMenu onChoose={choice => { setMenu(false); if (choice === "paste") { setKeyboard(true); setVoice(false); } else { setPhoto(choice); setPhotoEntry(props.jobs[0]?.id || ""); } }}/></ChatSheet>
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
  useEffect(() => { if (!ctx.detail) end.current?.scrollIntoView({ block: "end" }); }, [ctx.jobs.length, ctx.detail]);
  const cards = Children.toArray(children);
  if (ctx.detail) {
    const index = ctx.jobs.findIndex(job => job.id === ctx.detail);
    return <div className="hisaab-entry-page">{index < 0 ? <p>This entry is no longer available.</p> : cards[index]}</div>;
  }
  const ordered = [...ctx.jobs].sort((a, b) => (Date.parse(a.createdAt || "") || Infinity) - (Date.parse(b.createdAt || "") || Infinity) || a.id.localeCompare(b.id));
  return <div className="hisaab-chat-log" aria-label="Customer entries">{ordered.length === 0 && <p className="hisaab-chat-empty">Your entries will appear here. Add your first entry below.</p>}{ordered.map((job, index) => <ChatEntryBubble key={job.id} job={job} number={index + 1} payments={ctx.payments.filter(p => p.jobId === job.id && p.customer === job.customer)} onOpen={() => ctx.navigate(job.id)} onPayment={() => ctx.onPayment(job)} onCopy={async () => { try { await navigator.clipboard.writeText(`Entry ${index + 1}\n${job.customer}\n${job.work}\nTotal ${money(job.total)}\nPending ${money(job.total - job.paid)}`); ctx.onToast("Entry copied"); } catch { ctx.onToast("Could not copy. Please allow clipboard access."); } }} photo={<HisaabEntryPhoto ownerId={ctx.ownerId} entryId={job.id} canUpload={false} countOnly/>}/>)}<div ref={end}/></div>;
}
