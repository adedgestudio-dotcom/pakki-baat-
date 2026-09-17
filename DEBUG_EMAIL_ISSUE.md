# 🔍 Debug Email Extraction Issue

## Immediate Steps to Debug

### 1. **Open Browser Console** (F12)
   - Go to the Console tab
   - Refresh the page
   - Sign in with Google

### 2. **Look for These Logs:**

You should see a sequence like this:

```
🚀 Setting up session watcher...
📥 Current session: {...}
🔍 extractUserName called with session: {...}
📧 Email found: uiux@domain.com
📋 Metadata: {...}
📝 Email name part: uiux
✅ Using capitalized email name: Uiux
📛 Setting userName to: Uiux
```

### 3. **Check What You Actually See:**

**If you see:**
```
❌ No session or user found
```
**Problem**: Google sign-in didn't work or session expired
**Solution**: Click "Sign out" then "Login / Sign up" again

**If you see:**
```
📧 Email found: 
❌ No email found
```
**Problem**: Session exists but has no email
**Solution**: The Google account might not have shared email - check Google OAuth settings

**If you see:**
```
✅ Using full name: [Your Name]
```
**This is OK**: It means your Google profile has a name set, so it's using that instead of email

**If you see nothing:**
```
(no logs at all)
```
**Problem**: Code not running or console cleared
**Solution**: Refresh page and check immediately

---

## Visual Indicators Added

### Top Bar Status:
- **Shows**: "Connected: uiux@domain.com" (when logged in with email visible)
- **Shows**: "Google connected" (when logged in but email not loaded yet)
- **Shows**: "Device workspace" (when not logged in)

### Navigation Sections:
All 3 places should now show your email:
1. **Workspace section** (top): Shows name + email
2. **Account section** (bottom): Shows name + email  
3. **Top bar avatar**: Hover shows email

---

## What to Report Back

Please copy and paste from your console:

1. **All logs starting with** 🚀, 📥, 🔍, 📧, ✅, or ❌
2. **What you see in top bar** (Connected: ... or Google connected?)
3. **What shows in workspace section** (small text under name)
4. **What shows in account section** (small text under name)

---

## Common Issues & Solutions

### Issue 1: "Google connected" but no email
**Check**: Console logs
**Look for**: What does `📧 Email found:` show?
**Solution**: If empty, Google account didn't share email

### Issue 2: Shows "Asha" instead of your name
**Check**: Are you actually logged in?
**Look for**: Top bar should say "Google connected" or "Connected: ..."
**Solution**: If it says "Device workspace", you're not logged in

### Issue 3: Console shows email but UI doesn't update
**Check**: Look for `📛 Setting userName to:` log
**Look for**: Does it show the correct name?
**Solution**: If log shows correct name but UI doesn't, might be React state issue - try hard refresh (Ctrl+Shift+F5)

### Issue 4: Name shows but not email in small text
**Check**: What does the small text show?
**Should show**: The full email address
**If shows**: "Your workspace" or "Signed in" instead
**Solution**: Code didn't update properly - check if latest commit was pulled

---

## Test Steps

1. **Clear browser cache** (Ctrl+Shift+Delete)
2. **Hard refresh** (Ctrl+Shift+F5)
3. **Open console** (F12)
4. **Sign out** (if logged in)
5. **Sign in with Google**
6. **Watch console logs** as they appear
7. **Take screenshot** of console
8. **Report what you see**

---

## Expected Behavior

### Successful Flow:
```
1. 🚀 Setting up session watcher...
2. 📥 Current session: { user: { ... } }
3. 🔍 extractUserName called with session: {...}
4. 📧 Email found: uiux@domain.com
5. 📋 Metadata: { ... }
6. 📝 Email name part: uiux
7. ✅ Using capitalized email name: Uiux
8. 📛 Setting userName to: Uiux
```

### Then:
- Top bar shows: "Connected: uiux@domain.com"
- Workspace section shows: "Uiux" with "uiux@domain.com" below
- Account section shows: "Uiux" with "uiux@domain.com" below
- All avatars show: "U"

---

## Quick Fix Attempts

### Try 1: Hard Refresh
```
Ctrl+Shift+F5 (Windows)
Cmd+Shift+R (Mac)
```

### Try 2: Clear State
```javascript
// In console, run:
localStorage.clear();
location.reload();
```

### Try 3: Sign Out & In
1. Click "Sign out"
2. Wait 2 seconds
3. Click "Login / Sign up"
4. Complete Google sign-in
5. Check console immediately

---

## What I Need to Debug Further

Please provide:
1. **Screenshot of browser console** (after signing in)
2. **Screenshot of the app** (showing workspace and account sections)
3. **What email you're signing in with**
4. **What you expect to see vs what you actually see**

This will help me identify exactly where the issue is!
