-- READ ONLY. Run only against staging after the verified-backup RPC migration.
with fixtures(name, payload) as (
  values
    ('nested', $json${"owner":"Āsha","business":"Cake & Co","jobs":[{"id":"job-1","customer":"Zoë","work":"Cake & tea","total":1250.5,"paid":250,"date":"2026-10-11","time":"09:30","status":"Confirmed","source":"WhatsApp","createdAt":"2026-10-11T09:00:00Z"}],"payments":[{"id":"pay-1","customer":"Zoë","jobId":"job-1","amount":250,"date":"2026-10-11","note":"Paid ₹250","createdAt":"2026-10-11T09:31:00Z"}],"reminders":[{"id":"rem-1","text":"Call \"Zoë\"\n","date":"2026-10-12","time":"10:00","customer":"Zoë","jobId":"job-1","repeat":"weekly","done":false,"createdAt":"2026-10-11T09:32:00Z"}],"notes":[{"id":"note-1","customer":"Zoë","text":"Unicode: café ✓","createdAt":"2026-10-11T09:33:00Z"}],"customerPhones":{"Åsha":"919999999999","李":"8613800000000"}}$json$::jsonb),
    ('key_ordering', $json${"owner":"O","business":"B","jobs":[],"payments":[],"reminders":[],"notes":[],"customerPhones":{"bbb":"1","a":"2","Å":"3","é":"4","aa":"5"}}$json$::jsonb),
    ('null_boolean_array', $json${"z":null,"a":[true,false,null,{"bb":"x","a":"y"}]}$json$::jsonb),
    ('numeric_decimal', $json${"owner":"N","business":"B","jobs":[{"id":"n","customer":"C","work":"W","total":0.000001,"paid":0,"date":"2026-10-11","time":"","status":"Waiting","source":"S"}],"payments":[],"reminders":[],"notes":[],"customerPhones":{}}$json$::jsonb),
    ('escaping', $json${"owner":"Line\nTab\tQuote\"Slash\\","business":"<>&","jobs":[],"payments":[],"reminders":[],"notes":[],"customerPhones":{"x/y":"\b\f\r"}}$json$::jsonb)
)
select name, payload::text as canonical_jsonb_text,
  pg_catalog.encode(extensions.digest(pg_catalog.convert_to(payload::text, 'UTF8'), 'sha256'), 'hex') as payload_sha256
from fixtures order by name;
