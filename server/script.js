const { useEffect, useRef, useState } = React;

const PRODUCT_KEY = "safebite-active-product";
const ANALYSIS_KEY = "safebite-active-analysis";
const SUBSTITUTES_KEY = "safebite-substitutes";
const ROUTES = ["/profile", "/search", "/product", "/substitutes", "/community"];

const BLACKLIST_OPTIONS = [
    "Milk",
    "Egg",
    "Peanut",
    "Tree Nuts",
    "Soy",
    "Sesame",
    "Shellfish"
];

const DIET_OPTIONS = [
    { id: "vegan", label: "Vegan" },
    { id: "nut-free", label: "Nut-free" },
    { id: "gluten-free", label: "Gluten-free" }
];

const DEFAULT_PROFILE = {
    name: "Asha",
    diets: [],
    blacklist: [],
    custom: []
};

const EMPTY_AUTH_FORM = {
    displayName: "",
    email: "",
    password: "",
    confirmPassword: ""
};

const EMPTY_WARNING_FORM = {
    productName: "",
    location: "",
    severity: "medium",
    message: ""
};

const ROUTE_META = {
    "/profile": {
        title: "Dietary Profile Setup",
        subtitle: "Personal preferences and restrictions"
    },
    "/search": {
        title: "Search / Scanner Home",
        subtitle: "Barcode lookup and product search"
    },
    "/product": {
        title: "Product Safety Detail",
        subtitle: "Live verdict workspace"
    },
    "/substitutes": {
        title: "Safe Substitutes",
        subtitle: "Safer alternatives for similar products"
    },
    "/community": {
        title: "Community Warnings",
        subtitle: "Latest alerts from the community"
    }
};

function readStorage(key, fallbackValue) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallbackValue;
    } catch (error) {
        return fallbackValue;
    }
}

function writeStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function scopedStorageKey(accountId, key) {
    return `${key}:${accountId}`;
}

function normalizeText(value) {
    return String(value || "")
        .trim()
        .replace(/\s+/g, " ");
}

function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
}

function unique(values) {
    return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

function slugifyUsername(value) {
    const base = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 24);

    return base || "user";
}

function buildDefaultProfile(displayName = "Asha") {
    return {
        name: normalizeText(displayName) || "Asha",
        diets: [],
        blacklist: [],
        custom: []
    };
}

function sanitizeProfile(profile = {}, fallbackName = "Asha") {
    const diets = unique((Array.isArray(profile.diets) ? profile.diets : []).filter((diet) => DIET_OPTIONS.some((option) => option.id === diet)));
    const custom = unique(
        (Array.isArray(profile.custom) ? profile.custom : [])
            .map(normalizeText)
            .filter(Boolean)
            .slice(0, 20)
    );
    const blacklist = unique(
        [...(Array.isArray(profile.blacklist) ? profile.blacklist : []), ...custom]
            .map(normalizeText)
            .filter(Boolean)
            .slice(0, 30)
    );

    return {
        name: normalizeText(profile.name) || normalizeText(fallbackName) || "Asha",
        diets,
        blacklist,
        custom
    };
}

function summarizeProduct(product) {
    return {
        code: product.code || "Unknown",
        name: product.product_name || product.name || "Unnamed product",
        brand: product.brands || product.brand || "Brand not listed",
        image: product.image_url || product.image || "",
        ingredients: product.ingredients_text_en || product.ingredients_text || "Ingredients not provided by the API.",
        quantity: product.quantity || "Quantity not listed",
        nutriscore: product.nutriscore_grade ? product.nutriscore_grade.toUpperCase() : product.nutriscore || "N/A"
    };
}

async function apiRequest(path, options = {}) {
    const auth = window.SafeBiteAuth;
    const currentUser = window.SafeBiteCurrentUser || auth?.currentUser || null;
    const token = window.SafeBiteIdToken || (currentUser ? await currentUser.getIdToken() : "");
    const optionHeaders = options.headers || {};
    const response = await fetch(path, {
        credentials: "same-origin",
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...optionHeaders
        },
    });

    const payload = await response.json();

    if (!response.ok) {
        const error = new Error(payload.error || "Request failed.");
        error.status = response.status;
        throw error;
    }

    return payload;
}

function apiGet(path) {
    return apiRequest(path, { method: "GET" });
}

function apiPost(path, body) {
    return apiRequest(path, {
        method: "POST",
        body: JSON.stringify(body || {})
    });
}

function apiPut(path, body) {
    return apiRequest(path, {
        method: "PUT",
        body: JSON.stringify(body || {})
    });
}

function buildAccountFromFirebase(user, profileRecord = {}) {
    return {
        id: user.uid,
        email: profileRecord.email || user.email || "",
        username: profileRecord.username || slugifyUsername(profileRecord.displayName || user.displayName || user.email),
        displayName: profileRecord.displayName || user.displayName || "SafeBite User"
    };
}

function formatFirebaseError(error) {
    const code = String(error?.code || "");

    if (code === "auth/email-already-in-use") {
        return "That email already has an account.";
    }
    if (code === "auth/invalid-email") {
        return "Enter a valid email address.";
    }
    if (code === "auth/weak-password") {
        return "Password is too weak for Firebase. Use at least 6 characters.";
    }
    if (code === "auth/invalid-credential" || code === "auth/invalid-login-credentials") {
        return "Invalid email or password.";
    }
    if (code === "auth/network-request-failed") {
        return "Firebase could not be reached. Check your connection and project config.";
    }
    if (code === "auth/too-many-requests") {
        return "Too many attempts. Wait a moment and try again.";
    }

    return error?.message || "Request failed.";
}

function buildWarningInsights(warnings) {
    const now = Date.now();
    const lastDay = warnings.filter((warning) => now - new Date(warning.createdAt || 0).getTime() < 24 * 60 * 60 * 1000).length;
    const high = warnings.filter((warning) => warning.severity === "high").length;
    const locations = unique(warnings.map((warning) => warning.location));

    return {
        total: warnings.length,
        high,
        lastDay,
        locations
    };
}

function matchesWarningFilter(warning, query, severity) {
    const haystack = [
        warning.productName,
        warning.location,
        warning.message,
        warning.author
    ].join(" ").toLowerCase();

    const queryPasses = !query || haystack.includes(query.toLowerCase());
    const severityPasses = severity === "all" || warning.severity === severity;

    return queryPasses && severityPasses;
}

function SafetyLightIndicator({ analysis }) {
    const tone = analysis?.level || "neutral";
    const label = analysis?.lightLabel || "Waiting";
    const summary = analysis?.summary || "Run a product check to see the final verdict.";

    return (
        <div className={`safety-indicator ${tone}`}>
            <div className="signal-stack">
                <span className={`signal-dot red ${tone === "red" ? "on" : ""}`}></span>
                <span className={`signal-dot yellow ${tone === "yellow" ? "on" : ""}`}></span>
                <span className={`signal-dot green ${tone === "green" ? "on" : ""}`}></span>
            </div>
            <div>
                <p className="section-label">Safety Light Indicator</p>
                <h3>{label}</h3>
                <p>{summary}</p>
            </div>
        </div>
    );
}

function IngredientChecklist({ analysis }) {
    const items = analysis?.ingredientList || [];
    const direct = new Set(analysis?.directMatches || []);
    const trace = new Set(analysis?.traceMatches || []);

    return (
        <div className="ingredient-checklist">
            <div className="section-mini-header">
                <p className="section-label">Ingredient Checklist</p>
                <h3>Ingredient breakdown</h3>
            </div>
            {items.length > 0 ? (
                <div className="checklist-grid">
                    {items.map((item, index) => {
                        const lowered = item.toLowerCase();
                        const isDirect = Array.from(direct).some((token) => lowered.includes(token.toLowerCase()));
                        const isTrace = !isDirect && Array.from(trace).some((token) => lowered.includes(token.toLowerCase()));
                        const state = isDirect ? "unsafe" : isTrace ? "warn" : "ok";

                        return (
                            <article key={`${item}-${index}`} className={`ingredient-item ${state}`}>
                                <span>{isDirect ? "Blocked" : isTrace ? "Watch" : "Clear"}</span>
                                <strong>{item}</strong>
                            </article>
                        );
                    })}
                </div>
            ) : (
                <div className="empty-card">No ingredient list was returned for this product.</div>
            )}
        </div>
    );
}

function SubstituteCarousel({ items, loading, apiLabel }) {
    return (
        <div className="substitute-carousel">
            <div className="section-mini-header">
                <p className="section-label">Substitute Carousel</p>
                <h3>Safe substitutes</h3>
            </div>
            {loading ? (
                <div className="empty-card">Looking for safer alternatives...</div>
            ) : items.length > 0 ? (
                <div className="carousel-grid">
                    {items.map((item) => (
                        <article key={`${item.code}-${item.name}`} className="sub-card">
                            <div className="sub-thumb">
                                {item.image ? <img src={item.image} alt={item.name} /> : <span>No image</span>}
                            </div>
                            <strong>{item.name}</strong>
                            <p>{item.brand}</p>
                            <small>{item.summary}</small>
                        </article>
                    ))}
                </div>
            ) : (
                <div className="empty-card">No substitute has been generated yet.</div>
            )}
            {apiLabel && <p className="api-note">Suggestion source: {apiLabel}</p>}
        </div>
    );
}

function App() {
    const [route, setRoute] = useState(() => (ROUTES.includes(window.location.pathname) ? window.location.pathname : "/search"));
    const [account, setAccount] = useState(null);
    const [authResolved, setAuthResolved] = useState(false);
    const [sessionReady, setSessionReady] = useState(false);
    const [authMode, setAuthMode] = useState("login");
    const [authForm, setAuthForm] = useState(EMPTY_AUTH_FORM);
    const [profile, setProfile] = useState(DEFAULT_PROFILE);
    const [profileStatus, setProfileStatus] = useState("idle");
    const [activeProduct, setActiveProduct] = useState(null);
    const [analysis, setAnalysis] = useState(null);
    const [substitutes, setSubstitutes] = useState([]);
    const [history, setHistory] = useState([]);
    const [warnings, setWarnings] = useState([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [barcodeQuery, setBarcodeQuery] = useState("");
    const [customTriggerInput, setCustomTriggerInput] = useState("");
    const [warningForm, setWarningForm] = useState(EMPTY_WARNING_FORM);
    const [warningSearch, setWarningSearch] = useState("");
    const [warningSeverityFilter, setWarningSeverityFilter] = useState("all");
    const [results, setResults] = useState([]);
    const [resultsSource, setResultsSource] = useState("");
    const [scannerActive, setScannerActive] = useState(false);
    const [scannerMessage, setScannerMessage] = useState("Camera scanning is optional. Search and barcode lookup always work.");
    const [loading, setLoading] = useState("");
    const [authLoading, setAuthLoading] = useState("");
    const [error, setError] = useState("");
    const [configError, setConfigError] = useState("");
    const [substituteLoading, setSubstituteLoading] = useState(false);
    const [substituteApiLabel, setSubstituteApiLabel] = useState("USDA + Open Food Facts");

    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const detectorRef = useRef(null);
    const frameRef = useRef(null);
    const firebaseRef = useRef(null);
    const firebaseAuthUnsubscribeRef = useRef(null);
    const profileSyncReadyRef = useRef(false);
    const profileSnapshotRef = useRef("");

    useEffect(() => {
        window.history.replaceState({}, "", route);
    }, []);

    useEffect(() => {
        const onPopState = () => {
            setRoute(ROUTES.includes(window.location.pathname) ? window.location.pathname : "/search");
        };

        window.addEventListener("popstate", onPopState);
        return () => window.removeEventListener("popstate", onPopState);
    }, []);

    useEffect(() => {
        let active = true;

        async function bootFirebase() {
            try {
                const payload = await apiGet("/api/config");
                const publicConfig = payload.firebase?.publicConfig || {};
                const adminConfig = payload.firebase?.admin || {};

                if (!publicConfig.enabled) {
                    setConfigError("Firebase public config is missing. Add the FIREBASE_* web app values to .env.");
                    setAuthResolved(true);
                    return;
                }

                if (!adminConfig.enabled) {
                    setConfigError("Firebase Admin SDK is not configured. Add the service account env values before using the app.");
                    setAuthResolved(true);
                    return;
                }

                if (!window.SafeBiteFirebase) {
                    throw new Error("Firebase SDK failed to load in the browser.");
                }

                const sdk = window.SafeBiteFirebase;
                const app = sdk.getApps().length > 0 ? sdk.getApp() : sdk.initializeApp(publicConfig);
                const auth = sdk.getAuth(app);
                window.SafeBiteAuth = auth;
                window.SafeBiteCurrentUser = null;
                window.SafeBiteIdToken = "";
                firebaseRef.current = { sdk, auth };
                firebaseAuthUnsubscribeRef.current = sdk.onAuthStateChanged(auth, async (user) => {
                    try {
                        if (!active) {
                            return;
                        }

                        if (!user) {
                            window.SafeBiteCurrentUser = null;
                            window.SafeBiteIdToken = "";
                            profileSyncReadyRef.current = false;
                            profileSnapshotRef.current = "";
                            setAccount(null);
                            setSessionReady(false);
                            setProfile(DEFAULT_PROFILE);
                            setHistory([]);
                            setWarnings([]);
                            setActiveProduct(null);
                            setAnalysis(null);
                            setSubstitutes([]);
                            setAuthResolved(true);
                            setAuthLoading("");
                            stopScanner();
                            setError("");
                            return;
                        }

                        window.SafeBiteCurrentUser = user;
                        window.SafeBiteIdToken = await user.getIdToken();

                        if (!active) {
                            return;
                        }

                        setAccount(buildAccountFromFirebase(user));
                        setSessionReady(true);
                        setAuthResolved(true);
                        setAuthLoading("");
                        setError("");
                    } catch (requestError) {
                        console.error("Firebase auth bootstrap failed", requestError);
                        setError(requestError.message || "Firebase profile bootstrap failed.");
                        setAuthResolved(true);
                        setAuthLoading("");
                    }
                });
            } catch (requestError) {
                setConfigError(requestError.message || "Firebase setup failed.");
                setAuthResolved(true);
            }
        }

        bootFirebase();

        return () => {
            active = false;
            stopScanner();
            window.SafeBiteAuth = null;
            window.SafeBiteCurrentUser = null;
            window.SafeBiteIdToken = "";

            if (firebaseAuthUnsubscribeRef.current) {
                firebaseAuthUnsubscribeRef.current();
                firebaseAuthUnsubscribeRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (!account) {
            profileSyncReadyRef.current = false;
            profileSnapshotRef.current = "";
            setProfile(DEFAULT_PROFILE);
            setProfileStatus("idle");
            setHistory([]);
            setWarnings([]);
            return;
        }

        if (!sessionReady) {
            return;
        }

        setActiveProduct(readStorage(scopedStorageKey(account.id, PRODUCT_KEY), null));
        setAnalysis(readStorage(scopedStorageKey(account.id, ANALYSIS_KEY), null));
        setSubstitutes(readStorage(scopedStorageKey(account.id, SUBSTITUTES_KEY), []));
        loadInitialData();
    }, [account?.id, sessionReady]);

    useEffect(() => {
        if (account) {
            writeStorage(scopedStorageKey(account.id, PRODUCT_KEY), activeProduct);
        }
    }, [account?.id, activeProduct]);

    useEffect(() => {
        if (account) {
            writeStorage(scopedStorageKey(account.id, ANALYSIS_KEY), analysis);
        }
    }, [account?.id, analysis]);

    useEffect(() => {
        if (account) {
            writeStorage(scopedStorageKey(account.id, SUBSTITUTES_KEY), substitutes);
        }
    }, [account?.id, substitutes]);

    useEffect(() => {
        if (!account || !profileSyncReadyRef.current) {
            return;
        }

        const serialized = JSON.stringify(profile);

        if (serialized === profileSnapshotRef.current) {
            return;
        }

        setProfileStatus("saving");
        const timeout = window.setTimeout(async () => {
            try {
                const payload = await apiPut("/api/profile", { profile });
                const nextProfile = payload.profile || profile;
                profileSnapshotRef.current = JSON.stringify(nextProfile);
                setProfileStatus("saved");

                if (payload.account) {
                    setAccount(payload.account);
                }

                if (JSON.stringify(nextProfile) !== serialized) {
                    setProfile(nextProfile);
                }
            } catch (requestError) {
                setProfileStatus("error");
                setError(requestError.message || "Profile sync failed.");
            }
        }, 350);

        return () => window.clearTimeout(timeout);
    }, [account?.id, profile]);

    async function loadInitialData(hasRetried = false) {
        try {
            const [profilePayload, historyPayload, warningsPayload] = await Promise.all([
                apiGet("/api/profile"),
                apiGet("/api/history"),
                apiGet("/api/warnings")
            ]);

            const nextProfile = profilePayload.profile || DEFAULT_PROFILE;
            profileSyncReadyRef.current = false;
            profileSnapshotRef.current = JSON.stringify(nextProfile);
            setProfile(nextProfile);
            setHistory(historyPayload.history || []);
            setWarnings(warningsPayload.warnings || []);
            setProfileStatus("saved");

            if (profilePayload.account) {
                setAccount(profilePayload.account);
            }

            profileSyncReadyRef.current = true;
        } catch (requestError) {
            if (requestError.status === 401) {
                const currentUser = window.SafeBiteCurrentUser || window.SafeBiteAuth?.currentUser;

                if (!hasRetried && currentUser) {
                    try {
                        window.SafeBiteIdToken = await currentUser.getIdToken(true);
                        await loadInitialData(true);
                        return;
                    } catch (refreshError) {
                        console.error("Firebase token refresh failed", refreshError);
                        setError(formatFirebaseError(refreshError) || "Your Firebase session could not be restored. Sign in again.");
                        return;
                    }
                }

                console.error("Initial protected data load returned 401", requestError);
                setError(requestError.message || "Firebase-protected data load failed.");
                return;
            }

            console.error("Initial protected data load failed", requestError);
            setError(requestError.message || "Failed to load Firebase-backed data.");
        }
    }

    function navigate(nextRoute) {
        setRoute(nextRoute);
        window.history.pushState({}, "", nextRoute);
    }

    function updateProfile(updater) {
        setProfile((current) => (typeof updater === "function" ? updater(current) : updater));
    }

    function toggleDiet(id) {
        updateProfile((current) => ({
            ...current,
            diets: current.diets.includes(id)
                ? current.diets.filter((diet) => diet !== id)
                : [...current.diets, id]
        }));
    }

    function toggleBlacklist(item) {
        updateProfile((current) => ({
            ...current,
            blacklist: current.blacklist.includes(item)
                ? current.blacklist.filter((entry) => entry !== item)
                : [...current.blacklist, item]
        }));
    }

    function addCustomTrigger() {
        const nextTrigger = normalizeText(customTriggerInput);

        if (!nextTrigger) {
            return;
        }

        updateProfile((current) => ({
            ...current,
            custom: current.custom.includes(nextTrigger) ? current.custom : [...current.custom, nextTrigger],
            blacklist: current.blacklist.includes(nextTrigger) ? current.blacklist : [...current.blacklist, nextTrigger]
        }));
        setCustomTriggerInput("");
    }

    async function runAnalysis(product) {
        if (!account) {
            setError("Sign in before running product checks.");
            return;
        }

        setLoading("Checking safety...");
        setError("");

        try {
            const analysisPayload = await apiPost("/api/analyze", { product, profile });
            const result = analysisPayload.analysis;

            setActiveProduct(product);
            setAnalysis(result);
            const historyPayload = await apiPost("/api/history-entry", { product, analysis: result });
            setHistory(historyPayload.history || []);

            navigate("/product");
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading("");
        }
    }

    async function searchProducts() {
        if (!searchQuery.trim()) {
            setError("Type a product name before searching.");
            return;
        }

        setLoading("Searching Open Food Facts...");
        setError("");

        try {
            const payload = await apiGet(`/api/search?q=${encodeURIComponent(searchQuery.trim())}`);
            setResults(payload.products || []);
            setResultsSource(payload.source || "");
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading("");
        }
    }

    async function lookupBarcode(barcodeOverride) {
        const code = String(barcodeOverride || barcodeQuery).trim();

        if (!code) {
            setError("Enter a barcode first.");
            return;
        }

        setLoading("Looking up barcode...");
        setError("");

        try {
            const payload = await apiGet(`/api/product/${encodeURIComponent(code)}`);
            setResults([payload.product]);
            setResultsSource(payload.product?.source_api || "Open Food Facts");
            setBarcodeQuery(payload.product.code || code);
            await runAnalysis(payload.product);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading("");
        }
    }

    async function loadSubstitutes() {
        if (!activeProduct) {
            navigate("/search");
            return;
        }

        setSubstituteLoading(true);
        setError("");

        try {
            const payload = await apiPost("/api/substitutes", { product: activeProduct, profile });
            setSubstitutes(payload.items || []);
            setSubstituteApiLabel(payload.apiLabel || "");
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setSubstituteLoading(false);
        }
    }

    useEffect(() => {
        if (route === "/substitutes" && activeProduct && substitutes.length === 0 && !substituteLoading) {
            loadSubstitutes();
        }
    }, [route, activeProduct, substitutes.length, substituteLoading]);

    async function submitWarning() {
        if (!account) {
            setError("Sign in before posting a community warning.");
            return;
        }

        if (!warningForm.productName || !warningForm.location || !warningForm.message) {
            setError("Fill in product, location, and warning message.");
            return;
        }

        setError("");

        try {
            const payload = await apiPost("/api/warnings", warningForm);
            setWarnings(payload.warnings || []);
            setWarningForm(EMPTY_WARNING_FORM);
            navigate("/community");
        } catch (requestError) {
            setError(requestError.message || "Publishing failed.");
        }
    }

    function primeWarningFormFromActiveProduct() {
        const summary = summarizeProduct(activeProduct || {});
        setWarningForm((current) => ({
            ...current,
            productName: summary.name === "Unnamed product" ? current.productName : summary.name,
            message: current.message || "Packaging, ingredient, or allergen information looked suspicious in-store."
        }));
        navigate("/community");
    }

    async function startScanner() {
        if (!navigator.mediaDevices || !window.BarcodeDetector) {
            setScannerMessage("This browser does not support live barcode scanning. Use manual barcode entry.");
            return;
        }

        try {
            detectorRef.current = new window.BarcodeDetector({
                formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"]
            });
            streamRef.current = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: "environment" } },
                audio: false
            });
            videoRef.current.srcObject = streamRef.current;
            await videoRef.current.play();
            setScannerActive(true);
            setScannerMessage("Scanning for a barcode...");
            scanFrame();
        } catch (cameraError) {
            setScannerMessage("Camera access failed. Manual barcode lookup is still available.");
        }
    }

    function scanFrame() {
        frameRef.current = requestAnimationFrame(async () => {
            try {
                const found = await detectorRef.current.detect(videoRef.current);

                if (found.length > 0 && found[0].rawValue) {
                    const value = found[0].rawValue;
                    setBarcodeQuery(value);
                    stopScanner();
                    await lookupBarcode(value);
                    return;
                }
            } catch (scanError) {
                setScannerMessage("Live scanning stopped because the browser blocked frame analysis.");
                stopScanner();
                return;
            }

            scanFrame();
        });
    }

    function stopScanner() {
        if (frameRef.current) {
            cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
        }

        if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
        }

        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.srcObject = null;
        }

        setScannerActive(false);
    }

    function updateAuthField(field, value) {
        setAuthForm((current) => ({
            ...current,
            [field]: value
        }));
    }

    async function submitAuth() {
        setError("");

        if (!firebaseRef.current) {
            setError(configError || "Firebase is not ready yet.");
            return;
        }

        if (!authForm.email.trim() || !authForm.password) {
            setError("Enter your email and password.");
            return;
        }

        if (authMode === "register") {
            if (!authForm.displayName.trim()) {
                setError("Enter your display name.");
                return;
            }

            if (authForm.password.length < 6) {
                setError("Password must be at least 6 characters for Firebase email auth.");
                return;
            }

            if (authForm.password !== authForm.confirmPassword) {
                setError("Passwords do not match.");
                return;
            }
        }

        const { sdk, auth } = firebaseRef.current;
        setAuthLoading(authMode === "register" ? "Creating account..." : "Signing in...");

        try {
            if (authMode === "register") {
                const credential = await sdk.createUserWithEmailAndPassword(
                    auth,
                    normalizeEmail(authForm.email),
                    authForm.password
                );

                await sdk.updateProfile(credential.user, {
                    displayName: normalizeText(authForm.displayName)
                });
            } else {
                await sdk.signInWithEmailAndPassword(
                    auth,
                    normalizeEmail(authForm.email),
                    authForm.password
                );
            }

            setAuthForm(EMPTY_AUTH_FORM);
            setRoute("/profile");
            window.history.pushState({}, "", "/profile");
        } catch (requestError) {
            setError(formatFirebaseError(requestError));
        } finally {
            setAuthLoading("");
        }
    }

    async function logout() {
        try {
            if (firebaseRef.current) {
                await firebaseRef.current.sdk.signOut(firebaseRef.current.auth);
            }
        } catch (requestError) {
            setError(formatFirebaseError(requestError));
        } finally {
            stopScanner();
            setAccount(null);
            setRoute("/search");
            window.history.pushState({}, "", "/search");
        }
    }

    function renderAuthPage() {
        const authDisabled = Boolean(configError);

        return (
            <main className="auth-main">
                <section className="auth-grid">
                    <div className="panel hero-panel auth-hero">
                        <p className="eyebrow">SafeBite</p>
                        <h1>Your allergy and diet safety workspace.</h1>
                        <p>
                            Save your profile, check products quickly, and stay updated with alerts shared by the community.
                        </p>
                    </div>
                    <div className="panel auth-card">
                        <p className="section-label">{authMode === "register" ? "Create account" : "Sign in"}</p>
                        <h2>{authMode === "register" ? "Create your SafeBite workspace" : "Resume your SafeBite workspace"}</h2>
                        <p className="auth-note">
                            Sign in to keep your profile, recent checks, and community alerts in one place.
                        </p>
                        {configError && <div className="inline-alert">{configError}</div>}
                        <div className="stack-form auth-form">
                            {authMode === "register" && (
                                <input
                                    type="text"
                                    value={authForm.displayName}
                                    onChange={(event) => updateAuthField("displayName", event.target.value)}
                                    placeholder="Display name"
                                    disabled={authDisabled}
                                />
                            )}
                            <input
                                type="email"
                                value={authForm.email}
                                onChange={(event) => updateAuthField("email", event.target.value)}
                                placeholder="Email address"
                                disabled={authDisabled}
                            />
                            <input
                                type="password"
                                value={authForm.password}
                                onChange={(event) => updateAuthField("password", event.target.value)}
                                placeholder="Password"
                                disabled={authDisabled}
                            />
                            {authMode === "register" && (
                                <input
                                    type="password"
                                    value={authForm.confirmPassword}
                                    onChange={(event) => updateAuthField("confirmPassword", event.target.value)}
                                    placeholder="Confirm password"
                                    disabled={authDisabled}
                                />
                            )}
                            <button type="button" className="primary-btn" onClick={submitAuth} disabled={authDisabled}>
                                {authLoading || (authMode === "register" ? "Create account" : "Sign in")}
                            </button>
                        </div>
                        <div className="auth-switch">
                            <span>{authMode === "register" ? "Already have an account?" : "Need an account?"}</span>
                            <button
                                type="button"
                                className="text-btn"
                                disabled={authDisabled}
                                onClick={() => {
                                    setAuthMode(authMode === "register" ? "login" : "register");
                                    setAuthForm(EMPTY_AUTH_FORM);
                                    setError("");
                                }}
                            >
                                {authMode === "register" ? "Switch to sign in" : "Switch to registration"}
                            </button>
                        </div>
                    </div>
                    <div className="panel auth-details">
                        <p className="section-label">Why sign in</p>
                        <ul className="auth-list">
                            <li>Keep your dietary preferences available every time you return.</li>
                            <li>See your recent checks across sessions.</li>
                            <li>Share and review product alerts with the community.</li>
                        </ul>
                    </div>
                </section>
            </main>
        );
    }

    function renderProfilePage() {
        return (
            <section className="page-grid">
                <div className="panel hero-panel">
                    <p className="eyebrow">Profile</p>
                    <h1>Dietary Profile Setup</h1>
                    <p>
                        Choose the diets and ingredients you want SafeBite to watch for in every product check.
                    </p>
                </div>
                <div className="panel">
                    <p className="section-label">Diet restrictions</p>
                    <div className="chip-grid">
                        {DIET_OPTIONS.map((option) => (
                            <button
                                key={option.id}
                                type="button"
                                className={profile.diets.includes(option.id) ? "chip active" : "chip"}
                                onClick={() => toggleDiet(option.id)}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="panel">
                    <p className="section-label">Allergy blacklist</p>
                    <div className="chip-grid">
                        {BLACKLIST_OPTIONS.map((item) => (
                            <button
                                key={item}
                                type="button"
                                className={profile.blacklist.includes(item) ? "chip active" : "chip"}
                                onClick={() => toggleBlacklist(item)}
                            >
                                {item}
                            </button>
                        ))}
                    </div>
                    <div className="inline-form">
                        <input
                            type="text"
                            value={customTriggerInput}
                            onChange={(event) => setCustomTriggerInput(event.target.value)}
                            placeholder="Add a custom trigger"
                        />
                        <button type="button" className="primary-btn" onClick={addCustomTrigger}>Add</button>
                    </div>
                    <div className="tag-row">
                        {profile.custom.map((item) => <span key={item} className="tag">{item}</span>)}
                    </div>
                </div>
                <div className="panel profile-summary">
                    <p className="section-label">Profile summary</p>
                    <h2>{profile.name}'s SafeBite profile</h2>
                    <p>{profile.diets.length} diets selected and {profile.blacklist.length} blacklist items active.</p>
                    <p className="status-line">
                        {profileStatus === "saving"
                            ? "Saving profile..."
                            : profileStatus === "saved"
                                ? "Profile saved."
                                : profileStatus === "error"
                                    ? "Profile sync failed."
                                    : "Profile sync is idle."}
                    </p>
                    <button type="button" className="primary-btn" onClick={() => navigate("/search")}>Continue to scanner</button>
                </div>
            </section>
        );
    }

    function renderSearchPage() {
        return (
            <section className="page-grid">
                <div className="panel hero-panel search-hero">
                    <p className="eyebrow">Search</p>
                    <h1>Search / Scanner Home</h1>
                    <p>Search products by name, type a barcode, or use the camera scanner when the browser supports it.</p>
                </div>
                <div className="panel wide-panel search-panel">
                    <p className="section-label">Product search</p>
                    <div className="inline-form search-row">
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            placeholder="Search Nutella, Oreos, corn flakes"
                        />
                        <button type="button" className="primary-btn" onClick={searchProducts}>Search</button>
                    </div>
                    <div className="inline-form search-row">
                        <input
                            type="text"
                            value={barcodeQuery}
                            onChange={(event) => setBarcodeQuery(event.target.value)}
                            placeholder="Enter or scan a barcode"
                        />
                        <button type="button" className="secondary-btn" onClick={() => lookupBarcode()}>Check barcode</button>
                    </div>
                    <div className="scanner-shell search-scanner">
                        <div>
                            <p className="section-label">Camera scan</p>
                            <p>{scannerMessage}</p>
                        </div>
                        <button type="button" className="secondary-btn" onClick={scannerActive ? stopScanner : startScanner}>
                            {scannerActive ? "Stop camera" : "Start camera"}
                        </button>
                    </div>
                    <div className="video-box">
                        <video ref={videoRef} muted playsInline></video>
                        {!scannerActive && <div className="video-placeholder">Live preview appears here.</div>}
                    </div>
                </div>
                <div className="panel wide-panel">
                    <div className="section-mini-header">
                        <p className="section-label">Live results</p>
                        <h2>Products</h2>
                    </div>
                    {loading && <p className="status-line">{loading}</p>}
                    {results.length > 0 ? (
                        <>
                            {resultsSource && <p className="api-note">Results source: {resultsSource}</p>}
                            <div className="results-grid">
                                {results.map((product) => {
                                    const summary = summarizeProduct(product);

                                    return (
                                        <button
                                            type="button"
                                            key={`${summary.code}-${summary.name}`}
                                            className="result-card"
                                            onClick={() => runAnalysis(product)}
                                        >
                                            <strong>{summary.name}</strong>
                                            <p>{summary.brand}</p>
                                            <span>{summary.code}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </>
                    ) : (
                        <div className="empty-card">Search results will appear here.</div>
                    )}
                </div>
                <div className="panel wide-panel">
                    <div className="section-mini-header">
                        <p className="section-label">History tracking</p>
                        <h2>Recently scanned items</h2>
                    </div>
                    {history.length > 0 ? (
                        <div className="history-list">
                            {history.slice(0, 4).map((entry) => (
                                <article key={entry.id} className={`history-item ${entry.level}`}>
                                    <div>
                                        <strong>{entry.name}</strong>
                                        <p>{entry.summary}</p>
                                    </div>
                                    <small>{new Date(entry.checkedAt).toLocaleString()}</small>
                                </article>
                            ))}
                        </div>
                    ) : (
                        <div className="empty-card">Your recent checks will appear here after a scan.</div>
                    )}
                </div>
            </section>
        );
    }

    function renderProductPage() {
        const productSummary = summarizeProduct(activeProduct || {});

        return (
            <section className="page-grid">
                <div className="panel hero-panel">
                    <p className="eyebrow">Product</p>
                    <h1>Product Safety Detail</h1>
                    <p>Review the safety result, ingredient breakdown, and product details before you buy.</p>
                </div>
                <div className="panel">
                    <SafetyLightIndicator analysis={analysis} />
                </div>
                <div className="panel">
                    <p className="section-label">Product snapshot</p>
                    {activeProduct ? (
                        <div className="product-card">
                            <div className="product-thumb">
                                {productSummary.image ? <img src={productSummary.image} alt={productSummary.name} /> : <span>No image</span>}
                            </div>
                            <div>
                                <h2>{productSummary.name}</h2>
                                <p>{productSummary.brand}</p>
                                <p>Barcode: {productSummary.code}</p>
                                <p>Quantity: {productSummary.quantity}</p>
                                <p>Nutri-Score: {productSummary.nutriscore}</p>
                            </div>
                        </div>
                    ) : (
                        <div className="empty-card">Run a product search first.</div>
                    )}
                </div>
                <div className="panel wide-panel">
                    <IngredientChecklist analysis={analysis} />
                </div>
                <div className="panel wide-panel action-band">
                    <button type="button" className="primary-btn" onClick={() => navigate("/substitutes")}>Open safe substitutes</button>
                    <button type="button" className="secondary-btn" onClick={primeWarningFormFromActiveProduct}>Report this product</button>
                </div>
            </section>
        );
    }

    function renderSubstitutesPage() {
        return (
            <section className="page-grid">
                <div className="panel hero-panel">
                    <p className="eyebrow">Alternatives</p>
                    <h1>Safe Substitutes Suggestions</h1>
                    <p>
                        Explore similar options that better match your dietary preferences and ingredient restrictions.
                    </p>
                </div>
                <div className="panel wide-panel">
                    <div className="action-band">
                        <button type="button" className="primary-btn" onClick={loadSubstitutes}>Refresh suggestions</button>
                        <button type="button" className="secondary-btn" onClick={() => navigate("/product")}>Back to product details</button>
                    </div>
                    <SubstituteCarousel items={substitutes} loading={substituteLoading} apiLabel={substituteApiLabel} />
                </div>
            </section>
        );
    }

    function renderCommunityPage() {
        const filteredWarnings = warnings.filter((warning) => matchesWarningFilter(warning, warningSearch, warningSeverityFilter));
        const insights = buildWarningInsights(warnings);

        return (
            <section className="page-grid">
                <div className="panel hero-panel">
                    <p className="eyebrow">Community</p>
                    <h1>Community Warnings Feed</h1>
                    <p>See recent reports about packaging changes, undeclared ingredients, and suspicious product batches.</p>
                </div>
                <div className="panel wide-panel warning-stats">
                    <article className="warning-stat">
                        <span>Total alerts</span>
                        <strong>{insights.total}</strong>
                    </article>
                    <article className="warning-stat">
                        <span>High alert</span>
                        <strong>{insights.high}</strong>
                    </article>
                    <article className="warning-stat">
                        <span>Last 24h</span>
                        <strong>{insights.lastDay}</strong>
                    </article>
                </div>
                <div className="panel">
                    <p className="section-label">Post a warning</p>
                    <p className="api-note">Posting as {account?.displayName || "your account"}.</p>
                    <div className="stack-form">
                        <input
                            type="text"
                            value={warningForm.productName}
                            onChange={(event) => setWarningForm((current) => ({ ...current, productName: event.target.value }))}
                            placeholder="Product name"
                        />
                        <input
                            type="text"
                            value={warningForm.location}
                            onChange={(event) => setWarningForm((current) => ({ ...current, location: event.target.value }))}
                            placeholder="Location"
                        />
                        <select
                            value={warningForm.severity}
                            onChange={(event) => setWarningForm((current) => ({ ...current, severity: event.target.value }))}
                        >
                            <option value="low">Low concern</option>
                            <option value="medium">Medium concern</option>
                            <option value="high">High concern</option>
                        </select>
                        <textarea
                            value={warningForm.message}
                            onChange={(event) => setWarningForm((current) => ({ ...current, message: event.target.value }))}
                            placeholder="What did you spot?"
                        ></textarea>
                        <button type="button" className="primary-btn" onClick={submitWarning}>Publish warning</button>
                    </div>
                </div>
                <div className="panel wide-panel">
                    <div className="section-mini-header">
                        <p className="section-label">Community feed</p>
                        <h2>Latest alerts</h2>
                    </div>
                    <div className="warning-toolbar">
                        <input
                            type="text"
                            value={warningSearch}
                            onChange={(event) => setWarningSearch(event.target.value)}
                            placeholder="Search product, location, or author"
                        />
                        <select value={warningSeverityFilter} onChange={(event) => setWarningSeverityFilter(event.target.value)}>
                            <option value="all">All severities</option>
                            <option value="high">High only</option>
                            <option value="medium">Medium only</option>
                            <option value="low">Low only</option>
                        </select>
                    </div>
                    {filteredWarnings.length > 0 ? (
                        <div className="warning-feed">
                            {filteredWarnings.map((warning) => (
                                <article key={warning.id} className={`warning-item ${warning.severity}`}>
                                    <div className="warning-head">
                                        <strong>{warning.productName}</strong>
                                        <span className={`severity-pill ${warning.severity}`}>{warning.severity} alert</span>
                                    </div>
                                    <p>{warning.message}</p>
                                    <div className="warning-meta">
                                        <span>{warning.location}</span>
                                        <small>
                                            {warning.author} · {new Date(warning.createdAt).toLocaleString()}
                                        </small>
                                    </div>
                                </article>
                            ))}
                        </div>
                    ) : (
                        <div className="empty-card">
                            {warnings.length === 0
                                ? "No community warnings have been posted yet."
                                : "No warnings match the current filters."}
                        </div>
                    )}
                </div>
            </section>
        );
    }

    function renderPage() {
        if (route === "/profile") {
            return renderProfilePage();
        }
        if (route === "/product") {
            return renderProductPage();
        }
        if (route === "/substitutes") {
            return renderSubstitutesPage();
        }
        if (route === "/community") {
            return renderCommunityPage();
        }
        return renderSearchPage();
    }

    if (!authResolved) {
        return (
            <main className="auth-main">
                <section className="auth-grid">
                    <div className="panel auth-card">
                        <p className="section-label">Initializing</p>
                        <h2>Loading your SafeBite session</h2>
                        <p className="auth-note">Preparing your account and saved safety profile.</p>
                    </div>
                </section>
            </main>
        );
    }

    if (!account) {
        return (
            <div className="app-shell auth-only">
                <div className="aero-halo halo-one"></div>
                <div className="aero-halo halo-two"></div>
                <div className="aero-halo halo-three"></div>
                {renderAuthPage()}
            </div>
        );
    }

    const routeMeta = ROUTE_META[route] || ROUTE_META["/search"];
    const activeTriggerCount = (profile.blacklist || []).length + (profile.diets || []).length;

    return (
        <div className="app-shell">
            <div className="aero-halo halo-one"></div>
            <div className="aero-halo halo-two"></div>
            <div className="aero-halo halo-three"></div>
            <aside className="sidebar">
                <div className="sidebar-top clickable-brand" onClick={() => navigate("/search")}>
                    <div className="sidebar-brand-container">
                        <div className="brand-glow"></div>
                        <img src="/logo.png" alt="SafeBite Logo" className="sidebar-brand-logo" />
                        <div className="sidebar-brand-text">SafeBite</div>
                    </div>
                    <p className="brand-kicker">Universal Allergen & Diet Scanner</p>
                </div>
                <nav className="nav-links nav-dock">
                    <button type="button" className={route === "/profile" ? "nav-link active" : "nav-link"} onClick={() => navigate("/profile")}>Dietary Profile Setup</button>
                    <button type="button" className={route === "/search" ? "nav-link active" : "nav-link"} onClick={() => navigate("/search")}>Search / Scanner Home</button>
                    <button type="button" className={route === "/product" ? "nav-link active" : "nav-link"} onClick={() => navigate("/product")}>Product Safety Detail</button>
                    <button type="button" className={route === "/substitutes" ? "nav-link active" : "nav-link"} onClick={() => navigate("/substitutes")}>Safe Substitutes</button>
                    <button type="button" className={route === "/community" ? "nav-link active" : "nav-link"} onClick={() => navigate("/community")}>Community Warnings</button>
                </nav>
                <div className="sidebar-card sidebar-footer">
                    <p className="section-label">Signed in</p>
                    <strong>{account.displayName}</strong>
                    <span>@{account.username}</span>
                    <span>{account.email}</span>
                    <button type="button" className="secondary-btn compact-btn" onClick={logout}>Sign out</button>
                </div>
            </aside>
            <main className="main-content">
                <div className="aero-topbar">
                    <div className="topbar-panel">
                        <p className="section-label">Active window</p>
                        <h3>{routeMeta.title}</h3>
                        <p>{routeMeta.subtitle}</p>
                    </div>
                    <div className="orb-metrics">
                        <div className="metric-orb">
                            <strong>{activeTriggerCount}</strong>
                            <span>rules</span>
                        </div>
                        <div className="metric-orb">
                            <strong>{history.length}</strong>
                            <span>history</span>
                        </div>
                        <div className="metric-orb">
                            <strong>{warnings.length}</strong>
                            <span>alerts</span>
                        </div>
                    </div>
                </div>
                {(error || configError) && <div className="global-alert">{error || configError}</div>}
                <section className="window-shell">
                    <div className="window-toolbar">
                        <div className="window-controls">
                            <span className="control-dot blue"></span>
                            <span className="control-dot green"></span>
                            <span className="control-dot gold"></span>
                        </div>
                        <div className="window-title">{routeMeta.title}</div>
                        <div className="toolbar-meta">
                            <div className="window-pill">{routeMeta.subtitle}</div>
                            <div className="account-pill">{account.displayName}</div>
                        </div>
                    </div>
                    <div className="window-body">
                        {renderPage()}
                    </div>
                </section>
            </main>
        </div>
    );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
