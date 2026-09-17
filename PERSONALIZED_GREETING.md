# ✨ Personalized Greeting Feature

## What Changed

The home page now displays a **personalized greeting** using the logged-in user's name!

---

## 🎯 Feature Details

### When Signed In with Google:
```
Hello, Sarrah ☀
```
- Shows your **Google profile name** (e.g., "Sarrah")
- Falls back to **email username** if no profile name (e.g., "sarrah" from sarrah@gmail.com)

### When Not Signed In:
```
Hello, Asha ☀
```
- Shows the **workspace owner name** (default: "Asha")
- You can change this in Settings

---

## 🔍 How It Works

1. **Google Sign-In**: When you log in with Google, the app fetches:
   - `user_metadata.full_name` or `user_metadata.name` (from Google profile)
   - `user.email` (as fallback)

2. **Name Extraction**:
   - If full name exists: Use it directly
   - If no full name: Extract username from email (before @)
   - If not signed in: Use workspace owner name

3. **Real-Time Updates**:
   - Name updates immediately when you sign in
   - Clears when you sign out
   - Persists across page refreshes

---

## 📝 Examples

### Example 1: Full Google Profile
- **Signed in as**: sarrah.designer@gmail.com
- **Google profile name**: Sarrah Ahmed
- **Displays**: "Hello, Sarrah Ahmed ☀"

### Example 2: Email Only
- **Signed in as**: sarrah123@gmail.com  
- **No profile name set**
- **Displays**: "Hello, sarrah123 ☀"

### Example 3: Not Signed In
- **Workspace owner**: Asha
- **Displays**: "Hello, Asha ☀"

---

## 🧪 Testing

1. **Test when signed out:**
   ```
   npm run dev
   ```
   - Go to: http://localhost:3000
   - Should see: "Hello, Asha ☀" (or your workspace owner name)

2. **Test Google Sign-In:**
   - Click "Login / Sign up" in top right
   - Sign in with Google
   - Return to home page
   - Should see: "Hello, [Your Name] ☀"

3. **Test Sign Out:**
   - Click "Sign out"
   - Should revert to: "Hello, Asha ☀"

---

## 🛠️ Technical Implementation

### State Management:
```typescript
const [userName, setUserName] = useState<string | null>(null);
```

### Session Watcher:
```typescript
useEffect(() => {
  void currentSession().then((session) => {
    if (session?.user) {
      const metadata = session.user.user_metadata;
      const fullName = metadata?.full_name || metadata?.name;
      const email = session.user.email || "";
      const emailName = email.split("@")[0];
      setUserName(fullName || emailName || null);
    }
  });

  return watchSession((session) => {
    // Updates in real-time when auth state changes
  });
}, []);
```

### Greeting Display:
```tsx
<h1>
  Hello, {userName || owner} <span className="sun">☀</span>
</h1>
```

---

## 📂 Files Modified

- ✅ `app/workspace.tsx` - Added userName state and auth listener
- ✅ Greeting now uses `{userName || owner}` for fallback

---

## ✨ User Experience

### Before:
- Always showed: "Hello, Asha ☀"
- Same for everyone, even when signed in

### After:
- Signed in: "Hello, Sarrah ☀" (personalized!)
- Signed out: "Hello, Asha ☀" (workspace default)
- Feels more welcoming and personal

---

## 🎉 All Changes Pushed to GitHub!

The greeting will now automatically show your name when you're logged in! 🚀
