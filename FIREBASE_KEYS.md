# How To Get Firebase Keys

This app needs two sets of Firebase values in `.env`:

1. The public web app config for browser sign-in.
2. The Admin SDK service-account values for the Node server.

## 1. Open your Firebase project

1. Go to the Firebase console.
2. Create a project if you do not already have one.
3. Open that project.

## 2. Register a web app

1. In the project overview, click the Web app icon (`</>`).
2. Enter any nickname, for example `SafeBite Web`.
3. Click `Register app`.

Firebase will show a web config object that looks like this:

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  databaseURL: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

## 3. Copy the public web config into `.env`

Map the Firebase config fields to this project like this:

```env
FIREBASE_API_KEY=apiKey
FIREBASE_AUTH_DOMAIN=authDomain
FIREBASE_PROJECT_ID=projectId
FIREBASE_STORAGE_BUCKET=storageBucket
FIREBASE_MESSAGING_SENDER_ID=messagingSenderId
FIREBASE_APP_ID=appId
```

Example:

```env
FIREBASE_API_KEY=AIza...
FIREBASE_AUTH_DOMAIN=my-project.firebaseapp.com
FIREBASE_PROJECT_ID=my-project
FIREBASE_STORAGE_BUCKET=my-project.firebasestorage.app
FIREBASE_MESSAGING_SENDER_ID=1234567890
FIREBASE_APP_ID=1:1234567890:web:abcdef123456
```

## 4. Get the Realtime Database URL

This value is usually **not** in the snippet you pasted unless you already created Realtime Database.

In Firebase Console:

1. Open `Build` -> `Realtime Database`.
2. Click `Create database` if you have not created one yet.
3. Choose the region and finish setup.
4. After the database exists, look near the top of the Realtime Database page for the database URL.

It will look like one of these:

```text
https://your-project-id-default-rtdb.firebaseio.com
https://your-project-id-default-rtdb.asia-southeast1.firebasedatabase.app
```

Copy that into:

```env
FIREBASE_DATABASE_URL=...
```

## 5. If you already closed the web setup popup

You can get the same values again from:

`Project settings` -> `General` -> `Your apps` -> select your web app -> `SDK setup and configuration`

## 6. Also enable the required Firebase products

For this app you still need:

1. `Authentication` -> enable `Email/Password`
2. `Realtime Database` -> create a database
3. Apply the rules from `FIREBASE_SETUP.md`

## 7. Get the Firebase Admin SDK credentials

This app now also uses the Firebase Admin SDK on the Node server.

In Firebase Console:

1. Open `Project settings`.
2. Open `Service accounts`.
3. Click `Generate new private key`.
4. Download the JSON file.

Open the downloaded JSON file and copy these values into `.env`:

```env
FIREBASE_PROJECT_ID=project_id
FIREBASE_CLIENT_EMAIL=client_email
FIREBASE_PRIVATE_KEY="private_key with \\n preserved"
```

If you paste the private key into `.env`, keep the newline escapes, for example:

```env
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nABC...\n-----END PRIVATE KEY-----\n"
```

You do **not** paste the whole JSON file into `.env`. Only copy the specific fields.

## 8. Final `.env` example

When you are done, your `.env` should look like this:

```env
FDC_API_KEY=DEMO_KEY
PORT=3000

FIREBASE_API_KEY=AIza...
FIREBASE_AUTH_DOMAIN=safebite-7ffff.firebaseapp.com
FIREBASE_PROJECT_ID=safebite-7ffff
FIREBASE_DATABASE_URL=https://safebite-7ffff-default-rtdb.firebaseio.com
FIREBASE_STORAGE_BUCKET=safebite-7ffff.firebasestorage.app
FIREBASE_MESSAGING_SENDER_ID=481709913437
FIREBASE_APP_ID=1:481709913437:web:a5f9d34ddcb0840f1fe4b4

FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@safebite-7ffff.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

## Notes

- The web snippet you pasted is only the browser config. It is not enough by itself for this app.
- The Node server also needs `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` from a service account key.
- If `FIREBASE_DATABASE_URL` is blank, create Realtime Database first and copy the URL from that page.
