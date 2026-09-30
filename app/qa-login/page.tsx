"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithPassword } from "@/lib/cloud";

export default function QaLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const session = await signInWithPassword(email, password);
      if (!session) throw new Error("QA sign-in did not create a session.");
      router.replace("/");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "QA sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{minHeight:"100vh",display:"grid",placeItems:"center",padding:24,background:"#0c0c1b",color:"#fff"}}>
      <form onSubmit={submit} style={{width:"min(420px,100%)",display:"grid",gap:14,padding:24,border:"1px solid #2d2d45",borderRadius:18,background:"#13132A"}}>
        <div>
          <div style={{fontSize:12,letterSpacing:1.5,opacity:.7}}>PAKKI BAAT QA</div>
          <h1 style={{margin:"6px 0 4px",fontSize:26}}>Test account sign in</h1>
          <p style={{margin:0,opacity:.7,fontSize:14}}>For disposable QA accounts only. Normal users should continue with Google.</p>
        </div>
        <label style={{display:"grid",gap:6,fontSize:14}}>Email
          <input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} style={{padding:12,borderRadius:10,border:"1px solid #3a3a55",background:"#0c0c1b",color:"#fff"}} />
        </label>
        <label style={{display:"grid",gap:6,fontSize:14}}>Password
          <input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} style={{padding:12,borderRadius:10,border:"1px solid #3a3a55",background:"#0c0c1b",color:"#fff"}} />
        </label>
        {error && <p role="alert" style={{margin:0,fontSize:14}}>{error}</p>}
        <button type="submit" disabled={busy} style={{padding:12,border:0,borderRadius:10,fontWeight:700,cursor:"pointer"}}>{busy ? "Signing in..." : "Sign in to QA account"}</button>
      </form>
    </main>
  );
}
