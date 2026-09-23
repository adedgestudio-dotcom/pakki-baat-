"use client";

import { useEffect, useState } from "react";
import { currentSession } from "@/lib/cloud";
import "./admin.css";

const OWNER_EMAIL = "zorivoworks@gmail.com";

export default function AdminPage(){
  const [state,setState]=useState<"loading"|"owner"|"blocked"|"signedout">("loading");
  const [email,setEmail]=useState("");

  useEffect(()=>{void currentSession().then(session=>{
    const mail=(session?.user?.email||"").toLowerCase();
    setEmail(mail);
    if(!session) setState("signedout");
    else if(mail===OWNER_EMAIL) setState("owner");
    else setState("blocked");
  }).catch(()=>setState("signedout"));},[]);

  if(state==="loading") return <main className="admin-shell"><div className="admin-center">Opening owner panel…</div></main>;
  if(state==="signedout") return <main className="admin-shell"><div className="admin-access-card"><span>PAKKI BAAT OWNER</span><h1>Admin sign in</h1><p>Sign in with the Pakki Baat owner Google account.</p><p className="admin-login-note">Admin sign-in is kept separate so it does not replace the account currently open in Pakki Baat.</p><a className="admin-button" href="/">Back to Pakki Baat</a></div></main>;
  if(state==="blocked") return <main className="admin-shell"><div className="admin-access-card"><span>OWNER ONLY</span><h1>Admin access</h1><p>{email} is the account currently open in Pakki Baat. It has not been changed.</p><p className="admin-login-note">To keep your testing account separate, admin will use its own owner session instead of switching this app session.</p><a className="admin-button" href="/">Back to Pakki Baat</a></div></main>;

  return <main className="admin-shell">
    <header className="admin-topbar"><div><span className="admin-brand-mark">P</span><div><strong>Pakki Baat</strong><small>Owner panel</small></div></div><a href="/">Open app</a></header>
    <div className="admin-wrap">
      <div className="admin-heading"><div><span>OWNER DASHBOARD</span><h1>Good to see you.</h1><p>Everything important, without the clutter.</p></div><small>{OWNER_EMAIL}</small></div>
      <section className="admin-stats">
        <article><small>Total users</small><strong>—</strong><span>Customer accounts</span></article>
        <article><small>Pending payments</small><strong>—</strong><span>Needs your review</span></article>
        <article><small>Active plans</small><strong>—</strong><span>Paid subscriptions</span></article>
        <article><small>Voice used</small><strong>—</strong><span>This month</span></article>
      </section>
      <section className="admin-grid">
        <article className="admin-card"><div className="admin-card-head"><div><span>PAYMENTS</span><h2>Pending approvals</h2></div><button disabled>View all</button></div><div className="admin-empty"><strong>No requests loaded yet</strong><p>UPI payment requests will appear here. You’ll be able to approve or reject them in one tap.</p></div></article>
        <article className="admin-card"><div className="admin-card-head"><div><span>USERS</span><h2>Manage plans</h2></div></div><div className="admin-actions"><div><strong>Change plan</strong><small>Basic · Smart · Business</small></div><div><strong>Add voice minutes</strong><small>Give bonus minutes when needed</small></div><div><strong>Extend subscription</strong><small>Change renewal date</small></div><div><strong>Suspend / reactivate</strong><small>Control account access</small></div></div></article>
      </section>
    </div>
  </main>;
}
