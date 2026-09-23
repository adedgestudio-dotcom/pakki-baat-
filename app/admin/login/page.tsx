"use client";

import { useState } from "react";

export default function AdminLoginPage(){
  const [showHelp,setShowHelp]=useState(false);
  return <main style={{minHeight:"100vh",display:"grid",placeItems:"center",background:"#f6f4ed",padding:20,fontFamily:"Arial, sans-serif"}}>
    <section style={{width:"min(430px,100%)",background:"#fffdf8",border:"1px solid #dde6e1",borderRadius:20,padding:28,textAlign:"center",color:"#24322d"}}>
      <div style={{fontSize:10,letterSpacing:".16em",fontWeight:900,color:"#2d7667"}}>PAKKI BAAT OWNER</div>
      <h1 style={{margin:"8px 0",fontSize:24}}>Owner login</h1>
      <p style={{color:"#718079",lineHeight:1.55,fontSize:14}}>Your normal Pakki Baat account will not be signed out from this page.</p>
      <button type="button" onClick={()=>setShowHelp(true)} style={{width:"100%",border:0,borderRadius:11,background:"#2d7667",color:"white",padding:12,fontWeight:800,marginTop:8}}>Sign in with owner Google account</button>
      {showHelp&&<div style={{marginTop:14,padding:14,border:"1px solid #dde6e1",borderRadius:12,color:"#718079",fontSize:13,lineHeight:1.5}}>Separate admin authentication is not connected yet. Until it is, use an Incognito / Private window, open <strong>/admin</strong>, and sign in there as <strong>zorivoworks@gmail.com</strong>. This avoids replacing your testing account.</div>}
      <a href="/" style={{display:"inline-block",marginTop:16,color:"#2d7667",textDecoration:"none",fontWeight:700,fontSize:13}}>Back to Pakki Baat</a>
    </section>
  </main>;
}
