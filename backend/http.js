const fs = require("fs");
const path = require("path");
const { STATIC_DIR } = require("./config");

function buildCorsHeaders(request) {
    const origin = request.headers.origin;
    return {
        "Access-Control-Allow-Origin": origin || "*",
        "Access-Control-Allow-Credentials": "true",
        "Vary": "Origin"
    };
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

function serveAppFile(response, relativePath) {
    serveStaticFile(response, path.join(STATIC_DIR, relativePath));
}

module.exports = {
    buildCorsHeaders,
    sendJson,
    readBody,
    serveAppFile
};
