require("dotenv").config();

const http = require("http");
const fs = require("fs");
const https = require("https");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const { cert, getApps: getAdminApps, initializeApp: initializeAdminApp } = require("firebase-admin/app");
const { getAuth: getFirebaseAdminAuth } = require("firebase-admin/auth");
const { getDatabase: getFirebaseAdminDatabase } = require("firebase-admin/database");

const PORT = Number(process.env.PORT || 3000);
const FDC_API_KEY = process.env.FDC_API_KEY || "DEMO_KEY";
const ROOT_DIR = __dirname;
const STATIC_DIR = path.join(ROOT_DIR, "server");
const DATA_DIR = path.join(ROOT_DIR, "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const WARNINGS_FILE = path.join(DATA_DIR, "warnings.json");

const APP_AGENT = "SafeBite University Project";
const SESSION_COOKIE_NAME = "safebite_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SEARCH_CACHE_MS = 10 * 60 * 1000;
const ROUTES = new Set(["/", "/profile", "/search", "/product", "/substitutes", "/community"]);
const FIREBASE_PUBLIC_ENV_KEYS = [
    "FIREBASE_API_KEY",
    "FIREBASE_AUTH_DOMAIN",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_DATABASE_URL",
    "FIREBASE_STORAGE_BUCKET",
    "FIREBASE_MESSAGING_SENDER_ID",
    "FIREBASE_APP_ID"
];
const FIREBASE_ADMIN_ENV_KEYS = [
    "FIREBASE_PROJECT_ID",
    "FIREBASE_DATABASE_URL",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY"
];
const SEARCH_FIELDS = [
    "code",
    "product_name",
    "brands",
    "image_url",
    "ingredients_text",
    "ingredients_text_en",
    "allergens_tags",
    "traces_tags",
    "categories_tags",
    "labels_tags",
    "quantity",
    "nutriscore_grade"
].join(",");

const BLACKLIST_LIBRARY = [
    { id: "milk", label: "Milk", aliases: ["milk", "dairy", "butter", "cheese", "cream", "lactose", "whey", "casein"] },
    { id: "egg", label: "Egg", aliases: ["egg", "albumin", "ovalbumin"] },
    { id: "peanut", label: "Peanut", aliases: ["peanut", "groundnut", "arachis"] },
    { id: "tree nut", label: "Tree Nuts", aliases: ["tree nut", "almond", "cashew", "hazelnut", "walnut", "pecan", "pistachio", "macadamia", "brazil nut"] },
    { id: "soy", label: "Soy", aliases: ["soy", "soya", "soybean", "tofu", "edamame"] },
    { id: "sesame", label: "Sesame", aliases: ["sesame", "tahini"] },
    { id: "shellfish", label: "Shellfish", aliases: ["shellfish", "shrimp", "prawn", "crab", "lobster", "crustacean"] }
];

const DIET_RULES = {
    vegan: {
        label: "Vegan",
        aliases: ["milk", "dairy", "egg", "honey", "gelatin", "beef", "pork", "chicken", "fish", "shellfish", "whey", "casein", "butter", "cheese", "yogurt", "anchovy"]
    },
    "nut-free": {
        label: "Nut-free",
        aliases: ["peanut", "groundnut", "arachis", "tree nut", "almond", "cashew", "hazelnut", "walnut", "pecan", "pistachio", "macadamia", "brazil nut"]
    },
    "gluten-free": {
        label: "Gluten-free",
        aliases: ["gluten", "wheat", "barley", "rye", "malt", "semolina", "durum", "spelt", "triticale"]
    }
};

const searchCache = new Map();
const barcodeCache = new Map();

ensureFile(ACCOUNTS_FILE, []);
ensureFile(SESSIONS_FILE, []);
ensureFile(WARNINGS_FILE, [
    {
        id: "warning-1",
        productName: "Chocolate Spread",
        location: "Main Campus Store",
        message: "A student reported a new peanut trace warning on the latest imported batch.",
        author: "SafeBite Team",
        authorAccountId: null,
        createdAt: "2026-03-24T10:00:00.000Z"
    },
    {
        id: "warning-2",
        productName: "Instant Cup Noodles",
        location: "Engineering Hostel Shop",
        message: "An undeclared egg-based flavor sachet variant was spotted by the community.",
        author: "Food Safety Club",
        authorAccountId: null,
        createdAt: "2026-03-23T13:20:00.000Z"
    }
]);

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

function normalizeText(value) {
    return String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeInlineText(value) {
    return String(value || "")
        .trim()
        .replace(/\s+/g, " ");
}

function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
}

function unique(values) {
    return [...new Set(values.filter(Boolean))];
}

function parseTag(tag) {
    return normalizeText(String(tag || "").split(":").pop());
}

function buildDefaultProfile(displayName = "User") {
    return {
        name: normalizeInlineText(displayName) || "User",
        diets: [],
        blacklist: [],
        custom: []
    };
}

function sanitizeProfile(profile = {}, fallbackName = "User") {
    const diets = unique((Array.isArray(profile.diets) ? profile.diets : []).filter((diet) => DIET_RULES[diet]));
    const custom = unique(
        (Array.isArray(profile.custom) ? profile.custom : [])
            .map(normalizeInlineText)
            .filter(Boolean)
            .slice(0, 20)
    );
    const blacklist = unique(
        [...(Array.isArray(profile.blacklist) ? profile.blacklist : []), ...custom]
            .map(normalizeInlineText)
            .filter(Boolean)
            .slice(0, 30)
    );

    return {
        name: normalizeInlineText(profile.name) || normalizeInlineText(fallbackName) || "User",
        diets,
        blacklist,
        custom
    };
}

function buildProfileEntries(profile = {}) {
    const safeProfile = sanitizeProfile(profile, profile.name || "User");
    const blacklist = safeProfile.blacklist;
    const diets = safeProfile.diets;

    const dietEntries = diets
        .filter((diet) => DIET_RULES[diet])
        .map((diet) => ({
            id: diet,
            label: DIET_RULES[diet].label,
            aliases: unique(DIET_RULES[diet].aliases.map(normalizeText))
        }));

    const blacklistEntries = blacklist
        .map((item) => normalizeText(item))
        .filter(Boolean)
        .map((item) => {
            const known = BLACKLIST_LIBRARY.find((entry) => entry.id === item || normalizeText(entry.label) === item);

            if (known) {
                return {
                    id: known.id,
                    label: known.label,
                    aliases: unique([known.id, known.label, ...known.aliases].map(normalizeText))
                };
            }

            return {
                id: item,
                label: item.replace(/\b\w/g, (letter) => letter.toUpperCase()),
                aliases: [item]
            };
        });

    return [...dietEntries, ...blacklistEntries];
}

function collectProductText(product) {
    return normalizeText(
        [
            product.product_name,
            product.brands,
            product.ingredients_text,
            product.ingredients_text_en,
            Array.isArray(product.categories_tags) ? product.categories_tags.join(" ") : "",
            Array.isArray(product.labels_tags) ? product.labels_tags.join(" ") : ""
        ].join(" ")
    );
}

function containsToken(text, token) {
    if (!text || !token) {
        return false;
    }

    return ` ${text} `.includes(` ${token} `);
}

function splitIngredients(product) {
    return String(product.ingredients_text_en || product.ingredients_text || "")
        .split(/[,;]+/)
        .map((ingredient) => ingredient.trim())
        .filter(Boolean)
        .slice(0, 24);
}

function analyzeProduct(product, profile) {
    const haystack = collectProductText(product);
    const allergenTags = Array.isArray(product.allergens_tags) ? product.allergens_tags.map(parseTag) : [];
    const traceTags = Array.isArray(product.traces_tags) ? product.traces_tags.map(parseTag) : [];
    const profileEntries = buildProfileEntries(profile);

    const directMatches = [];
    const traceMatches = [];

    profileEntries.forEach((entry) => {
        const matchesDirect = entry.aliases.some((alias) => allergenTags.includes(alias) || containsToken(haystack, alias));
        const matchesTrace = entry.aliases.some((alias) => traceTags.includes(alias));

        if (matchesDirect) {
            directMatches.push(entry.label);
            return;
        }

        if (matchesTrace) {
            traceMatches.push(entry.label);
        }
    });

    const uniqueDirect = unique(directMatches);
    const uniqueTrace = unique(traceMatches.filter((item) => !uniqueDirect.includes(item)));
    const level = uniqueDirect.length > 0 ? "red" : uniqueTrace.length > 0 ? "yellow" : "green";

    return {
        level,
        lightLabel: level === "red" ? "Red light" : level === "yellow" ? "Yellow light" : "Green light",
        summary:
            level === "red"
                ? `Matched against ${uniqueDirect.join(", ")} in the product data.`
                : level === "yellow"
                    ? `Trace warnings found for ${uniqueTrace.join(", ")}.`
                    : "No selected diet conflict or blacklist trigger was detected in the available product fields.",
        directMatches: uniqueDirect,
        traceMatches: uniqueTrace,
        ingredientList: splitIngredients(product)
    };
}

function buildHistoryEntry(product, analysis) {
    return {
        id: `${product.code || "unknown"}-${Date.now()}`,
        code: product.code || "Unknown",
        name: product.product_name || "Unnamed product",
        brand: product.brands || "Brand not listed",
        level: analysis.level,
        summary: analysis.summary,
        checkedAt: new Date().toISOString()
    };
}

function normalizeUsername(value) {
    const base = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 24);

    return base || "user";
}

function buildUniqueUsername(displayName, email, accounts) {
    const seed = normalizeUsername(displayName || email.split("@")[0] || "user");
    const existing = new Set(accounts.map((account) => String(account.username || "").toLowerCase()));
    let candidate = seed;
    let suffix = 1;

    while (existing.has(candidate)) {
        suffix += 1;
        candidate = `${seed}-${suffix}`.slice(0, 28);
    }

    return candidate;
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

function sanitizeAccount(account) {
    return {
        id: account.id,
        email: account.email,
        username: account.username,
        displayName: account.displayName,
        authProvider: account.authProvider || "local",
        profile: sanitizeProfile(account.profile, account.displayName),
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
        lastLoginAt: account.lastLoginAt || null
    };
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

function requireAuth(request, response) {
    const auth = getAuthContext(request);

    if (!auth) {
        sendJson(request, response, 401, { error: "Sign in required." });
        return null;
    }

    return auth;
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

function getEffectiveProfile(request, body) {
    if (body && body.profile) {
        return body.profile;
    }

    const auth = getAuthContext(request);
    return auth ? auth.account.profile : {};
}

function requestJson(url, options = {}) {
    return new Promise((resolve, reject) => {
        const request = https.request(url, options, (response) => {
            let body = "";

            response.on("data", (chunk) => {
                body += chunk.toString();
            });

            response.on("end", () => {
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(new Error(`Request failed with status ${response.statusCode}.`));
                    return;
                }

                try {
                    resolve(JSON.parse(body));
                } catch (error) {
                    reject(new Error("Invalid JSON response."));
                }
            });
        });

        request.on("error", reject);

        if (options.body) {
            request.write(options.body);
        }

        request.end();
    });
}

async function fetchJson(url, options = {}) {
    if (url.startsWith("https://")) {
        return requestJson(url, options);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}.`);
    }

    return response.json();
}

async function fetchOffJson(url) {
    return requestJson(url, {
        method: "GET",
        headers: {
            Accept: "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent": `${APP_AGENT} (student project demo)`
        }
    });
}

async function searchOffProducts(query, pageSize = 8) {
    const normalizedQuery = String(query || "").trim().toLowerCase();

    if (!normalizedQuery) {
        return [];
    }

    const cacheKey = `${normalizedQuery}:${pageSize}`;
    const cached = searchCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < SEARCH_CACHE_MS) {
        return cached.products;
    }

    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=${pageSize}&fields=${SEARCH_FIELDS}`;
    const data = await fetchOffJson(url);
    const products = Array.isArray(data.products) ? data.products.filter((product) => product.product_name || product.code) : [];
    searchCache.set(cacheKey, {
        timestamp: Date.now(),
        products
    });
    return products;
}

function mapUsdaFoodToProduct(food) {
    return {
        code: food.gtinUpc || String(food.fdcId || ""),
        product_name: food.description || food.brandName || "USDA product",
        brands: [food.brandOwner, food.brandName].filter(Boolean).join(" / ") || "USDA FoodData Central",
        image_url: "",
        ingredients_text: food.ingredients || "",
        ingredients_text_en: food.ingredients || "",
        allergens_tags: [],
        traces_tags: [],
        categories_tags: [food.foodCategory].filter(Boolean),
        labels_tags: [],
        quantity: food.packageWeight || food.householdServingFullText || "",
        nutriscore_grade: "",
        source_api: "USDA FoodData Central"
    };
}

async function searchUsdaProducts(query, pageSize = 8) {
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(FDC_API_KEY)}`;
    const payload = {
        query,
        pageSize,
        dataType: ["Branded"]
    };
    const data = await fetchJson(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });
    const foods = Array.isArray(data.foods) ? data.foods : [];
    return foods.map(mapUsdaFoodToProduct).filter((product) => product.product_name || product.code);
}

async function lookupBarcode(barcode) {
    const cleaned = String(barcode || "").replace(/[^\d]/g, "");
    const cached = barcodeCache.get(cleaned);

    if (cached && Date.now() - cached.timestamp < SEARCH_CACHE_MS) {
        return cached.product;
    }

    const url = `https://world.openfoodfacts.org/api/v2/product/${cleaned}.json?fields=${SEARCH_FIELDS}`;
    try {
        const data = await fetchOffJson(url);

        if (!data.product) {
            throw new Error("No product was found for that barcode.");
        }

        barcodeCache.set(cleaned, {
            timestamp: Date.now(),
            product: data.product
        });
        return data.product;
    } catch (error) {
        const fallbackMatches = await searchUsdaProducts(cleaned, 8);
        const exactMatch = fallbackMatches.find((product) => String(product.code) === cleaned);

        if (!exactMatch) {
            throw error;
        }

        barcodeCache.set(cleaned, {
            timestamp: Date.now(),
            product: exactMatch
        });
        return exactMatch;
    }
}

function buildSubstituteQueries(product, profile) {
    const diets = Array.isArray(profile.diets) ? profile.diets : [];
    const descriptor = diets.length > 0 ? diets.join(" ") : "safe";
    const nameSeed = String(product.product_name || "").split("-")[0].trim();
    const categorySeed = Array.isArray(product.categories_tags) && product.categories_tags[0]
        ? parseTag(product.categories_tags[0])
        : "";

    return unique([
        `${descriptor} ${nameSeed}`.trim(),
        `${descriptor} ${categorySeed}`.trim(),
        nameSeed,
        categorySeed
    ].filter(Boolean));
}

async function fetchUsdaCandidates(query) {
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(FDC_API_KEY)}`;
    const payload = {
        query,
        pageSize: 6,
        dataType: ["Branded", "Foundation", "Survey (FNDDS)"]
    };

    const data = await fetchJson(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });

    const foods = Array.isArray(data.foods) ? data.foods : [];
    return foods.map((food) => food.description).filter(Boolean);
}

async function searchProductsWithFallback(query, pageSize = 8) {
    try {
        const products = await searchOffProducts(query, pageSize);
        return {
            products,
            source: "Open Food Facts"
        };
    } catch (error) {
        const products = await searchUsdaProducts(query, pageSize);
        return {
            products,
            source: "USDA FoodData Central fallback"
        };
    }
}

async function buildSubstitutes(product, profile) {
    const substituteQueries = buildSubstituteQueries(product, profile);
    let usdaSeedNames = [];
    const directUsdaItems = [];

    for (const query of substituteQueries.slice(0, 3)) {
        try {
            const names = await fetchUsdaCandidates(query);
            usdaSeedNames = usdaSeedNames.concat(names);

            const usdaProducts = await searchUsdaProducts(query, 6);
            usdaProducts.forEach((candidate) => {
                const candidateAnalysis = analyzeProduct(candidate, profile);

                if (candidateAnalysis.level === "green") {
                    directUsdaItems.push({
                        code: candidate.code || query,
                        name: candidate.product_name || query,
                        brand: candidate.brands || "USDA FoodData Central",
                        image: "",
                        summary: candidateAnalysis.summary
                    });
                }
            });
        } catch (error) {
            continue;
        }
    }

    const offQueries = unique([...usdaSeedNames, ...substituteQueries]).slice(0, 8);
    const items = [...directUsdaItems];

    for (const query of offQueries) {
        try {
            const matches = await searchOffProducts(query, 4);
            const safeMatch = matches.find((candidate) => analyzeProduct(candidate, profile).level === "green");

            if (safeMatch) {
                items.push({
                    code: safeMatch.code || query,
                    name: safeMatch.product_name || query,
                    brand: safeMatch.brands || "Brand not listed",
                    image: safeMatch.image_url || "",
                    summary: analyzeProduct(safeMatch, profile).summary
                });
            }
        } catch (error) {
            continue;
        }
    }

    return unique(items.map((item) => JSON.stringify(item))).map((item) => JSON.parse(item)).slice(0, 6);
}

function buildCorsHeaders(request) {
    const origin = request.headers.origin;
    return {
        "Access-Control-Allow-Origin": origin || "*",
        "Access-Control-Allow-Credentials": "true",
        "Vary": "Origin"
    };
}

let firebaseAdminApp = null;
let firebaseAdminError = "";

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

async function requireFirebaseUser(request, response) {
    const token = getBearerToken(request);

    if (!token) {
        sendJson(request, response, 401, { error: "Firebase sign-in required." });
        return null;
    }

    let tools;

    try {
        tools = getFirebaseAdminTools();
    } catch (error) {
        sendJson(request, response, 500, { error: error.message || "Firebase Admin SDK is not configured." });
        return null;
    }

    try {
        return await tools.auth.verifyIdToken(token);
    } catch (error) {
        sendJson(request, response, 401, { error: "Invalid Firebase ID token." });
        return null;
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

async function listFirebaseHistory(uid) {
    const { database } = getFirebaseAdminTools();
    return sortFirebaseCollection(await readFirebaseValue(database.ref(`history/${uid}`)), "checkedAt");
}

async function listFirebaseWarnings() {
    const { database } = getFirebaseAdminTools();
    return sortFirebaseCollection(await readFirebaseValue(database.ref("warnings")), "createdAt");
}

function sendJson(request, response, statusCode, payload) {
    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        ...buildCorsHeaders(request)
    });
    response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, payload, contentType) {
    response.writeHead(statusCode, {
        "Content-Type": contentType
    });
    response.end(payload);
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        let body = "";

        request.on("data", (chunk) => {
            body += chunk.toString();
        });

        request.on("end", () => {
            if (!body) {
                resolve({});
                return;
            }

            try {
                resolve(JSON.parse(body));
            } catch (error) {
                reject(new Error("Invalid JSON body."));
            }
        });

        request.on("error", reject);
    });
}

function getContentType(filePath) {
    const extension = path.extname(filePath);

    if (extension === ".html") {
        return "text/html; charset=utf-8";
    }
    if (extension === ".css") {
        return "text/css; charset=utf-8";
    }
    if (extension === ".js") {
        return "application/javascript; charset=utf-8";
    }

    return "text/plain; charset=utf-8";
}

function serveStaticFile(response, filePath) {
    try {
        const file = fs.readFileSync(filePath);
        sendText(response, 200, file, getContentType(filePath));
    } catch (error) {
        sendText(response, 404, JSON.stringify({ error: "File not found." }), "application/json; charset=utf-8");
    }
}

const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "OPTIONS") {
        response.writeHead(204, {
            ...buildCorsHeaders(request),
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS"
        });
        response.end();
        return;
    }

    try {
        if (requestUrl.pathname === "/api/config" && request.method === "GET") {
            sendJson(request, response, 200, {
                firebase: getFirebaseConfig()
            });
            return;
        }

        if (requestUrl.pathname === "/api/auth/session" && request.method === "GET") {
            const auth = getAuthContext(request);
            sendJson(request, response, 200, { account: auth ? sanitizeAccount(auth.account) : null });
            return;
        }

        if (requestUrl.pathname === "/api/auth/register" && request.method === "POST") {
            const body = await readBody(request);
            const displayName = normalizeInlineText(body.displayName);
            const email = normalizeEmail(body.email);
            const password = String(body.password || "");

            if (!displayName) {
                sendJson(request, response, 400, { error: "Display name is required." });
                return;
            }

            if (!email || !email.includes("@")) {
                sendJson(request, response, 400, { error: "A valid email is required." });
                return;
            }

            if (password.length < 8) {
                sendJson(request, response, 400, { error: "Password must be at least 8 characters." });
                return;
            }

            const accounts = readJson(ACCOUNTS_FILE, []);

            if (accounts.some((account) => account.email === email)) {
                sendJson(request, response, 409, { error: "An account with that email already exists." });
                return;
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
            createSession(account.id, response);
            sendJson(request, response, 201, { account: sanitizeAccount(account) });
            return;
        }

        if (requestUrl.pathname === "/api/auth/login" && request.method === "POST") {
            const body = await readBody(request);
            const identifier = normalizeEmail(body.identifier);
            const password = String(body.password || "");
            const accounts = readJson(ACCOUNTS_FILE, []);
            const account = accounts.find((entry) => entry.email === identifier || String(entry.username || "").toLowerCase() === identifier);

            if (!account) {
                sendJson(request, response, 401, { error: "Invalid email/username or password." });
                return;
            }

            const passwordMethod = Array.isArray(account.authMethods)
                ? account.authMethods.find((method) => method.type === "password")
                : null;

            if (!verifyPasswordMethod(password, passwordMethod)) {
                sendJson(request, response, 401, { error: "Invalid email/username or password." });
                return;
            }

            account.lastLoginAt = new Date().toISOString();
            account.updatedAt = account.lastLoginAt;
            writeJson(ACCOUNTS_FILE, accounts);
            createSession(account.id, response);
            sendJson(request, response, 200, { account: sanitizeAccount(account) });
            return;
        }

        if (requestUrl.pathname === "/api/auth/logout" && request.method === "POST") {
            destroySession(request, response);
            sendJson(request, response, 200, { ok: true });
            return;
        }

        if (requestUrl.pathname === "/api/profile" && request.method === "GET") {
            const firebaseUser = await requireFirebaseUser(request, response);

            if (!firebaseUser) {
                return;
            }

            const profileRecord = await getOrCreateFirebaseProfile(firebaseUser);
            const account = buildFirebaseAccount(firebaseUser, profileRecord);
            sendJson(request, response, 200, {
                account,
                profile: sanitizeProfile(profileRecord, account.displayName)
            });
            return;
        }

        if (requestUrl.pathname === "/api/profile" && request.method === "PUT") {
            const firebaseUser = await requireFirebaseUser(request, response);

            if (!firebaseUser) {
                return;
            }

            const body = await readBody(request);
            const existingProfile = await getOrCreateFirebaseProfile(firebaseUser);
            const account = buildFirebaseAccount(firebaseUser, existingProfile);
            const profile = sanitizeProfile(body.profile || {}, account.displayName);
            const { database } = getFirebaseAdminTools();

            await database.ref(`profiles/${firebaseUser.uid}`).update({
                ...profile,
                displayName: account.displayName,
                email: account.email,
                username: account.username,
                updatedAt: new Date().toISOString()
            });

            sendJson(request, response, 200, { profile, account });
            return;
        }

        if (requestUrl.pathname === "/api/search" && request.method === "GET") {
            const query = requestUrl.searchParams.get("q") || "";
            const result = await searchProductsWithFallback(query);
            sendJson(request, response, 200, result);
            return;
        }

        if (requestUrl.pathname.startsWith("/api/product/") && request.method === "GET") {
            const barcode = requestUrl.pathname.split("/").pop();
            const product = await lookupBarcode(barcode);
            sendJson(request, response, 200, { product });
            return;
        }

        if (requestUrl.pathname === "/api/analyze" && request.method === "POST") {
            const body = await readBody(request);
            const analysis = analyzeProduct(body.product || {}, getEffectiveProfile(request, body));
            sendJson(request, response, 200, { analysis });
            return;
        }

        if (requestUrl.pathname === "/api/history" && request.method === "GET") {
            const firebaseUser = await requireFirebaseUser(request, response);

            if (!firebaseUser) {
                return;
            }

            sendJson(request, response, 200, { history: await listFirebaseHistory(firebaseUser.uid) });
            return;
        }

        if (requestUrl.pathname === "/api/history-entry" && request.method === "POST") {
            const firebaseUser = await requireFirebaseUser(request, response);

            if (!firebaseUser) {
                return;
            }

            const body = await readBody(request);
            const entry = buildHistoryEntry(body.product || {}, body.analysis || {});
            const { database } = getFirebaseAdminTools();
            const historyRef = database.ref(`history/${firebaseUser.uid}`);
            const createdRef = historyRef.push();
            await createdRef.set(entry);

            const allHistory = await listFirebaseHistory(firebaseUser.uid);
            const overflow = allHistory.slice(12);
            await Promise.all(overflow.map((item) => historyRef.child(item.id).remove()));
            const updated = allHistory.slice(0, 12);
            sendJson(request, response, 201, { entry, history: updated });
            return;
        }

        if (requestUrl.pathname === "/api/substitutes" && request.method === "POST") {
            const body = await readBody(request);
            const items = await buildSubstitutes(body.product || {}, getEffectiveProfile(request, body));
            sendJson(request, response, 200, { items, apiLabel: "USDA + Open Food Facts" });
            return;
        }

        if (requestUrl.pathname === "/api/warnings" && request.method === "GET") {
            const firebaseUser = await requireFirebaseUser(request, response);

            if (!firebaseUser) {
                return;
            }

            sendJson(request, response, 200, { warnings: await listFirebaseWarnings() });
            return;
        }

        if (requestUrl.pathname === "/api/warnings" && request.method === "POST") {
            const firebaseUser = await requireFirebaseUser(request, response);

            if (!firebaseUser) {
                return;
            }

            const body = await readBody(request);
            const message = normalizeInlineText(body.message);
            const productName = normalizeInlineText(body.productName);
            const location = normalizeInlineText(body.location);
            const severity = ["low", "medium", "high"].includes(body.severity) ? body.severity : "medium";

            if (!productName || !location || !message) {
                sendJson(request, response, 400, { error: "Product, location, and warning message are required." });
                return;
            }

            const profileRecord = await getOrCreateFirebaseProfile(firebaseUser);
            const account = buildFirebaseAccount(firebaseUser, profileRecord);
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
            const updated = allWarnings.slice(0, 50);
            sendJson(request, response, 201, { warnings: updated });
            return;
        }

        if (requestUrl.pathname === "/style.css" || requestUrl.pathname === "/script.js") {
            serveStaticFile(response, path.join(STATIC_DIR, requestUrl.pathname.slice(1)));
            return;
        }

        if (requestUrl.pathname === "/" || ROUTES.has(requestUrl.pathname)) {
            serveStaticFile(response, path.join(STATIC_DIR, "index.html"));
            return;
        }

        sendJson(request, response, 404, { error: "Route not found." });
    } catch (error) {
        sendJson(request, response, 500, { error: error.message || "Server error." });
    }
});

server.listen(PORT, () => {
    console.log(`SafeBite running on http://localhost:${PORT}`);
});
