# ✨ Custom Name Management System

## How It Works

The name displayed throughout Pakki Baat follows this priority:

```
Custom name → Google/account name → Email-derived name → "there"
```

### Priority Breakdown:

1. **Custom name** (`owner`) - User-edited in Settings
2. **Google/account name** (`userName`) - From Google profile metadata
3. **Email-derived name** - Extracted from email (e.g., "sarrah" from sarrah@gmail.com)
4. **Fallback** - "there" (e.g., "Hello, there")

---

## Code Pattern

### Display Name:
```typescript
const displayName = owner?.trim() || userName || "there";
```

### Usage Examples:

**Greetings:**
```tsx
<h1>Hello, {displayName}!</h1>
<strong>Hi {displayName}!</strong>
```

**Avatars:**
```tsx
<span className="avatar">{displayName.charAt(0).toUpperCase()}</span>
```

---

## User Flow

### First Login (No Custom Name Set):

1. User signs in with Google
2. System extracts name from Google profile: "Sarrah"
3. App shows: "Hello, Sarrah"
4. Workspace shows: "Sarrah" with email below

### Setting Custom Name:

1. User goes to Settings
2. Sees input field with placeholder showing current name
3. Changes name to anything (e.g., "Sarrah Ahmed")
4. Saves (happens automatically on change)
5. App now shows: "Hello, Sarrah Ahmed" everywhere

### Priority in Action:

| Scenario | owner | userName | displayName |
|----------|-------|----------|-------------|
| New user, no custom name | "" | "Sarrah" | "Sarrah" |
| Custom name set | "Sarrah Ahmed" | "Sarrah" | "Sarrah Ahmed" |
| Custom name cleared | "" | "Sarrah" | "Sarrah" |
| No Google name | "" | "" | "there" |

---

## Where Display Name Appears

### 1. **Home Page Greeting**
```tsx
<h1>Hello, {displayName} ☀</h1>
```

### 2. **Workspace Card** (Top of Sidebar)
```tsx
<span className="avatar coral">{displayName.charAt(0).toUpperCase()}</span>
<strong>{displayName}</strong>
```

### 3. **Account Card** (Bottom of Sidebar)
```tsx
<span className="avatar">{displayName.charAt(0).toUpperCase()}</span>
<strong>{displayName}</strong>
```

### 4. **Top Bar Avatar**
```tsx
<span className="avatar small">{displayName.charAt(0).toUpperCase()}</span>
```

### 5. **Assistant Chat**
```tsx
<strong>Hi {displayName}!</strong>
```

---

## Settings UI

### Name Input Field:
```tsx
<label>
  Your name
  <input
    value={owner}
    maxLength={60}
    onChange={(e) => setOwner(e.target.value)}
    placeholder={userName || "Your name"}
  />
  <small>This is how Pakki Baat will address you.</small>
</label>
```

**Features:**
- Shows current custom name (if set)
- Placeholder shows Google/account name (if available)
- Helper text explains purpose
- Auto-saves on change (via localStorage)
- Max 60 characters

---

## Benefits

### ✅ **Personalization:**
- Users can choose any name they prefer
- Not limited to Google profile name
- Can use nicknames, full names, or anything

### ✅ **Privacy:**
- Users control what name appears in the app
- Can use different name than Google account
- Email address shown separately (only in sidebar)

### ✅ **Consistency:**
- Same name appears everywhere in the app
- Single source of truth (`displayName`)
- Easy to maintain and update

### ✅ **Smart Fallbacks:**
- Always shows something meaningful
- Never shows "undefined" or "null"
- Graceful degradation

---

## Examples

### Example 1: Google User "AD_Edge Studio"
```
First login:
- displayName: "AD_Edge Studio" (from Google)
- Shows: "Hello, AD_Edge Studio"

After setting custom name to "Sarrah":
- displayName: "Sarrah"
- Shows: "Hello, Sarrah"
```

### Example 2: Email-only User
```
First login with: sarrah@example.com
- displayName: "Sarrah" (from email)
- Shows: "Hello, Sarrah"

After setting custom name to "Sarrah Ahmed":
- displayName: "Sarrah Ahmed"
- Shows: "Hello, Sarrah Ahmed"
```

### Example 3: No Name Available
```
Rare case (no Google name, no email):
- displayName: "there"
- Shows: "Hello, there"
```

---

## Data Storage

### Local Storage:
```javascript
localStorage.setItem("pakki-baat-v1", JSON.stringify({
  jobs: [...],
  owner: "Sarrah Ahmed", // Custom name saved here
  business: "My small business"
}));
```

### Cloud Storage (Planned):
- Custom name syncs to user's Google account
- Available across devices
- Stored in cloud workspace snapshot

---

## Changes Made

### State:
- ✅ Changed `owner` default from "Asha" to ""
- ✅ Added `displayName` computed value
- ✅ Kept `userName` from Google/email extraction

### UI Updates:
- ✅ All greetings use `displayName`
- ✅ All avatars use `displayName.charAt(0).toUpperCase()`
- ✅ Settings input has placeholder and helper text
- ✅ Workspace section shows `displayName`
- ✅ Account section shows `displayName`

### Removed:
- ❌ "Asha" as default owner
- ❌ "Your little workspace" vs "Your workspace" logic
- ❌ Complex conditional name display

---

## Testing

### Test Scenarios:

1. **Sign out, refresh page:**
   - Should show empty name field in Settings
   - Should show "Hello, there" on home page

2. **Sign in with Google:**
   - Should show Google name automatically
   - Should show as placeholder in Settings

3. **Set custom name in Settings:**
   - Type "Sarrah Ahmed" and see it update everywhere
   - Avatar should show "S"
   - All greetings should say "Sarrah Ahmed"

4. **Clear custom name:**
   - Delete text in Settings
   - Should revert to Google/email name

5. **Sign out:**
   - Custom name should be saved in local storage
   - Next sign-in restores custom name (if same browser)

---

## 🎉 Result

**Consistent, personalized experience:**
- ✅ User-controlled name
- ✅ Smart fallbacks
- ✅ Clean, simple code
- ✅ Works across all screens
- ✅ No more "Asha" for new users!

**All changes pushed to GitHub!** 🚀
