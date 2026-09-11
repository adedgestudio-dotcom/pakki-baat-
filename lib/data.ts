export type Job = { id:string; customer:string; work:string; total:number; paid:number; date:string; time:string; status:string; source:string };
export type Snapshot = {jobs:Job[]; owner:string; business:string};
export function isSnapshot(v:unknown):v is Snapshot {
 if(!v||typeof v!=="object")return false;
 const s=v as Snapshot;
 return typeof s.owner==="string"&&s.owner.length<=60&&typeof s.business==="string"&&s.business.length<=100&&Array.isArray(s.jobs)&&s.jobs.length<=5000&&s.jobs.every(j=>j&&typeof j.id==="string"&&typeof j.customer==="string"&&j.customer.length<=100&&typeof j.work==="string"&&j.work.length<=500&&typeof j.source==="string"&&j.source.length<=12000&&Number.isFinite(j.total)&&Number.isFinite(j.paid)&&j.total>=0&&j.paid>=0&&j.paid<=j.total&&["Waiting","Confirmed","Completed"].includes(j.status)&&typeof j.date==="string"&&(!j.date||/^\d{4}-\d{2}-\d{2}$/.test(j.date))&&typeof j.time==="string"&&(!j.time||/^\d{2}:\d{2}$/.test(j.time)))&&new Set(s.jobs.map(j=>j.id)).size===s.jobs.length;
}
export function calendarFile(j:Job){
 const escape=(s:string)=>s.replace(/\\/g,"\\\\").replace(/\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;").replace(/\r/g,"");
 const date=j.date.replaceAll("-","");
 return ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Pakki Baat//Business reminders//EN","BEGIN:VEVENT",`UID:${j.id}@pakki-baat`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,"")}`,j.time?`DTSTART:${date}T${j.time.replace(":","")}00`:`DTSTART;VALUE=DATE:${date}`,`SUMMARY:${escape(j.customer+": "+j.work)}`,`DESCRIPTION:${escape(`Balance to collect: INR ${j.total-j.paid}`)}`,"BEGIN:VALARM","TRIGGER:-PT1H","ACTION:DISPLAY","DESCRIPTION:Pakki Baat reminder","END:VALARM","END:VEVENT","END:VCALENDAR"].join("\r\n");
}
