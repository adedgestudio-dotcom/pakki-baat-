"use client";
import { useEffect, useRef, useState } from "react";
import "./workspace.css";
import "./connections.css";
import CloudSettings from "./cloud-settings";
import ChatComposer from "./chat-composer";
import AudioPlayer from "./audio-player";
import { saveVoice, loadVoice, deleteVoice } from "@/lib/voice-messages";
import {
  cloudConfigured,
  cloudToken,
  currentSession,
  loadCloud,
  saveCloud,
  signInWithGoogle,
  signOut,
  watchSession,
} from "@/lib/cloud";
import {
  isSnapshot,
  calendarFile,
  type Job,
  type Reminder,
  type Payment,
  type CustomerNote,
  type Snapshot,
} from "@/lib/data";
import type { Session } from "@supabase/supabase-js";
type Tab = "Today" | "My assistant" | "Hisaab" | "Customers" | "Settings";
type ChatTurn = {
  id: string;
  role: "me" | "assistant";
  text: string;
  replyFor?: Job;
  voiceId?: string;
  duration?: number;
  customer?: string;
};
type ChatStep = "customer" | "total" | "paid" | "date" | "ready";
type ChatState = { turns: ChatTurn[]; pending: Job | null; step: ChatStep };
function isRealDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, date] = value.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, date));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() + 1 === month &&
    check.getUTCDate() === date
  );
}
function isChatState(value: unknown): value is ChatState {
  if (!value || typeof value !== "object") return false;
  const state = value as ChatState;
  return (
    Array.isArray(state.turns) &&
    state.turns.length <= 80 &&
    state.turns.every(
      (turn) =>
        turn &&
        typeof turn.id === "string" &&
        ["me", "assistant"].includes(turn.role) &&
        typeof turn.text === "string" &&
        turn.text.length <= 12000 &&
        (!turn.voiceId ||
          (typeof turn.voiceId === "string" && turn.voiceId.length <= 100)) &&
        (turn.customer === undefined || typeof turn.customer === "string") &&
        (turn.duration === undefined ||
          (Number.isFinite(turn.duration) &&
            turn.duration >= 0 &&
            turn.duration <= 60)) &&
        (!turn.replyFor ||
          isSnapshot({ jobs: [turn.replyFor], owner: "", business: "" }))
    ) &&
    (state.pending === null ||
      isSnapshot({ jobs: [state.pending], owner: "", business: "" })) &&
    ["customer", "total", "paid", "date", "ready"].includes(state.step)
  );
}
const blank = (): Job => ({
  id: "",
  customer: "",
  work: "",
  total: 0,
  paid: 0,
  date: "",
  time: "",
  status: "Waiting",
  source: "",
});
const money = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
const day = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getDate()).padStart(2, "0")}`;
};
function accountNameFromEmail(session: Session | null) {
  const email = session?.user.email?.trim();
  if (!email) return null;
  const local = email.split("@")[0]?.trim();
  if (!local) return null;
  return local
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
const LOCAL_WORKSPACE_ID = "local";
const localWorkspaceKey = (userId: string) =>
  "pakki-baat-workspace:" + userId;
function readLocalWorkspace(userId: string) {
  try {
    const raw = localStorage.getItem(localWorkspaceKey(userId));
    if (!raw) return null;
    const snapshot = JSON.parse(raw);
    return isSnapshot(snapshot) ? snapshot : null;
  } catch {
    return null;
  }
}
function writeLocalWorkspace(userId: string, snapshot: Snapshot) {
  try {
    localStorage.setItem(localWorkspaceKey(userId), JSON.stringify(snapshot));
  } catch {
    // Browser storage can be full or disabled. Cloud save still gets a chance.
  }
}
function Icon({ name, size = 22 }: { name: string; size?: number }) {
  const p: Record<string, string> = {
    home: "m3 10 9-7 9 7v10H3Z M9 20v-7h6v7",
    chat: "M21 11a9 9 0 0 1-9 9H4l-2 2V11a9 9 0 1 1 19 0Z M7 9h9 M7 13h6",
    list: "M8 5h13 M8 12h13 M8 19h13 M3 5h.01 M3 12h.01 M3 19h.01",
    people:
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 4a4 4 0 0 1 0 7 M22 21v-2a4 4 0 0 0-3-4",
    settings:
      "M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5 5l3 3 M16 16l3 3 M5 19l3-3 M16 8l3-3 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    plus: "M12 5v14 M5 12h14",
    arrow: "M5 12h14 m-6-6 6 6-6 6",
    check: "m5 12 4 4L19 6",
    bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4",
    clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3 2",
    calendar: "M6 2v4 M18 2v4 M3 9h18 M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z",
    copy: "M9 9h12v12H9Z M5 15H3V3h12v2",
    search: "M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0 m-2 5 6 6",
    close: "m6 6 12 12 M6 18 18 6",
    leaf: "M5 20c0-10 6-15 15-16 0 10-5 16-15 16Z M5 20l10-10",
    promise:
      "M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-5 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z M8 11l2.2 2.2L16 8",
    sun: "M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4 M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0",
    moon: "M20 15.2A8.5 8.5 0 0 1 8.8 4 8.5 8.5 0 1 0 20 15.2Z",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={p[name] || p.chat} />
    </svg>
  );
}
export default function Workspace() {
  const [tab, setTab] = useState<Tab>("Today"),
    [jobs, setJobs] = useState<Job[]>([]),
    [reminders, setReminders] = useState<Reminder[]>([]),
    [ready, setReady] = useState(false),
    [owner, setOwner] = useState(""),
    [business, setBusiness] = useState("My small business"),
    [message, setMessage] = useState(""),
    [draft, setDraft] = useState<Job | null>(null),
    [pendingJob, setPendingJob] = useState<Job | null>(null),
    [pendingReminderText, setPendingReminderText] = useState(""),
    [chatStep, setChatStep] = useState<ChatStep>("customer"),
    [chatTurns, setChatTurns] = useState<ChatTurn[]>([]),
    [voiceUrls, setVoiceUrls] = useState<Record<string, string>>({}),
    [voiceBusy, setVoiceBusy] = useState(false),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("All"),
    [toast, setToast] = useState(""),
    [feedback, setFeedback] = useState(""),
    [authReady, setAuthReady] = useState(!cloudConfigured),
    [loggedIn, setLoggedIn] = useState(false),
    [userName, setUserName] = useState<string | null>(null),
    [userEmail, setUserEmail] = useState<string | null>(null),
    [dark, setDark] = useState(false),
    [selectedCustomer, setSelectedCustomer] = useState<string | null>(null),
    [payments, setPayments] = useState<Payment[]>([]),
    [notes, setNotes] = useState<CustomerNote[]>([]),
    [newCustomerOpen, setNewCustomerOpen] = useState(false),
    [newCustomerName, setNewCustomerName] = useState(""),
    [customerChatOpen, setCustomerChatOpen] = useState(false),
    [reminderJob, setReminderJob] = useState<Job | null>(null),
    [reminderDate, setReminderDate] = useState(""),
    [reminderTime, setReminderTime] = useState("09:00"),
    [reminderRepeat, setReminderRepeat] = useState<"none"|"daily"|"weekly"|"monthly">("none"),
    [reminderText, setReminderText] = useState(""),
    [entryMode, setEntryMode] = useState<"quick"|"form">("quick");
  const chatBodyRef = useRef<HTMLDivElement>(null);
  const voiceUrlsRef = useRef<Record<string, string>>({});
  const voiceFilesRef = useRef<Record<string, File>>({});
  const loadingVoiceIds = useRef(new Set<string>());
  const activeUserIdRef = useRef<string | null>(null);
  const cloudHydratedRef = useRef(false);

  // Display name priority: custom name → Google/account name → email name → "there"
  const displayName = owner?.trim() || userName || "there";
  // Account workspaces are loaded after authentication. Never hydrate business data
  // from a shared browser key, otherwise one signed-out user can see another user's data.
  useEffect(() => {
    const savedTheme = localStorage.getItem("pakki-baat-theme");
    const isDark = savedTheme === "dark";
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDark(isDark);
  }, []);
  useEffect(() => {
    if (!cloudConfigured) return;

    let cancelled = false;

    async function applySession(session: Session | null) {
      if (cancelled) return;
      setLoggedIn(Boolean(session));
      setUserEmail(session?.user.email || null);
      setUserName(accountNameFromEmail(session));
      activeUserIdRef.current = session?.user.id || null;

      if (!session) {
        cloudHydratedRef.current = false;
        const localSnapshot = readLocalWorkspace(LOCAL_WORKSPACE_ID);
        if (localSnapshot) restore(localSnapshot);
        setReady(true);
        return;
      }

      cloudHydratedRef.current = false;
      setReady(false);
      try {
        const cloudSnapshot = await loadCloud();
        if (cancelled || activeUserIdRef.current !== session.user.id) return;
        const localSnapshot = readLocalWorkspace(session.user.id);
        const snapshot = cloudSnapshot && isSnapshot(cloudSnapshot)
          ? cloudSnapshot
          : localSnapshot;
        if (snapshot) {
          restore(snapshot);
        } else {
          setJobs([]);
          setReminders([]);
          setPayments([]);
          setNotes([]);
          setOwner("");
          setBusiness("My small business");
          setChatTurns([]);
          setPendingJob(null);
          setChatStep("customer");
        }
      } catch {
        if (!cancelled) {
          const localSnapshot = readLocalWorkspace(session.user.id);
          if (localSnapshot) {
            restore(localSnapshot);
          } else {
            setToast("Could not load your cloud workspace.");
          }
        }
      } finally {
        if (!cancelled && activeUserIdRef.current === session.user.id) {
          cloudHydratedRef.current = true;
          setReady(true);
        }
      }
    }

    void currentSession()
      .then(applySession)
      .catch(() => setToast("Could not check Google sign-in."))
      .finally(() => setAuthReady(true));

    const stopWatching = watchSession((session) => {
      setAuthReady(true);
      void applySession(session);
    });

    return () => {
      cancelled = true;
      stopWatching();
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const snapshot = { jobs, owner, business, reminders, payments, notes };
    const storageUserId = activeUserIdRef.current || LOCAL_WORKSPACE_ID;
    writeLocalWorkspace(storageUserId, snapshot);
    if (!loggedIn || !activeUserIdRef.current || !cloudHydratedRef.current) return;
    const timer = window.setTimeout(() => {
      void saveCloud(snapshot).catch(() =>
        setToast("Saved on this device. Cloud backup could not update yet.")
      );
    }, 500);
    return () => window.clearTimeout(timer);
  }, [jobs, owner, business, reminders, payments, notes, ready, loggedIn]);

  useEffect(() => {
    for (const turn of chatTurns) {
      const id = turn.voiceId;
      if (!id || voiceUrlsRef.current[id] || loadingVoiceIds.current.has(id))
        continue;
      loadingVoiceIds.current.add(id);
      void loadVoice(id)
        .then((file) => {
          if (!file) {
            setVoiceUrls((urls) => ({ ...urls, [id]: "" }));
            return;
          }
          voiceFilesRef.current[id] = file;
          const url = URL.createObjectURL(file);
          voiceUrlsRef.current[id] = url;
          setVoiceUrls((urls) => ({ ...urls, [id]: url }));
        })
        .catch(() => setVoiceUrls((urls) => ({ ...urls, [id]: "" })))
        .finally(() => loadingVoiceIds.current.delete(id));
    }
  }, [chatTurns]);
  useEffect(() => {
    return () => {
      Object.values(voiceUrlsRef.current).forEach((url) =>
        URL.revokeObjectURL(url)
      );
      voiceUrlsRef.current = {};
    };
  }, []);
  useEffect(() => {
    if (tab !== "My assistant") return;
    const body = chatBodyRef.current;
    body?.scrollTo({ top: body.scrollHeight, behavior: "smooth" });
  }, [chatTurns, tab]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(id);
  }, [toast]);
  const modalOpen = Boolean(draft);
  useEffect(() => {
    if (!modalOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDraft(null);
      if (e.key === "Tab") {
        const nodes = document.querySelectorAll<HTMLElement>(
          '[role="dialog"] button:not(:disabled), [role="dialog"] input, [role="dialog"] textarea, [role="dialog"] select, [role="dialog"] summary'
        );
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            !document
              .querySelector('[role="dialog"]')
              ?.contains(document.activeElement))
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, [modalOpen]);
  const nav: [Tab, string][] = [
    ["Today", "home"],
    ["Hisaab", "list"],
  ];
  const open = jobs.filter((j) => j.status !== "Completed"),
    due = open.filter((j) => j.date && j.date <= day()),
    balance = jobs.reduce((a, j) => a + Math.max(0, j.total - j.paid), 0);
  const visible = jobs.filter(
    (j) =>
      `${j.customer} ${j.work}`.toLowerCase().includes(query.toLowerCase()) &&
      (filter === "All" ||
        (filter === "Payment due"
          ? j.total > j.paid
          : filter === "Due now"
          ? j.status !== "Completed" && Boolean(j.date) && j.date <= day()
          : j.status === filter))
  );
  function go(t: Tab) {
    if (t === "My assistant") setSelectedCustomer(null);
    setTab(t);
    setQuery("");
    setFilter("All");
  }
  function openCustomerAssistant(seed = "") {
    setTab("Hisaab");
    setQuery("");
    setFilter("All");
    setPendingJob(null);
    setPendingReminderText("");
    setMessage(seed);
  }
  function toggleTheme() {
    const next = !dark;
    setDark(next);
    localStorage.setItem("pakki-baat-theme", next ? "dark" : "light");
    document.documentElement.dataset.theme = next ? "dark" : "light";
  }
  function say(role: ChatTurn["role"], text: string, replyFor?: Job) {
    setChatTurns((turns) =>
      [...turns, { id: crypto.randomUUID(), role, text, replyFor, customer: selectedCustomer || undefined }].slice(-80)
    );
  }
  async function sendVoice(file: File, duration: number, transcript: string) {
    const id = crypto.randomUUID();
    const url = URL.createObjectURL(file);
    voiceUrlsRef.current[id] = url;
    voiceFilesRef.current[id] = file;
    setVoiceUrls((urls) => ({ ...urls, [id]: url }));

    const voiceText = transcript || "Voice note";
    setChatTurns((turns) =>
      [
        ...turns,
        {
          id: crypto.randomUUID(),
          role: "me" as const,
          text: voiceText,
          voiceId: id,
          duration,
          customer: selectedCustomer || undefined,
        },
      ].slice(-80)
    );

    if (transcript) {
      setMessage("");
      await processAssistantMessage(transcript, "voice");
    } else {
      await transcribeSentVoice(file, id);
    }

    try {
      await saveVoice(id, file);
    } catch {
      // The entry can still be created even if local audio playback cannot be saved.
    }
  }
  async function transcribeSentVoice(file: File, id: string) {
    if (voiceBusy) return;
    setVoiceBusy(true);
    try {
      if (file.size > 2_000_000)
        throw new Error(
          "This recording is over the 2 MB AI limit. Record a shorter note."
        );

      const token = await cloudToken();
      const form = new FormData();
      form.set("file", file);
      form.set("mode", "transcribe");
      form.set("today", day());

      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: form,
      });

      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Transcription failed.");

      const transcript = String(result.text || "")
        .trim()
        .slice(0, 6000);

      if (!transcript)
        throw new Error("No speech was detected in the recording.");

      // Update the chat turn with the transcript
      setChatTurns((turns) =>
        turns.map((turn) =>
          turn.voiceId === id ? { ...turn, text: transcript } : turn
        )
      );

      // Process through unified conversation flow
      say("assistant", "I heard: " + transcript);
      await processAssistantMessage(transcript, "voice");
    } catch (cause) {
      const reason =
        cause instanceof Error ? cause.message : "Transcription failed.";
      if (reason.includes("Continue with Google")) {
        setToast("Sign in once to use voice transcription, then tap the mic again.");
      } else {
        setToast("Could not read that voice note. " + reason);
      }
    } finally {
      setVoiceBusy(false);
    }
  }

  async function retryVoice(id: string) {
    if (voiceBusy) return;
    try {
      const file = voiceFilesRef.current[id] || (await loadVoice(id));
      if (!file)
        throw new Error("This recording is no longer stored on this device.");
      voiceFilesRef.current[id] = file;
      await transcribeSentVoice(file, id);
    } catch (cause) {
      setToast(
        cause instanceof Error
          ? cause.message
          : "Could not retry the voice note."
      );
    }
  }
  async function startGoogleSignIn() {
    try {
      if (!cloudConfigured) {
        setToast("Google sign-in is not configured yet.");
        return;
      }
      await signInWithGoogle();
    } catch (cause) {
      setToast(
        cause instanceof Error
          ? cause.message
          : "Could not start Google sign-in."
      );
    }
  }
  async function handleSignOut() {
    try {
      await signOut();
      setLoggedIn(false);
      setUserName(null);
      setUserEmail(null);
      setReminders([]);
      setPayments([]);
      setNotes([]);
      setJobs([]);
      setChatTurns([]);
      setPendingJob(null);
      setToast("Signed out. Your account workspace is hidden on this device.");
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : "Could not sign out.");
    }
  }
  async function downloadVoiceInChat(id: string) {
    try {
      const file = voiceFilesRef.current[id] || (await loadVoice(id));
      if (!file)
        throw new Error("This recording is no longer stored on this device.");
      const url = voiceUrlsRef.current[id] || URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name || "pakki-baat-voice-note.webm";
      link.click();
      if (!voiceUrlsRef.current[id])
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setToast(
        cause instanceof Error
          ? cause.message
          : "Could not download the voice note."
      );
    }
  }
  async function removeVoice(id: string) {
    setChatTurns((turns) => turns.filter((turn) => turn.voiceId !== id));
    const url = voiceUrlsRef.current[id];
    if (url) URL.revokeObjectURL(url);
    delete voiceUrlsRef.current[id];
    delete voiceFilesRef.current[id];
    setVoiceUrls((urls) => {
      const next = { ...urls };
      delete next[id];
      return next;
    });
    try {
      await deleteVoice(id);
    } catch {
      setToast("Could not delete the stored audio on this device.");
    }
  }
  async function processAssistantMessage(
    message: string,
    source: "text" | "voice"
  ) {
    try {
      console.log(`📨 Processing ${source} message:`, message);

      const token = await cloudToken();

      const response = await fetch("/api/process-message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: pendingReminderText
            ? `${pendingReminderText}. Follow-up: ${message}`
            : message,
          pending: pendingJob,
          today: day(),
          customerContext: selectedCustomer || undefined,
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const reason = String(result.error || "Failed to process message");
        console.error("❌ Assistant API failed:", response.status, result);
        throw new Error(reason);
      }
      console.log("✅ Processing result:", result);

      if (result.intent === "reminder") {
        if (result.nextQuestion) {
          setPendingReminderText(
            pendingReminderText ? `${pendingReminderText}. ${message}` : message
          );
          say("assistant", result.nextQuestion);
          return;
        }
        if (result.reminder?.date) {
          const reminder: Reminder = {
            id: crypto.randomUUID(),
            text: String(result.reminder.text || "Reminder"),
            date: String(result.reminder.date),
            time: String(result.reminder.time || ""),
            customer: result.reminder.customer
              ? String(result.reminder.customer)
              : selectedCustomer || undefined,
            jobId: pendingJob?.id,
            repeat: ["daily", "weekly", "monthly"].includes(
              result.reminder.repeat
            )
              ? result.reminder.repeat
              : "none",
            done: false,
            createdAt: new Date().toISOString(),
          };
          setReminders((items) => [reminder, ...items]);
          setPendingReminderText("");
          say(
            "assistant",
            `Reminder set ✓ ${reminder.text} — ${reminder.date}${
              reminder.time ? " at " + reminder.time : ""
            }.`
          );
          return;
        }
      }

      if (result.intent === "payment") {
        if (result.nextQuestion) { say("assistant", result.nextQuestion); return; }
        const amount = Number(result.payment?.amount || 0);
        const customer = selectedCustomer || String(result.payment?.customer || "");
        if (!customer) { say("assistant", "Which customer is this payment from?"); return; }
        if (!(amount > 0)) { say("assistant", "How much did they pay?"); return; }
        const latest = jobs.find(j => j.customer === customer && j.paid < j.total);
        if (latest) {
          const preview: Job = { ...latest, id: crypto.randomUUID(), paid: Math.min(latest.total, latest.paid + amount), source: message };
          setPendingJob(preview);
          setChatStep("ready");
          say("assistant", "I got the details. Check this before saving:", preview);
        } else {
          const preview: Job = { ...blank(), id: crypto.randomUUID(), customer, work: String(result.payment?.note || "Payment received"), total: amount, paid: amount, date: String(result.payment?.date || day()), source: message, status: "Confirmed" };
          setPendingJob(preview);
          setChatStep("ready");
          say("assistant", "I got the payment details. Check this before saving:", preview);
        }
        return;
      }

      if (result.intent === "note") {
        const customer = selectedCustomer;
        const text = String(result.note?.text || "").trim();
        if (!customer) { say("assistant", "Open the customer first so I know where to save this note."); return; }
        if (!text) { say("assistant", "What note should I remember?"); return; }
        setNotes(items => [{ id: crypto.randomUUID(), customer, text, createdAt: new Date().toISOString() }, ...items]);
        say("assistant", "Saved to " + customer + " ✓");
        return;
      }

      if (result.intent === "edit") {
        if (!selectedCustomer) { say("assistant", "Open the customer first so I know which entry to change."); return; }
        const latest = jobs.find(j => j.customer === selectedCustomer);
        if (!latest) { say("assistant", "There is no order to change yet for " + selectedCustomer + "."); return; }
        const changes = result.changes || {};
        const next: Job = {
          ...latest,
          ...(typeof changes.work === "string" ? { work: changes.work } : {}),
          ...(Number.isFinite(Number(changes.total)) ? { total: Number(changes.total) } : {}),
          ...(Number.isFinite(Number(changes.paid)) ? { paid: Number(changes.paid) } : {}),
          ...(typeof changes.date === "string" ? { date: changes.date } : {}),
          ...(typeof changes.time === "string" ? { time: changes.time } : {}),
          ...(["Waiting","Confirmed","Completed"].includes(changes.status) ? { status: changes.status } : {}),
        };
        if (next.total < next.paid) { say("assistant", "That would make the received amount higher than the total. Tell me the correct total or payment."); return; }
        if (next.paid > latest.paid) {
          setPayments(items => [{ id: crypto.randomUUID(), customer: selectedCustomer, jobId: latest.id, amount: next.paid-latest.paid, date: day(), note: "Payment correction", createdAt: new Date().toISOString() }, ...items]);
        }
        setJobs(items => items.map(j => j.id===latest.id ? next : j));
        say("assistant", "Updated " + selectedCustomer + " ✓");
        return;
      }

      const extracted = result.updated || {};
      const item: Job = {
        ...blank(),
        ...extracted,
        id: pendingJob?.id || crypto.randomUUID(),
        customer: selectedCustomer || extracted.customer?.trim() || "",
        work: extracted.work?.trim() || pendingJob?.work || "",
        total: Number(extracted.total ?? pendingJob?.total ?? 0),
        paid: Number(extracted.paid ?? pendingJob?.paid ?? 0),
        date: String(extracted.date ?? pendingJob?.date ?? ""),
        time: String(extracted.time ?? pendingJob?.time ?? ""),
        status: "Confirmed",
        source: message,
      };
      setPendingJob(item);
      setChatStep("ready");
    } catch (error) {
      console.error("❌ Error processing message:", error);
      const reason = error instanceof Error ? error.message : "Unknown error";
      say(
        "assistant",
        "I heard your message, but I could not process it: " + reason
      );
    }
  }

  function savePendingEntry(item: Job) {
    if (!selectedCustomer) return;
    const saved = { ...item, customer: selectedCustomer };
    setJobs(items => [saved, ...items.filter(j => j.id !== saved.id)]);
    if (saved.paid > 0 && !payments.some(p => p.jobId === saved.id)) {
      setPayments(items => [{ id: crypto.randomUUID(), customer: selectedCustomer, jobId: saved.id, amount: saved.paid, date: day(), note: "Initial payment / advance", createdAt: new Date().toISOString() }, ...items]);
    }
    setPendingJob(null);
    setChatStep("customer");
    say("assistant", "Entry saved ✓");
    setToast("Saved in " + selectedCustomer + "'s hisaab.");
  }

  function startEntry(mode: "quick" | "form") {
    if (!selectedCustomer) return;
    setEntryMode(mode);
    setMessage("");
    setPendingJob(mode === "form" ? { ...blank(), id: crypto.randomUUID(), customer: selectedCustomer, status: "Confirmed" } : null);
    setCustomerChatOpen(true);
  }
  function amountValue(value: number) {
    return value > 0 ? String(value) : "";
  }
  function updatePendingAmount(field: "total" | "paid", raw: string) {
    if (!pendingJob) return;
    const value = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(value) || value < 0) return;
    setPendingJob({ ...pendingJob, [field]: value });
  }

  function capture() {
    const input = message.trim();
    if (!input || voiceBusy) return;
    setMessage("");
    say("me", input);
    void processAssistantMessage(input, "text");
  }

  function finishCustomerChat() {
    if (!selectedCustomer || voiceBusy) return;
    if (!pendingJob || !pendingJob.work?.trim()) {
      setToast("Add the entry details first, then tap Save.");
      return;
    }
    const saved = { ...pendingJob, customer: selectedCustomer };
    setJobs(items => [saved, ...items.filter(j => j.id !== saved.id)]);
    if (saved.paid > 0 && !payments.some(p => p.jobId === saved.id)) {
      setPayments(items => [{ id: crypto.randomUUID(), customer: selectedCustomer, jobId: saved.id, amount: saved.paid, date: day(), note: "Initial payment / advance", createdAt: new Date().toISOString() }, ...items]);
    }
    setPendingJob(null);
    setPendingReminderText("");
    setChatStep("customer");
    setMessage("");
    setCustomerChatOpen(false);
    setChatTurns(turns => turns.filter(turn => turn.customer !== selectedCustomer));
    setToast("Saved in " + selectedCustomer + "'s hisaab.");
  }

  function receiveAiDraft(job: Job) {
    setPendingJob(job);
    setChatStep("ready");
    say(
      "assistant",
      "I read the attachment and added the details. Keep chatting or tap Save when you're done."
    );
  }
  function save() {
    if (!draft || !draft.customer.trim() || !draft.work.trim()) return;
    if (
      !Number.isFinite(draft.total) ||
      !Number.isFinite(draft.paid) ||
      draft.total < 0 ||
      draft.paid < 0 ||
      draft.paid > draft.total
    ) {
      setToast("Check the total and received amounts.");
      return;
    }
    const item = {
      ...draft,
      id: draft.id || crypto.randomUUID(),
      customer: draft.customer.trim(),
      work: draft.work.trim(),
    };
    const previous = jobs.find(j => j.id === item.id);
    const previousPaid = previous?.paid || 0;
    if (item.paid > previousPaid) {
      setPayments(items => [{ id: crypto.randomUUID(), customer: item.customer, jobId: item.id, amount: item.paid - previousPaid, date: day(), note: previous ? "Payment update" : "Initial payment / advance", createdAt: new Date().toISOString() }, ...items]);
    }
    setJobs((p) => [item, ...p.filter((j) => j.id !== item.id)]);
    setDraft(null);

    setPendingJob(null);
    setChatStep("customer");
    setTab("Hisaab");
    say("assistant", replyText(item), item);
    setMessage("");
    setToast("Saved. Your next steps are ready.");
  }
  const replyText = (j: Job) =>
    `Hi ${j.customer}, here are the details for ${j.work}. ${
      j.date
        ? `Date: ${j.date}${
            j.time ? ` at ${j.time}` : " (time to be agreed)"
          }. `
        : "Please confirm a date. "
    }Total: ${money(j.total)}. Received: ${money(j.paid)}. Balance: ${money(
      j.total - j.paid
    )}. Please reply to confirm these details. Thank you!`;
  async function shareFeedback() {
    try {
      if (navigator.share) {
        await navigator.share({ title: "Pakki Baat feedback", text: feedback });
      } else {
        await navigator.clipboard.writeText(feedback);
        setToast("Feedback copied. Paste it into your chat with the creator.");
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setToast("Sharing is unavailable. Download your feedback instead.");
    }
  }
  async function copy(t: string) {
    try {
      await navigator.clipboard.writeText(t);
      setToast("Copied. Paste it into your customer's chat.");
    } catch {
      setToast("Please select and copy the message manually.");
    }
  }
  function download(text: string, name: string) {
    const u = URL.createObjectURL(new Blob([text], { type: "text/plain" })),
      a = document.createElement("a");
    a.href = u;
    a.download = name;
    a.click();
    URL.revokeObjectURL(u);
  }
  function sample() {
    setJobs([
      {
        ...blank(),
        id: crypto.randomUUID(),
        customer: "Riya Shah",
        work: "2 kg chocolate cake",
        total: 2400,
        paid: 1000,
        date: day(),
        time: "17:00",
        status: "Confirmed",
        source: "Sample commitment",
      },
      {
        ...blank(),
        id: crypto.randomUUID(),
        customer: "Meera Patel",
        work: "Blouse alterations & fitting",
        total: 1200,
        paid: 0,
        date: day(),
        source: "Sample commitment",
      },
    ]);
    setToast("Sample commitments added. Edit or delete them freely.");
  }
  function restore(s: Snapshot) {
    setJobs(s.jobs);
    setReminders(s.reminders || []);
    setPayments(s.payments || []);
    setNotes(s.notes || []);
    setOwner(s.owner);
    setBusiness(s.business);
    setChatTurns([]);
    setPendingJob(null);
    setChatStep("customer");
    setReady(true);
    setToast("Workspace restored on this device.");
  }
  async function importBackup(file: File) {
    try {
      if (file.size > 10_000_000) throw new Error("Backup is too large.");
      const data = JSON.parse(await file.text());
      if (!isSnapshot(data))
        throw new Error("This is not a valid Pakki Baat backup.");
      if (confirm("Replace this device’s workspace with this backup?"))
        restore(data);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Could not read this backup.");
    }
  }
  const jobCard = (j: Job) => (
    <button className="job" key={j.id} onClick={() => setDraft(j)}>
      <span className="avatar">{j.customer[0]}</span>
      <span className="job-main">
        <strong>{j.work}</strong>
        <span>{j.customer}</span>
        <small>{j.date ? new Date(j.date + "T12:00:00").toLocaleDateString("en-IN",{day:"numeric",month:"short"}) : "Date to be agreed"}{j.time ? " · " + j.time : ""}</small>
      </span>
      <span className="job-end"><strong>{money(j.total-j.paid)} baki</strong><span className={j.status==="Confirmed"?"tag green":"tag"}>{j.status}</span></span>
      <Icon name="arrow" size={16}/>
    </button>
  );
  const customerNames = Array.from(new Set([...jobs.map(j=>j.customer), ...payments.map(p=>p.customer), ...notes.map(n=>n.customer), ...reminders.map(r=>r.customer || "")])).filter(Boolean);
  const customerJobs = selectedCustomer ? jobs.filter(j=>j.customer===selectedCustomer) : [];
  const customerReminders = selectedCustomer ? reminders.filter(r=>r.customer===selectedCustomer && !r.done) : [];
  const selectedBaki = customerJobs.reduce((sum,j)=>sum+j.total-j.paid,0);
  const customerPayments = selectedCustomer ? payments.filter(p=>p.customer===selectedCustomer) : [];
  const customerNotes = selectedCustomer ? notes.filter(n=>n.customer===selectedCustomer) : [];
  function openReminder(job: Job) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const iso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth()+1).padStart(2,"0")}-${String(tomorrow.getDate()).padStart(2,"0")}`;
    setReminderJob(job);
    setReminderDate(job.date || iso);
    setReminderTime(job.time || "09:00");
    setReminderRepeat("none");
    const baki = Math.max(0, job.total - job.paid);
    setReminderText(baki > 0 ? `Collect ${money(baki)} baki from ${job.customer}` : `Follow up with ${job.customer} about ${job.work}`);
  }
  function quickReminderDate(kind:"today"|"tomorrow") {
    const d = new Date();
    if (kind === "tomorrow") d.setDate(d.getDate()+1);
    setReminderDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`);
  }
  function saveReminder() {
    if (!reminderJob || !reminderDate || !reminderText.trim()) return;
    const reminder: Reminder = {
      id: crypto.randomUUID(),
      text: reminderText.trim(),
      date: reminderDate,
      time: reminderTime,
      customer: reminderJob.customer,
      jobId: reminderJob.id,
      repeat: reminderRepeat,
      done: false,
      createdAt: new Date().toISOString(),
    };
    setReminders(items => [reminder, ...items]);
    setReminderJob(null);
    setToast("Reminder saved.");
  }
  function completeReminder(id:string) {
    setReminders(items=>items.map(r=>{
      if(r.id!==id)return r;
      if(!r.repeat || r.repeat==="none") return {...r,done:true};
      const next=new Date(r.date+"T12:00:00");
      if(r.repeat==="daily")next.setDate(next.getDate()+1);
      if(r.repeat==="weekly")next.setDate(next.getDate()+7);
      if(r.repeat==="monthly")next.setMonth(next.getMonth()+1);
      const date=`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,"0")}-${String(next.getDate()).padStart(2,"0")}`;
      return {...r,date,done:false};
    }));
  }
  function snoozeReminder(id:string) {
    setReminders(items=>items.map(r=>{
      if(r.id!==id)return r;
      const next=new Date(r.date+"T12:00:00"); next.setDate(next.getDate()+1);
      return {...r,date:`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,"0")}-${String(next.getDate()).padStart(2,"0")}`};
    }));
  }
  return (
    <div className="shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => go("Today")}>
          <span className="brand-mark">
            <Icon name="promise" size={29} />
          </span>
          <span className="brand-word">
            pakki baat<span className="brand-dot">.</span>
          </span>
        </button>
        <div className="workspace">
          <span className="avatar coral">
            {displayName.charAt(0).toUpperCase()}
          </span>
          <div>
            <strong>{displayName}</strong>
            <small>{userEmail || "Your workspace"}</small>
          </div>
        </div>
        <span className="eyebrow nav-label">YOUR WORKSPACE</span>
        <nav>
          {nav.map(([t, i]) => (
            <button
              key={t}
              className={tab === t ? "active" : ""}
              onClick={() => go(t)}
            >
              <Icon name={i} />
              {t}
              {t === "Today" && (due.length + reminders.filter(r=>!r.done && r.date<=day()).length) > 0 && <b>{due.length + reminders.filter(r=>!r.done && r.date<=day()).length}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card">
            <span>Small business. Big heart.</span>
            <p>
              A little less remembering.
              <br />A little more doing what you love.
            </p>
          </div>
          <button className="settings-button" onClick={() => go("Settings")}>
            <Icon name="settings" />
            Settings & feedback
          </button>
          {loggedIn && (
            <button className="settings-button" onClick={() => void handleSignOut()}>
              <Icon name="arrow" />
              Sign out
            </button>
          )}
          <div className="account">
            <span className="avatar">
              {displayName.charAt(0).toUpperCase()}
            </span>
            <div>
              <strong>{displayName}</strong>
              <small>{userEmail || "Local trial workspace"}</small>
            </div>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            Your workspace <span>/</span>
            <strong>{tab}</strong>
          </div>
          <div className="top-actions">
            {authReady && !loggedIn && (
              <button
                type="button"
                className="google-sign-in top-login"
                onClick={() => void startGoogleSignIn()}
                disabled={!cloudConfigured}
                title={
                  cloudConfigured
                    ? "Login or sign up"
                    : "Add Supabase env keys to enable login"
                }
              >
                Login / Sign up
              </button>
            )}
            <button
              type="button"
              className={dark ? "theme-toggle is-dark" : "theme-toggle"}
              role="switch"
              aria-checked={dark}
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
              title={dark ? "Switch to light mode" : "Switch to dark mode"}
              onClick={toggleTheme}
            >
              <span className="theme-sun">
                <Icon name="sun" size={16} />
              </span>
              <span className="theme-moon">
                <Icon name="moon" size={16} />
              </span>
              <span className="theme-toggle-thumb" />
            </button>
            <button
              className="icon-button"
              aria-label="View reminders"
              onClick={() => go("Today")}
            >
              <Icon name="bell" />
            </button>
            <span className="avatar small">
              {displayName.charAt(0).toUpperCase()}
            </span>
          </div>
        </header>
        <div className="content">
          {tab === "Today" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">A LITTLE CLARITY FOR YOUR DAY</div>
                  <h1>
                    Hello, {displayName} <span className="sun">☀</span>
                  </h1>
                  <p>Let’s make room for the work you love.</p>
                </div>
                <button className="primary mobile-primary-action" onClick={() => go("Hisaab")}>
                  <Icon name="plus" size={18} />
                  <span>Add entry</span>
                </button>
              </div>
              <section className="hero">
                <div className="hero-copy">
                  <span className="pill">YOUR BUSINESS, A LITTLE LIGHTER</span>
                  <h2>
                    Every little detail.
                    <br />
                    Taken care of.
                  </h2>
                  <p>
                    A customer message, a voice note, a promise.
                    <br />
                    Let’s turn it into your next clear step.
                  </p>
                  <button
                    className="dark-button"
                    onClick={() => go("Hisaab")}
                  >
                    Tell me what’s new <Icon name="arrow" size={18} />
                  </button>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="art-circle" />
                  <div className="note back">
                    <span>Made with love</span>
                    <div className="cake">♨</div>
                    <span>And a little less worry.</span>
                  </div>
                  <div className="note front">
                    <div className="note-icon">
                      <Icon name="check" />
                    </div>
                    <strong>It’s a pakki baat!</strong>
                    <span>Details saved. Mind at ease.</span>
                    <div className="note-line" />
                    <div className="note-line short" />
                  </div>
                  <span className="spark one">✦</span>
                  <span className="spark two">✧</span>
                </div>
              </section>
              <section className="stats">
                <button
                  onClick={() => {
                    go("Hisaab");
                    setFilter("Payment due");
                  }}
                >
                  <span className="stat-icon peach">₹</span>
                  <div>
                    <span>Payments to collect</span>
                    <strong>{money(balance)}</strong>
                    <small>A gentle nudge goes a long way</small>
                  </div>
                  <Icon name="arrow" size={18} />
                </button>
                <button
                  onClick={() => {
                    go("Hisaab");
                    setFilter("Due now");
                  }}
                >
                  <span className="stat-icon mint">
                    <Icon name="clock" />
                  </span>
                  <div>
                    <span>Due today or earlier</span>
                    <strong>
                      {due.length} <em>commitments</em>
                    </strong>
                    <small>Keep your promises on time</small>
                  </div>
                  <Icon name="arrow" size={18} />
                </button>
                <button
                  onClick={() => {
                    go("Hisaab");
                    setFilter("Waiting");
                  }}
                >
                  <span className="stat-icon yellow">
                    <Icon name="chat" />
                  </span>
                  <div>
                    <span>Waiting for a reply</span>
                    <strong>
                      {open.filter((j) => j.status === "Waiting").length}{" "}
                      <em>customers</em>
                    </strong>
                    <small>Pick up where you left off</small>
                  </div>
                  <Icon name="arrow" size={18} />
                </button>
              </section>
              <section className="today-reminders">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">
                      DON’T KEEP IT ALL IN YOUR HEAD
                    </span>
                    <h2>
                      Reminders{" "}
                      <span className="count">
                        {reminders.filter((r) => !r.done).length}
                      </span>
                    </h2>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => go("Hisaab")}
                  >
                    + Tell me a reminder
                  </button>
                </div>
                {reminders.filter((r) => !r.done).length ? (
                  <div className="reminder-list">
                    {reminders
                      .filter((r) => !r.done)
                      .sort((a, b) =>
                        (a.date + a.time).localeCompare(b.date + b.time)
                      )
                      .slice(0, 5)
                      .map((r) => (
                        <div className="reminder-row" key={r.id}>
                          <span className="reminder-bell">
                            <Icon name="bell" size={18} />
                          </span>
                          <div>
                            <strong>{r.text}</strong>
                            <small>
                              {r.date}
                              {r.time ? " · " + r.time : ""}
                              {r.repeat && r.repeat !== "none"
                                ? " · " + r.repeat
                                : ""}
                            </small>
                          </div>
                          <div className="reminder-actions">
                            <button className="outline mini" onClick={()=>snoozeReminder(r.id)}>Tomorrow</button>
                            <button className="outline mini" onClick={()=>completeReminder(r.id)}>Done ✓</button>
                          </div>
                        </div>
                      ))}
                  </div>
                ) : (
                  <button
                    className="reminder-empty"
                    onClick={() => {
                      go("Hisaab");
                      setToast("Open a customer entry and tap Set reminder.");
                    }}
                  >
                    <Icon name="bell" size={20} />
                    <span>
                      <strong>No reminders yet</strong>
                      <small>
                        Open a customer entry and tap Set reminder.
                      </small>
                    </span>
                  </button>
                )}
              </section>
              <div className="lower-grid">
                <section className="panel">
                  <div className="section-heading">
                    <h2>
                      Needs a little attention{" "}
                      <span className="count">{open.length}</span>
                    </h2>
                    <button
                      className="text-button"
                      onClick={() => go("Hisaab")}
                    >
                      View all <Icon name="arrow" size={15} />
                    </button>
                  </div>
                  {open.length ? (
                    open.slice(0, 4).map(jobCard)
                  ) : (
                    <div className="empty">
                      <span className="empty-icon">
                        <Icon name="check" size={28} />
                      </span>
                      <h3>A fresh start, just for you</h3>
                      <p>
                        Add your first customer message.
                        <br />
                        We’ll help you keep the details together.
                      </p>
                      {!jobs.length && (
                        <button className="text-button" onClick={sample}>
                          Explore with sample commitments →
                        </button>
                      )}
                    </div>
                  )}
                </section>
                <section className="tip-panel">
                  <span className="eyebrow">YOUR POCKET ASSISTANT</span>
                  <h2>
                    “Wait, what did
                    <br />
                    she ask for?”
                  </h2>
                  <p>
                    Sound familiar? Paste a customer’s message and keep the
                    work, amount and date in one place.
                  </p>
                  <button
                    className="outline"
                    onClick={() => go("Hisaab")}
                  >
                    Let’s try it <Icon name="arrow" size={16} />
                  </button>
                  <span className="tiny">
                    Made for your everyday kind of busy.
                  </span>
                </section>
              </div>
              <footer>
                Made with <span>♡</span> by Zorivo
              </footer>
            </>
          )}
          {tab === "My assistant" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">A HELPING HAND, ALWAYS</div>
                  <h1>Your pocket assistant</h1>
                  <p>
                    Type or speak naturally. Orders, payments, baki and
                    reminders all work here.
                  </p>
                </div>
              </div>
              <section className="chat-layout">
                <div className="chat-panel">
                  <div className="chat-header">
                    <Icon name="promise" />
                    <div>
                      <strong>Pakki Baat</strong>
                      <small>Let’s get the details together</small>
                    </div>
                  </div>
                  <div
                    className="chat-body"
                    ref={chatBodyRef}
                    role="log"
                    aria-label="Assistant conversation"
                    aria-live="polite"
                  >
                    {authReady && !loggedIn && (
                      <div className="assistant-login-card">
                        <div>
                          <strong>
                            {cloudConfigured
                              ? "Login to use AI voice"
                              : "AI login setup needed"}
                          </strong>
                          <p>
                            {cloudConfigured
                              ? "Sign in or sign up with Google so Pakki Baat can listen to voice notes, write the text, and prepare the details slip."
                              : "Add the Supabase public keys to .env.local, then restart localhost to show Google login."}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="google-sign-in compact"
                          onClick={() => void startGoogleSignIn()}
                          disabled={!cloudConfigured}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path
                              fill="#4285F4"
                              d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.6h3.3c1.9-1.8 2.9-4.4 2.9-7.5Z"
                            />
                            <path
                              fill="#34A853"
                              d="M12 22c2.7 0 5-.9 6.7-2.3l-3.3-2.6c-.9.6-2.1 1-3.4 1a5.9 5.9 0 0 1-5.5-4.1H3.1v2.7A10 10 0 0 0 12 22Z"
                            />
                            <path
                              fill="#FBBC05"
                              d="M6.5 14a6 6 0 0 1 0-3.9V7.3H3.1a10 10 0 0 0 0 9.4L6.5 14Z"
                            />
                            <path
                              fill="#EA4335"
                              d="M12 5.9c1.5 0 2.8.5 3.9 1.5l2.9-2.8A9.7 9.7 0 0 0 3.1 7.3l3.4 2.8A5.9 5.9 0 0 1 12 5.9Z"
                            />
                          </svg>
                          Continue with Google
                        </button>
                      </div>
                    )}
                    <span className="chat-date">Your conversation</span>
                    <div className="bubble">
                      <strong>Hi {displayName}!</strong>
                      <p>
                        Tell me what happened just like you would in WhatsApp —
                        an order, payment, baki or reminder. I’ll organise it
                        for you.
                      </p>
                    </div>
                    {chatTurns.filter(turn => selectedCustomer ? turn.customer === selectedCustomer : !turn.customer).map((turn) => (
                      <div
                        key={turn.id}
                        className={`chat-turn ${
                          turn.role === "me" ? "from-me" : "from-assistant"
                        }`}
                      >
                        <span className="chat-speaker">
                          {turn.role === "me"
                            ? "You"
                            : turn.replyFor
                            ? "Suggested customer reply"
                            : "Pakki Baat"}
                        </span>
                        <div className="chat-turn-text">{turn.text}</div>
                        {turn.voiceId && (
                          <div className="chat-voice">
                            <small>
                              {turn.duration
                                ? "Recorded " +
                                  Math.floor(turn.duration / 60) +
                                  ":" +
                                  String(turn.duration % 60).padStart(2, "0")
                                : "Sent voice note"}
                            </small>
                            {voiceUrls[turn.voiceId] === undefined ? (
                              <small>Loading voice note…</small>
                            ) : voiceUrls[turn.voiceId] ? (
                              <AudioPlayer
                                audioBlob={voiceFilesRef.current[turn.voiceId]}
                                audioUrl={voiceUrls[turn.voiceId]}
                                duration={turn.duration || 0}
                                onTranscribe={() => retryVoice(turn.voiceId!)}
                                onDownload={() =>
                                  downloadVoiceInChat(turn.voiceId!)
                                }
                                onDelete={() => removeVoice(turn.voiceId!)}
                              />
                            ) : (
                              <small>Audio unavailable on this device.</small>
                            )}
                          </div>
                        )}
                        {(turn.text.includes("Please continue with Google") ||
                          turn.text.includes(
                            "Continue with Google in Settings"
                          )) && (
                          <div className="login-prompt-actions">
                            <button
                              type="button"
                              className="google-sign-in compact"
                              onClick={() => void startGoogleSignIn()}
                              disabled={!cloudConfigured}
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path
                                  fill="#4285F4"
                                  d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.6h3.3c1.9-1.8 2.9-4.4 2.9-7.5Z"
                                />
                                <path
                                  fill="#34A853"
                                  d="M12 22c2.7 0 5-.9 6.7-2.3l-3.3-2.6c-.9.6-2.1 1-3.4 1a5.9 5.9 0 0 1-5.5-4.1H3.1v2.7A10 10 0 0 0 12 22Z"
                                />
                                <path
                                  fill="#FBBC05"
                                  d="M6.5 14a6 6 0 0 1 0-3.9V7.3H3.1a10 10 0 0 0 0 9.4L6.5 14Z"
                                />
                                <path
                                  fill="#EA4335"
                                  d="M12 5.9c1.5 0 2.8.5 3.9 1.5l2.9-2.8A9.7 9.7 0 0 0 3.1 7.3l3.4 2.8A5.9 5.9 0 0 1 12 5.9Z"
                                />
                              </svg>
                              Continue with Google
                            </button>
                          </div>
                        )}
                        {turn.replyFor && (
                          <div className="saved-detail-card"><strong>{turn.replyFor.customer}</strong><span>{turn.replyFor.work}</span><dl><div><dt>Total</dt><dd>{money(turn.replyFor.total)}</dd></div><div><dt>Received</dt><dd>{money(turn.replyFor.paid)}</dd></div><div><dt>Baki</dt><dd>{money(turn.replyFor.total-turn.replyFor.paid)}</dd></div><div><dt>Due</dt><dd>{turn.replyFor.date||"Date not set"}{turn.replyFor.time?" · "+turn.replyFor.time:""}</dd></div><div><dt>Status</dt><dd>{turn.replyFor.status}</dd></div></dl></div>
                        )}
                        {turn.replyFor && (
                          <div className="chat-turn-actions">
                            <button
                              type="button"
                              onClick={() => copy(turn.text)}
                            >
                              Copy reply
                            </button>
                            <button
                              type="button"
                              onClick={() => setDraft(turn.replyFor!)}
                            >
                              Edit details
                            </button>
                            {turn.replyFor.date && (
                              <button
                                type="button"
                                onClick={() =>
                                  download(
                                    calendarFile(turn.replyFor!),
                                    "pakki-baat-reminder.ics"
                                  )
                                }
                              >
                                Add reminder
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                    {!chatTurns.length && (
                      <button
                        className="example"
                        onClick={() =>
                          setMessage(
                            "Riya wants a 2 kg chocolate cake. Total ₹2400. ₹1000 advance. Delivery on Saturday at 5 pm."
                          )
                        }
                      >
                        Try an example{" "}
                        <span>“Riya wants a 2 kg chocolate cake…”</span>
                      </button>
                    )}
                  </div>
                  <ChatComposer
                    message={message}
                    onMessageChange={setMessage}
                    onCapture={capture}
                    onToast={setToast}
                    onDraft={receiveAiDraft}
                    onSendVoice={sendVoice}
                    voiceBusy={voiceBusy}
                  />
                </div>
                <aside className="capture-help">
                  <h3>Talk it through.</h3>
                  {[
                    [
                      "1",
                      "Start the conversation",
                      "Type it or say it naturally, just like sending a WhatsApp message.",
                    ],
                    [
                      "2",
                      "Answer the follow-up questions",
                      "I’ll ask only for the missing detail, one question at a time.",
                    ],
                    [
                      "3",
                      "Done and remembered",
                      "Orders go to Hisaab and reminders appear on Today.",
                    ],
                  ].map(([n, t, d]) => (
                    <div key={n}>
                      <b>{n}</b>
                      <section>
                        <strong>{t}</strong>
                        <p>{d}</p>
                      </section>
                    </div>
                  ))}
                  <p className="privacy-note">
                    Screenshot and voice-note understanding need an AI service
                    connection. Your pasted text is kept with each commitment.
                  </p>
                </aside>
              </section>
            </>
          )}
          {tab === "Hisaab" && (
            <>
              {!selectedCustomer ? (
                <>
                  <div className="page-heading customer-heading">
                    <div>
                      <div className="eyebrow">YOUR DIGITAL HISAAB BOOK</div>
                      <h1>Hisaab</h1>
                      <p>One customer, one place. Open a name and continue where you left off.</p>
                    </div>
                    <button className="primary mobile-primary-action" onClick={() => { setNewCustomerName(""); setNewCustomerOpen(true); }}><Icon name="plus" /><span>New entry</span></button>
                  </div>
                  <label className="search customer-search"><Icon name="search"/><input aria-label="Search customers" placeholder="Search customer name…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
                  <div className="customer-list-mobile">
                    {customerNames.filter(name=>name.toLowerCase().includes(query.toLowerCase())).map(name=>{
                      const entries=jobs.filter(j=>j.customer===name);
                      const baki=entries.reduce((sum,j)=>sum+j.total-j.paid,0);
                      const latest=entries[0];
                      return <button className="customer-row-card" key={name} onClick={()=>{setSelectedCustomer(name);setMessage("");setCustomerChatOpen(false);}}>
                        <span className="avatar large">{name[0]}</span>
                        <span className="customer-row-main"><strong>{name}</strong><small>{latest?.work || "Ready for first entry"} · {entries.length} saved {entries.length===1?"entry":"entries"}</small></span>
                        <span className="customer-row-money"><strong>{money(baki)}</strong><small>baki</small></span>
                        <Icon name="arrow" size={17}/>
                      </button>;
                    })}
                  </div>
                  {!customerNames.length && <div className="empty"><h3>Your hisaab book is empty</h3><p>Tap New entry, add a customer name, then type or speak naturally.</p></div>}
                </>
              ) : (
                <section className="customer-detail">
                  <button className="text-button customer-back" onClick={()=>{setSelectedCustomer(null);setMessage("");}}>← Hisaab</button>
                  <div className="customer-profile-head">
                    <span className="avatar large customer-profile-avatar">{selectedCustomer?.[0] || "?"}</span>
                    <div className="customer-profile-copy"><span className="eyebrow">CUSTOMER HISAAB</span><h1>{selectedCustomer}</h1><p>{customerJobs.length} saved {customerJobs.length===1?"entry":"entries"} · {money(selectedBaki)} baki</p></div>
                   </div>
                  {customerChatOpen ? (
                    <section className="smart-entry-panel">
                      <div className="smart-entry-head">
                        <div><span className="eyebrow">NEW ENTRY</span><h2>{entryMode==="quick" ? `Tell me what happened with ${selectedCustomer}` : `Add details for ${selectedCustomer}`}</h2><p>{entryMode==="quick" ? "Type or speak naturally. Pakki Baat will fill the details for you." : "Fill only what you know. Date and time are optional."}</p></div>
                        <button className="icon-button" aria-label="Close entry" onClick={()=>{setCustomerChatOpen(false);setPendingJob(null);setMessage("");}}><Icon name="close"/></button>
                      </div>
                      <div className="entry-mode-tabs" role="tablist" aria-label="Entry method">
                        <button type="button" className={entryMode==="quick"?"active":""} onClick={()=>startEntry("quick")}>✨ Quick entry</button>
                        <button type="button" className={entryMode==="form"?"active":""} onClick={()=>startEntry("form")}>Form</button>
                      </div>
                      {entryMode==="quick" ? (
                        <>
                          <ChatComposer message={message} onMessageChange={setMessage} onCapture={capture} onToast={setToast} onDraft={receiveAiDraft} onSendVoice={sendVoice} voiceBusy={voiceBusy}/>
                          <p className="smart-example">Try: “2 kg chocolate cake, ₹5,000 total, ₹2,000 received, Sunday 5 PM.”</p>
                          {pendingJob?.work?.trim() && (
                            <article className="smart-preview-card">
                              <div className="smart-preview-title"><div><span className="eyebrow">PAKKI BAAT FILLED THIS</span><h3>{pendingJob.work}</h3></div><button type="button" onClick={()=>setEntryMode("form")}>Edit</button></div>
                              <dl><div><dt>Total</dt><dd>{money(pendingJob.total)}</dd></div><div><dt>Received</dt><dd>{money(pendingJob.paid)}</dd></div><div className="baki"><dt>Baki</dt><dd>{money(Math.max(0,pendingJob.total-pendingJob.paid))}</dd></div><div><dt>Due</dt><dd>{pendingJob.date || "Optional"}</dd></div><div><dt>Time</dt><dd>{pendingJob.time || "Optional"}</dd></div></dl>
                              <button type="button" className="primary smart-save" onClick={finishCustomerChat}>Save to {selectedCustomer} <Icon name="check" size={17}/></button>
                            </article>
                          )}
                        </>
                      ) : pendingJob && (
                        <form className="inline-entry-form" onSubmit={e=>{e.preventDefault();finishCustomerChat();}}>
                          <label className="full">What’s the work? *<textarea autoFocus required maxLength={500} placeholder="e.g. 2 kg chocolate cake" value={pendingJob.work || ""} onChange={e=>setPendingJob({...pendingJob,work:e.target.value})}/></label>
                          <div className="inline-form-grid">
                            <label>Total amount (₹)<input inputMode="decimal" type="number" min="0" step="0.01" placeholder="e.g. 2000" value={amountValue(pendingJob.total)} onChange={e=>updatePendingAmount("total",e.target.value)}/></label>
                            <label>Amount received (₹)<input inputMode="decimal" type="number" min="0" step="0.01" placeholder="e.g. 1000" value={amountValue(pendingJob.paid)} onChange={e=>updatePendingAmount("paid",e.target.value)}/></label>
                            <label>Due date <span>optional</span><input type="date" value={pendingJob.date || ""} onChange={e=>setPendingJob({...pendingJob,date:e.target.value})}/></label>
                            <label>Due time <span>optional</span><input type="time" value={pendingJob.time || ""} onChange={e=>setPendingJob({...pendingJob,time:e.target.value})}/></label>
                          </div>
                          <button type="submit" className="primary smart-save" disabled={!pendingJob.work.trim() || pendingJob.paid>pendingJob.total}>Save to {selectedCustomer} <Icon name="check" size={17}/></button>
                          {pendingJob.paid>pendingJob.total && <p className="form-error">Received amount cannot be more than the total.</p>}
                        </form>
                      )}
                    </section>
                  ) : (
                    <div className="entry-choice">
                      <div><span className="eyebrow">NEW ENTRY</span><h3>Add something to {selectedCustomer}</h3><p>Speak naturally or use the simple form.</p></div>
                      <div className="entry-choice-actions"><button className="primary" type="button" onClick={()=>startEntry("quick")}>✨ Type or speak</button><button className="outline" type="button" onClick={()=>startEntry("form")}>Fill a form</button></div>
                    </div>
                  )}
                  <div className="customer-book-section"><div className="section-title-row"><div><span className="eyebrow">SAVED ENTRIES</span><h2>History</h2></div></div>
                    <div className="saved-entry-grid">{customerJobs.map((j,index)=><article className="saved-detail-card customer-saved-card" key={`${j.id || "entry"}-${j.date || "saved"}-${index}`}><strong>{j.work}</strong><dl><div><dt>Total</dt><dd>{money(j.total)}</dd></div><div><dt>Received</dt><dd>{money(j.paid)}</dd></div><div><dt>Baki</dt><dd>{money(j.total-j.paid)}</dd></div><div><dt>Due</dt><dd>{j.date||"Not set"}{j.time?" · "+j.time:""}</dd></div></dl><div className="chat-turn-actions saved-card-actions"><button type="button" className="card-action" onClick={()=>copy(replyText(j))}><Icon name="copy" size={15}/> Copy</button><button type="button" className="card-action whatsapp-soon" disabled title="Coming soon"><Icon name="chat" size={15}/> WhatsApp <span>Soon</span></button><button type="button" className="card-action" onClick={()=>setDraft(j)}>Edit details</button><button type="button" className="card-action reminder-action" onClick={()=>openReminder(j)}><Icon name="bell" size={15}/> Reminder</button></div></article>)}</div>
                  </div>
                  {customerReminders.length>0 && <div className="customer-book-section"><span className="eyebrow">REMINDERS</span>{customerReminders.map(r=><div className="customer-mini-reminder" key={r.id}><Icon name="bell" size={16}/><span>{r.text}</span><small>{r.date}{r.time?" · "+r.time:""}</small><button className="text-button" onClick={()=>completeReminder(r.id)}>Done</button></div>)}</div>}
                </section>
              )}
            </>
          )}
          {false && tab === "Customers" && (
            <>
              {!selectedCustomer ? (
                <>
                  <div className="page-heading customer-heading">
                    <div>
                      <div className="eyebrow">YOUR CUSTOMER BOOK</div>
                      <h1>Customers</h1>
                      <p>Open a customer to see their orders, payments, baki and reminders together.</p>
                    </div>
                    <button className="primary mobile-add-customer" onClick={() => { go("Hisaab"); setMessage("New customer: "); }}>+ Add new</button>
                  </div>
                  <label className="search customer-search"><Icon name="search"/><input aria-label="Search customers" placeholder="Search customer name…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
                  <div className="customer-list-mobile">
                    {customerNames.filter(name=>name.toLowerCase().includes(query.toLowerCase())).map(name=>{
                      const entries=jobs.filter(j=>j.customer===name);
                      const baki=entries.reduce((sum,j)=>sum+j.total-j.paid,0);
                      const latest=entries[0];
                      return <button className="customer-row-card" key={name} onClick={()=>setSelectedCustomer(name)}>
                        <span className="avatar large">{name[0]}</span>
                        <span className="customer-row-main"><strong>{name}</strong><small>{latest?.work || "Customer"} · {entries.length} {entries.length===1?"entry":"entries"}</small></span>
                        <span className="customer-row-money"><strong>{money(baki)}</strong><small>baki</small></span>
                        <Icon name="arrow" size={17}/>
                      </button>;
                    })}
                  </div>
                  {!customerNames.length && <div className="empty"><h3>No customers yet</h3><p>Tap Add new and tell Pakki Baat the customer name and what happened.</p><button className="primary" onClick={()=>{go("Hisaab");setMessage("New customer: ");}}>+ Add first customer</button></div>}
                </>
              ) : (
                <section className="customer-detail">
                  <button className="text-button customer-back" onClick={()=>setSelectedCustomer(null)}>← All customers</button>
                  <div className="customer-profile-head">
                    <span className="avatar large">{selectedCustomer?.[0] || "?"}</span>
                    <div><h1>{selectedCustomer}</h1><p>{customerJobs.length} {customerJobs.length===1?"entry":"entries"} in this customer book</p></div>
                  </div>
                  <div className="customer-summary-strip">
                    <div><small>Total business</small><strong>{money(customerJobs.reduce((s,j)=>s+j.total,0))}</strong></div>
                    <div><small>Received</small><strong>{money(customerJobs.reduce((s,j)=>s+j.paid,0))}</strong></div>
                    <div className="baki"><small>Baki</small><strong>{money(selectedBaki)}</strong></div>
                  </div>
                  <div className="customer-quick-actions">
                    <button className="primary" onClick={()=>openCustomerAssistant()}>+ Add update</button>
                    <button className="outline" onClick={()=>openCustomerAssistant("Received ₹")} >₹ Add payment</button>
                    <button className="outline" onClick={()=>openCustomerAssistant("Remind me ")}><Icon name="bell" size={17}/> Add reminder</button>
                    <button className="outline" onClick={()=>openCustomerAssistant("Note: ")}>Add note</button>
                  </div>
                  <div className="customer-book-section">
                    <div className="section-title-row"><div><span className="eyebrow">HISAAB & WORK</span><h2>History</h2></div></div>
                    <div className="customer-timeline">
                      {customerJobs.map(j=><button className="customer-timeline-entry" key={j.id} onClick={()=>setDraft(j)}>
                        <span className="timeline-dot"/>
                        <span className="timeline-content"><strong>{j.work}</strong><small>{j.date || "No date"}{j.time?" · "+j.time:""}</small><span>Total {money(j.total)} · Received {money(j.paid)}</span></span>
                        <span className="timeline-baki"><strong>{money(j.total-j.paid)}</strong><small>baki</small></span>
                      </button>)}
                    </div>
                  </div>
                  {customerPayments.length>0 && <div className="customer-book-section"><span className="eyebrow">PAYMENTS</span><div className="customer-timeline">{customerPayments.map(p=><div className="customer-history-row" key={p.id}><span><strong>Payment received</strong><small>{p.date}{p.note?" · "+p.note:""}</small></span><strong>+{money(p.amount)}</strong></div>)}</div></div>}
                  {customerNotes.length>0 && <div className="customer-book-section"><span className="eyebrow">NOTES</span><div className="customer-timeline">{customerNotes.map(n=><div className="customer-history-row" key={n.id}><span><strong>{n.text}</strong><small>{new Date(n.createdAt).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}</small></span></div>)}</div></div>}
                  {customerReminders.length>0 && <div className="customer-book-section"><span className="eyebrow">REMINDERS</span>{customerReminders.map(r=><div className="customer-mini-reminder" key={r.id}><Icon name="bell" size={16}/><span>{r.text}</span><small>{r.date}{r.time?" · "+r.time:""}</small><button className="text-button" onClick={()=>completeReminder(r.id)}>Done</button></div>)}</div>}
                </section>
              )}
            </>
          )}
          {tab === "Settings" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">MAKE YOURSELF AT HOME</div>
                  <h1>Your workspace</h1>
                  <p>A few details to make Pakki Baat yours.</p>
                </div>
              </div>
              <section className="settings-panel panel">
                <label>
                  Your name
                  <input
                    value={owner}
                    maxLength={60}
                    onChange={(e) => setOwner(e.target.value)}
                    placeholder={userName || "Your name"}
                  />
                  <small>This is how Pakki Baat will address you.</small>
                </label>
                <label>
                  Business name
                  <input
                    value={business}
                    maxLength={100}
                    onChange={(e) => setBusiness(e.target.value)}
                  />
                </label>
                <div className="notice">
                  <strong>Local trial mode</strong>
                  <p>
                    Your data is saved in this browser. Export a backup before
                    clearing browser data or switching devices. Use a cloud
                    backup after Google sign-in to move between devices.
                  </p>
                </div>
                <button
                  className="outline"
                  onClick={() =>
                    download(
                      JSON.stringify(
                        { jobs, owner, business, reminders, payments, notes },
                        null,
                        2
                      ),
                      "pakki-baat-backup.json"
                    )
                  }
                >
                  Export my data
                </button>
                <label className="upload">
                  Restore from a backup
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void importBackup(f);
                      e.target.value = "";
                    }}
                  />
                </label>
                <CloudSettings
                  snapshot={{ jobs, owner, business, reminders, payments, notes }}
                  onRestore={restore}
                  dark={dark}
                  onToggleTheme={toggleTheme}
                />
                <section
                  className="future-card"
                  aria-labelledby="future-whatsapp-title"
                >
                  <div className="future-card-heading">
                    <span className="future-icon">
                      <Icon name="chat" size={20} />
                    </span>
                    <div>
                      <span className="future-badge">COMING SOON</span>
                      <h2 id="future-whatsapp-title">
                        Send directly to WhatsApp
                      </h2>
                    </div>
                  </div>
                  <p>
                    Send confirmations and friendly reminders to customers
                    without leaving Pakki Baat.
                  </p>
                  <ul>
                    <li>Send a commitment summary to the customer</li>
                    <li>Share payment and due-date reminders</li>
                    <li>Review every message before it is sent</li>
                  </ul>
                  <button
                    type="button"
                    className="future-whatsapp-button"
                    disabled
                  >
                    <Icon name="chat" size={17} /> WhatsApp direct send · Coming
                    soon
                  </button>
                </section>
                <label>
                  Tell us what could be better
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="What felt easy? What got in your way?"
                  />
                </label>
                <button
                  className="outline"
                  disabled={!feedback.trim()}
                  onClick={shareFeedback}
                >
                  Share feedback
                </button>
                <button
                  className="primary"
                  disabled={!feedback.trim()}
                  onClick={() => {
                    download(feedback, "pakki-baat-feedback.txt");
                    setFeedback("");
                    setToast(
                      "Feedback downloaded. Send this file to the creator."
                    );
                  }}
                >
                  Download feedback
                </button>
              </section>
            </>
          )}
        </div>
      </main>
      <nav className="mobile-nav">
        {nav.map(([t, i]) => (
          <button
            aria-label={t}
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => go(t)}
          >
            <Icon name={i} size={21} />
            <span>{t}</span>
          </button>
        ))}
        <button onClick={() => go("Settings")}>
          <Icon name="settings" size={21} />
          <span>Settings</span>
        </button>
      </nav>
      {reminderJob && (
        <div className="modal-backdrop" onClick={()=>setReminderJob(null)}>
          <section className="reminder-sheet" role="dialog" aria-modal="true" aria-labelledby="reminder-title" onClick={e=>e.stopPropagation()}>
            <div className="reminder-sheet-head"><div><span className="new-customer-icon"><Icon name="bell" size={22}/></span><span className="eyebrow">REMINDER</span><h2 id="reminder-title">Remind me about {reminderJob.customer}</h2></div><button className="icon-button" aria-label="Close reminder" onClick={()=>setReminderJob(null)}><Icon name="close"/></button></div>
            <label className="reminder-text-label">Reminder<input value={reminderText} onChange={e=>setReminderText(e.target.value)} maxLength={500}/></label>
            <div className="reminder-block"><strong>When?</strong><div className="reminder-chips"><button type="button" onClick={()=>quickReminderDate("today")}>Today</button><button type="button" onClick={()=>quickReminderDate("tomorrow")}>Tomorrow</button><label className="date-chip"><Icon name="calendar" size={16}/><input aria-label="Pick reminder date" type="date" min={day()} value={reminderDate} onChange={e=>setReminderDate(e.target.value)}/></label></div></div>
            <div className="reminder-block"><strong>Time</strong><div className="reminder-chips"><button type="button" onClick={()=>setReminderTime("09:00")}>Morning</button><button type="button" onClick={()=>setReminderTime("15:00")}>Afternoon</button><button type="button" onClick={()=>setReminderTime("19:00")}>Evening</button><label className="date-chip"><Icon name="clock" size={16}/><input aria-label="Pick reminder time" type="time" value={reminderTime} onChange={e=>setReminderTime(e.target.value)}/></label></div></div>
            <div className="reminder-block"><strong>Repeat?</strong><div className="reminder-chips">{([["none","Once"],["daily","Daily"],["weekly","Weekly"],["monthly","Monthly"]] as const).map(([value,label])=><button type="button" key={value} className={reminderRepeat===value?"selected":""} onClick={()=>setReminderRepeat(value)}>{label}</button>)}</div></div>
            <div className="reminder-sheet-actions"><button type="button" onClick={()=>setReminderJob(null)}>Cancel</button><button type="button" className="primary" disabled={!reminderDate || !reminderText.trim()} onClick={saveReminder}>Save reminder</button></div>
          </section>
        </div>
      )}
      {newCustomerOpen && (
        <div className="modal-backdrop" onClick={() => setNewCustomerOpen(false)}>
          <section className="new-customer-modal" role="dialog" aria-modal="true" aria-labelledby="new-customer-title" onClick={e=>e.stopPropagation()}>
            <button className="icon-button new-customer-close" aria-label="Close" onClick={()=>setNewCustomerOpen(false)}><Icon name="close"/></button>
            <span className="new-customer-icon"><Icon name="people" size={24}/></span>
            <span className="eyebrow">NEW HISAAB</span>
            <h2 id="new-customer-title">Who is this for?</h2>
            <p>Add the customer name. You can tell Pakki Baat the rest naturally.</p>
            <form onSubmit={e=>{
              e.preventDefault();
              const customer=newCustomerName.trim();
              if(!customer)return;
              setNotes(items=>items.some(n=>n.customer===customer)?items:[{id:crypto.randomUUID(),customer,text:"Customer created",createdAt:new Date().toISOString()},...items]);
              setSelectedCustomer(customer);
              setMessage("");
              setCustomerChatOpen(false);
              setEntryMode("quick");
              setNewCustomerOpen(false);
            }}>
              <label>Customer name<input autoFocus maxLength={100} placeholder="e.g. Asha" value={newCustomerName} onChange={e=>setNewCustomerName(e.target.value)}/></label>
              <button className="primary" type="submit" disabled={!newCustomerName.trim()}>Continue <Icon name="arrow" size={17}/></button>
            </form>
          </section>
        </div>
      )}
      {draft && (
        <div className="modal-backdrop" onClick={() => setDraft(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="section-heading">
              <div>
                <span className="eyebrow">YOU’RE IN CONTROL</span>
                <h2 id="review-title">Edit details</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close review"
                onClick={() => setDraft(null)}
              >
                <Icon name="close" />
              </button>
            </div>
            <p>Fill in anything missing. Nothing is sent automatically.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <div className="form-grid">
                <label className="full">
                  Customer name *
                  <input
                    autoFocus
                    required
                    maxLength={100}
                    value={draft.customer || ""}
                    onChange={(e) =>
                      setDraft({ ...draft, customer: e.target.value })
                    }
                  />
                </label>
                <label className="full">
                  What’s the work? *
                  <textarea
                    required
                    maxLength={500}
                    value={draft.work || ""}
                    onChange={(e) =>
                      setDraft({ ...draft, work: e.target.value })
                    }
                  />
                </label>
                <label>
                  Total amount (₹)
                  <input
                    type="number"
                    min="0"
                    max="100000000"
                    step="0.01"
                    value={amountValue(draft.total)}
                    placeholder="e.g. 2000"
                    onChange={(e) =>
                      setDraft({ ...draft, total: e.target.value === "" ? 0 : Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Amount received (₹)
                  <input
                    type="number"
                    min="0"
                    max={draft.total}
                    step="0.01"
                    value={amountValue(draft.paid)}
                    placeholder="e.g. 1000"
                    onChange={(e) =>
                      setDraft({ ...draft, paid: e.target.value === "" ? 0 : Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Due date
                  <input
                    type="date"
                    value={draft.date || ""}
                    onChange={(e) =>
                      setDraft({ ...draft, date: e.target.value })
                    }
                  />
                </label>
                <label>
                  Due time
                  <input
                    type="time"
                    value={draft.time || ""}
                    onChange={(e) =>
                      setDraft({ ...draft, time: e.target.value })
                    }
                  />
                </label>
                <label className="full">
                  Customer confirmation
                  <select
                    value={draft.status}
                    onChange={(e) =>
                      setDraft({ ...draft, status: e.target.value })
                    }
                  >
                    {["Waiting", "Confirmed", "Completed"].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
              </div>

              {draft.source && (
                <details>
                  <summary>Original message</summary>
                  <p>{draft.source}</p>
                </details>
              )}
              <div className="modal-actions">
                {draft.id && (
                  <button
                    type="button"
                    className="text-button danger"
                    onClick={() => {
                      if (
                        confirm(
                          "Delete this commitment? This cannot be undone."
                        )
                      ) {
                        setJobs(jobs.filter((j) => j.id !== draft.id));
                        setChatTurns((turns) =>
                          turns.filter((turn) => turn.replyFor?.id !== draft.id)
                        );
                        setDraft(null);
                      }
                    }}
                  >
                    Delete
                  </button>
                )}
                <button className="primary" type="submit">
                  Save changes <Icon name="check" size={18} />
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
