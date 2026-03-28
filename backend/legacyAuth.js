const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const {
    ACCOUNTS_FILE,
    SESSIONS_FILE,
    SESSION_COOKIE_NAME,
    SESSION_TTL_MS
} = require("./config");
const {
    buildDefaultProfile,
    buildUniqueUsername,
    normalizeEmail,
    normalizeInlineText,
    sanitizeAccount,
    sanitizeProfile
} = require("./domain");
const { createHttpError } = require("./firebase");

ensureFile(ACCOUNTS_FILE, []);
ensureFile(SESSIONS_FILE, []);

function ensureFile(filePath, defaultValue) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
    }
}

function readJson(filePath, fallbackValue) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
        return fallbackValue;
    }
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function randomId(prefix) {
    return `${prefix}-${crypto.randomBytes(12).toString("hex")}`;
}

function createPasswordMethod(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");

    return {
        type: "password",
        algorithm: "scrypt",
        salt,
        hash,
        createdAt: new Date().toISOString()
    };
}

function verifyPasswordMethod(password, method) {
    if (!method || method.type !== "password" || method.algorithm !== "scrypt") {
        return false;
    }

    const expected = Buffer.from(method.hash, "hex");
    const actual = crypto.scryptSync(password, method.salt, 64);

    if (expected.length !== actual.length) {
        return false;
    }

    return crypto.timingSafeEqual(expected, actual);
}

function hashToken(token) {
    return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function cleanupExpiredSessions(sessions) {
    const now = Date.now();
    return sessions.filter((session) => new Date(session.expiresAt).getTime() > now);
}

function parseCookies(cookieHeader) {
    return String(cookieHeader || "")
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .reduce((cookies, chunk) => {
            const separatorIndex = chunk.indexOf("=");

            if (separatorIndex === -1) {
                return cookies;
            }

            const key = chunk.slice(0, separatorIndex).trim();
            const value = chunk.slice(separatorIndex + 1).trim();
            cookies[key] = decodeURIComponent(value);
            return cookies;
        }, {});
}

function setSessionCookie(response, token, expiresAt) {
    const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
    const parts = [
        `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${maxAge}`
    ];

    if (process.env.NODE_ENV === "production") {
        parts.push("Secure");
    }

    response.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(response) {
    const parts = [
        `${SESSION_COOKIE_NAME}=`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        "Max-Age=0",
        "Expires=Thu, 01 Jan 1970 00:00:00 GMT"
    ];

    if (process.env.NODE_ENV === "production") {
        parts.push("Secure");
    }

    response.setHeader("Set-Cookie", parts.join("; "));
}

function getAuthContext(request) {
    const cookies = parseCookies(request.headers.cookie || "");
    const token = cookies[SESSION_COOKIE_NAME];

    if (!token) {
        return null;
    }

    const tokenHash = hashToken(token);
    const rawSessions = readJson(SESSIONS_FILE, []);
    const activeSessions = cleanupExpiredSessions(rawSessions);

    if (activeSessions.length !== rawSessions.length) {
        writeJson(SESSIONS_FILE, activeSessions);
    }

    const session = activeSessions.find((entry) => entry.tokenHash === tokenHash);

    if (!session) {
        return null;
    }

    const accounts = readJson(ACCOUNTS_FILE, []);
    const account = accounts.find((entry) => entry.id === session.accountId);

    if (!account) {
        return null;
    }

    return {
        account,
        accounts,
        session,
        sessions: activeSessions,
        tokenHash
    };
}

function createSession(accountId, response) {
    const sessions = cleanupExpiredSessions(readJson(SESSIONS_FILE, []));
    const token = crypto.randomBytes(32).toString("hex");
    const now = Date.now();
    const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();
    const session = {
        id: randomId("session"),
        accountId,
        tokenHash: hashToken(token),
        createdAt: new Date(now).toISOString(),
        expiresAt
    };

    sessions.push(session);
    writeJson(SESSIONS_FILE, sessions);
    setSessionCookie(response, token, expiresAt);
}

function destroySession(request, response) {
    const auth = getAuthContext(request);

    if (auth) {
        const remaining = auth.sessions.filter((session) => session.tokenHash !== auth.tokenHash);
        writeJson(SESSIONS_FILE, remaining);
    }

    clearSessionCookie(response);
}

function registerLocalAccount(body) {
    const displayName = normalizeInlineText(body.displayName);
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");

    if (!displayName) {
        throw createHttpError(400, "Display name is required.");
    }

    if (!email || !email.includes("@")) {
        throw createHttpError(400, "A valid email is required.");
    }

    if (password.length < 8) {
        throw createHttpError(400, "Password must be at least 8 characters.");
    }

    const accounts = readJson(ACCOUNTS_FILE, []);

    if (accounts.some((account) => account.email === email)) {
        throw createHttpError(409, "An account with that email already exists.");
    }

    const now = new Date().toISOString();
    const account = {
        id: randomId("acct"),
        email,
        username: buildUniqueUsername(displayName, email, accounts),
        displayName,
        authProvider: "local",
        authMethods: [createPasswordMethod(password)],
        profile: sanitizeProfile(buildDefaultProfile(displayName), displayName),
        history: [],
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now
    };

    accounts.unshift(account);
    writeJson(ACCOUNTS_FILE, accounts);
    return sanitizeAccount(account);
}

function loginLocalAccount(body) {
    const identifier = normalizeEmail(body.identifier);
    const password = String(body.password || "");
    const accounts = readJson(ACCOUNTS_FILE, []);
    const account = accounts.find((entry) => entry.email === identifier || String(entry.username || "").toLowerCase() === identifier);

    if (!account) {
        throw createHttpError(401, "Invalid email/username or password.");
    }

    const passwordMethod = Array.isArray(account.authMethods)
        ? account.authMethods.find((method) => method.type === "password")
        : null;

    if (!verifyPasswordMethod(password, passwordMethod)) {
        throw createHttpError(401, "Invalid email/username or password.");
    }

    account.lastLoginAt = new Date().toISOString();
    account.updatedAt = account.lastLoginAt;
    writeJson(ACCOUNTS_FILE, accounts);
    return sanitizeAccount(account);
}

module.exports = {
    getAuthContext,
    createSession,
    destroySession,
    registerLocalAccount,
    loginLocalAccount
};
