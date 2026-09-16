# 🎤 AI Transcription Setup Guide

Complete guide to enable voice recording with AI transcription in Pakki Baat.

---

## 📋 Overview

AI transcription allows users to:
1. **Record voice notes** (WhatsApp-style)
2. **Auto-transcribe** audio to text (OpenAI Whisper)
3. **Auto-extract** business details (GPT-4)

**Requirements:**
- ✅ OpenAI API Key (already have)
- ✅ Supabase Project (already have)
- ⚠️ Supabase Database Setup (need to run SQL)
- ⚠️ Supabase Phone Auth Setup (optional but recommended)

---

## 🗄️ Step 1: Setup Supabase Database

### 1.1 Open Supabase SQL Editor

1. Go to: https://supabase.com/dashboard/project/uendrvpkyvfxnoxsalpu
2. Click **"SQL Editor"** in left sidebar
3. Click **"New query"**

### 1.2 Run the Database Schema

Copy and paste this SQL:

```sql
-- Run once in the Supabase SQL editor. Phone authentication requires an SMS provider.
create table if not exists public.workspaces (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 payload jsonb not null check (jsonb_typeof(payload) = 'object'),
 updated_at timestamptz not null default now()
);
alter table public.workspaces enable row level security;
revoke all on public.workspaces from anon;
grant select, insert, update on public.workspaces to authenticated;
create policy "Read own workspace" on public.workspaces for select to authenticated using (auth.uid() = owner_id);
create policy "Insert own workspace" on public.workspaces for insert to authenticated with check (auth.uid() = owner_id);
create policy "Update own workspace" on public.workspaces for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create or replace function public.save_workspace(payload jsonb) returns void language sql security invoker set search_path = public as $$
 insert into public.workspaces(owner_id,payload) values(auth.uid(),payload)
 on conflict(owner_id) do update set payload=excluded.payload, updated_at=now();
$$;
revoke all on function public.save_workspace(jsonb) from public;
grant execute on function public.save_workspace(jsonb) to authenticated;

-- Atomic, durable quota. Only the server can consume credits.
create table if not exists public.ai_usage(owner_id uuid references auth.users(id) on delete cascade, usage_day date not null default current_date, calls integer not null default 0, primary key(owner_id,usage_day));
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon,authenticated;
create or replace function public.consume_ai_credit(user_id uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 insert into public.ai_usage(owner_id,usage_day,calls) values(user_id,current_date,1)
 on conflict(owner_id,usage_day) do update set calls=ai_usage.calls+1 where ai_usage.calls<30
 returning calls into n;
 return n is not null;
end;$$;
revoke all on function public.consume_ai_credit(uuid) from public,anon,authenticated;
grant execute on function public.consume_ai_credit(uuid) to service_role;
```

### 1.3 Click "Run" button

You should see: **"Success. No rows returned"**

---

## 📱 Step 2: Setup Phone Authentication (2 Options)

### ⚡ Option A: Quick Test Mode (No SMS, Magic Link)

**Use email authentication for testing:**

1. Go to: https://supabase.com/dashboard/project/uendrvpkyvfxnoxsalpu/auth/providers
2. Scroll to **"Email"** provider
3. Enable **"Enable Email provider"**
4. **Disable** "Confirm email" (for testing)
5. Click **"Save"**

**Test with email:**
- In your app Settings, use email instead of phone
- No SMS costs, instant setup

---

### 🚀 Option B: Full Phone Auth with SMS (Production)

**Required: SMS Provider (Twilio recommended)**

#### 2.1 Create Twilio Account

1. Go to: https://www.twilio.com/try-twilio
2. Sign up (free trial gives $15 credit)
3. Verify your email and phone
4. Go to: https://console.twilio.com/

#### 2.2 Get Twilio Credentials

1. From Twilio Console dashboard, copy:
   - **Account SID** (starts with AC...)
   - **Auth Token** (click to reveal)
2. Click **"Get a trial phone number"** (or buy one)
3. Copy the **Phone Number** (format: +1234567890)

#### 2.3 Configure Supabase Phone Auth

1. Go to: https://supabase.com/dashboard/project/uendrvpkyvfxnoxsalpu/auth/providers
2. Scroll to **"Phone"** provider
3. Click **"Enable"**
4. Select **"Twilio"** as provider
5. Enter:
   - **Twilio Account SID**: (from step 2.2)
   - **Twilio Auth Token**: (from step 2.2)
   - **Twilio Phone Number**: (from step 2.2, with +)
6. Click **"Save"**

---

## 🔑 Step 3: Verify Environment Variables

Your `.env.local` should have (already configured):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://uendrvpkyvfxnoxsalpu.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
OPENAI_API_KEY=sk-proj-3Qtqw...
OPENAI_EXTRACTION_MODEL=gpt-4-turbo-preview
OPENAI_TRANSCRIPTION_MODEL=whisper-1
```

⚠️ **IMPORTANT:** Your current Supabase URL looks like a dashboard URL, not an API URL!

### Fix Supabase URL:

1. Go to: https://supabase.com/dashboard/project/uendrvpkyvfxnoxsalpu/settings/api
2. Find **"Project URL"** (should be: `https://uendrvpkyvfxnoxsalpu.supabase.co`)
3. Update `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://uendrvpkyvfxnoxsalpu.supabase.co
```

---

## 🧪 Step 4: Test the Setup

### 4.1 Restart Development Server

```powershell
# Stop current server (Ctrl+C)
npm run dev
```

### 4.2 Test in Browser

1. Open: http://localhost:3000
2. Go to **"Settings"** (gear icon)
3. Enter your phone number (with country code, e.g., +919876543210)
4. Click **"Send code"**
5. Enter the 6-digit OTP from SMS
6. Should see: **"Signed in as +919876543210"**

### 4.3 Test Voice Recording

1. Go to **"My assistant"** tab
2. Click the **microphone button**
3. Allow microphone permission in browser
4. Click again to start recording
5. Speak: "Test message for Riya, chocolate cake, 2500 rupees"
6. Click to stop (after 3-5 seconds)
7. Should see: **"Processing..."** then auto-filled form

---

## 🐛 Troubleshooting

### ❌ "Sign in with your phone in Settings to use AI"

**Fix:** Complete Step 2 (Phone Auth) and sign in

---

### ❌ "Usage limits are not configured"

**Fix:** Run the SQL schema from Step 1.2 again

---

### ❌ "You have used today's 30 AI captures"

**Fix:** Wait until tomorrow, or increase limit in SQL:

```sql
-- Change 30 to 100 or any number
create or replace function public.consume_ai_credit(user_id uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 insert into public.ai_usage(owner_id,usage_day,calls) values(user_id,current_date,1)
 on conflict(owner_id,usage_day) do update set calls=ai_usage.calls+1 where ai_usage.calls<100
 returning calls into n;
 return n is not null;
end;$$;
```

---

### ❌ "The recording could not be transcribed"

**Possible causes:**
1. Invalid OpenAI API key
2. Audio format not supported
3. Audio file too large (>2MB)
4. No speech detected

**Fix:**
- Check console for error details
- Try shorter recording (5-10 seconds)
- Speak clearly and loudly

---

### ❌ "Microphone not supported"

**Fix:** Use HTTPS or localhost (HTTP only works on localhost)

---

## 💰 Costs

### OpenAI API:
- **Whisper transcription**: $0.006 per minute (~₹0.50/min)
- **GPT-4 extraction**: ~$0.01 per request (~₹0.80)
- **30 daily captures**: ~₹30-40/day

### Twilio SMS:
- **Free trial**: $15 credit (~1000 OTPs)
- **After trial**: $0.0075 per SMS (~₹0.60 per OTP)
- **Phone number**: $1/month (~₹80/month)

### Alternative: Use email auth (FREE)
- No SMS costs
- Use magic links instead of OTP
- Good for testing

---

## 🎯 Quick Test Without Phone Auth

If you just want to test transcription without phone auth:

1. **Temporarily disable auth check** in `app/api/extract/route.ts`
2. Comment out lines 31-44 (auth verification)
3. Restart server
4. Test voice recording
5. **Re-enable auth** before deploying!

⚠️ **NOT RECOMMENDED FOR PRODUCTION** - anyone can use your OpenAI credits!

---

## ✅ Success Checklist

- [ ] Database schema created (Step 1)
- [ ] Phone auth or email auth enabled (Step 2)
- [ ] Environment variables correct (Step 3)
- [ ] Server restarted
- [ ] Signed in successfully
- [ ] Voice recording works
- [ ] Transcription appears
- [ ] Details auto-extracted

---

## 📞 Support

If stuck, check:
1. Browser console (F12) for errors
2. Server logs (`npm run dev` output)
3. Supabase logs: https://supabase.com/dashboard/project/uendrvpkyvfxnoxsalpu/logs/edge-logs

Common error patterns:
- `401`: Auth issue - sign in again
- `503`: Missing env vars
- `502`: OpenAI API error
- `429`: Daily limit reached
