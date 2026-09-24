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
  claimFreeTrial,
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
type Tab = "Today" | "Reminders" | "My assistant" | "Hisaab" | "Customers" | "Subscription" | "Admin" | "Settings";
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
    trash: "M4 7h16 M9 7V4h6v3 M7 7l1 14h8l1-14 M10 11v6 M14 11v6",
    leaf: "M5 20c0-10 6-15 15-16 0 10-5 16-15 16Z M5 20l10-10",
    promise:
      "M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-5 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z M8 11l2.2 2.2L16 8",
    sun: "M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4 M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0",
    moon: "M20 15.2A8.5 8.5 0 0 1 8.8 4 8.5 8.5 0 1 0 20 15.2Z",
    plan: "M4 7h16v12H4Z M4 10h16 M8 15h4",
    shield: "M12 3l8 3v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6l8-3Z M9 12l2 2 4-5",
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
    [profileOwnerDraft, setProfileOwnerDraft] = useState(""),
    [profileBusinessDraft, setProfileBusinessDraft] = useState("My small business"),
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
    [paymentPlan, setPaymentPlan] = useState<{name:string;price:string}|null>(null),
    [paymentRef, setPaymentRef] = useState(""),
    [paymentProof, setPaymentProof] = useState<File | null>(null),
    [paymentSubmitting, setPaymentSubmitting] = useState(false),
    [feedback, setFeedback] = useState(""),
    [loggedIn, setLoggedIn] = useState(false),
    [userName, setUserName] = useState<string | null>(null),
    [userEmail, setUserEmail] = useState<string | null>(null),
    [dark, setDark] = useState(false),
    [isOnline, setIsOnline] = useState(true),
    [syncPending, setSyncPending] = useState(false),
    [selectedCustomer, setSelectedCustomer] = useState<string | null>(null),
    [payments, setPayments] = useState<Payment[]>([]),
    [notes, setNotes] = useState<CustomerNote[]>([]),
    [customerPhones, setCustomerPhones] = useState<Record<string,string>>({}),
    [customerContactsOpen, setCustomerContactsOpen] = useState(false),
    [contactQuery, setContactQuery] = useState(""),
    [newCustomerOpen, setNewCustomerOpen] = useState(false),
    [saveLoginPromptOpen, setSaveLoginPromptOpen] = useState(false),
    [whatsappJob, setWhatsappJob] = useState<Job | null>(null),
    [whatsappNumber, setWhatsappNumber] = useState(""),
    [whatsappMessage, setWhatsappMessage] = useState(""),
    [saveWhatsappNumber, setSaveWhatsappNumber] = useState(true),
    [paymentJob, setPaymentJob] = useState<Job | null>(null),
    [paymentAmount, setPaymentAmount] = useState(""),
    [phoneEditorCustomer, setPhoneEditorCustomer] = useState<string | null>(null),
    [phoneEditorValue, setPhoneEditorValue] = useState(""),
    [lastUndo, setLastUndo] = useState<{message:string;snapshot:Snapshot}|null>(null),
    [guideOpen, setGuideOpen] = useState(false),
    [deleteJob, setDeleteJob] = useState<Job | null>(null),
    [deleteCustomer, setDeleteCustomer] = useState<string | null>(null),
    [receiptJob, setReceiptJob] = useState<Job | null>(null),
    [receiptImageBusy, setReceiptImageBusy] = useState(false),
    [directReminderOpen, setDirectReminderOpen] = useState(false),
    [reminderCustomer, setReminderCustomer] = useState(""),
    [newCustomerName, setNewCustomerName] = useState(""),
    [customerChatOpen, setCustomerChatOpen] = useState(false),
    [reminderJob, setReminderJob] = useState<Job | null>(null),
    [reminderDate, setReminderDate] = useState(""),
    [reminderTime, setReminderTime] = useState("09:00"),
    [reminderRepeat, setReminderRepeat] = useState<"none"|"daily"|"weekly"|"monthly">("none"),
    [reminderText, setReminderText] = useState(""),
    [reminderAlertsEnabled, setReminderAlertsEnabled] = useState(false),
    [reminderSoundEnabled, setReminderSoundEnabled] = useState(true),
    [reminderVibrationEnabled, setReminderVibrationEnabled] = useState(true),
    [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("default"),
    [ringingReminder, setRingingReminder] = useState<Reminder | null>(null),
    [navigationReady, setNavigationReady] = useState(false),
    [pushDiagnostic, setPushDiagnostic] = useState(""),
    [pushDiagnosticBusy, setPushDiagnosticBusy] = useState(false),
    [entryMode, setEntryMode] = useState<"quick"|"form">("quick");
  const chatBodyRef = useRef<HTMLDivElement>(null);
  const voiceUrlsRef = useRef<Record<string, string>>({});
  const voiceFilesRef = useRef<Record<string, File>>({});
  const loadingVoiceIds = useRef(new Set<string>());
  const activeUserIdRef = useRef<string | null>(null);
  const cloudHydratedRef = useRef(false);
  const firedReminderKeysRef = useRef(new Set<string>());
  const navigationRestoredRef = useRef(false);

  // Display name priority: custom name → Google/account name → email name → "there"
  const displayName = owner?.trim() || userName || "there";
  useEffect(() => {
    if (tab !== "Settings") return;
    setProfileOwnerDraft(owner);
    setProfileBusinessDraft(business);
  }, [tab, owner, business]);
  async function copyUpiId() {
    try {
      await navigator.clipboard.writeText("zorivoworks-1@okicici");
      setToast("UPI ID copied ✓");
    } catch {
      setToast("UPI ID: zorivoworks-1@okicici");
    }
  }
  function downloadPaymentQr() {
    const link = document.createElement("a");
    link.href = "/QR%20zorivo-icic.jpg";
    link.download = "QR zorivo-icic.jpg";
    link.click();
  }
  async function submitPaymentReference() {
    if (!paymentProof && !paymentRef.trim()) {
      setToast("Upload your payment screenshot or enter the transaction ID.");
      return;
    }
    if (!loggedIn) {
      setToast("Please sign in before submitting your payment.");
      return;
    }
    try {
      setPaymentSubmitting(true);
      const token = await cloudToken();
      const form = new FormData();
      form.append("plan", paymentPlan?.name || "");
      form.append("price", paymentPlan?.price || "");
      form.append("transactionRef", paymentRef.trim());
      if (paymentProof) form.append("proof", paymentProof);
      const response = await fetch("/api/payment-request", { method:"POST", headers:{ Authorization:`Bearer ${token}` }, body:form });
      const result = await response.json().catch(()=>({}));
      if (!response.ok) throw new Error(result?.error || "Could not submit payment.");
      setToast("Payment submitted ✓ We’ll verify it and activate your plan.");
      setPaymentPlan(null);
      setPaymentRef("");
      setPaymentProof(null);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not submit payment.");
    } finally {
      setPaymentSubmitting(false);
    }
  }

  function saveProfileDetails() {
    setOwner(profileOwnerDraft.trim());
    setBusiness(profileBusinessDraft.trim() || "My small business");
    setToast("Name and business saved ✓");
  }
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
    const updateOnlineState = () => setIsOnline(navigator.onLine);
    updateOnlineState();
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker
        .register("/sw.js", { updateViaCache: "none" })
        .then((registration) => registration.update())
        .catch(() => {
          // Local data still works even if the browser blocks service workers.
        });
    }
    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, []);
  useEffect(() => {
    try {
      setReminderAlertsEnabled(localStorage.getItem("pakki-baat-reminder-alerts") === "on");
      setReminderSoundEnabled(localStorage.getItem("pakki-baat-reminder-sound") !== "off");
      setReminderVibrationEnabled(localStorage.getItem("pakki-baat-reminder-vibration") !== "off");
      const fired = JSON.parse(localStorage.getItem("pakki-baat-fired-reminders") || "[]");
      if (Array.isArray(fired)) firedReminderKeysRef.current = new Set(fired.filter((v): v is string => typeof v === "string"));
    } catch {}
    setNotificationPermission("Notification" in window ? Notification.permission : "unsupported");
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

      if (session) {
        try {
          const trial = await claimFreeTrial();
          if (!trial.allowed && trial.reason === "trial_already_used_on_device") {
            setToast("This device has already used its 30-day free trial. Your account is safe — choose a plan to continue.");
            setTab("Subscription");
          }
        } catch {
          // A temporary trial check failure must not block sign-in or access to existing data.
        }
        try {
          const guideKey = "pakki-baat-guide-v1:" + session.user.id;
          if (!localStorage.getItem(guideKey)) setGuideOpen(true);
        } catch {}
      }

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
          setCustomerPhones({});
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
      .finally(() => {});

    const stopWatching = watchSession((session) => {
      void applySession(session);
    });

    return () => {
      cancelled = true;
      stopWatching();
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const snapshot = { jobs, owner, business, reminders, payments, notes, customerPhones };
    const storageUserId = activeUserIdRef.current || LOCAL_WORKSPACE_ID;
    writeLocalWorkspace(storageUserId, snapshot);

    if (!loggedIn || !activeUserIdRef.current || !cloudHydratedRef.current) return;
    if (!isOnline) {
      setSyncPending(true);
      return;
    }

    const timer = window.setTimeout(() => {
      void saveCloud(snapshot)
        .then(() => {
          if (syncPending) {
            setSyncPending(false);
            setToast("Back online. Your offline changes are synced ✓");
          }
        })
        .catch(() => {
          setSyncPending(true);
          setToast("Saved on this device. Cloud backup will retry when you’re online.");
        });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [jobs, owner, business, reminders, payments, notes, customerPhones, ready, loggedIn, isOnline]);

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
    ["Reminders", "bell"],
  ];
  const open = jobs.filter((j) => j.status !== "Completed"),
    due = open.filter((j) => j.date && j.date <= day()),
    balance = jobs.reduce((a, j) => a + Math.max(0, j.total - j.paid), 0),
    activeReminders = reminders
      .filter((r) => !r.done)
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)),
    completedReminders = reminders
      .filter((r) => r.done)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    remindersToday = activeReminders.filter((r) => r.date <= day()).length;
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
    if (t === tab && !selectedCustomer && !customerChatOpen) return;
    if (t === "My assistant") setSelectedCustomer(null);
    window.history.pushState({ pakkiBaat: true, tab: t }, "");
    setTab(t);
    setQuery("");
    setFilter("All");
  }
  useEffect(() => {
    const validTabs: Tab[] = ["Today", "Hisaab", "Reminders", "Subscription", "Admin", "Settings"];
    let restoredTab: Tab = "Today";
    let restoredCustomer: string | null = null;
    let restoredCustomerChatOpen = false;
    let restoredEntryMode: "quick" | "form" = "quick";

    try {
      const historyState = window.history.state as {
        pakkiBaat?: boolean;
        tab?: Tab;
        customer?: string;
        customerChatOpen?: boolean;
        entryMode?: "quick" | "form";
      } | null;
      const raw = localStorage.getItem("pakki-baat-last-view");
      const saved = raw ? JSON.parse(raw) as {
        tab?: Tab;
        customer?: string | null;
        customerChatOpen?: boolean;
        entryMode?: "quick" | "form";
      } : null;

      const candidateTab =
        historyState?.pakkiBaat && historyState.tab
          ? historyState.tab
          : saved?.tab ||
            (localStorage.getItem("pakki-baat-last-tab") as Tab | null);

      if (candidateTab && validTabs.includes(candidateTab)) restoredTab = candidateTab;

      const candidateCustomer =
        historyState?.pakkiBaat && typeof historyState.customer === "string"
          ? historyState.customer
          : saved?.customer;
      restoredCustomer =
        restoredTab === "Hisaab" && typeof candidateCustomer === "string" && candidateCustomer.trim()
          ? candidateCustomer
          : null;

      restoredCustomerChatOpen =
        Boolean(restoredCustomer) &&
        Boolean(
          historyState?.pakkiBaat
            ? historyState.customerChatOpen
            : saved?.customerChatOpen
        );

      const candidateEntryMode =
        historyState?.pakkiBaat ? historyState.entryMode : saved?.entryMode;
      restoredEntryMode = candidateEntryMode === "form" ? "form" : "quick";
    } catch {
      // Fall back to Today if browser storage is unavailable or malformed.
    }

    setTab(restoredTab);
    setSelectedCustomer(restoredCustomer);
    setCustomerChatOpen(restoredCustomerChatOpen);
    setEntryMode(restoredEntryMode);
    navigationRestoredRef.current = true;
    setNavigationReady(true);

    window.history.replaceState(
      {
        pakkiBaat: true,
        tab: restoredTab,
        customer: restoredCustomer || undefined,
        customerChatOpen: restoredCustomerChatOpen || undefined,
        entryMode: restoredEntryMode,
      },
      ""
    );
  }, []);

  useEffect(() => {
    if (!navigationRestoredRef.current) return;
    const view = {
      tab,
      customer: tab === "Hisaab" ? selectedCustomer : null,
      customerChatOpen: tab === "Hisaab" && Boolean(selectedCustomer) && customerChatOpen,
      entryMode,
    };
    try {
      localStorage.setItem("pakki-baat-last-tab", tab);
      localStorage.setItem("pakki-baat-last-view", JSON.stringify(view));
    } catch {}
    window.history.replaceState({ pakkiBaat: true, ...view }, "");
  }, [tab, selectedCustomer, customerChatOpen, entryMode]);
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as { pakkiBaat?: boolean; tab?: Tab; customer?: string; customerChatOpen?: boolean; entryMode?: "quick"|"form" } | null;
      setNewCustomerOpen(false);
      setCustomerChatOpen(false);
      setPendingJob(null);
      setMessage("");
      if (state?.pakkiBaat) {
        setTab(state.tab || "Today");
        setSelectedCustomer(state.customer || null);
        setCustomerChatOpen(Boolean(state.customer && state.customerChatOpen));
        if (state.entryMode) setEntryMode(state.entryMode);
      } else {
        setSelectedCustomer(null);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function openCustomerFromHisaab(name: string) {
    window.history.pushState({ pakkiBaat: true, tab: "Hisaab", customer: name, customerChatOpen: false, entryMode }, "");
    setSelectedCustomer(name);
    setMessage("");
    setCustomerChatOpen(false);
  }

  function openReminders() {
    setSelectedCustomer(null);
    setTab("Reminders");
    setQuery("");
    setFilter("All");
  }
  const dateForOffset = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  };
  function persistReminderAlertSettings(enabled: boolean, sound = reminderSoundEnabled, vibration = reminderVibrationEnabled) {
    try {
      localStorage.setItem("pakki-baat-reminder-alerts", enabled ? "on" : "off");
      localStorage.setItem("pakki-baat-reminder-sound", sound ? "on" : "off");
      localStorage.setItem("pakki-baat-reminder-vibration", vibration ? "on" : "off");
    } catch {}
  }
  function urlBase64ToUint8Array(value: string) {
    const padding = "=".repeat((4 - (value.length % 4)) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = window.atob(base64);
    return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
  }
  async function ensurePushSubscription() {
    if (!loggedIn) throw new Error("Sign in first to enable closed-app reminders.");
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      throw new Error("This browser does not support closed-app push notifications.");
    }

    const configResponse = await fetch("/api/push/config", { cache: "no-store" });
    const config = await configResponse.json().catch(() => ({}));
    if (!configResponse.ok || !config.enabled || !config.publicKey) {
      throw new Error("Closed-app push is not configured on the server yet.");
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(String(config.publicKey)),
      });
    }
    return subscription;
  }
  function scheduledPushKey(reminder: Reminder, endpoint: string) {
    return `${reminder.id}:${reminder.date}:${reminder.time || "09:00"}:${endpoint.slice(-48)}`;
  }
  function hasScheduledPush(key: string) {
    try {
      const values = JSON.parse(localStorage.getItem("pakki-baat-push-scheduled") || "[]");
      return Array.isArray(values) && values.includes(key);
    } catch {
      return false;
    }
  }
  function rememberScheduledPush(key: string) {
    try {
      const values = JSON.parse(localStorage.getItem("pakki-baat-push-scheduled") || "[]");
      const next = Array.isArray(values) ? values.filter((value): value is string => typeof value === "string") : [];
      if (!next.includes(key)) next.push(key);
      localStorage.setItem("pakki-baat-push-scheduled", JSON.stringify(next.slice(-500)));
    } catch {}
  }
  async function scheduleClosedReminder(reminder: Reminder, existingSubscription?: PushSubscription) {
    if (!reminderAlertsEnabled || reminder.done || !reminder.date || !loggedIn) return;
    const subscription = existingSubscription || await ensurePushSubscription();
    const key = scheduledPushKey(reminder, subscription.endpoint);
    if (hasScheduledPush(key)) return;

    const time = reminder.time || "09:00";
    const due = new Date(`${reminder.date}T${time}:00`);
    if (!Number.isFinite(due.getTime())) return;

    const token = await cloudToken();
    const response = await fetch("/api/push/schedule", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        reminder,
        remindAt: due.toISOString(),
        subscription: subscription.toJSON(),
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(String(result.error || "Could not schedule closed-app reminder."));
    }
    rememberScheduledPush(key);
  }

  async function enableReminderAlerts() {
    if (!loggedIn) {
      setToast("Sign in first so reminders can reach you even when Pakki Baat is closed.");
      return;
    }

    let permission: NotificationPermission | "unsupported" =
      "Notification" in window ? Notification.permission : "unsupported";
    if (permission === "default") {
      try {
        permission = await Notification.requestPermission();
      } catch {}
    }
    setNotificationPermission(permission);

    if (permission !== "granted") {
      setToast(
        permission === "denied"
          ? "Notifications are blocked. Allow them in your browser/site settings, then try again."
          : "This browser cannot show closed-app reminder notifications."
      );
      return;
    }

    try {
      const subscription = await ensurePushSubscription();
      setReminderAlertsEnabled(true);
      persistReminderAlertSettings(true);

      for (const reminder of reminders) {
        if (!reminder.done) {
          try {
            await scheduleClosedReminder(reminder, subscription);
          } catch {}
        }
      }

      setToast("Closed-app reminder notifications are on ✓");
    } catch (error) {
      setReminderAlertsEnabled(false);
      persistReminderAlertSettings(false);
      setToast(error instanceof Error ? error.message : "Could not enable closed-app reminders.");
    }
  }
  function disableReminderAlerts() {
    setReminderAlertsEnabled(false);
    persistReminderAlertSettings(false);
    setRingingReminder(null);
    setToast("Reminder alerts turned off.");
  }
  function setReminderSound(next: boolean) {
    setReminderSoundEnabled(next);
    persistReminderAlertSettings(reminderAlertsEnabled, next, reminderVibrationEnabled);
  }
  function setReminderVibration(next: boolean) {
    setReminderVibrationEnabled(next);
    persistReminderAlertSettings(reminderAlertsEnabled, reminderSoundEnabled, next);
  }
  function playReminderAlarm() {
    if (!reminderSoundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const start = ctx.currentTime + 0.02;
      [0, .42, .84, 1.35].forEach((offset, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = index === 3 ? 740 : 880;
        gain.gain.setValueAtTime(0.0001, start + offset);
        gain.gain.exponentialRampToValueAtTime(0.16, start + offset + .025);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + .28);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start + offset);
        osc.stop(start + offset + .3);
      });
      window.setTimeout(() => void ctx.close(), 2200);
    } catch {}
  }
  async function showSystemReminder(reminder: Reminder) {
    if (notificationPermission !== "granted" && (!("Notification" in window) || Notification.permission !== "granted")) return;
    const body = `${reminder.customer ? reminder.customer + " · " : ""}${reminder.text}`;
    try {
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification("Pakki Baat reminder", {
          body,
          icon: "/icon.svg",
          badge: "/icon.svg",
          tag: "pakki-baat-reminder-" + reminder.id,
          requireInteraction: true,
          data: { reminderId: reminder.id, url: "/" },
        });
      } else {
        new Notification("Pakki Baat reminder", { body, icon: "/icon.svg", tag: "pakki-baat-reminder-" + reminder.id });
      }
    } catch {}
  }
  function fireReminderAlert(reminder: Reminder, markFired = true) {
    if (markFired) {
      const key = `${reminder.id}:${reminder.date}:${reminder.time || "09:00"}`;
      firedReminderKeysRef.current.add(key);
      try {
        localStorage.setItem(
          "pakki-baat-fired-reminders",
          JSON.stringify(Array.from(firedReminderKeysRef.current).slice(-300))
        );
      } catch {}
    }
    setRingingReminder(current => current || reminder);
    playReminderAlarm();
    if (reminderVibrationEnabled && "vibrate" in navigator) {
      navigator.vibrate([350,180,350,180,650]);
    }
    void showSystemReminder(reminder);
  }
  async function testReminderAlert() {
    if (pushDiagnosticBusy) return;
    setPushDiagnosticBusy(true);
    setPushDiagnostic("Checking phone + server notification setup…");

    const test: Reminder = {
      id: "test-reminder",
      text: "Closed-app notifications are working ✓",
      date: day(),
      time: new Date().toTimeString().slice(0,5),
      repeat: "none",
      done: false,
      createdAt: new Date().toISOString(),
    };

    try {
      if (!loggedIn) throw new Error("Sign in first. Closed-app reminders need your account.");
      if (!("Notification" in window)) throw new Error("This browser does not support notifications.");
      if (Notification.permission !== "granted") {
        const permission = await Notification.requestPermission();
        setNotificationPermission(permission);
        if (permission !== "granted") throw new Error("Phone notification permission is not allowed.");
      }
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error("This browser does not support closed-app push.");
      }

      const configResponse = await fetch("/api/push/config", { cache: "no-store" });
      const config = await configResponse.json().catch(() => ({}));
      if (!configResponse.ok) throw new Error("Could not check server push setup.");
      if (!config.enabled) {
        const missing = Array.isArray(config.missing) ? config.missing.join(", ") : "server push settings";
        throw new Error("Server push setup is incomplete: " + missing);
      }

      const registration = await navigator.serviceWorker.ready;
      await registration.update().catch(() => {});
      const subscription = await ensurePushSubscription();
      const token = await cloudToken();

      const response = await fetch("/api/push/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(result.error || "Server push test failed."));

      setPushDiagnostic("✓ Server push sent successfully. If no phone notification appears, Android/Chrome notifications are blocked for Pakki Baat.");
      setToast("Test push sent from the server ✓");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not complete notification test.";
      setPushDiagnostic("✕ " + message);
      setToast(message);
    } finally {
      setPushDiagnosticBusy(false);
    }

    setRingingReminder(test);
    playReminderAlarm();
    if (reminderVibrationEnabled && "vibrate" in navigator) {
      navigator.vibrate([350,180,350,180,650]);
    }
  }
  function deleteReminder(id: string) {
    const reminder = reminders.find(r => r.id === id);
    if (!reminder) return;
    rememberUndo("Reminder deleted");
    setReminders(items => items.filter(r => r.id !== id));
    if (ringingReminder?.id === id) setRingingReminder(null);
    setToast("Reminder deleted.");
  }

  function openNewReminder() {
    if (!requireLoginForSaving()) return;
    setReminderJob(null);
    setDirectReminderOpen(true);
    setReminderCustomer(selectedCustomer || "");
    setReminderText("");
    setReminderDate(day());
    setReminderTime("09:00");
    setReminderRepeat("none");
  }
  function closeReminderEditor() {
    setReminderJob(null);
    setDirectReminderOpen(false);
    setReminderCustomer("");
  }
  function closeGuide(nextTab?: Tab) {
    try {
      const userId = activeUserIdRef.current;
      if (userId) localStorage.setItem("pakki-baat-guide-v1:" + userId, "seen");
    } catch {}
    setGuideOpen(false);
    if (nextTab) go(nextTab);
  }
  function openCustomerAssistant(seed = "") {
    setTab("Hisaab");
    setQuery("");
    setFilter("All");
    setPendingJob(null);
    setPendingReminderText("");
    setMessage(seed);
  }
  function openNewEntry() {
    setTab("Hisaab");
    setQuery("");
    setFilter("All");
    setSelectedCustomer(null);
    setCustomerChatOpen(false);
    setPendingJob(null);
    setPendingReminderText("");
    setMessage("");
    setNewCustomerName("");
    setNewCustomerOpen(true);
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
      setVoiceBusy(true);
      try {
        await processAssistantMessage(transcript, "voice");
      } finally {
        setVoiceBusy(false);
      }
    } else {
      await transcribeSentVoice(file, id, duration);
    }

    try {
      await saveVoice(id, file);
    } catch {
      // The entry can still be created even if local audio playback cannot be saved.
    }
  }
  async function transcribeSentVoice(file: File, id: string, duration: number) {
    if (voiceBusy) return;
    if (!navigator.onLine) {
      setToast("Voice transcription needs internet. Your saved hisaab still works offline.");
      return;
    }
    setVoiceBusy(true);
    try {
      if (file.size > 2_000_000)
        throw new Error(
          "This recording is over the 2 MB AI limit. Record a shorter note."
        );

      const form = new FormData();
      form.set("file", file);
      form.set("mode", "transcribe");
      form.set("today", day());
      form.set("duration", String(Math.max(1, Math.ceil(duration))));

      const token = await cloudToken();
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
      const savedTurn = chatTurns.find(turn => turn.voiceId === id);
      await transcribeSentVoice(file, id, Math.max(1, savedTurn?.duration || 1));
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
      setCustomerPhones({});
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
      if (!navigator.onLine) {
        const offlineDraft: Job = {
          ...(pendingJob || blank()),
          id: pendingJob?.id || crypto.randomUUID(),
          customer: selectedCustomer || pendingJob?.customer || "",
          work: pendingJob?.work || message.trim(),
          source: message,
        };
        setPendingJob(offlineDraft);
        setEntryMode("form");
        setCustomerChatOpen(true);
        setToast("You’re offline. I kept your text — use the simple form to finish this entry.");
        return;
      }
      console.log(`📨 Processing ${source} message:`, message);

      const token = await cloudToken();
      const response = await fetch("/api/process-message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
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

  function requireLoginForSaving() {
    if (loggedIn) return true;
    setSaveLoginPromptOpen(true);
    return false;
  }

  function startEntry(mode: "quick" | "form") {
    if (!selectedCustomer || !requireLoginForSaving()) return;
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
    if (!requireLoginForSaving()) return;
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
    if (!requireLoginForSaving()) return;
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
  const receiptNumber = (j: Job) =>
    "PB-" + j.id.replace(/-/g, "").slice(0, 8).toUpperCase();
  const receiptText = (j: Job) => {
    const baki = Math.max(0, j.total - j.paid);
    return [
      `*${business?.trim() || "Pakki Baat"}*`,
      `Receipt: ${receiptNumber(j)}`,
      `Customer: ${j.customer}`,
      `Work: ${j.work}`,
      "",
      `Total: ${money(j.total)}`,
      `Received: ${money(j.paid)}`,
      `Balance: ${money(baki)}`,
      j.date ? `Due: ${j.date}${j.time ? " · " + j.time : ""}` : "",
      "",
      baki === 0 ? "Payment status: Paid in full" : "Payment status: Balance pending",
      "",
      "Thank you.",
    ].filter(Boolean).join("\n");
  };
  function escapeReceiptHtml(value: string) {
    return value.replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[char] || char));
  }
  function openReceipt(job: Job) {
    setReceiptJob(job);
  }
  function sendReceiptOnWhatsApp(job: Job) {
    setReceiptJob(null);
    setWhatsappJob(job);
    setWhatsappNumber(customerPhones[job.customer] || "");
    setWhatsappMessage(receiptText(job));
    setSaveWhatsappNumber(true);
  }
  function printReceipt(job: Job) {
    const popup = window.open("", "_blank", "width=520,height=760");
    if (!popup) {
      setToast("Allow pop-ups once to print the receipt.");
      return;
    }
    const businessName = escapeReceiptHtml(business?.trim() || "Pakki Baat");
    const customer = escapeReceiptHtml(job.customer);
    const work = escapeReceiptHtml(job.work);
    const receiptNo = escapeReceiptHtml(receiptNumber(job));
    const due = job.date
      ? escapeReceiptHtml(job.date + (job.time ? " · " + job.time : ""))
      : "Not set";
    const baki = Math.max(0, job.total - job.paid);
    const issued = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    popup.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><title>${receiptNo}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f3f1eb;color:#22332d;font-family:Arial,sans-serif;padding:28px}
.receipt{max-width:440px;margin:auto;background:#fff;border:1px solid #ddd8cb;border-radius:18px;padding:28px;box-shadow:0 10px 30px #00000012}
.brand{font-family:Georgia,serif;font-size:28px;margin:0 0 4px}.muted{color:#7d8983;font-size:12px}
.rule{height:1px;background:#e9e4d9;margin:22px 0}
h2{font:22px Georgia,serif;margin:0 0 18px}.row{display:flex;justify-content:space-between;gap:18px;margin:10px 0;font-size:13px}.row span:first-child{color:#7b8781}
.total{font-size:16px;font-weight:700}.baki{color:#a65b42}.status{margin-top:18px;padding:10px 12px;border-radius:10px;background:#eef5f0;color:#2d6e5b;font-size:12px;font-weight:700}
.footer{text-align:center;margin-top:24px;color:#8b948f;font-size:10px}
@media print{body{background:#fff;padding:0}.receipt{box-shadow:none;border:0;max-width:none;border-radius:0}}
</style></head><body>
<div class="receipt">
<p class="brand">${businessName}</p>
<p class="muted">Receipt ${receiptNo} · ${issued}</p>
<div class="rule"></div>
<h2>${work}</h2>
<div class="row"><span>Customer</span><strong>${customer}</strong></div>
<div class="row"><span>Due</span><strong>${due}</strong></div>
<div class="rule"></div>
<div class="row"><span>Total</span><strong>${escapeReceiptHtml(money(job.total))}</strong></div>
<div class="row"><span>Received</span><strong>${escapeReceiptHtml(money(job.paid))}</strong></div>
<div class="row total"><span>Balance</span><strong class="baki">${escapeReceiptHtml(money(baki))}</strong></div>
<div class="status">${baki === 0 ? "Paid in full" : "Balance pending"}</div>
<p class="footer">Generated from Pakki Baat</p>
</div>
<script>window.onload=()=>{window.print();};<\/script>
</body></html>`);
    popup.document.close();
  }
  function safeReceiptFileName(value: string) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "receipt";
  }
  function receiptCanvasBlob(job: Job): Promise<Blob> {
    return new Promise((resolve, reject) => {
      try {
        const width = 1080;
        const height = 1350;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas is unavailable.");

        const baki = Math.max(0, job.total - job.paid);
        const businessName = business?.trim() || "Pakki Baat";
        const issued = new Date().toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        });

        const roundRect = (x:number,y:number,w:number,h:number,r:number,fill:string,stroke?:string) => {
          ctx.beginPath();
          ctx.roundRect(x,y,w,h,r);
          ctx.fillStyle = fill;
          ctx.fill();
          if (stroke) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        };
        const text = (value:string,x:number,y:number,size:number,weight:string,color:string,align:CanvasTextAlign="left") => {
          ctx.font = `${weight} ${size}px Arial, sans-serif`;
          ctx.fillStyle = color;
          ctx.textAlign = align;
          ctx.textBaseline = "alphabetic";
          ctx.fillText(value,x,y);
        };
        const wrapText = (value:string,x:number,y:number,maxWidth:number,lineHeight:number,size:number,weight:string,color:string) => {
          ctx.font = `${weight} ${size}px Arial, sans-serif`;
          ctx.fillStyle = color;
          ctx.textAlign = "left";
          const words = value.split(/\s+/);
          let line = "";
          let yy = y;
          for (const word of words) {
            const test = line ? line + " " + word : word;
            if (ctx.measureText(test).width > maxWidth && line) {
              ctx.fillText(line,x,yy);
              line = word;
              yy += lineHeight;
            } else {
              line = test;
            }
          }
          if (line) ctx.fillText(line,x,yy);
          return yy;
        };

        ctx.fillStyle = "#f2efe7";
        ctx.fillRect(0,0,width,height);

        // Receipt sheet
        roundRect(76,64,928,1222,38,"#fffdf8","#dfdacd");

        // Header
        text(businessName,122,150,44,"700","#22372f");
        text("CUSTOMER RECEIPT",122,194,18,"700","#718079");
        text(receiptNumber(job),958,150,20,"700","#5d6f66","right");
        text(issued,958,187,18,"400","#8a958f","right");

        ctx.strokeStyle = "#e9e4d8";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(122,236);
        ctx.lineTo(958,236);
        ctx.stroke();

        // Customer + status
        text("CUSTOMER",122,294,17,"700","#8a958f");
        text(job.customer,122,342,34,"700","#263d33");

        const statusLabel = baki === 0 ? "PAID IN FULL" : "BALANCE DUE";
        const statusFill = baki === 0 ? "#e7f3ec" : "#fff0e5";
        const statusColor = baki === 0 ? "#2f735e" : "#a35d43";
        roundRect(730,282,228,62,31,statusFill);
        text(statusLabel,844,322,16,"700",statusColor,"center");

        text("WORK / ORDER",122,406,17,"700","#8a958f");
        const workEnd = wrapText(job.work,122,452,836,38,28,"700","#30463c");

        // Amount cards
        const cardsY = Math.max(540, workEnd + 64);
        const cardW = 254;
        const gap = 24;
        const amountCard = (x:number,label:string,value:string,accent=false) => {
          roundRect(x,cardsY,cardW,154,24,accent ? "#fff5ec" : "#f4f7f3",accent ? "#ead8c7" : "#e1e7df");
          text(label,x+24,cardsY+46,16,"700","#7f8d85");
          text(value,x+24,cardsY+105,30,"700",accent ? "#a35d43" : "#2a4036");
        };
        amountCard(122,"TOTAL",money(job.total));
        amountCard(122+cardW+gap,"RECEIVED",money(job.paid));
        amountCard(122+(cardW+gap)*2,"BALANCE",money(baki),true);

        // Due row
        const dueY = cardsY + 198;
        roundRect(122,dueY,836,92,20,"#faf9f5","#e6e1d8");
        text("DUE",150,dueY+36,15,"700","#86928b");
        text(job.date ? job.date + (job.time ? " · " + job.time : "") : "Not set",930,dueY+57,24,"700","#32483e","right");

        // Footer note
        const noteY = dueY + 150;
        text(baki === 0 ? "Payment complete ✓" : "Balance pending",122,noteY,24,"700",baki===0 ? "#2f735e" : "#a35d43");
        text("Thank you.",122,noteY+62,28,"700","#33483f");

        ctx.strokeStyle = "#e9e4d8";
        ctx.beginPath();
        ctx.moveTo(122,1168);
        ctx.lineTo(958,1168);
        ctx.stroke();
        text("Generated from Pakki Baat",540,1218,17,"400","#8a958f","center");

        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not create receipt image.")), "image/png", 0.96);
      } catch (error) {
        reject(error);
      }
    });
  }
  async function downloadReceiptImage(job: Job) {
    try {
      setReceiptImageBusy(true);
      const blob = await receiptCanvasBlob(job);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${safeReceiptFileName(job.customer)}-${receiptNumber(job)}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setToast("Receipt image saved ✓");
    } catch {
      setToast("Could not create the receipt image.");
    } finally {
      setReceiptImageBusy(false);
    }
  }
  async function shareReceiptImage(job: Job) {
    try {
      setReceiptImageBusy(true);
      const blob = await receiptCanvasBlob(job);
      const file = new File(
        [blob],
        `${safeReceiptFileName(job.customer)}-${receiptNumber(job)}.png`,
        { type: "image/png" }
      );
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: `Receipt ${receiptNumber(job)}`,
          text: `Receipt for ${job.customer}`,
          files: [file],
        });
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setToast("Image sharing is not supported here, so the receipt was downloaded.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setToast("Could not share the receipt image.");
    } finally {
      setReceiptImageBusy(false);
    }
  }
  function currentSnapshot(): Snapshot {
    return { jobs, owner, business, reminders, payments, notes, customerPhones };
  }
  function rememberUndo(message: string) {
    setLastUndo({ message, snapshot: currentSnapshot() });
  }
  function undoLastAction() {
    if (!lastUndo) return;
    const s = lastUndo.snapshot;
    setJobs(s.jobs);
    setReminders(s.reminders || []);
    setPayments(s.payments || []);
    setNotes(s.notes || []);
    setCustomerPhones(s.customerPhones || {});
    setOwner(s.owner);
    setBusiness(s.business);
    setLastUndo(null);
    setToast("Undone.");
  }
  function openWhatsApp(job: Job) {
    setWhatsappJob(job);
    setWhatsappNumber(customerPhones[job.customer] || "");
    setWhatsappMessage(replyText(job));
    setSaveWhatsappNumber(true);
  }
  function sendWhatsApp() {
    if (!whatsappJob) return;
    let digits = whatsappNumber.replace(/\D/g, "");
    if (digits.length === 10) digits = "91" + digits;
    if (digits.length < 8 || digits.length > 15) {
      setToast("Enter a valid WhatsApp number with country code.");
      return;
    }
    const text = whatsappMessage.trim() || replyText(whatsappJob);
    if (saveWhatsappNumber) {
      setCustomerPhones(items => ({ ...items, [whatsappJob.customer]: digits }));
    }
    const url =
      "https://wa.me/" +
      digits +
      "?text=" +
      encodeURIComponent(text);
    window.open(url, "_blank", "noopener,noreferrer");
    setWhatsappJob(null);
    setWhatsappNumber("");
    setWhatsappMessage("");
  }
  function openPhoneEditor(customer: string) {
    setPhoneEditorCustomer(customer);
    setPhoneEditorValue(customerPhones[customer] || "");
  }
  function saveCustomerPhone() {
    if (!phoneEditorCustomer) return;
    let digits = phoneEditorValue.replace(/\D/g, "");
    if (digits.length === 10) digits = "91" + digits;
    if (digits && (digits.length < 8 || digits.length > 15)) {
      setToast("Enter a valid WhatsApp number with country code.");
      return;
    }
    setCustomerPhones(items => {
      const next = { ...items };
      if (digits) next[phoneEditorCustomer] = digits;
      else delete next[phoneEditorCustomer];
      return next;
    });
    setPhoneEditorCustomer(null);
    setPhoneEditorValue("");
    setToast(digits ? "Customer WhatsApp number saved." : "Customer number removed.");
  }
  function customerContactText() {
    return customerNames
      .map(name => `${name} — ${customerPhones[name] ? "+" + customerPhones[name] : "No mobile number"}`)
      .join("\n");
  }
  async function copyCustomerContacts() {
    try {
      await navigator.clipboard.writeText(customerContactText());
      setToast("Customer contact list copied ✓");
    } catch {
      setToast("Could not copy the customer list.");
    }
  }
  function downloadCustomerContacts() {
    const rows = [
      ["Customer","Mobile number"],
      ...customerNames.map(name => [name, customerPhones[name] ? "+" + customerPhones[name] : ""]),
    ];
    const csv = rows
      .map(row => row.map(value => `"${String(value).replace(/"/g,'""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "pakki-baat-customer-contacts.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function openPayment(job: Job) {
    if (!requireLoginForSaving()) return;
    if (job.total <= job.paid) {
      setToast("This entry is already fully paid.");
      return;
    }
    setPaymentJob(job);
    setPaymentAmount("");
  }
  function saveQuickPayment() {
    if (!paymentJob) return;
    const amount = Number(paymentAmount);
    const baki = Math.max(0, paymentJob.total - paymentJob.paid);
    if (!(amount > 0) || amount > baki) {
      setToast("Enter an amount up to " + money(baki) + ".");
      return;
    }
    const message = "Payment updated ✓";
    rememberUndo(message);
    setJobs(items => items.map(j => j.id === paymentJob.id ? { ...j, paid: j.paid + amount } : j));
    setPayments(items => [{
      id: crypto.randomUUID(),
      customer: paymentJob.customer,
      jobId: paymentJob.id,
      amount,
      date: day(),
      note: "Quick payment",
      createdAt: new Date().toISOString()
    }, ...items]);
    setPaymentJob(null);
    setPaymentAmount("");
    setToast(message);
  }
  function updateJobStatus(job: Job, status: "Waiting"|"Confirmed"|"Completed") {
    if (job.status === status) return;
    const message = status === "Completed" ? "Marked done ✓" : status === "Confirmed" ? "Marked in progress ✓" : "Marked pending ✓";
    rememberUndo(message);
    setJobs(items => items.map(item => item.id === job.id ? { ...item, status } : item));
    setToast(message);
  }
  function deleteEntry(job: Job) {
    setDeleteJob(job);
  }
  function confirmDeleteCustomer() {
    if (!deleteCustomer) return;
    const name = deleteCustomer;
    rememberUndo("Customer deleted");
    const jobIds = new Set(jobs.filter(j => j.customer === name).map(j => j.id));
    setJobs(items => items.filter(j => j.customer !== name));
    setPayments(items => items.filter(p => p.customer !== name && (!p.jobId || !jobIds.has(p.jobId))));
    setReminders(items => items.filter(r => r.customer !== name && (!r.jobId || !jobIds.has(r.jobId))));
    setNotes(items => items.filter(n => n.customer !== name));
    setChatTurns(items => items.filter(t => t.customer !== name));
    setCustomerPhones(items => {
      const next = { ...items };
      delete next[name];
      return next;
    });
    if (selectedCustomer === name) setSelectedCustomer(null);
    setDeleteCustomer(null);
    setToast(name + " deleted from Hisaab");
  }
  function confirmDeleteEntry() {
    if (!deleteJob) return;
    const job = deleteJob;
    const message = "Entry deleted";
    rememberUndo(message);
    setJobs(items => items.filter(item => item.id !== job.id));
    setPayments(items => items.filter(item => item.jobId !== job.id));
    setReminders(items => items.filter(item => item.jobId !== job.id));
    setChatTurns(items => items.filter(item => item.replyFor?.id !== job.id));
    if (draft?.id === job.id) setDraft(null);
    setDeleteJob(null);
    setToast(message);
  }
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
    setCustomerPhones(s.customerPhones || {});
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
      <span className="job-end"><strong>{money(j.total-j.paid)}</strong><span className={j.status==="Confirmed"?"tag green":"tag"}>{j.status}</span></span>
      <Icon name="arrow" size={16}/>
    </button>
  );
  const customerNames = Array.from(new Set([...jobs.map(j=>j.customer), ...payments.map(p=>p.customer), ...notes.map(n=>n.customer), ...reminders.map(r=>r.customer || ""), ...Object.keys(customerPhones)])).filter(Boolean);
  const customerJobs = selectedCustomer ? jobs.filter(j=>j.customer===selectedCustomer) : [];
  const customerReminders = selectedCustomer ? reminders.filter(r=>r.customer===selectedCustomer && !r.done) : [];
  const selectedBaki = customerJobs.reduce((sum,j)=>sum+j.total-j.paid,0);
  const customerPayments = selectedCustomer ? payments.filter(p=>p.customer===selectedCustomer) : [];
  const customerNotes = selectedCustomer ? notes.filter(n=>n.customer===selectedCustomer) : [];
  const customerOpenJob = customerJobs.find(j=>j.paid<j.total && j.status!=="Completed") || customerJobs.find(j=>j.paid<j.total) || customerJobs[0];
  const recentCustomers = customerNames.slice(0,4);
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
    setReminderDate(dateForOffset(kind === "tomorrow" ? 1 : 0));
  }
  async function saveReminder() {
    if ((!reminderJob && !directReminderOpen) || !reminderDate || !reminderText.trim()) return;
    const customer = reminderJob?.customer || reminderCustomer.trim() || undefined;
    const reminder: Reminder = {
      id: crypto.randomUUID(),
      text: reminderText.trim(),
      date: reminderDate,
      time: reminderTime,
      customer,
      jobId: reminderJob?.id || undefined,
      repeat: reminderRepeat,
      done: false,
      createdAt: new Date().toISOString(),
    };
    const nextReminders = [reminder, ...reminders];
    setReminders(nextReminders);
    closeReminderEditor();

    let cloudReadyForPush = true;
    if (loggedIn && isOnline) {
      try {
        await saveCloud({ jobs, owner, business, reminders: nextReminders, payments, notes, customerPhones });
      } catch {
        cloudReadyForPush = false;
      }
    }

    if (reminderAlertsEnabled) {
      if (!loggedIn) {
        setToast("Reminder saved locally. Sign in to receive it when Pakki Baat is closed.");
        return;
      }
      if (!isOnline) {
        setToast("Reminder saved. Closed-app alert will be scheduled when you’re online.");
        return;
      }
      if (!cloudReadyForPush) {
        setToast("Reminder saved, but cloud sync failed. Closed-app alert will retry.");
        return;
      }
      try {
        await scheduleClosedReminder(reminder);
        setToast("Reminder saved + phone alert scheduled ✓");
      } catch (error) {
        setToast(error instanceof Error ? error.message : "Reminder saved, but phone alert could not be scheduled.");
      }
      return;
    }

    setToast("Reminder saved.");
  }
  function completeReminder(id:string) {
    const message = "Reminder updated ✓";
    rememberUndo(message);
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
    setToast(message);
  }
  function snoozeReminder(id:string) {
    const message = "Reminder moved to tomorrow ✓";
    rememberUndo(message);
    setReminders(items=>items.map(r=>{
      if(r.id!==id)return r;
      const next=new Date(r.date+"T12:00:00"); next.setDate(next.getDate()+1);
      return {...r,date:`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,"0")}-${String(next.getDate()).padStart(2,"0")}`};
    }));
    setToast(message);
  }
  useEffect(() => {
    if (!ready || !loggedIn || !reminderAlertsEnabled || notificationPermission !== "granted") return;
    let cancelled = false;
    void (async () => {
      try {
        const subscription = await ensurePushSubscription();
        if (cancelled) return;
        for (const reminder of reminders) {
          if (cancelled) return;
          if (!reminder.done) {
            try {
              await scheduleClosedReminder(reminder, subscription);
            } catch {}
          }
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [reminders, ready, loggedIn, reminderAlertsEnabled, notificationPermission]);

  useEffect(() => {
    if (!ready || !reminderAlertsEnabled) return;
    const checkDueReminders = () => {
      const now = Date.now();
      for (const reminder of reminders) {
        if (reminder.done || !reminder.date) continue;
        const time = reminder.time || "09:00";
        const dueAt = new Date(`${reminder.date}T${time}:00`).getTime();
        if (!Number.isFinite(dueAt) || dueAt > now) continue;
        const key = `${reminder.id}:${reminder.date}:${time}`;
        if (firedReminderKeysRef.current.has(key)) continue;
        fireReminderAlert(reminder, true);
      }
    };
    checkDueReminders();
    const id = window.setInterval(checkDueReminders, 15000);
    return () => window.clearInterval(id);
  }, [reminders, ready, reminderAlertsEnabled, reminderSoundEnabled, reminderVibrationEnabled, notificationPermission]);

  return (
    <div className={navigationReady ? "shell" : "shell navigation-restoring"}>
      {!isOnline && (
        <div className="offline-banner" role="status">
          <span className="offline-dot" /> Offline · changes are saved on this device
        </div>
      )}
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
              {t === "Reminders" && activeReminders.length > 0 && <b>{activeReminders.length}</b>}
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
          <button className="settings-button learn-pakki-button" onClick={() => setGuideOpen(true)}>
            <span className="learn-pakki-icon">?</span>
            Learn Pakki Baat
          </button>
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
            <button type="button" className={tab === "Subscription" ? "subscription-nav-button active" : "subscription-nav-button"} onClick={()=>go("Subscription")} title="Subscription & usage">
              <Icon name="plan" size={18}/><span>Plan</span>
            </button>
            {!loggedIn && (
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
              className="icon-button top-reminder-button"
              aria-label="View reminders"
              onClick={openReminders}
            >
              <Icon name="bell" />
              {activeReminders.length>0 && <span className="top-reminder-badge">{Math.min(99,activeReminders.length)}</span>}
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
                    className="dark-button hero-cta"
                    onClick={() => go("Hisaab")}
                  >
                    Tell me what’s new <Icon name="arrow" size={18} />
                  </button>
                </div>
                <div className="hero-art hero-app-preview" aria-hidden="true">
                  <div className="hero-preview-glow" />
                  <div className="hero-preview-main">
                    <div className="hero-preview-top">
                      <span className="hero-preview-avatar">A</span>
                      <span><strong>Asha</strong><small>Cake order</small></span>
                      <Icon name="check" size={15} />
                    </div>
                    <div className="hero-preview-money">
                      <small>Balance</small>
                      <strong>₹2,000</strong>
                      <span>baki</span>
                    </div>
                  </div>
                  <div className="hero-preview-chip reminder">
                    <span className="hero-preview-chip-icon"><Icon name="bell" size={15} /></span>
                    <span><small>Reminder</small><strong>Tomorrow · 9:00</strong></span>
                  </div>
                  <div className="hero-preview-chip whatsapp">
                    <span className="hero-preview-chip-icon"><Icon name="chat" size={15} /></span>
                    <span><small>WhatsApp</small><strong>Reply ready</strong></span>
                  </div>
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
                    <Icon name="list" />
                  </span>
                  <div>
                    <span>Pending work</span>
                    <strong>
                      {open.filter((j) => j.status === "Waiting").length}{" "}
                      <em>entries</em>
                    </strong>
                    <small>Things that still need action</small>
                  </div>
                  <Icon name="arrow" size={18} />
                </button>
              </section>
              {(due.length > 0 || reminders.some(r=>!r.done && r.date<=day())) && (
                <section className="today-focus">
                  <div className="section-heading">
                    <div><span className="eyebrow">TODAY'S FOCUS</span><h2>What needs your attention</h2></div>
                  </div>
                  <div className="today-focus-list">
                    {due.slice(0,3).map(j=><button type="button" key={j.id} className="today-focus-item" onClick={()=>{setSelectedCustomer(j.customer);setCustomerChatOpen(false);setTab("Hisaab");}}>
                      <span className="today-focus-icon"><Icon name="clock" size={17}/></span>
                      <span><strong>{j.customer}</strong><small>{j.work}</small></span>
                      <b>{j.total>j.paid ? money(j.total-j.paid)+" baki" : "Due"}</b>
                      <Icon name="arrow" size={16}/>
                    </button>)}
                    {reminders.filter(r=>!r.done && r.date<=day()).slice(0,3).map(r=><button type="button" key={r.id} className="today-focus-item" onClick={()=>{if(r.customer){setSelectedCustomer(r.customer);setCustomerChatOpen(false);setTab("Hisaab");}}}>
                      <span className="today-focus-icon"><Icon name="bell" size={17}/></span>
                      <span><strong>{r.customer || "Reminder"}</strong><small>{r.text}</small></span>
                      <b>{r.time || "Today"}</b>
                      <Icon name="arrow" size={16}/>
                    </button>)}
                  </div>
                </section>
              )}
              <div className="lower-grid">
                <section className="panel">
                  <div className="section-heading">
                    <h2>
                      Needs a little attention{" "}
                      <span className="count">{open.length}</span>
                    </h2>
                    <button
                      className="text-button attention-view-all"
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
                Made with <span>♡</span> by Sarrah Aliasgar Bharmal
                <span className="footer-separator">·</span>
                <a href="https://zorivo.in" target="_blank" rel="noopener noreferrer">zorivo.in</a>
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
                    {!loggedIn && (
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
                      "Orders go to Hisaab and reminders stay together on the Reminders page.",
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
          {tab === "Reminders" && (
            <>
              <div className="page-heading reminders-heading">
                <div className="reminders-heading-copy">
                  <div className="eyebrow">NOTHING TO KEEP IN YOUR HEAD</div>
                  <h1>Reminders</h1>
                  <p>See what needs a follow-up, snooze it, or mark it done.</p>
                </div>
                <button type="button" className="primary mobile-primary-action reminder-add-primary" onClick={openNewReminder}>
                  <Icon name="plus" size={17}/><span>Add reminder</span>
                </button>
              </div>
              <section className="reminder-page-summary">
                <div><span className="reminder-summary-icon"><Icon name="bell" size={17}/></span><small>Today / overdue</small><strong>{remindersToday}</strong></div>
                <div><span className="reminder-summary-icon"><Icon name="calendar" size={17}/></span><small>Active reminders</small><strong>{activeReminders.length}</strong></div>
                <div><span className="reminder-summary-icon"><Icon name="check" size={17}/></span><small>Completed</small><strong>{completedReminders.length}</strong></div>
              </section>
              <section className="reminders-page-card">
                <div className="section-heading reminders-page-title">
                  <div><span className="eyebrow">UP NEXT</span><h2>Active reminders <span className="count">{activeReminders.length}</span></h2></div>
                </div>
                {activeReminders.length ? (
                  <div className="reminders-page-list">
                    {activeReminders.map(r=>(
                      <article className={r.date<=day() ? "reminder-page-row is-due" : "reminder-page-row"} key={r.id}>
                        <span className="reminder-page-bell"><Icon name="bell" size={18}/></span>
                        <div className="reminder-page-copy">
                          {r.customer ? <button type="button" className="reminder-customer-link" onClick={()=>{setSelectedCustomer(r.customer!);setCustomerChatOpen(false);setTab("Hisaab");}}>{r.customer}</button> : <span className="reminder-generic-label">General reminder</span>}
                          <strong>{r.text}</strong>
                          <small>{r.date}{r.time ? " · "+r.time : ""}{r.repeat && r.repeat!=="none" ? " · "+r.repeat : ""}</small>
                        </div>
                        <div className="reminder-page-actions">
                          <button type="button" className="outline mini" onClick={()=>snoozeReminder(r.id)}>Tomorrow</button>
                          <button type="button" className="primary mini" onClick={()=>completeReminder(r.id)}>Done ✓</button>
                          <button type="button" className="reminder-delete-button" aria-label="Delete reminder" title="Delete reminder" onClick={()=>deleteReminder(r.id)}><Icon name="close" size={15}/></button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="reminders-page-empty">
                    <span><Icon name="bell" size={25}/></span>
                    <h3>No active reminders</h3>
                    <p>Add one for a payment, delivery, customer follow-up, or anything you don’t want to remember yourself.</p>
                    <button type="button" className="primary" onClick={openNewReminder}><Icon name="plus" size={16}/> Add reminder</button>
                  </div>
                )}
              </section>
              {completedReminders.length>0 && (
                <section className="reminders-completed">
                  <div className="section-heading"><div><span className="eyebrow">DONE</span><h2>Recently completed</h2></div></div>
                  <div className="completed-reminder-list">
                    {completedReminders.slice(0,8).map(r=>(
                      <div className="completed-reminder-row" key={r.id}>
                        <span className="completed-check"><Icon name="check" size={15}/></span>
                        <span><strong>{r.text}</strong><small>{r.customer ? r.customer+" · " : ""}{r.date}</small></span>
                        <button type="button" className="reminder-delete-button completed-delete" aria-label="Delete completed reminder" title="Delete reminder" onClick={()=>deleteReminder(r.id)}><Icon name="close" size={14}/></button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
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
                    <div className="hisaab-heading-actions">
                      <button type="button" className="outline customer-contacts-button" onClick={()=>{setContactQuery("");setCustomerContactsOpen(true);}}>
                        <Icon name="people" size={17}/><span>Contacts</span>
                      </button>
                      <button className="primary mobile-primary-action" onClick={() => { if (!requireLoginForSaving()) return; setNewCustomerName(""); setNewCustomerOpen(true); }}><Icon name="plus" /><span>New customer</span></button>
                    </div>
                  </div>
                  <label className="search customer-search"><Icon name="search"/><input aria-label="Search customers" placeholder="Search customer name…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
                  <div className="customer-list-mobile">
                    {customerNames.filter(name=>name.toLowerCase().includes(query.toLowerCase())).map(name=>{
                      const entries=jobs.filter(j=>j.customer===name);
                      const baki=entries.reduce((sum,j)=>sum+j.total-j.paid,0);
                      const latest=entries[0];
                      return <div className="customer-row-card customer-row-with-delete" key={name} role="group">
                        <button type="button" className="customer-row-open" onClick={()=>openCustomerFromHisaab(name)}>
                          <span className="avatar large">{name[0]}</span>
                          <span className="customer-row-main"><strong>{name}</strong><small>{latest?.work || "Ready for first entry"} · {entries.length} saved {entries.length===1?"entry":"entries"}</small></span>
                          <span className="customer-row-money"><strong>{money(baki)}</strong><small>baki</small></span>
                          <Icon name="arrow" size={17}/>
                        </button>
                        <button type="button" className="customer-delete-button" aria-label={"Delete " + name} title="Delete customer" onClick={()=>setDeleteCustomer(name)}><svg className="customer-trash-svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 10v6M14 10v6"/></svg></button>
                      </div>;
                    })}
                  </div>
                  {!customerNames.length && <div className="empty"><h3>Your hisaab book is empty</h3><p>Tap New customer, add a name, then type or speak naturally.</p></div>}
                </>
              ) : (
                <section className="customer-detail">
                  <div className="customer-profile-head">
                    <span className="avatar large customer-profile-avatar">{selectedCustomer?.[0] || "?"}</span>
                    <div className="customer-profile-copy">
                      <span className="eyebrow">CUSTOMER HISAAB</span>
                      <h1>{selectedCustomer}</h1>
                      <p>{customerJobs.length} saved {customerJobs.length===1?"entry":"entries"} · {money(selectedBaki)} baki</p>
                      <button type="button" className="customer-phone-link" onClick={()=>openPhoneEditor(selectedCustomer!)}>
                        {customerPhones[selectedCustomer!] ? "WhatsApp +" + customerPhones[selectedCustomer!] : "+ Add WhatsApp number"}
                      </button>
                    </div>
                    {!customerChatOpen && <button type="button" className="customer-add-entry" onClick={()=>startEntry("quick")}><Icon name="plus" size={16}/><span>Add entry</span></button>}
                  </div>
                  {!customerChatOpen && (
                    <div className="customer-action-strip">
                      <button type="button" className="primary" onClick={()=>startEntry("quick")}><Icon name="plus" size={15}/> Add entry</button>
                      <button type="button" className="outline" disabled={!customerOpenJob || customerOpenJob.total<=customerOpenJob.paid} onClick={()=>customerOpenJob && openPayment(customerOpenJob)}>₹ Payment</button>
                      <button type="button" className="outline" disabled={!customerOpenJob} onClick={()=>customerOpenJob && openWhatsApp(customerOpenJob)}><Icon name="chat" size={15}/> WhatsApp</button>
                      <button type="button" className="outline" disabled={!customerOpenJob} onClick={()=>customerOpenJob && openReminder(customerOpenJob)}><Icon name="bell" size={15}/> Reminder</button>
                    </div>
                  )}
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
                    <div className="saved-entry-grid">{customerJobs.map((j,index)=><article className="saved-detail-card customer-saved-card" key={`${j.id || "entry"}-${j.date || "saved"}-${index}`}><strong>{j.work}</strong><dl><div><dt>Total</dt><dd>{money(j.total)}</dd></div><div><dt>Received</dt><dd>{money(j.paid)}</dd></div><div><dt>Baki</dt><dd>{money(j.total-j.paid)}</dd></div><div><dt>Due</dt><dd>{j.date||"Not set"}{j.time?" · "+j.time:""}</dd></div></dl><div className="entry-status-chips" aria-label="Entry status"><button type="button" className={j.status==="Waiting"?"active":""} onClick={()=>updateJobStatus(j,"Waiting")}>Pending</button><button type="button" className={j.status==="Confirmed"?"active":""} onClick={()=>updateJobStatus(j,"Confirmed")}>In progress</button><button type="button" className={j.status==="Completed"?"active":""} onClick={()=>updateJobStatus(j,"Completed")}>Done</button></div><div className="chat-turn-actions saved-card-actions">{j.paid<j.total && <button type="button" className="card-action payment-action" onClick={()=>openPayment(j)}>₹ Payment</button>}<button type="button" className="card-action receipt-action" onClick={()=>openReceipt(j)}>Receipt</button><button type="button" className="card-action whatsapp-action" onClick={()=>openWhatsApp(j)}><Icon name="chat" size={15}/> WhatsApp</button><button type="button" className="card-action" onClick={()=>setDraft(j)}>Edit</button><button type="button" className="card-action reminder-action" onClick={()=>openReminder(j)}><Icon name="bell" size={15}/> Reminder</button><button type="button" className="card-action delete-action" onClick={()=>deleteEntry(j)}><Icon name="close" size={14}/> Delete</button></div></article>)}</div>
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
                      return <button className="customer-row-card" key={name} onClick={()=>openCustomerFromHisaab(name)}>
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
          {tab === "Subscription" && (
            <>
              <div className="page-heading subscription-heading">
                <div><div className="eyebrow">PLAN & USAGE</div><h1>Subscription</h1><p>See your plan, monthly voice allowance and upgrade options.</p></div>
              </div>
              <section className="subscription-summary panel">
                <div className="subscription-summary-main">
                  <span className="subscription-plan-icon"><Icon name="plan" size={21}/></span>
                  <div><small>CURRENT PLAN</small><h2>30-Day Free Trial</h2><p>100 customers · 100 voice minutes · full core features</p></div>
                </div>
                <div className="subscription-summary-usage">
                  <div><span>Voice used</span><strong>0 / 60 min</strong></div>
                  <div className="usage-track"><span style={{width:"0%"}}/></div>
                  <small>Your actual usage will appear here once connected to your account.</small>
                </div>
              </section>
              <section className="trial-value-banner">
                <div><span className="trial-value-kicker">FREE FOR 30 DAYS</span><h2>Try Pakki Baat free for 30 days</h2><p>Start with your real customers and see how easy daily Hisaab feels — no payment needed.</p><div className="trial-limit-row"><span><small>CUSTOMERS</small><strong>100</strong></span><span><small>VOICE + AI</small><strong>100 min</strong></span></div></div>
              </section>
              <div className="subscription-section-title"><div><h2>Choose what fits your business</h2><p>Start small and upgrade only when your customer list grows.</p></div></div>
              <div className="plan-grid clean-plan-grid value-plan-grid">
                {[
                  {name:"Basic",price:"₹99",perDay:"₹3.30/day",copy:"Everything you need to get organised",customers:"Up to 100 customers",team:"1 user",voice:"100 voice minutes included",voiceCopy:"Speak entries instead of typing"},
                  {name:"Smart",price:"₹179",perDay:"Less than ₹6/day",copy:"Best value for a growing business",customers:"Up to 250 customers",team:"1 user",voice:"500 voice minutes included",voiceCopy:"More freedom to enter Hisaab by voice"},
                  {name:"Business",price:"₹299",perDay:"Less than ₹10/day",copy:"For busy businesses and small teams",customers:"Unlimited customers",team:"1 business · Up to 3 team members",voice:"1,000 shared voice minutes",voiceCopy:"Shared across your whole team"},
                ].map(plan=><article className={"plan-card value-plan-card "+(plan.name==="Smart"?"recommended":"")} key={plan.name}>
                  <div className="plan-card-head"><div><h3>{plan.name}</h3><small>{plan.copy}</small></div>{plan.name==="Smart"&&<span className="recommended-tag">BEST VALUE</span>}</div>
                  <div className="plan-price-row"><div className="plan-price">{plan.price}<small>/month</small></div><span className="plan-daily-price">{plan.perDay}</span></div>
                  <div className="plan-limit-grid"><div><small>CUSTOMERS</small><strong>{plan.customers}</strong></div><div><small>VOICE + AI</small><strong>{plan.voice}</strong></div></div><div className="plan-team-line">{plan.team}</div>
                  <ul>
                    <li>Unlimited Hisaab entries</li>
                    <li>Track payments & baki</li>
                    <li>Reminders & WhatsApp follow-ups</li>
                    <li>Receipts & customer history</li>
                  </ul>
                  <div className="plan-voice-value"><small>{plan.voiceCopy}</small></div>
                  <button type="button" className={plan.name==="Smart"?"primary":"outline"} onClick={()=>{setPaymentPlan({name:plan.name,price:plan.price});setPaymentRef("");setPaymentProof(null);}}>Choose {plan.name}</button>
                </article>)}
              </div>
              <section className="subscription-help">
                <Icon name="shield" size={19}/><div><strong>What happens if voice minutes finish?</strong><p>You can keep using Hisaab and type entries. Voice/AI usage resumes after renewal or when extra minutes are added.</p></div>
              </section>
            </>
          )}
          {tab === "Admin" && (
            <>
              <div className="page-heading"><div><div className="eyebrow">PAKKI BAAT CONTROL</div><h1>Admin</h1><p>Subscription controls for the Pakki Baat owner.</p></div></div>
              <section className="admin-home">
                <div className="admin-welcome panel">
                  <span className="admin-gate-icon"><Icon name="shield" size={25}/></span>
                  <div><span className="eyebrow">OWNER ONLY</span><h2>Simple controls, all in one place</h2><p>Manage customers, payments and subscriptions without touching the database.</p></div>
                </div>
                <div className="admin-stat-row admin-overview">
                  <button type="button"><small>Total users</small><strong>—</strong><span>View customers</span></button>
                  <button type="button"><small>Pending payments</small><strong>—</strong><span>Review requests</span></button>
                  <button type="button"><small>Active plans</small><strong>—</strong><span>Subscriptions</span></button>
                  <button type="button"><small>Voice used</small><strong>—</strong><span>This month</span></button>
                </div>
                <div className="admin-section-grid">
                  <section className="panel admin-action-card">
                    <div className="admin-card-title"><span className="admin-action-icon"><Icon name="check" size={19}/></span><div><h3>Pending payments</h3><p>Approve UPI payments and activate the selected plan.</p></div></div>
                    <div className="admin-empty-state"><strong>No payment requests loaded yet</strong><small>New payment requests will appear here for one-tap approval.</small></div>
                  </section>
                  <section className="panel admin-action-card">
                    <div className="admin-card-title"><span className="admin-action-icon"><Icon name="plan" size={19}/></span><div><h3>Users & plans</h3><p>See each user's plan, expiry and voice usage.</p></div></div>
                    <div className="admin-quick-actions"><span><strong>Change plan</strong><small>Basic · Smart · Business</small></span><span><strong>Add voice minutes</strong><small>Give bonus usage when needed</small></span><span><strong>Extend / suspend</strong><small>Simple account controls</small></span></div>
                  </section>
                </div>
              </section>
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
              <section className="settings-subscription-card">
                <span className="settings-subscription-icon"><Icon name="plan" size={20}/></span>
                <span><strong>Subscription & usage</strong><small>See your plan, voice minutes and renewal details.</small></span>
                <button type="button" className="outline" onClick={()=>go("Subscription")}>View plan</button>
              </section>
              <section className="settings-panel panel">
                <label className="profile-name-setting">
                  Display name
                  <input
                    value={profileOwnerDraft}
                    maxLength={60}
                    onChange={(e) => setProfileOwnerDraft(e.target.value)}
                    placeholder={userName || "Your name"}
                  />
                  <small>Change this anytime. Pakki Baat will use it in greetings and your workspace.</small>
                </label>
                <label>
                  Business name
                  <input
                    value={profileBusinessDraft}
                    maxLength={100}
                    onChange={(e) => setProfileBusinessDraft(e.target.value)}
                  />
                  <small>This appears on receipts and business details.</small>
                </label>
                <button
                  type="button"
                  className="primary settings-profile-save"
                  onClick={saveProfileDetails}
                  disabled={profileOwnerDraft.trim() === owner.trim() && profileBusinessDraft.trim() === business.trim()}
                >
                  Save name & business
                </button>
                <div className="reminder-alert-settings">
                  <div className="reminder-alert-settings-head">
                    <span className="reminder-alert-settings-icon"><Icon name="bell" size={19}/></span>
                    <span><strong>Reminder alerts</strong><small>Notification, alarm sound and vibration on this device.</small></span>
                    <button
                      type="button"
                      className={reminderAlertsEnabled ? "setting-switch is-on" : "setting-switch"}
                      role="switch"
                      aria-checked={reminderAlertsEnabled}
                      onClick={()=>reminderAlertsEnabled ? disableReminderAlerts() : void enableReminderAlerts()}
                    ><span/></button>
                  </div>
                  {reminderAlertsEnabled && (
                    <div className="reminder-alert-options">
                      <label className="reminder-alert-option">
                        <span><strong>Alarm sound</strong><small>Play a clock-style alert while Pakki Baat is running.</small></span>
                        <input type="checkbox" checked={reminderSoundEnabled} onChange={e=>setReminderSound(e.target.checked)}/>
                      </label>
                      <label className="reminder-alert-option">
                        <span><strong>Vibrate</strong><small>Use phone vibration when the browser supports it.</small></span>
                        <input type="checkbox" checked={reminderVibrationEnabled} onChange={e=>setReminderVibration(e.target.checked)}/>
                      </label>
                      <div className="reminder-alert-status">
                        <span>System notifications</span>
                        <strong className={notificationPermission==="granted" ? "ok" : ""}>
                          {notificationPermission==="granted" ? "Allowed" : notificationPermission==="denied" ? "Blocked" : notificationPermission==="unsupported" ? "Not supported" : "Not allowed yet"}
                        </strong>
                      </div>
                      <button type="button" className="outline reminder-test-alert" disabled={pushDiagnosticBusy} onClick={()=>void testReminderAlert()}>
                        {pushDiagnosticBusy ? "Checking setup…" : "Check & send test notification"}
                      </button>
                      {pushDiagnostic && <div className={pushDiagnostic.startsWith("✓") ? "push-diagnostic ok" : "push-diagnostic error"}>{pushDiagnostic}</div>}
                    </div>
                  )}
                  <p className="reminder-alert-note">Closed-app reminders use system push notifications, so they can appear over other apps after Pakki Baat is closed. The custom clock-style sound is used while Pakki Baat is open; when closed, your phone controls the notification sound and vibration.</p>
                </div>
                <button type="button" className="how-it-works-card" onClick={()=>setGuideOpen(true)}>
                  <span className="how-it-works-icon">?</span>
                  <span><strong>How Pakki Baat works</strong><small>A 30-second guide to entries, payments, reminders and WhatsApp.</small></span>
                  <Icon name="arrow" size={17}/>
                </button>
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
                        { jobs, owner, business, reminders, payments, notes, customerPhones },
                        null,
                        2
                      ),
                      "pakki-baat-backup.json"
                    )
                  }
                >
                  Export my data
                </button>
                <label className="upload restore-backup-button">
                  <span className="restore-backup-main"><Icon name="arrow" size={17}/> Restore from backup</span>
                  <small>Choose a Pakki Baat backup file from this device.</small>
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
                  snapshot={{ jobs, owner, business, reminders, payments, notes, customerPhones }}
                  onRestore={restore}
                  dark={dark}
                  onToggleTheme={toggleTheme}
                />

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
      <nav className="mobile-nav" aria-label="Main navigation">
        {nav.map(([t, i], index) => (
          <span key={t} style={{ display: "contents" }}>
            {index === 2 && (
              <button
                type="button"
                className="mobile-add-entry"
                aria-label="Add new entry"
                title="Add new entry"
                onClick={openNewEntry}
              >
                <Icon name="plus" size={25} />
              </button>
            )}
            <button
              aria-label={t}
              className={tab === t ? "active mobile-nav-item" : "mobile-nav-item"}
              onClick={() => go(t)}
            >
              <span className="mobile-nav-icon-wrap">
                <Icon name={i} size={23} />
                {t==="Reminders" && activeReminders.length>0 && <b className="mobile-reminder-badge">{Math.min(99,activeReminders.length)}</b>}
              </span>
              <span className="mobile-nav-label">{t}</span>
            </button>
          </span>
        ))}
        <button
          aria-label="Settings"
          className={tab === "Settings" ? "active mobile-nav-item" : "mobile-nav-item"}
          onClick={() => go("Settings")}
        >
          <span className="mobile-nav-icon-wrap"><Icon name="settings" size={23} /></span>
          <span className="mobile-nav-label">Settings</span>
        </button>
      </nav>
      {ringingReminder && (
        <div className="modal-backdrop reminder-alarm-backdrop" onClick={()=>setRingingReminder(null)}>
          <section className="reminder-alarm-modal" role="alertdialog" aria-modal="true" aria-labelledby="reminder-alarm-title" onClick={e=>e.stopPropagation()}>
            <span className="reminder-alarm-icon"><Icon name="bell" size={27}/></span>
            <span className="eyebrow">REMINDER NOW</span>
            <h2 id="reminder-alarm-title">{ringingReminder.customer || "Pakki Baat reminder"}</h2>
            <p>{ringingReminder.text}</p>
            <small>{ringingReminder.date}{ringingReminder.time ? " · "+ringingReminder.time : ""}</small>
            <div className="reminder-alarm-actions">
              <button type="button" className="outline" onClick={()=>{snoozeReminder(ringingReminder.id);setRingingReminder(null);}}>Tomorrow</button>
              <button type="button" className="primary" onClick={()=>{completeReminder(ringingReminder.id);setRingingReminder(null);}}>Done ✓</button>
            </div>
            <button type="button" className="reminder-alarm-dismiss" onClick={()=>setRingingReminder(null)}>Dismiss alert</button>
          </section>
        </div>
      )}
      {(reminderJob || directReminderOpen) && (
        <div className="modal-backdrop" onClick={closeReminderEditor}>
          <section className="reminder-sheet" role="dialog" aria-modal="true" aria-labelledby="reminder-title" onClick={e=>e.stopPropagation()}>
            <div className="reminder-sheet-head">
              <div>
                <span className="new-customer-icon"><Icon name="bell" size={22}/></span>
                <span className="eyebrow">REMINDER</span>
                <h2 id="reminder-title">{reminderJob ? `Remind me about ${reminderJob.customer}` : "Add a reminder"}</h2>
                <p>{reminderJob ? reminderJob.work : "Write it once. Pakki Baat will keep it here for you."}</p>
              </div>
              <button className="icon-button" aria-label="Close reminder" onClick={closeReminderEditor}><Icon name="close"/></button>
            </div>
            {directReminderOpen && (
              <label className="reminder-customer-select">Customer <span>optional</span>
                <select value={reminderCustomer} onChange={e=>setReminderCustomer(e.target.value)}>
                  <option value="">General reminder</option>
                  {customerNames.map(name=><option key={name} value={name}>{name}</option>)}
                </select>
              </label>
            )}
            <label className="reminder-text-label">What should I remind you?<input autoFocus={directReminderOpen} value={reminderText} onChange={e=>setReminderText(e.target.value)} maxLength={500} placeholder="e.g. Call Asha about pending payment"/></label>
            <div className="reminder-block"><strong>When?</strong><div className="reminder-chips"><button type="button" className={reminderDate===dateForOffset(0)?"selected":""} onClick={()=>quickReminderDate("today")}><span className="chip-check">✓</span>Today</button><button type="button" className={reminderDate===dateForOffset(1)?"selected":""} onClick={()=>quickReminderDate("tomorrow")}><span className="chip-check">✓</span>Tomorrow</button><label className={reminderDate && reminderDate!==dateForOffset(0) && reminderDate!==dateForOffset(1) ? "date-chip selected" : "date-chip"}><Icon name="calendar" size={16}/><input aria-label="Pick reminder date" type="date" min={day()} value={reminderDate} onChange={e=>setReminderDate(e.target.value)}/></label></div></div>
            <div className="reminder-block"><strong>Time</strong><div className="reminder-chips"><button type="button" className={reminderTime==="09:00"?"selected":""} onClick={()=>setReminderTime("09:00")}><span className="chip-check">✓</span>Morning</button><button type="button" className={reminderTime==="15:00"?"selected":""} onClick={()=>setReminderTime("15:00")}><span className="chip-check">✓</span>Afternoon</button><button type="button" className={reminderTime==="19:00"?"selected":""} onClick={()=>setReminderTime("19:00")}><span className="chip-check">✓</span>Evening</button><label className={!["09:00","15:00","19:00"].includes(reminderTime) ? "date-chip selected" : "date-chip"}><Icon name="clock" size={16}/><input aria-label="Pick reminder time" type="time" value={reminderTime} onChange={e=>setReminderTime(e.target.value)}/></label></div></div>
            <div className="reminder-block"><strong>Repeat?</strong><div className="reminder-chips">{([["none","Once"],["daily","Daily"],["weekly","Weekly"],["monthly","Monthly"]] as const).map(([value,label])=><button type="button" key={value} className={reminderRepeat===value?"selected":""} onClick={()=>setReminderRepeat(value)}><span className="chip-check">✓</span>{label}</button>)}</div></div>
            <div className="reminder-sheet-actions"><button type="button" onClick={closeReminderEditor}>Cancel</button><button type="button" className="primary" disabled={!reminderDate || !reminderText.trim()} onClick={()=>void saveReminder()}>Save reminder</button></div>
          </section>
        </div>
      )}
      {receiptJob && (
        <div className="modal-backdrop" onClick={()=>setReceiptJob(null)}>
          <section className="receipt-modal" role="dialog" aria-modal="true" aria-labelledby="receipt-title" onClick={e=>e.stopPropagation()}>
            <button className="icon-button receipt-close" aria-label="Close receipt" onClick={()=>setReceiptJob(null)}><Icon name="close"/></button>
            <span className="eyebrow">CUSTOMER RECEIPT</span>
            <div className="receipt-paper">
              <div className="receipt-head">
                <div><strong>{business?.trim() || "Pakki Baat"}</strong><small>{receiptNumber(receiptJob)}</small></div>
                <span className={receiptJob.total<=receiptJob.paid ? "receipt-status paid" : "receipt-status"}>{receiptJob.total<=receiptJob.paid ? "PAID" : "BALANCE DUE"}</span>
              </div>
              <div className="receipt-customer">
                <small>Customer</small>
                <strong>{receiptJob.customer}</strong>
                <span>{receiptJob.work}</span>
              </div>
              <div className="receipt-values">
                <div><small>Total</small><strong>{money(receiptJob.total)}</strong></div>
                <div><small>Received</small><strong>{money(receiptJob.paid)}</strong></div>
                <div className="receipt-balance"><small>Balance</small><strong>{money(Math.max(0,receiptJob.total-receiptJob.paid))}</strong></div>
              </div>
              <div className="receipt-due"><span>Due</span><strong>{receiptJob.date || "Not set"}{receiptJob.time ? " · "+receiptJob.time : ""}</strong></div>
              <p>Thank you.</p>
            </div>
            <p className="receipt-help">Print it directly, save it as PDF from the print screen, or send the receipt details through WhatsApp.</p>
            <div className="receipt-actions">
              <button type="button" className="outline receipt-image-button" disabled={receiptImageBusy} onClick={()=>void downloadReceiptImage(receiptJob)}>{receiptImageBusy ? "Preparing…" : "Save image"}</button>
              <button type="button" className="outline receipt-image-button" disabled={receiptImageBusy} onClick={()=>void shareReceiptImage(receiptJob)}>{receiptImageBusy ? "Preparing…" : "Share image"}</button>
              <button type="button" className="outline" onClick={()=>printReceipt(receiptJob)}>Print / Save PDF</button>
              <button type="button" className="whatsapp-open-button" disabled={!isOnline} onClick={()=>sendReceiptOnWhatsApp(receiptJob)}><Icon name="chat" size={17}/> {isOnline ? "Send text on WhatsApp" : "WhatsApp needs internet"}</button>
            </div>
          </section>
        </div>
      )}
      {paymentPlan && (
        <div className="modal-backdrop payment-backdrop" onClick={()=>setPaymentPlan(null)}>
          <div className="modal payment-modal" role="dialog" aria-modal="true" aria-labelledby="payment-title" onClick={e=>e.stopPropagation()}>
            <button className="icon-button payment-close" aria-label="Close payment" onClick={()=>setPaymentPlan(null)}><Icon name="close"/></button>
            <span className="eyebrow">PAY WITH UPI</span>
            <h2 id="payment-title">{paymentPlan.name} · {paymentPlan.price}</h2>
            <p className="payment-intro">Scan this QR with any UPI app, or save it and pay from another app.</p>
            <div className="payment-qr-frame">
              <img src="/QR%20zorivo-icic.jpg" alt="Zorivo UPI QR code for Pakki Baat subscription payment"/>
            </div>
            <div className="payment-upi-row"><span><small>UPI ID</small><strong>zorivoworks-1@okicici</strong></span><button type="button" className="outline" onClick={()=>void copyUpiId()}>Copy</button></div>
            <div className="payment-actions"><button type="button" className="outline" onClick={downloadPaymentQr}>Download QR</button></div>
            <div className="payment-confirm">
              <div className="payment-done-title"><strong>Payment done? ✓</strong><small>Upload the payment-success screenshot. This is the easiest way.</small></div>
              <label className="payment-proof-upload">
                <input type="file" accept="image/*" onChange={e=>setPaymentProof(e.target.files?.[0] || null)}/>
                <span><Icon name="image" size={18}/><b>{paymentProof ? "Screenshot selected ✓" : "Upload payment screenshot"}</b></span>
                {paymentProof && <small>{paymentProof.name}</small>}
              </label>
              <div className="payment-or"><span>or</span></div>
              <label className="payment-ref-label"><span>Enter transaction ID instead</span><input value={paymentRef} onChange={e=>setPaymentRef(e.target.value)} placeholder="UPI transaction / reference ID" maxLength={80}/></label>
              <button type="button" className="primary" disabled={paymentSubmitting || (!paymentProof && !paymentRef.trim())} onClick={()=>void submitPaymentReference()}>{paymentSubmitting ? "Submitting…" : "Yes, I’ve Paid"}</button>
              <small className="payment-review-note">Your plan will activate after payment verification. No need to message us.</small>
            </div>
          </div>
        </div>
      )}
      {deleteCustomer && (
        <div className="modal-backdrop delete-confirm-backdrop" onClick={()=>setDeleteCustomer(null)}>
          <div className="modal delete-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-customer-title" onClick={e=>e.stopPropagation()}>
            <button className="icon-button delete-confirm-close" aria-label="Close" onClick={()=>setDeleteCustomer(null)}><Icon name="close"/></button>
            <div className="delete-confirm-icon"><Icon name="trash" size={22}/></div>
            <span className="eyebrow">DELETE CUSTOMER</span>
            <h2 id="delete-customer-title">Delete {deleteCustomer}?</h2>
            <p>This removes this customer and their hisaab entries, payments, notes and reminders.</p>
            <div className="modal-actions">
              <button type="button" className="outline" onClick={()=>setDeleteCustomer(null)}>Keep customer</button>
              <button type="button" className="danger-button" onClick={confirmDeleteCustomer}>Delete customer</button>
            </div>
          </div>
        </div>
      )}
      {deleteJob && (
        <div className="modal-backdrop delete-confirm-backdrop" onClick={()=>setDeleteJob(null)}>
          <section className="delete-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-entry-title" aria-describedby="delete-entry-description" onClick={e=>e.stopPropagation()}>
            <button className="icon-button delete-confirm-close" aria-label="Close" onClick={()=>setDeleteJob(null)}><Icon name="close"/></button>
            <span className="delete-confirm-icon"><Icon name="close" size={21}/></span>
            <span className="eyebrow">DELETE ENTRY</span>
            <h2 id="delete-entry-title">Remove this from {deleteJob.customer}’s hisaab?</h2>
            <div className="delete-entry-preview">
              <strong>{deleteJob.work}</strong>
              <span>{money(deleteJob.total)} total · {money(deleteJob.paid)} received · {money(Math.max(0,deleteJob.total-deleteJob.paid))} baki</span>
            </div>
            <p id="delete-entry-description">Any payment history and reminders linked to this entry will also be removed. You can still undo immediately after deleting.</p>
            <div className="delete-confirm-actions">
              <button type="button" className="outline" onClick={()=>setDeleteJob(null)}>Keep entry</button>
              <button type="button" className="delete-confirm-button" onClick={confirmDeleteEntry}>Delete entry</button>
            </div>
          </section>
        </div>
      )}
      {guideOpen && (
        <div className="modal-backdrop guide-backdrop" onClick={()=>closeGuide()}>
          <section className="app-guide-modal" role="dialog" aria-modal="true" aria-labelledby="app-guide-title" onClick={e=>e.stopPropagation()}>
            <button className="icon-button app-guide-close" aria-label="Close guide" onClick={()=>closeGuide()}><Icon name="close"/></button>
            <span className="eyebrow">PAKKI BAAT IN 30 SECONDS</span>
            <h2 id="app-guide-title">Your hisaab, without the notebook confusion.</h2>
            <p className="app-guide-intro">Start with a customer. Pakki Baat keeps the work, money, reminders and follow-up together.</p>
            <div className="app-guide-steps">
              <div className="app-guide-step"><b>1</b><span><strong>Add a customer</strong><small>Each customer gets one simple hisaab folder.</small></span></div>
              <div className="app-guide-step"><b>2</b><span><strong>Add what happened</strong><small>Speak, type naturally, or fill the form. We turn it into a clean entry.</small></span></div>
              <div className="app-guide-step"><b>3</b><span><strong>Payment = record money received</strong><small>Tap Payment when a customer has already paid you. It only updates Received and Baki — it never takes money.</small></span></div>
              <div className="app-guide-step"><b>4</b><span><strong>Follow up without remembering everything</strong><small>Set a reminder or open WhatsApp with an editable message already prepared.</small></span></div>
            </div>
            <div className="app-guide-actions">
              <button type="button" className="outline" onClick={()=>closeGuide()}>Got it</button>
              <button type="button" className="primary" onClick={()=>closeGuide("Hisaab")}>Open Hisaab <Icon name="arrow" size={16}/></button>
            </div>
          </section>
        </div>
      )}
      {paymentJob && (
        <div className="modal-backdrop" onClick={()=>setPaymentJob(null)}>
          <section className="quick-payment-modal" role="dialog" aria-modal="true" aria-labelledby="quick-payment-title" onClick={e=>e.stopPropagation()}>
            <button className="icon-button quick-payment-close" aria-label="Close" onClick={()=>setPaymentJob(null)}><Icon name="close"/></button>
            <span className="eyebrow">PAYMENT RECEIVED</span>
            <h2 id="quick-payment-title">{paymentJob.customer}</h2>
            <p>{paymentJob.work}</p>
            <div className="payment-explainer"><strong>What this does</strong><span>Records money you already received and reduces the baki. Pakki Baat does not collect or transfer money.</span></div>
            <div className="quick-payment-baki"><small>Current baki</small><strong>{money(Math.max(0,paymentJob.total-paymentJob.paid))}</strong></div>
            <form onSubmit={e=>{e.preventDefault();saveQuickPayment();}}>
              <label>Amount received (₹)
                <input autoFocus inputMode="decimal" type="number" min="0" step="0.01" max={Math.max(0,paymentJob.total-paymentJob.paid)} placeholder="e.g. 500" value={paymentAmount} onChange={e=>setPaymentAmount(e.target.value)}/>
              </label>
              <button type="submit" className="primary" disabled={!paymentAmount || Number(paymentAmount)<=0}>Save payment</button>
            </form>
          </section>
        </div>
      )}
      {customerContactsOpen && (
        <div className="modal-backdrop" onClick={()=>setCustomerContactsOpen(false)}>
          <section className="customer-contacts-modal" role="dialog" aria-modal="true" aria-labelledby="customer-contacts-title" onClick={e=>e.stopPropagation()}>
            <button className="icon-button customer-contacts-close" aria-label="Close contacts" onClick={()=>setCustomerContactsOpen(false)}><Icon name="close"/></button>
            <span className="eyebrow">CUSTOMER DIRECTORY</span>
            <h2 id="customer-contacts-title">Customer contacts</h2>
            <p>{customerNames.length} {customerNames.length===1 ? "customer" : "customers"} · {customerNames.filter(name=>customerPhones[name]).length} with mobile number</p>
            <label className="customer-contacts-search"><Icon name="search" size={17}/><input autoFocus placeholder="Search customer…" value={contactQuery} onChange={e=>setContactQuery(e.target.value)}/></label>
            <div className="customer-contacts-list">
              {customerNames.filter(name=>name.toLowerCase().includes(contactQuery.toLowerCase())).map(name=>(
                <div className="customer-contact-row" key={name}>
                  <span className="avatar">{name[0]?.toUpperCase()}</span>
                  <span className="customer-contact-main"><strong>{name}</strong><small>{customerPhones[name] ? "+"+customerPhones[name] : "No mobile number saved"}</small></span>
                  <button type="button" className="customer-contact-edit" onClick={()=>{setCustomerContactsOpen(false);openPhoneEditor(name);}}>
                    {customerPhones[name] ? "Edit" : "Add number"}
                  </button>
                </div>
              ))}
              {!customerNames.length && <div className="customer-contacts-empty">No customers yet.</div>}
            </div>
            <div className="customer-contacts-actions">
              <button type="button" className="outline" disabled={!customerNames.length} onClick={()=>void copyCustomerContacts()}>Copy list</button>
              <button type="button" className="primary" disabled={!customerNames.length} onClick={downloadCustomerContacts}>Download CSV</button>
            </div>
          </section>
        </div>
      )}
      {phoneEditorCustomer && (
        <div className="modal-backdrop" onClick={()=>setPhoneEditorCustomer(null)}>
          <section className="phone-editor-modal" role="dialog" aria-modal="true" aria-labelledby="phone-editor-title" onClick={e=>e.stopPropagation()}>
            <button className="icon-button phone-editor-close" aria-label="Close" onClick={()=>setPhoneEditorCustomer(null)}><Icon name="close"/></button>
            <span className="eyebrow">CUSTOMER WHATSAPP</span>
            <h2 id="phone-editor-title">{phoneEditorCustomer}</h2>
            <p>Save the number once so WhatsApp is one tap next time.</p>
            <form onSubmit={e=>{e.preventDefault();saveCustomerPhone();}}>
              <label>WhatsApp number
                <input autoFocus type="tel" inputMode="tel" autoComplete="tel" placeholder="e.g. 9876543210" value={phoneEditorValue} onChange={e=>setPhoneEditorValue(e.target.value)} maxLength={20}/>
              </label>
              <button type="submit" className="primary">{phoneEditorValue.trim() ? "Save number" : "Remove number"}</button>
            </form>
          </section>
        </div>
      )}
      {whatsappJob && (
        <div className="modal-backdrop" onClick={() => setWhatsappJob(null)}>
          <section className="whatsapp-send-modal" role="dialog" aria-modal="true" aria-labelledby="whatsapp-send-title" onClick={e=>e.stopPropagation()}>
            <button className="icon-button whatsapp-send-close" aria-label="Close" onClick={()=>setWhatsappJob(null)}><Icon name="close"/></button>
            <span className="whatsapp-send-icon"><Icon name="chat" size={23}/></span>
            <span className="eyebrow">SEND ON WHATSAPP</span>
            <h2 id="whatsapp-send-title">Message {whatsappJob.customer}</h2>
            <p>Edit the message any way you like. We’ll open WhatsApp with it already filled in.</p>
            <form onSubmit={e=>{e.preventDefault();sendWhatsApp();}}>
              <label>WhatsApp number
                <input
                  autoFocus
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="e.g. 9876543210"
                  value={whatsappNumber}
                  onChange={e=>setWhatsappNumber(e.target.value)}
                  maxLength={20}
                />
              </label>
              <label className="whatsapp-save-number">
                <input type="checkbox" checked={saveWhatsappNumber} onChange={e=>setSaveWhatsappNumber(e.target.checked)}/>
                <span>Save this number for {whatsappJob.customer}</span>
              </label>
              <label>Message
                <textarea
                  value={whatsappMessage}
                  onChange={e=>setWhatsappMessage(e.target.value)}
                  maxLength={4000}
                  placeholder="Write anything you want to send…"
                />
              </label>
              <button type="button" className="whatsapp-reset-message" onClick={()=>setWhatsappMessage(replyText(whatsappJob))}>Use saved entry details</button>
              <small>Indian 10-digit numbers automatically get +91. For other countries, include the country code.</small>
              <button className="whatsapp-open-button" type="submit" disabled={!whatsappNumber.trim() || !whatsappMessage.trim()}>
                <Icon name="chat" size={18}/> Open WhatsApp
              </button>
            </form>
          </section>
        </div>
      )}
      {saveLoginPromptOpen && (
        <div className="modal-backdrop" onClick={() => setSaveLoginPromptOpen(false)}>
          <section className="save-login-modal" role="dialog" aria-modal="true" aria-labelledby="save-login-title" onClick={e=>e.stopPropagation()}>
            <button className="icon-button save-login-close" aria-label="Close" onClick={()=>setSaveLoginPromptOpen(false)}><Icon name="close"/></button>
            <span className="save-login-icon"><Icon name="check" size={24}/></span>
            <span className="eyebrow">KEEP YOUR HISAAB SAFE</span>
            <h2 id="save-login-title">Sign in to save your entries</h2>
            <p>Your customers, payments and reminders will stay connected to your account and can be restored on another device.</p>
            <button type="button" className="google-sign-in save-login-google" onClick={()=>{setSaveLoginPromptOpen(false);void startGoogleSignIn();}}>
              Continue with Google
            </button>
            <button type="button" className="save-login-later" onClick={()=>setSaveLoginPromptOpen(false)}>Not now</button>
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
            {recentCustomers.length>0 && (
              <div className="recent-customers">
                <small>Recent customers</small>
                <div>{recentCustomers.map(name=><button type="button" key={name} onClick={()=>{setSelectedCustomer(name);setMessage("");setCustomerChatOpen(false);setNewCustomerOpen(false);}}>{name}</button>)}</div>
              </div>
            )}
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
                    <option value="Waiting">Pending</option>
                    <option value="Confirmed">In progress</option>
                    <option value="Completed">Done</option>
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
          <span>{toast}</span>
          {lastUndo?.message===toast && <button type="button" onClick={undoLastAction}>Undo</button>}
        </div>
      )}
    </div>
  );
}
