const http = require("http");
const { URL } = require("url");
const { PORT, ROUTES } = require("./config");
const {
    analyzeProduct,
    buildHistoryEntry,
    sanitizeAccount,
    sanitizeProfile
} = require("./domain");
const {
    appendFirebaseHistoryEntry,
    buildFirebaseAccount,
    createFirebaseWarning,
    getFirebaseConfig,
    getOrCreateFirebaseProfile,
    listFirebaseHistory,
    listFirebaseWarnings,
    updateFirebaseProfile,
    verifyFirebaseUser
} = require("./firebase");
const { buildCorsHeaders, readBody, sendJson, serveAppFile } = require("./http");
const {
    createSession,
    destroySession,
    getAuthContext,
    loginLocalAccount,
    registerLocalAccount
} = require("./legacyAuth");
const {
    buildSubstitutes,
    lookupBarcode,
    searchProductsWithFallback
} = require("./products");

function getEffectiveProfile(request, body) {
    if (body && body.profile) {
        return body.profile;
    }

    const auth = getAuthContext(request);
    return auth ? auth.account.profile : {};
}

async function handleRequest(request, response) {
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
            const account = registerLocalAccount(await readBody(request));
            createSession(account.id, response);
            sendJson(request, response, 201, { account });
            return;
        }

        if (requestUrl.pathname === "/api/auth/login" && request.method === "POST") {
            const account = loginLocalAccount(await readBody(request));
            createSession(account.id, response);
            sendJson(request, response, 200, { account });
            return;
        }

        if (requestUrl.pathname === "/api/auth/logout" && request.method === "POST") {
            destroySession(request, response);
            sendJson(request, response, 200, { ok: true });
            return;
        }

        if (requestUrl.pathname === "/api/profile" && request.method === "GET") {
            const firebaseUser = await verifyFirebaseUser(request);
            const profileRecord = await getOrCreateFirebaseProfile(firebaseUser);
            const account = buildFirebaseAccount(firebaseUser, profileRecord);
            sendJson(request, response, 200, {
                account,
                profile: sanitizeProfile(profileRecord, account.displayName)
            });
            return;
        }

        if (requestUrl.pathname === "/api/profile" && request.method === "PUT") {
            const firebaseUser = await verifyFirebaseUser(request);
            const { account, profile } = await updateFirebaseProfile(firebaseUser, (await readBody(request)).profile);
            sendJson(request, response, 200, { account, profile });
            return;
        }

        if (requestUrl.pathname === "/api/search" && request.method === "GET") {
            const query = requestUrl.searchParams.get("q") || "";
            sendJson(request, response, 200, await searchProductsWithFallback(query));
            return;
        }

        if (requestUrl.pathname.startsWith("/api/product/") && request.method === "GET") {
            const barcode = requestUrl.pathname.split("/").pop();
            sendJson(request, response, 200, { product: await lookupBarcode(barcode) });
            return;
        }

        if (requestUrl.pathname === "/api/analyze" && request.method === "POST") {
            const body = await readBody(request);
            sendJson(request, response, 200, {
                analysis: analyzeProduct(body.product || {}, getEffectiveProfile(request, body))
            });
            return;
        }

        if (requestUrl.pathname === "/api/history" && request.method === "GET") {
            const firebaseUser = await verifyFirebaseUser(request);
            sendJson(request, response, 200, { history: await listFirebaseHistory(firebaseUser.uid) });
            return;
        }

        if (requestUrl.pathname === "/api/history-entry" && request.method === "POST") {
            const firebaseUser = await verifyFirebaseUser(request);
            const body = await readBody(request);
            const entry = buildHistoryEntry(body.product || {}, body.analysis || {});
            sendJson(request, response, 201, await appendFirebaseHistoryEntry(firebaseUser.uid, entry));
            return;
        }

        if (requestUrl.pathname === "/api/substitutes" && request.method === "POST") {
            const body = await readBody(request);
            sendJson(request, response, 200, {
                items: await buildSubstitutes(body.product || {}, getEffectiveProfile(request, body)),
                apiLabel: "USDA + Open Food Facts"
            });
            return;
        }

        if (requestUrl.pathname === "/api/warnings" && request.method === "GET") {
            await verifyFirebaseUser(request);
            sendJson(request, response, 200, { warnings: await listFirebaseWarnings() });
            return;
        }

        if (requestUrl.pathname === "/api/warnings" && request.method === "POST") {
            const firebaseUser = await verifyFirebaseUser(request);
            sendJson(request, response, 201, {
                warnings: await createFirebaseWarning(firebaseUser, await readBody(request))
            });
            return;
        }

        if (requestUrl.pathname === "/style.css" || requestUrl.pathname === "/script.js" || requestUrl.pathname === "/logo.png") {
            serveAppFile(response, requestUrl.pathname.slice(1));
            return;
        }

        if (requestUrl.pathname === "/" || ROUTES.has(requestUrl.pathname)) {
            serveAppFile(response, "index.html");
            return;
        }

        sendJson(request, response, 404, { error: "Route not found." });
    } catch (error) {
        sendJson(request, response, error.statusCode || 500, { error: error.message || "Server error." });
    }
}

function createServer() {
    return http.createServer(handleRequest);
}

function startServer() {
    const server = createServer();
    server.listen(PORT, () => {
        console.log(`SafeBite running on http://localhost:${PORT}`);
    });
    return server;
}

module.exports = {
    createServer,
    startServer
};
