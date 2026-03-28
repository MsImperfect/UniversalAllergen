const https = require("https");
const {
    APP_AGENT,
    FDC_API_KEY,
    SEARCH_CACHE_MS,
    SEARCH_FIELDS
} = require("./config");
const {
    analyzeProduct,
    normalizeText,
    unique
} = require("./domain");

const searchCache = new Map();
const barcodeCache = new Map();

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
        ? normalizeText(product.categories_tags[0].split(":").pop())
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

module.exports = {
    searchProductsWithFallback,
    lookupBarcode,
    buildSubstitutes
};
