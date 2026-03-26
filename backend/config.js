require("dotenv").config();

const path = require("path");

const ROOT_DIR = path.join(__dirname, "..");
const STATIC_DIR = path.join(ROOT_DIR, "server");
const DATA_DIR = path.join(ROOT_DIR, "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

const PORT = Number(process.env.PORT || 3000);
const FDC_API_KEY = process.env.FDC_API_KEY || "DEMO_KEY";

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

module.exports = {
    ROOT_DIR,
    STATIC_DIR,
    DATA_DIR,
    ACCOUNTS_FILE,
    SESSIONS_FILE,
    PORT,
    FDC_API_KEY,
    APP_AGENT,
    SESSION_COOKIE_NAME,
    SESSION_TTL_MS,
    SEARCH_CACHE_MS,
    ROUTES,
    FIREBASE_PUBLIC_ENV_KEYS,
    FIREBASE_ADMIN_ENV_KEYS,
    SEARCH_FIELDS
};
