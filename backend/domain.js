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

function singularizeWord(word) {
    if (!word) {
        return "";
    }

    if (word.endsWith("ies") && word.length > 3) {
        return `${word.slice(0, -3)}y`;
    }

    if (word.endsWith("oes") && word.length > 3) {
        return word.slice(0, -2);
    }

    if (word.endsWith("es") && word.length > 4 && /(ches|shes|sses|xes|zes)$/.test(word)) {
        return word.slice(0, -2);
    }

    if (word.endsWith("s") && word.length > 3 && !word.endsWith("ss")) {
        return word.slice(0, -1);
    }

    return word;
}

function pluralizeWord(word) {
    if (!word) {
        return "";
    }

    if (word.endsWith("y") && word.length > 1 && !/[aeiou]y$/.test(word)) {
        return `${word.slice(0, -1)}ies`;
    }

    if (/(s|x|z|ch|sh)$/.test(word)) {
        return `${word}es`;
    }

    return `${word}s`;
}

function buildAliasVariants(value) {
    const normalized = normalizeText(value);

    if (!normalized) {
        return [];
    }

    const words = normalized.split(" ").filter(Boolean);
    const variants = new Set([normalized]);

    if (words.length === 1) {
        variants.add(singularizeWord(words[0]));
        variants.add(pluralizeWord(words[0]));
        return [...variants].filter(Boolean);
    }

    words.forEach((word, index) => {
        const singularWords = [...words];
        singularWords[index] = singularizeWord(word);
        variants.add(singularWords.join(" "));

        const pluralWords = [...words];
        pluralWords[index] = pluralizeWord(word);
        variants.add(pluralWords.join(" "));
    });

    return [...variants].filter(Boolean);
}

function buildCustomAliases(value) {
    const normalized = normalizeText(value);

    if (!normalized) {
        return [];
    }

    const words = normalized.split(" ").filter(Boolean);
    const variants = new Set(buildAliasVariants(normalized));

    // Custom user-entered restrictions should lean conservative and also match
    // ingredient phrases built from the same root words.
    words.forEach((word) => {
        buildAliasVariants(word).forEach((variant) => variants.add(variant));
    });

    return [...variants].filter(Boolean);
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
            aliases: unique(DIET_RULES[diet].aliases.flatMap(buildAliasVariants))
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
                    aliases: unique([known.id, known.label, ...known.aliases].flatMap(buildAliasVariants))
                };
            }

            return {
                id: item,
                label: item.replace(/\b\w/g, (letter) => letter.toUpperCase()),
                aliases: buildCustomAliases(item)
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

module.exports = {
    DIET_RULES,
    normalizeText,
    normalizeInlineText,
    normalizeEmail,
    unique,
    buildAliasVariants,
    buildCustomAliases,
    buildDefaultProfile,
    sanitizeProfile,
    analyzeProduct,
    buildHistoryEntry,
    normalizeUsername,
    buildUniqueUsername,
    sanitizeAccount
};
