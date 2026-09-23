"use client";

export default function AdminLoginPage(){
  return (
    <main style={{minHeight:"100vh",display:"grid",placeItems:"center",background:"#f6f4ed",padding:20,fontFamily:"Arial, sans-serif"}}>
      <section style={{width:"min(430px,100%)",background:"#fffdf8",border:"1px solid #dde6e1",borderRadius:20,padding:28,textAlign:"center",color:"#24322d"}}>
        <div style={{fontSize:10,letterSpacing:".16em",fontWeight:900,color:"#2d7667"}}>PAKKI BAAT OWNER</div>
        <h1 style={{margin:"8px 0",fontSize:24}}>Owner login</h1>
        <p style={{color:"#718079",lineHeight:1.55,fontSize:14}}>Admin access is being kept separate from your customer testing login.</p>
        <p style={{color:"#718079",lineHeight:1.55,fontSize:13}}>For now, open this admin page in an Incognito / Private browser window and sign in there with <strong>zorivoworks@gmail.com</strong>. Your normal Pakki Baat window will remain signed in to the testing account.</p>
        <a href="/admin" style={{display:"inline-block",marginTop:8,background:"#2d7667",color:"white",padding:"11px 16px",borderRadius:11,textDecoration:"none",fontWeight:800,fontSize:13}}>Continue to Admin</a>
      </section>
    </main>
  );
}
