const { cert, getApps: getAdminApps, initializeApp: initializeAdminApp } = require("firebase-admin/app");
const { getAuth: getFirebaseAdminAuth } = require("firebase-admin/auth");
const { getDatabase: getFirebaseAdminDatabase } = require("firebase-admin/database");
const {
    FIREBASE_PUBLIC_ENV_KEYS,
    FIREBASE_ADMIN_ENV_KEYS
} = require("./config");
const {
    normalizeEmail,
    normalizeInlineText,
    normalizeUsername,
    sanitizeProfile
} = require("./domain");

let firebaseAdminApp = null;
let firebaseAdminError = "";

function createHttpError(statusCode, message) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function getFirebasePublicConfig() {
    const config = {
        apiKey: process.env.FIREBASE_API_KEY || "",
        authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
        projectId: process.env.FIREBASE_PROJECT_ID || "",
        databaseURL: process.env.FIREBASE_DATABASE_URL || "",
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "",
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
        appId: process.env.FIREBASE_APP_ID || ""
    };

    const required = ["apiKey", "authDomain", "projectId", "appId"];
    const enabled = required.every((key) => Boolean(config[key]));

    return {
        ...config,
        enabled,
        missing: FIREBASE_PUBLIC_ENV_KEYS.filter((key) => !process.env[key])
    };
}

function getFirebaseAdminCredentialConfig() {
    return {
        projectId: process.env.FIREBASE_PROJECT_ID || "",
        databaseURL: process.env.FIREBASE_DATABASE_URL || "",
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL || "",
        privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n")
    };
}

function hasFirebaseAdminConfig() {
    const config = getFirebaseAdminCredentialConfig();
    return Boolean(config.projectId && config.databaseURL && config.clientEmail && config.privateKey);
}

function getFirebaseAdminApp() {
    if (firebaseAdminApp) {
        return firebaseAdminApp;
    }

    if (firebaseAdminError) {
        throw new Error(firebaseAdminError);
    }

    if (!hasFirebaseAdminConfig()) {
        throw new Error("Firebase Admin SDK is not configured.");
    }

    try {
        if (getAdminApps().length > 0) {
            firebaseAdminApp = getAdminApps()[0];
            return firebaseAdminApp;
        }

        const config = getFirebaseAdminCredentialConfig();
        firebaseAdminApp = initializeAdminApp({
            credential: cert({
                projectId: config.projectId,
                clientEmail: config.clientEmail,
                privateKey: config.privateKey
            }),
            databaseURL: config.databaseURL
        });
        return firebaseAdminApp;
    } catch (error) {
        firebaseAdminError = error.message || "Firebase Admin SDK initialization failed.";
        throw new Error(firebaseAdminError);
    }
}

function getFirebaseAdminTools() {
    const app = getFirebaseAdminApp();

    return {
        app,
        auth: getFirebaseAdminAuth(app),
        database: getFirebaseAdminDatabase(app)
    };
}

function getFirebaseConfig() {
    return {
        publicConfig: getFirebasePublicConfig(),
        admin: {
            enabled: hasFirebaseAdminConfig(),
            missing: FIREBASE_ADMIN_ENV_KEYS.filter((key) => !process.env[key]),
            error: firebaseAdminError || ""
        }
    };
}

function getBearerToken(request) {
    const authorization = String(request.headers.authorization || "");

    if (!authorization.startsWith("Bearer ")) {
        return "";
    }

    return authorization.slice("Bearer ".length).trim();
}

async function verifyFirebaseUser(request) {
    const token = getBearerToken(request);

    if (!token) {
        throw createHttpError(401, "Firebase sign-in required.");
    }

    let tools;

    try {
        tools = getFirebaseAdminTools();
    } catch (error) {
        throw createHttpError(500, error.message || "Firebase Admin SDK is not configured.");
    }

    try {
        return await tools.auth.verifyIdToken(token);
    } catch (error) {
        throw createHttpError(401, "Invalid Firebase ID token.");
    }
}

function buildFirebaseAccount(token, profileRecord = {}) {
    const displayName = normalizeInlineText(profileRecord.displayName || token.name || token.email?.split("@")[0] || "User");
    const email = normalizeEmail(profileRecord.email || token.email || "");
    const username = normalizeUsername(profileRecord.username || displayName || email || token.uid);

    return {
        id: token.uid,
        email,
        username,
        displayName
    };
}

function buildFirebaseProfileRecord(token, existingRecord = {}) {
    const account = buildFirebaseAccount(token, existingRecord);
    const profile = sanitizeProfile(existingRecord, account.displayName);

    return {
        ...profile,
        displayName: account.displayName,
        email: account.email,
        username: account.username,
        createdAt: existingRecord.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}

async function readFirebaseValue(reference) {
    const snapshot = await reference.once("value");
    return snapshot.val();
}

function sortFirebaseCollection(value, timestampKey) {
    return Object.entries(value || {})
        .map(([id, entry]) => ({
            id,
            ...entry
        }))
        .sort((left, right) => new Date(right[timestampKey] || 0).getTime() - new Date(left[timestampKey] || 0).getTime());
}

async function getOrCreateFirebaseProfile(token) {
    const { database } = getFirebaseAdminTools();
    const profileRef = database.ref(`profiles/${token.uid}`);
    const existing = await readFirebaseValue(profileRef) || {};
    const profileRecord = buildFirebaseProfileRecord(token, existing);

    if (!existing || Object.keys(existing).length === 0) {
        await profileRef.set(profileRecord);
    } else if (
        existing.displayName !== profileRecord.displayName
        || existing.email !== profileRecord.email
        || existing.username !== profileRecord.username
    ) {
        await profileRef.update({
            displayName: profileRecord.displayName,
            email: profileRecord.email,
            username: profileRecord.username,
            updatedAt: new Date().toISOString()
        });
    }

    return profileRecord;
}

async function updateFirebaseProfile(token, profile) {
    const existingProfile = await getOrCreateFirebaseProfile(token);
    const account = buildFirebaseAccount(token, existingProfile);
    const sanitizedProfile = sanitizeProfile(profile || {}, account.displayName);
    const { database } = getFirebaseAdminTools();

    await database.ref(`profiles/${token.uid}`).update({
        ...sanitizedProfile,
        displayName: account.displayName,
        email: account.email,
        username: account.username,
        updatedAt: new Date().toISOString()
    });

    return {
        account,
        profile: sanitizedProfile
    };
}

async function listFirebaseHistory(uid) {
    const { database } = getFirebaseAdminTools();
    return sortFirebaseCollection(await readFirebaseValue(database.ref(`history/${uid}`)), "checkedAt");
}

async function appendFirebaseHistoryEntry(uid, entry) {
    const { database } = getFirebaseAdminTools();
    const historyRef = database.ref(`history/${uid}`);
    const createdRef = historyRef.push();
    await createdRef.set(entry);

    const allHistory = await listFirebaseHistory(uid);
    const overflow = allHistory.slice(12);
    await Promise.all(overflow.map((item) => historyRef.child(item.id).remove()));

    return {
        entry,
        history: allHistory.slice(0, 12)
    };
}

async function listFirebaseWarnings() {
    const { database } = getFirebaseAdminTools();
    return sortFirebaseCollection(await readFirebaseValue(database.ref("warnings")), "createdAt");
}

async function createFirebaseWarning(token, payload) {
    const message = normalizeInlineText(payload.message);
    const productName = normalizeInlineText(payload.productName);
    const location = normalizeInlineText(payload.location);
    const severity = ["low", "medium", "high"].includes(payload.severity) ? payload.severity : "medium";

    if (!productName || !location || !message) {
        throw createHttpError(400, "Product, location, and warning message are required.");
    }

    const profileRecord = await getOrCreateFirebaseProfile(token);
    const account = buildFirebaseAccount(token, profileRecord);
    const { database } = getFirebaseAdminTools();
    const warningsRef = database.ref("warnings");
    const createdRef = warningsRef.push();
    const warning = {
        id: createdRef.key,
        productName,
        location,
        severity,
        message,
        author: account.displayName,
        authorAccountId: account.id,
        createdAt: new Date().toISOString()
    };

    await createdRef.set(warning);

    const allWarnings = await listFirebaseWarnings();
    const overflow = allWarnings.slice(50);
    await Promise.all(overflow.map((item) => warningsRef.child(item.id).remove()));

    return allWarnings.slice(0, 50);
}

module.exports = {
    getFirebaseConfig,
    verifyFirebaseUser,
    buildFirebaseAccount,
    getOrCreateFirebaseProfile,
    updateFirebaseProfile,
    listFirebaseHistory,
    appendFirebaseHistoryEntry,
    listFirebaseWarnings,
    createFirebaseWarning,
    createHttpError
};
