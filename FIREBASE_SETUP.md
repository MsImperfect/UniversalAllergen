# Firebase Setup

Enable Firebase email/password auth and create a Realtime Database for the SafeBite app.

## 1. Environment

Copy `.env.example` to `.env` and fill in:

```env
FIREBASE_API_KEY=...
FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_DATABASE_URL=https://your-project-id-default-rtdb.firebaseio.com
FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
FIREBASE_MESSAGING_SENDER_ID=...
FIREBASE_APP_ID=...
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

How to get each missing value:

- `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`
  Get these from `Project settings` -> `General` -> `Your apps` -> your web app -> `SDK setup and configuration`.
- `FIREBASE_DATABASE_URL`
  Get this from `Build` -> `Realtime Database` after creating the database.
- `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
  Get these from `Project settings` -> `Service accounts` -> `Generate new private key`.

## 2. Authentication

In Firebase Console:

1. Open `Authentication`.
2. Enable `Email/Password`.

## 3. Realtime Database

Create a Realtime Database and apply rules like this:

```json
{
  "rules": {
    "profiles": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    },
    "history": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    },
    "warnings": {
      ".read": "auth != null",
      "$warningId": {
        ".write": "auth != null"
      }
    }
  }
}
```

After you create the database, copy its URL into:

```env
FIREBASE_DATABASE_URL=...
```

## 4. Data Shape

The app writes:

- `profiles/{uid}`
- `history/{uid}/{entryId}`
- `warnings/{warningId}`

## 5. Run

```bash
npm start
```

If startup says Firebase Admin is not configured, check that:

- `FIREBASE_DATABASE_URL` is set
- `FIREBASE_CLIENT_EMAIL` is set
- `FIREBASE_PRIVATE_KEY` is present and still contains `\n` line breaks inside the quoted string
