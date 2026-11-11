"use client";
import { Children, createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Job, Payment } from "@/lib/data";
import { formatMoneyRupees as money } from "@/lib/money";
import HisaabEntryPhoto from "./hisaab-entry-photo";
import ChatSheet from "./chat-sheet";
import { ChatBottomBar, ClipMenu, EntryActionMenu } from "./chat-hisaab-menus";
export { ChatBottomBar, ClipMenu, EntryActionMenu } from "./chat-hisaab-menus";
import "./chat-hisaab.css";
import "./chat-hisaab-menus.css";

type Props = {
  customer: string; pending: number; jobs: Job[]; payments: Payment[];
  ownerId: string | null; canUpload: boolean; children: ReactNode;
  onBack: () => void; onAdd: () => void; onQuick: () => void;
  onReceipt: (job: Job) => void; onWhatsApp: (job: Job) => void; onReminder: (job: Job) => void;
  onDelete: (job: Job) => void; onEdit: (job: Job) => void; onHistory: () => void; hasHistory: boolean;
  onPayment: (job: Job) => void; onToast: (text: string) => void;
  whatsappNumber?: string; onEditPhone?: () => void;
  message: string; onMessage: (text: string) => void; onCapture: () => void;
  onVoice: (file: File, duration: number, transcript: string) => Promise<void>;
  voiceBusy: boolean; voiceSeconds: number;
};
const ChatContext = createContext<(Props & { detail: string; navigate: (id: string) => void }) | null>(null);
function Icon({ name, size }: { name: string; size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">{name === "plus" ? <path d="M12 5v14M5 12h14"/> : name === "copy" ? <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></> : <path d="m4 16 12-12 4 4L8 20H4v-4ZM14 6l4 4"/>}</svg>;
}
export default function ChatCustomer(props: Props) {
  const [detail, setDetail] = useState("");
  const [menu, setMenu] = useState(false), [attach, setAttach] = useState(false), [paste, setPaste] = useState(false), [pasteText, setPasteText] = useState("");
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
  const orderedJobs = [...props.jobs].sort((a, b) => (Date.parse(a.createdAt || "") || Infinity) - (Date.parse(b.createdAt || "") || Infinity) || a.id.localeCompare(b.id));
  const actionJob = props.jobs.find(job => job.id === (detail || photoEntry)) || orderedJobs.at(-1);
  function chooseAction(choice: string) {
    setMenu(false); setAttach(false);
    if (choice === "paste") { setPaste(true); return; }
    if (choice === "camera" || choice === "gallery" || choice === "photo") { setPhoto(choice === "camera" ? "camera" : "gallery"); setPhotoEntry(actionJob?.id || ""); return; }
    if (choice === "history") { props.onHistory(); return; }
    if (!actionJob) return;
    if (choice === "receipt") props.onReceipt(actionJob);
    if (choice === "whatsapp") { if (!props.whatsappNumber) props.onEditPhone?.(); else props.onWhatsApp(actionJob); }
    if (choice === "reminder") props.onReminder(actionJob);
    if (choice === "payment") props.onPayment(actionJob);
    if (choice === "edit") props.onEdit(actionJob);
    if (choice === "delete") props.onDelete(actionJob);
  }
  return <ChatContext.Provider value={{ ...props, detail, navigate }}><section className={`customer-detail chat-hisaab${detail ? " has-detail" : ""}`}>
    <header className="hisaab-chat-head"><button aria-label="Back to Hisaab customers" onClick={() => { const url = new URL(location.href); url.searchParams.delete("hisaabEntry"); history.replaceState({ pakkiBaat: true, tab: "Hisaab", customer: null, customerChatOpen: false }, "", url); props.onBack(); }}><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="m15 18-6-6 6-6M9 12h12"/></svg></button><h1><small className="hisaab-brand">pakki baat.</small>{props.customer}</h1><span>Pending {money(props.pending)}</span>{detail && <button aria-label="More entry actions" onClick={() => setMenu(true)}><Icon name="plus" size={24}/></button>}</header>
    {props.children}
    {!detail && <footer className="hisaab-compose">
      <ChatBottomBar onActions={() => setMenu(true)} onAdd={props.onAdd} onAttach={() => setAttach(true)}/>
    </footer>}
    <ChatSheet open={menu} label="Entry actions" onClose={() => setMenu(false)}><EntryActionMenu onChoose={chooseAction} hasEntry={!!actionJob} hasHistory={props.hasHistory} jobs={orderedJobs} selected={actionJob?.id} onSelect={setPhotoEntry}/></ChatSheet>
    <ChatSheet open={attach} label="Attach" onClose={() => setAttach(false)}><h2>Attach</h2><ClipMenu onChoose={chooseAction}/></ChatSheet>
    <ChatSheet open={paste} label="Paste message" onClose={() => setPaste(false)}><h2>Paste message</h2><p>Paste a customer message to turn it into an entry.</p><textarea className="hisaab-paste-text" value={pasteText} onChange={event => setPasteText(event.target.value)}/><button className="primary hisaab-paste-submit" disabled={!pasteText.trim()} onClick={() => { props.onQuick(); props.onMessage(pasteText); setPaste(false); }}>Continue in Quick entry</button></ChatSheet>
    <ChatSheet open={!!photo} label="Attach photo" onClose={() => setPhoto("")}><h2>{photo === "camera" ? "Camera" : "Gallery"}</h2>{props.jobs.length ? <><label>Attach to entry<select value={photoEntry} onChange={e => setPhotoEntry(e.target.value)}>{props.jobs.map(job => <option key={job.id} value={job.id}>{job.work}</option>)}</select></label><HisaabEntryPhoto key={`${props.ownerId}:${photoEntry}:${photo}`} ownerId={props.ownerId} entryId={photoEntry} canUpload={props.canUpload} capture={photo === "camera" ? "environment" : undefined}/></> : <p>Add an entry first to attach its photo.</p>}</ChatSheet>
  </section></ChatContext.Provider>;
}
export function ChatEntryBubble({ job, number, payments, photo, onOpen, onPayment, onCopy, onEdit }: { job: Job; number: number; payments: Payment[]; photo?: ReactNode; onOpen: () => void; onPayment: () => void; onCopy: () => void; onEdit: () => void }) {
  return <article className="hisaab-chat-entry" data-entry-id={job.id}>
    <button className="hisaab-bubble" onClick={onOpen}><small>Entry {number}</small><strong>{job.work}</strong><span>Total {money(job.total)}</span><b>Pending {money(job.total - job.paid)}</b><small>{payments.length} payments</small>{photo}</button>
    <div className="hisaab-bubble-actions">{job.paid < job.total ? <button className="hisaab-payment-chip" aria-label="Add payment" title="Add payment" onClick={onPayment}><Icon name="plus" size={14}/> Add payment</button> : <span className="hisaab-paid-tag">Paid</span>}<button className="hisaab-icon-action" aria-label="Copy entry" title="Copy entry" onClick={onCopy}><Icon name="copy" size={16}/></button><button className="hisaab-icon-action" aria-label="Edit entry" title="Edit entry" onClick={onEdit}><Icon name="edit" size={16}/></button></div>
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
  return <div className="hisaab-chat-log" aria-label="Customer entries">{ordered.length === 0 && <p className="hisaab-chat-empty">Your entries will appear here. Add your first entry below.</p>}{ordered.map((job, index) => <ChatEntryBubble key={job.id} job={job} number={index + 1} payments={ctx.payments.filter(p => p.jobId === job.id && p.customer === job.customer)} onOpen={() => ctx.navigate(job.id)} onPayment={() => ctx.onPayment(job)} onEdit={() => ctx.onEdit(job)} onCopy={async () => { try { await navigator.clipboard.writeText(`Entry ${index + 1}\n${job.customer}\n${job.work}\nTotal ${money(job.total)}\nPending ${money(job.total - job.paid)}`); ctx.onToast("Entry copied"); } catch { ctx.onToast("Could not copy. Please allow clipboard access."); } }} photo={<HisaabEntryPhoto ownerId={ctx.ownerId} entryId={job.id} canUpload={false} countOnly/>}/>)}<div ref={end}/></div>;
}
