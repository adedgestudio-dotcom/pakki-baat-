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
    [dark, setDark] = useState(false);
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
    if (
      !ready ||
      !loggedIn ||
      !activeUserIdRef.current ||
      !cloudHydratedRef.current
    )
      return;
    const snapshot = { jobs, owner, business, reminders };
    writeLocalWorkspace(activeUserIdRef.current, snapshot);
    const timer = window.setTimeout(() => {
      void saveCloud(snapshot).catch(() =>
        setToast("Saved on this device. Cloud backup could not update yet.")
      );
    }, 500);
    return () => window.clearTimeout(timer);
  }, [jobs, owner, business, reminders, ready, loggedIn]);

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
    ["My assistant", "chat"],
    ["Hisaab", "list"],
    ["Customers", "people"],
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
    setTab(t);
    setQuery("");
    setFilter("All");
  }
  function toggleTheme() {
    const next = !dark;
    setDark(next);
    localStorage.setItem("pakki-baat-theme", next ? "dark" : "light");
    document.documentElement.dataset.theme = next ? "dark" : "light";
  }
  function say(role: ChatTurn["role"], text: string, replyFor?: Job) {
    setChatTurns((turns) =>
      [...turns, { id: crypto.randomUUID(), role, text, replyFor }].slice(-80)
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
        },
      ].slice(-80)
    );

    if (transcript) {
      setMessage("");
      // Process the transcribed voice message through unified flow
      void processAssistantMessage(transcript, "voice");
    } else {
      void transcribeSentVoice(file, id);
    }

    try {
      await saveVoice(id, file);
    } catch {
      setToast(
        "Voice sent, but this browser could not store the audio for later playback."
      );
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
        say(
          "assistant",
          "Please continue with Google to turn on AI voice transcription. After sign in, tap Retry transcription and I will listen to this voice note, write the text, and prepare the details slip."
        );
      } else {
        say(
          "assistant",
          "Your voice note is in the chat, but I could not read it: " +
            reason +
            " Tap Retry transcription or type the details."
        );
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
              : undefined,
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

      setPendingJob(result.updated);

      if (result.isComplete) {
        // Save the commitment
        const item: Job = {
          ...blank(),
          ...result.updated,
          id: crypto.randomUUID(),
          customer: result.updated.customer?.trim() || "",
          work: result.updated.work?.trim() || "",
          status: result.updated.confirmed ? "Confirmed" : "Waiting",
        };

        setJobs((p) => [item, ...p]);
        setPendingJob(null);
        setChatStep("customer");

        say("assistant", "Saved ✓");
        say("assistant", `Here's what I can send to ${item.customer}:`, item);
      } else if (result.nextQuestion) {
        say("assistant", result.nextQuestion);
      }
    } catch (error) {
      console.error("❌ Error processing message:", error);
      const reason = error instanceof Error ? error.message : "Unknown error";
      say(
        "assistant",
        "I heard your message, but I could not process it: " + reason
      );
    }
  }

  function capture() {
    const input = message.trim();
    if (!input || voiceBusy) return;
    setMessage("");
    say("me", input);
    void processAssistantMessage(input, "text");
  }

  function receiveAiDraft(job: Job) {
    setPendingJob(job);
    setChatStep("ready");
    say(
      "assistant",
      "I read the attachment and filled in a draft. Open Review details to check it, or keep chatting."
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
    setJobs((p) => [item, ...p.filter((j) => j.id !== item.id)]);
    setDraft(null);

    setPendingJob(null);
    setChatStep("customer");
    setTab("My assistant");
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
        <strong>{j.customer}</strong>
        <span>{j.work}</span>
        <small>
          {j.date
            ? new Date(j.date + "T12:00:00").toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
              })
            : "Date to be agreed"}
          {j.time ? " · " + j.time : ""}
        </small>
      </span>
      <span className="job-end">
        <strong>{money(j.total - j.paid)}</strong>
        <span className={j.status === "Confirmed" ? "tag green" : "tag"}>
          {j.status}
        </span>
      </span>
      <Icon name="arrow" size={16} />
    </button>
  );
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
              {t === "Today" && due.length > 0 && <b>{due.length}</b>}
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
            <span className="saved-dot" />
            {ready
              ? loggedIn
                ? "Google connected"
                : "Device workspace"
              : "Storage unavailable"}
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
            {cloudConfigured && authReady && loggedIn && (
              <button
                type="button"
                className="text-button top-signout"
                onClick={() => void handleSignOut()}
              >
                Sign out
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
                <button className="primary" onClick={() => go("My assistant")}>
                  <Icon name="plus" size={18} />
                  Add customer message
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
                    onClick={() => go("My assistant")}
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
                    onClick={() => go("My assistant")}
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
                          <button
                            className="outline mini"
                            onClick={() =>
                              setReminders((items) =>
                                items.map((x) =>
                                  x.id === r.id ? { ...x, done: true } : x
                                )
                              )
                            }
                          >
                            Done ✓
                          </button>
                        </div>
                      ))}
                  </div>
                ) : (
                  <button
                    className="reminder-empty"
                    onClick={() => {
                      go("My assistant");
                      setMessage("Remind me tomorrow at 10 AM to ");
                    }}
                  >
                    <Icon name="bell" size={20} />
                    <span>
                      <strong>No reminders yet</strong>
                      <small>
                        Try “Remind me tomorrow at 10 to call Sakina.”
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
                    onClick={() => go("My assistant")}
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
                    {chatTurns.map((turn) => (
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
              <div className="page-heading">
                <div>
                  <div className="eyebrow">ALL YOUR PROMISES, TOGETHER</div>
                  <h1>Hisaab</h1>
                  <p>
                    Your work, received money and baki — like your book, only
                    easier to find.
                  </p>
                </div>
                <button className="primary" onClick={() => setDraft(blank())}>
                  <Icon name="plus" />
                  Add entry
                </button>
              </div>
              <div className="toolbar">
                <label className="search">
                  <Icon name="search" size={19} />
                  <input
                    aria-label="Search commitments"
                    placeholder="Search name, work or hisaab…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <select
                  aria-label="Filter commitments"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  {[
                    "All",
                    "Waiting",
                    "Confirmed",
                    "Completed",
                    "Payment due",
                    "Due now",
                  ].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </div>
              <section className="panel">
                {visible.length ? (
                  visible.map(jobCard)
                ) : (
                  <div className="empty">
                    <Icon name="list" size={36} />
                    <h3>Your hisaab book is empty</h3>
                    <p>
                      Tell Pakki Baat about an order or payment to get started.
                    </p>
                  </div>
                )}
              </section>
            </>
          )}
          {tab === "Customers" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">THE PEOPLE BEHIND YOUR BUSINESS</div>
                  <h1>Your customers</h1>
                  <p>Every conversation, a little easier to remember.</p>
                </div>
              </div>
              <label className="search">
                <Icon name="search" />
                <input
                  aria-label="Search customers"
                  placeholder="Find a customer…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="customer-grid">
                {Array.from(new Set(jobs.map((j) => j.customer)))
                  .filter((c) => c.toLowerCase().includes(query.toLowerCase()))
                  .map((c) => {
                    const cj = jobs.filter((j) => j.customer === c);
                    return (
                      <button
                        className="customer-card"
                        key={c}
                        onClick={() => {
                          go("Hisaab");
                          setQuery(c);
                        }}
                      >
                        <span className="avatar large">{c[0]}</span>
                        <h3>{c}</h3>
                        <p>{cj.length} commitments</p>
                        <strong>
                          {money(cj.reduce((a, j) => a + j.total - j.paid, 0))}{" "}
                          to collect
                        </strong>
                        <span>View history →</span>
                      </button>
                    );
                  })}
              </div>
              {!jobs.length && (
                <div className="empty">
                  <h3>Your customers will appear here</h3>
                  <p>Create a commitment to add your first customer.</p>
                </div>
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
                        { jobs, owner, business, reminders },
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
                  snapshot={{ jobs, owner, business, reminders }}
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
            <span>{t === "My assistant" ? "Assistant" : t}</span>
          </button>
        ))}
        <button onClick={() => go("Settings")}>
          <Icon name="settings" size={21} />
          <span>Settings</span>
        </button>
      </nav>
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
                <h2 id="review-title">Check the details</h2>
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
                    value={draft.customer}
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
                    value={draft.work}
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
                    value={draft.total}
                    onChange={(e) =>
                      setDraft({ ...draft, total: Number(e.target.value) })
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
                    value={draft.paid}
                    onChange={(e) =>
                      setDraft({ ...draft, paid: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Due date
                  <input
                    type="date"
                    value={draft.date}
                    onChange={(e) =>
                      setDraft({ ...draft, date: e.target.value })
                    }
                  />
                </label>
                <label>
                  Due time
                  <input
                    type="time"
                    value={draft.time}
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
              {(!draft.date || !draft.time) && (
                <div className="warning">
                  Date or time still missing. Ask your customer before promising
                  a deadline.
                </div>
              )}
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
                  Save & prepare reply <Icon name="check" size={18} />
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
