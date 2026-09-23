"use client";

import { FormEvent, useEffect, useState } from "react";
import "./admin.css";

export default function AdminPage(){
  const [ready,setReady]=useState(false);
  const [unlocked,setUnlocked]=useState(false);
  const [pin,setPin]=useState("");
  const [error,setError]=useState("");
  const [showPin,setShowPin]=useState(false);
  useEffect(()=>{setUnlocked(sessionStorage.getItem("pakki-admin-unlocked")==="1");setReady(true)},[]);

  async function login(e:FormEvent){
    e.preventDefault(); setError("");
    try {
      const res=await fetch("/api/admin/auth",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pin})});
      const data=await res.json().catch(()=>({}));
      if(res.ok){sessionStorage.setItem("pakki-admin-unlocked","1");setUnlocked(true);setPin("");return;}
      if(res.status===401) setError(data?.error||"Incorrect PIN. Please try again.");
      else if(res.status===503) setError("Admin PIN is not configured on this deployment. Check ADMIN_PIN in Vercel and redeploy.");
      else setError(data?.error||`Admin login failed (error ${res.status}).`);
    } catch {
      setError("Could not reach the admin login server. Please try again.");
    }
  }
  function logout(){sessionStorage.removeItem("pakki-admin-unlocked");setUnlocked(false)}

  if(!ready) return <main className="admin-shell"><div className="admin-center">Opening admin…</div></main>;
  if(!unlocked) return <main className="admin-shell"><form className="admin-access-card" onSubmit={login}>
    <span>PAKKI BAAT OWNER</span><h1>Admin access</h1><p>Enter your owner PIN. Your Pakki Baat testing account stays signed in separately.</p>
    <div className="admin-pin-row"><input className="admin-pin" type={showPin?"text":"password"} inputMode="numeric" autoComplete="current-password" value={pin} onChange={e=>setPin(e.target.value)} placeholder="Enter PIN" maxLength={32} autoFocus /><button className="admin-pin-eye" type="button" aria-label={showPin?"Hide PIN":"Show PIN"} onClick={()=>setShowPin(v=>!v)}><span className="admin-eye-label">{showPin?"Hide":"Show"}</span><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>{showPin&&<path d="M4 4l16 16"/>}</svg></button></div>
    {error&&<div className="admin-error">{error}</div>}
    <button type="submit" disabled={!pin}>Open Admin</button><a href="/">Back to Pakki Baat</a>
  </form></main>;

  return <main className="admin-shell">
    <header className="admin-topbar"><div><span className="admin-brand-mark">P</span><div><strong>Pakki Baat</strong><small>Owner panel</small></div></div><div className="admin-top-actions"><a href="/">Open app</a><button onClick={logout}>Lock</button></div></header>
    <div className="admin-wrap">
      <div className="admin-heading"><div><span>OWNER DASHBOARD</span><h1>Good to see you.</h1><p>Everything important, without the clutter.</p></div></div>
      <section className="admin-stats"><article><small>Total users</small><strong>—</strong><span>Customer accounts</span></article><article><small>Pending payments</small><strong>—</strong><span>Needs your review</span></article><article><small>Active plans</small><strong>—</strong><span>Paid subscriptions</span></article><article><small>Voice used</small><strong>—</strong><span>This month</span></article></section>
      <section className="admin-grid">
        <article className="admin-card"><div className="admin-card-head"><div><span>PAYMENTS</span><h2>Pending approvals</h2></div><button disabled>View all</button></div><div className="admin-empty"><strong>No requests loaded yet</strong><p>UPI payment requests will appear here. You’ll be able to approve or reject them in one tap.</p></div></article>
        <article className="admin-card"><div className="admin-card-head"><div><span>USERS</span><h2>Manage plans</h2></div></div><div className="admin-actions"><div><strong>Change plan</strong><small>Basic · Smart · Business</small></div><div><strong>Add voice minutes</strong><small>Give bonus minutes when needed</small></div><div><strong>Extend subscription</strong><small>Change renewal date</small></div><div><strong>Suspend / reactivate</strong><small>Control account access</small></div></div></article>
      </section>
    </div>
  </main>;
}
