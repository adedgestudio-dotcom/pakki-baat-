# 🚀 Quick Start - AI Transcription

**Time needed:** 5-10 minutes (with SMS) or 2 minutes (email only)

---

## ✅ Step 1: Run Database Setup (2 minutes)

1. **Open Supabase SQL Editor:**
   ```
   https://supabase.com/dashboard/project/uendrvpkyvfxnoxsalpu/sql/new
   ```

2. **Copy the SQL from `supabase/schema.sql`**

3. **Click "Run"** - should see "Success"

---

## ✅ Step 2: Enable Authentication (Choose ONE)

### Option A: Email Auth (FASTEST - 1 minute)

1. Go to: https://supabase.com/dashboard/project/uendrvpkyvfxnoxsalpu/auth/providers
2. Scroll to **"Email"**
3. Toggle **ON** - "Enable Email provider"
4. **Uncheck** "Confirm email" (for testing)
5. Click **"Save"**

✅ **Done!** You can now sign in with email (no SMS costs)

---

### Option B: Phone Auth with SMS (PRODUCTION - 10 minutes)

**Requires:** Twilio account (free trial has $15 credit)

1. **Get Twilio Account:**
   - Sign up: https://www.twilio.com/try-twilio
   - Copy: Account SID, Auth Token, Phone Number

2. **Configure Supabase:**
   - Go to: https://supabase.com/dashboard/project/uendrvpkyvfxnoxsalpu/auth/providers
   - Click "Phone" → "Enable"
   - Select "Twilio"
   - Enter your Twilio credentials
   - Save

✅ **Done!** Users can sign in with phone + OTP

---

## ✅ Step 3: Verify Environment (30 seconds)

Your `.env.local` should have:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://uendrvpkyvfxnoxsalpu.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
OPENAI_API_KEY=sk-proj-3Qtqw...
OPENAI_EXTRACTION_MODEL=gpt-4-turbo-preview
OPENAI_TRANSCRIPTION_MODEL=whisper-1
```

✅ **Already configured!**

---

## ✅ Step 4: Test It! (1 minute)

1. **Restart server:**
   ```powershell
   npm run dev
   ```

2. **Open:** http://localhost:3000

3. **Go to Settings** → Sign in (email or phone)

4. **Go to "My assistant"** → Click microphone

5. **Record:** "Test for Riya, birthday cake, 3000 rupees"

6. **See magic:** Auto-transcribed and extracted! ✨

---

## 🎯 That's It!

**What works now:**
- ✅ Voice recording (WhatsApp-style)
- ✅ Auto-transcription (Whisper AI)
- ✅ Auto-extraction (GPT-4)
- ✅ 30 free AI captures per day per user
- ✅ Manual text entry (always free)

**Costs:**
- Whisper: ~₹0.50 per minute
- GPT-4: ~₹0.80 per extraction
- Twilio SMS (if using): ~₹0.60 per OTP
- Email auth: FREE

---

## 🐛 Troubleshooting

**Pages not loading?**
```powershell
# Kill any stuck processes
Get-Process -Name node | Stop-Process -Force
npm run dev
```

**"Sign in with your phone"?**
→ Complete Step 2 and sign in from Settings

**"Usage limits not configured"?**
→ Run the SQL from Step 1 again

**Microphone not working?**
→ Allow microphone permission in browser

---

## 📖 Full Documentation

See `AI_SETUP_GUIDE.md` for detailed docs, troubleshooting, and advanced setup.
