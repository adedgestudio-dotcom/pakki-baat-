const base=process.env.NEXT_PUBLIC_SUPABASE_URL;
const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const cloudConfigured=Boolean(base&&key);
type Session={access_token:string;refresh_token:string;expires_at?:number;expires_in?:number;user:{id:string}};
let session:Session|null=null;
export function signedIn(){return Boolean(session)}
async function request(path:string,body?:unknown,token?:string){
 if(!base||!key)throw new Error("Cloud connection is not configured yet.");
 const r=await fetch(`${base}${path}`,{method:body?"POST":"GET",headers:{apikey:key,"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const raw=await r.text();const result=raw?JSON.parse(raw):null;if(!r.ok)throw new Error(result?.msg||result?.error_description||result?.message||"Cloud request failed.");return result;
}
export async function sendCode(phone:string){if(!/^\+[1-9]\d{7,14}$/.test(phone))throw new Error("Enter your phone with country code, for example +919876543210.");await request("/auth/v1/otp",{phone,create_user:true});}
export async function verifyCode(phone:string,code:string){session=await request("/auth/v1/verify",{phone,token:code,type:"sms"});if(session)session.expires_at=Math.floor(Date.now()/1000)+(session.expires_in||3600);}
export async function cloudToken(){if(!session)throw new Error("Sign in with your phone first.");if((session.expires_at||0)<Date.now()/1000+60){session=await request("/auth/v1/token?grant_type=refresh_token",{refresh_token:session.refresh_token});if(session)session.expires_at=Math.floor(Date.now()/1000)+(session.expires_in||3600);}if(!session)throw new Error("Sign in again.");return session.access_token;}
export async function saveCloud(snapshot:unknown){const token=await cloudToken();await request("/rest/v1/rpc/save_workspace",{payload:snapshot},token);}
export async function loadCloud(){const token=await cloudToken();const rows=await request("/rest/v1/workspaces?select=payload",undefined,token);return rows[0]?.payload||null;}
export function signOut(){session=null;}
