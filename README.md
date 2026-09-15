# Pakki Baat

A simple workspace for bakers, tutors, boutique owners and other small businesses. Turn customer messages into reviewed commitments, keep payment balances together and prepare a clear reply.

Built with React, Next.js App Router and TypeScript. Next.js route handlers run on Vercel; Supabase provides optional phone authentication and cloud backups.

## Try locally

Run these commands in this project folder:

```sh
npm install
npm run dev
```

Open http://localhost:3000. On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`.

No service account is needed for the local trial. Start with **Add customer message**, try the example, review the details and save. Use **Explore with sample commitments** for a populated workspace.

## Included

- Today: outstanding payments, work due, and commitments awaiting confirmation.
- Chat-style assistant with manual capture and a mandatory review step.
- Create, edit, delete, search and filter commitments; track total and actual money received.
- Copy a customer confirmation; download a calendar event with a reminder.
- Customer history inferred from saved commitments.
- Editable workspace name, device persistence, JSON backup export and validated restore.
- Phone share-sheet feedback (or clipboard fallback) and downloadable feedback.
- Optional SMS sign-in and manual Supabase cloud backup/restore.
- Optional AI capture from text, screenshots, uploaded audio or microphone recording.
- Responsive desktop layout and mobile bottom navigation.

Quick capture is a convenience form, not an AI parser. Check every field. Customer confirmation is a manual status; sending a reply never changes it automatically. A calendar download must be imported into the user's calendar to create a reminder.

## Optional Supabase setup

1. Copy `.env.example` to `.env.local`.
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from your project.
3. Run `supabase/schema.sql` once in the Supabase SQL editor.
4. Enable phone authentication and configure an SMS provider. For a private trial, Supabase test phone numbers/codes can avoid sending real SMS.
5. Restart the app, open Settings, and sign in using a phone number with its country code.

Cloud backups are explicitly saved and restored. They do not merge across devices. Each Supabase account can read/write only its own workspace through row-level security. Authentication tokens stay in memory; refreshing the app requires signing in again. Device data remains visible in that browser after signing out.

## Optional AI setup

Set `OPENAI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` on the server. Never prefix these secrets with `NEXT_PUBLIC_`. Model names can be changed through the example environment variables.

AI requests require a valid Supabase login and use an atomic database quota of 30 attempted captures per account per database day. Failed processing attempts also count. Uploads are limited to 2 MB; microphone recordings stop after one minute. After recording, choose **Send voice in chat** to post a playable audio message. If AI is configured, the recording is automatically sent to OpenAI for transcription and the assistant replies to the spoken details in the chat. If transcription fails, the voice note stays in the chat and can be retried. **Transcribe with OpenAI** is also available before sending for users who want to review the words first. **Read details with AI** opens an editable draft. Sent audio is stored in this browser and is not included in workspace backups. The server uses OpenAI transcription and structured extraction. Uploaded media is forwarded for processing and is not stored in Supabase; the extracted text is stored when the user saves the commitment.

Live SMS delivery, cloud access policies and AI output need to be verified against your configured services before inviting public users. Provider calls may cost money.

## Deploy when ready

Import this repository into Vercel as a Next.js project and add the same environment variables to the intended environment. No custom domain is needed for the trial; Vercel's assigned URL is sufficient. Public trials should also configure Supabase SMS rate limits and CAPTCHA, provider budgets and a privacy notice for customer data.

## Validation and limits

```sh
npm run lint
npm run build
```

Browser smoke testing covers creation, edits, payment balance, device persistence, customer history, calendar export, backups, feedback, and mobile layouts. Local trial features work without Meta. There is no automatic WhatsApp sending, subscription billing, background notification service or offline service worker in this version. The web manifest supplies app naming and icons only.

Device storage belongs to this browser, not a login account. Use a separate browser profile on shared devices and export backups before clearing browser data. Keep backup files private; they contain customer details.
