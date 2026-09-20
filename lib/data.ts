export type Job = { id:string; customer:string; work:string; total:number; paid:number; date:string; time:string; status:string; source:string };
export type Reminder = { id:string; text:string; date:string; time:string; customer?:string; jobId?:string; repeat?:"none"|"daily"|"weekly"|"monthly"; done:boolean; createdAt:string };
export type Payment = { id:string; customer:string; jobId?:string; amount:number; date:string; note?:string; createdAt:string };
export type CustomerNote = { id:string; customer:string; text:string; createdAt:string };
export type Snapshot = {jobs:Job[]; owner:string; business:string; reminders?:Reminder[]; payments?:Payment[]; notes?:CustomerNote[]; customerPhones?:Record<string,string>};

export function isSnapshot(v:unknown):v is Snapshot {
 if(!v||typeof v!=="object")return false;
 const s=v as Snapshot;
 const jobsOk=typeof s.owner==="string"&&s.owner.length<=60&&typeof s.business==="string"&&s.business.length<=100&&Array.isArray(s.jobs)&&s.jobs.length<=5000&&s.jobs.every(j=>j&&typeof j.id==="string"&&typeof j.customer==="string"&&j.customer.length<=100&&typeof j.work==="string"&&j.work.length<=500&&typeof j.source==="string"&&j.source.length<=12000&&Number.isFinite(j.total)&&Number.isFinite(j.paid)&&j.total>=0&&j.paid>=0&&j.paid<=j.total&&["Waiting","Confirmed","Completed"].includes(j.status)&&typeof j.date==="string"&&(!j.date||/^\d{4}-\d{2}-\d{2}$/.test(j.date))&&typeof j.time==="string"&&(!j.time||/^\d{2}:\d{2}$/.test(j.time)))&&new Set(s.jobs.map(j=>j.id)).size===s.jobs.length;
 if(!jobsOk)return false;
 if(s.reminders!==undefined&&(!Array.isArray(s.reminders)||s.reminders.length>5000||!s.reminders.every(r=>r&&typeof r.id==="string"&&typeof r.text==="string"&&r.text.length<=500&&typeof r.date==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&typeof r.time==="string"&&(!r.time||/^\d{2}:\d{2}$/.test(r.time))&&(r.customer===undefined||typeof r.customer==="string")&&(r.jobId===undefined||typeof r.jobId==="string")&&["none","daily","weekly","monthly",undefined].includes(r.repeat)&&typeof r.done==="boolean"&&typeof r.createdAt==="string")))return false;
 if(s.payments!==undefined&&(!Array.isArray(s.payments)||s.payments.length>10000||!s.payments.every(p=>p&&typeof p.id==="string"&&typeof p.customer==="string"&&Number.isFinite(p.amount)&&p.amount>0&&typeof p.date==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(p.date)&&typeof p.createdAt==="string")))return false;
 if(s.notes!==undefined&&(!Array.isArray(s.notes)||s.notes.length>10000||!s.notes.every(n=>n&&typeof n.id==="string"&&typeof n.customer==="string"&&typeof n.text==="string"&&n.text.length<=2000&&typeof n.createdAt==="string")))return false;
 if(s.customerPhones!==undefined&&(!s.customerPhones||typeof s.customerPhones!=="object"||Array.isArray(s.customerPhones)||Object.entries(s.customerPhones).some(([name,phone])=>!name||name.length>100||typeof phone!=="string"||phone.length>20)))return false;
 return true;
}
export function calendarFile(j:Job){
 const escape=(s:string)=>s.replace(/\\/g,"\\\\").replace(/\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;").replace(/\r/g,"");
 const date=j.date.replaceAll("-","");
 return ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Pakki Baat//Business reminders//EN","BEGIN:VEVENT",`UID:${j.id}@pakki-baat`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,"")}`,j.time?`DTSTART:${date}T${j.time.replace(":","")}00`:`DTSTART;VALUE=DATE:${date}`,`SUMMARY:${escape(j.customer+": "+j.work)}`,`DESCRIPTION:${escape(`Balance to collect: INR ${j.total-j.paid}`)}`,"BEGIN:VALARM","TRIGGER:-PT1H","ACTION:DISPLAY","DESCRIPTION:Pakki Baat reminder","END:VALARM","END:VEVENT","END:VCALENDAR"].join("\r\n");
}
