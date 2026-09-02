const express = require("express");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(
    express.json({
        limit: "100kb"
    })
);


/* =========================================================
   CORS
   ========================================================= */

const ALLOWED_ORIGIN =
    "https://rerrerrer0109-dotcom.github.io";

app.use((req, res, next) => {

    res.setHeader(
        "Access-Control-Allow-Origin",
        ALLOWED_ORIGIN
    );

    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS"
    );

    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type"
    );

    if (req.method === "OPTIONS") {

        return res.sendStatus(204);
    }

    next();
});


/* =========================================================
   ENV
   ========================================================= */

const BOT_TOKEN =
    process.env.BOT_TOKEN;

const SUPABASE_URL =
    process.env.SUPABASE_URL;

const SUPABASE_SECRET_KEY =
    process.env.SUPABASE_SECRET_KEY;


const OLD_LISTING_PRICE_STARS =
    Math.max(
        1,
        Number(
            process.env.LISTING_PRICE_STARS ||
            "750"
        )
    );


const LISTING_RENEWAL_PRICE_STARS =
    Math.max(
        1,
        Number(
            process.env.LISTING_RENEWAL_PRICE_STARS ||
            OLD_LISTING_PRICE_STARS ||
            "750"
        )
    );


const PAID_LISTING_PRICE_STARS =
    LISTING_RENEWAL_PRICE_STARS;


const CONTACT_UNLOCK_PRICE_STARS =
    Math.max(
        1,
        Number(
            process.env.CONTACT_UNLOCK_PRICE_STARS ||
            "50"
        )
    );


const WANTED_PRICE_STARS =
    Math.max(
        1,
        Number(
            process.env.WANTED_PRICE_STARS ||
            "250"
        )
    );


const FREE_LISTING_DURATION_HOURS =
    24;


const PAID_LISTING_DURATION_DAYS =
    30;


const LISTING_RENEWAL_PRICE_USD =
    15;


const PUBLIC_BASE_URL =
    String(
        process.env.PUBLIC_BASE_URL ||
        ""
    )
        .trim()
        .replace(/\/+$/, "");


const TELEGRAM_WEBHOOK_SECRET =
    process.env.TELEGRAM_WEBHOOK_SECRET;


const TELEGRAM_BOT_USERNAME =
    String(
        process.env.TELEGRAM_BOT_USERNAME ||
        ""
    )
        .trim()
        .replace(/^@/, "");


const TELEGRAM_MINI_APP_SHORT_NAME =
    String(
        process.env.TELEGRAM_MINI_APP_SHORT_NAME ||
        ""
    )
        .trim()
        .replace(/^\/+|\/+$/g, "");


const REFERRAL_LISTING_DURATION_HOURS =
    7 * 24;


/* =========================================================
   PROMOTIONS
   ========================================================= */

/* Production pricing build: test-price overrides are intentionally disabled. */
const PROMOTION_TEST_MODE =
    false;


const PROMOTION_PRICES = {

    bump: {

        24: Math.max(
            1,
            Number(
                process.env.BUMP_24H_STARS ||
                "50"
            )
        ),

        72: Math.max(
            1,
            Number(
                process.env.BUMP_72H_STARS ||
                "120"
            )
        ),

        168: Math.max(
            1,
            Number(
                process.env.BUMP_168H_STARS ||
                "250"
            )
        )
    },


    hot: {

        24: Math.max(
            1,
            Number(
                process.env.HOT_24H_STARS ||
                "150"
            )
        ),

        72: Math.max(
            1,
            Number(
                process.env.HOT_72H_STARS ||
                "350"
            )
        ),

        168: Math.max(
            1,
            Number(
                process.env.HOT_168H_STARS ||
                "700"
            )
        )
    },


    vip: {

        24: Math.max(
            1,
            Number(
                process.env.VIP_24H_STARS ||
                "300"
            )
        ),

        72: Math.max(
            1,
            Number(
                process.env.VIP_72H_STARS ||
                "750"
            )
        ),

        168: Math.max(
            1,
            Number(
                process.env.VIP_168H_STARS ||
                "1500"
            )
        )
    }
};


/* =========================================================
   SUPABASE
   ========================================================= */

let supabase = null;

if (
    SUPABASE_URL &&
    SUPABASE_SECRET_KEY
) {

    supabase =
        createClient(
            SUPABASE_URL,
            SUPABASE_SECRET_KEY,
            {
                auth: {
                    persistSession: false,
                    autoRefreshToken: false,
                    detectSessionInUrl: false
                }
            }
        );
}


/* =========================================================
   GENERAL HELPERS
   ========================================================= */

const sleep =
    ms =>
        new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    ms
                )
        );


const nowIso =
    () =>
        new Date().toISOString();


function addHoursIso(
    value,
    hours
) {

    const base =
        value instanceof Date
            ? value.getTime()
            : new Date(value).getTime();


    return new Date(
        base +
        Number(hours) *
        60 *
        60 *
        1000
    ).toISOString();
}


function addDaysIso(
    value,
    days
) {

    return addHoursIso(
        value,
        Number(days) * 24
    );
}


function timeMs(
    value
) {

    if (!value) {

        return 0;
    }


    const result =
        new Date(value).getTime();


    return Number.isFinite(result)
        ? result
        : 0;
}


function isFuture(
    value
) {

    return (
        timeMs(value) >
        Date.now()
    );
}


/* =========================================================
   LISTING LIFECYCLE
   ========================================================= */

function isListingExpired(
    listing,
    referenceTime = Date.now()
) {

    if (!listing) {

        return true;
    }


    const plan =
        String(
            listing.listing_plan ||
            "legacy"
        );


    if (
        plan === "legacy" ||
        !listing.listing_expires_at
    ) {

        return false;
    }


    const expiry =
        timeMs(
            listing.listing_expires_at
        );


    if (!expiry) {

        return false;
    }


    return (
        expiry <=
        referenceTime
    );
}


function listingIsPubliclyAvailable(
    listing
) {

    return Boolean(
        listing &&
        listing.status === "active" &&
        !listing.is_paused &&
        !listing.is_frozen &&
        !isListingExpired(listing)
    );
}


function withLifecycle(
    listing
) {

    if (!listing) {

        return listing;
    }


    return {

        ...listing,

        listing_plan:
            listing.listing_plan ||
            "legacy",

        is_expired:
            isListingExpired(
                listing
            )
    };
}


/* =========================================================
   TELEGRAM API
   ========================================================= */

async function telegramApi(
    method,
    payload = {}
) {

    if (!BOT_TOKEN) {

        throw new Error(
            "BOT_TOKEN not configured"
        );
    }


    const response =
        await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(
                        payload
                    )
            }
        );


    const data =
        await response.json();


    if (
        !response.ok ||
        !data.ok
    ) {

        console.error(
            `Telegram API ${method}:`,
            data.description ||
            data
        );


        throw new Error(
            data.description ||
            "telegram_api_error"
        );
    }


    return data.result;
}


async function safeSendMessage(
    chatId,
    text
) {

    try {

        await telegramApi(
            "sendMessage",
            {
                chat_id:
                    Number(chatId),

                text
            }
        );

    } catch (error) {

        console.log(
            "Notification not delivered:",
            error.message
        );
    }
}


function createStarsInvoice(
    title,
    description,
    payload,
    amount
) {

    return telegramApi(
        "createInvoiceLink",
        {
            title,
            description,
            payload,
            currency: "XTR",

            prices: [
                {
                    label:
                        title,

                    amount:
                        Number(amount)
                }
            ]
        }
    );
}


function refundStars(
    userId,
    chargeId
) {

    return telegramApi(
        "refundStarPayment",
        {
            user_id:
                Number(userId),

            telegram_payment_charge_id:
                chargeId
        }
    );
}


/* =========================================================
   WEBHOOK SETUP
   ========================================================= */

async function setupTelegramWebhook() {

    if (
        !PUBLIC_BASE_URL ||
        !TELEGRAM_WEBHOOK_SECRET
    ) {

        console.log(
            "Webhook environment not configured"
        );

        return;
    }


    const webhookUrl =
        PUBLIC_BASE_URL +
        "/telegram-webhook";


    for (
        let attempt = 1;
        attempt <= 6;
        attempt++
    ) {

        try {

            await telegramApi(
                "setWebhook",
                {
                    url:
                        webhookUrl,

                    secret_token:
                        TELEGRAM_WEBHOOK_SECRET,

                    allowed_updates: [
                        "message",
                        "pre_checkout_query"
                    ],

                    drop_pending_updates:
                        false
                }
            );


            console.log(
                "Telegram webhook configured ✓"
            );


            return;

        } catch (error) {

            console.error(
                `Webhook attempt ${attempt} failed:`,
                error.message
            );


            if (
                attempt < 6
            ) {

                await sleep(
                    attempt *
                    5000
                );
            }
        }
    }
}


/* =========================================================
   TELEGRAM INIT DATA
   ========================================================= */

function validateInitData(
    initData
) {

    if (!BOT_TOKEN) {

        return {
            valid: false,
            error:
                "server_not_configured"
        };
    }


    if (
        !initData ||
        typeof initData !==
        "string"
    ) {

        return {
            valid: false,
            error:
                "initData_missing"
        };
    }


    const params =
        new URLSearchParams(
            initData
        );


    const receivedHash =
        params.get("hash");


    if (!receivedHash) {

        return {
            valid: false,
            error:
                "hash_missing"
        };
    }


    params.delete("hash");


    const dataCheckString =
        [...params.entries()]
            .sort(
                ([a], [b]) =>
                    a.localeCompare(b)
            )
            .map(
                ([key, value]) =>
                    `${key}=${value}`
            )
            .join("\n");


    const secretKey =
        crypto
            .createHmac(
                "sha256",
                "WebAppData"
            )
            .update(
                BOT_TOKEN
            )
            .digest();


    const calculatedHash =
        crypto
            .createHmac(
                "sha256",
                secretKey
            )
            .update(
                dataCheckString
            )
            .digest("hex");


    try {

        const a =
            Buffer.from(
                receivedHash,
                "hex"
            );


        const b =
            Buffer.from(
                calculatedHash,
                "hex"
            );


        if (
            a.length !==
            b.length ||
            !crypto.timingSafeEqual(
                a,
                b
            )
        ) {

            return {
                valid: false,
                error:
                    "invalid_signature"
            };
        }

    } catch {

        return {
            valid: false,
            error:
                "invalid_hash"
        };
    }


    const authDate =
        Number(
            params.get(
                "auth_date"
            )
        );


    const now =
        Math.floor(
            Date.now() /
            1000
        );


    if (
        !Number.isFinite(
            authDate
        ) ||
        authDate <= 0 ||
        now - authDate >
        3600 ||
        authDate >
        now + 30
    ) {

        return {
            valid: false,
            error:
                "initData_expired"
        };
    }


    let user;


    try {

        user =
            JSON.parse(
                params.get("user") ||
                "null"
            );

    } catch {

        return {
            valid: false,
            error:
                "invalid_user"
        };
    }


    if (!user?.id) {

        return {
            valid: false,
            error:
                "user_missing"
        };
    }


    return {
        valid: true,
        user
    };
}


/* =========================================================
   SELLER PROFILE
   ========================================================= */

async function ensureSellerProfile(
    telegramId
) {

    const {
        data,
        error
    } =
        await supabase
            .from(
                "seller_profiles"
            )
            .upsert(
                {
                    telegram_id:
                        Number(
                            telegramId
                        )
                },
                {
                    onConflict:
                        "telegram_id"
                }
            )
            .select(
                "id,telegram_id,bio,is_public,created_at,updated_at"
            )
            .single();


    if (error) {

        throw error;
    }


    return data;
}


/* =========================================================
   AUTH DATABASE USER
   ========================================================= */

async function getDatabaseUser(
    initData
) {

    const result =
        validateInitData(
            initData
        );


    if (!result.valid) {

        return {
            ok: false,
            status: 401,
            error:
                result.error
        };
    }


    if (!supabase) {

        return {
            ok: false,
            status: 500,
            error:
                "database_not_configured"
        };
    }


    const tgUser =
        result.user;


    const userRecord = {

        telegram_id:
            Number(
                tgUser.id
            ),

        first_name:
            tgUser.first_name ||
            "",

        last_name:
            tgUser.last_name ||
            "",

        telegram_username:
            tgUser.username ||
            null,

        language_code:
            tgUser.language_code ||
            null,

        photo_url:
            tgUser.photo_url ||
            null,

        last_seen_at:
            nowIso()
    };


    const {
        data,
        error
    } =
        await supabase
            .from("users")
            .upsert(
                userRecord,
                {
                    onConflict:
                        "telegram_id"
                }
            )
            .select()
            .single();


    if (error) {

        console.error(
            "User DB error:",
            error
        );


        return {
            ok: false,
            status: 500,
            error:
                "database_error"
        };
    }


    if (
        data.is_blocked
    ) {

        return {
            ok: false,
            status: 403,
            error:
                "account_blocked"
        };
    }


    try {

        data.seller_profile =
            await ensureSellerProfile(
                data.telegram_id
            );

    } catch (error) {

        console.error(
            "Seller profile ensure error:",
            error
        );


        return {
            ok: false,
            status: 500,
            error:
                "seller_profile_error"
        };
    }


    return {
        ok: true,
        user: data
    };
}


async function requireAdmin(
    initData
) {

    const auth =
        await getDatabaseUser(
            initData
        );


    if (!auth.ok) {

        return auth;
    }


    if (
        !auth.user.is_admin
    ) {

        return {
            ok: false,
            status: 403,
            error:
                "admin_required"
        };
    }


    return auth;
}


function normalizedAdminRole(
    user
) {

    if (
        !user ||
        !user.is_admin
    ) {

        return null;
    }


    const role =
        String(
            user.admin_role ||
            "owner"
        )
            .trim()
            .toLowerCase();


    return [
        "owner",
        "moderator",
        "support"
    ].includes(role)
        ? role
        : "owner";
}


function adminRoleAllowed(
    user,
    allowedRoles
) {

    const role =
        normalizedAdminRole(
            user
        );


    return Boolean(
        role &&
        allowedRoles.includes(
            role
        )
    );
}


/* =========================================================
   CATEGORIES
   ========================================================= */

const USERNAME_CATEGORIES = [
    "Business",
    "Brand",
    "Tech & AI",
    "Short",
    "Travel",
    "Finance",
    "Gaming",
    "Crypto",
    "Media",
    "Generic",
    "Other"
];


function normalizeCategory(
    value
) {

    const raw =
        String(
            value ||
            ""
        ).trim();


    if (
        raw === "AI"
    ) {

        return "Tech & AI";
    }


    return USERNAME_CATEGORIES
        .includes(raw)
        ? raw
        : "Other";
}


/* =========================================================
   INPUT VALIDATION
   ========================================================= */

function validateListingInput(
    body
) {

    let username =
        String(
            body.whatsapp_username ||
            ""
        ).trim();


    if (
        username.startsWith("@")
    ) {

        username =
            username.slice(1);
    }


    if (
        username.length < 2 ||
        username.length > 64 ||
        !/^[a-zA-Z0-9._]+$/.test(
            username
        )
    ) {

        return {
            ok: false,
            error:
                "invalid_username"
        };
    }


    const price =
        Number(
            body.asking_price
        );


    if (
        !Number.isFinite(price) ||
        price <= 0 ||
        price >
        100000000
    ) {

        return {
            ok: false,
            error:
                "invalid_price"
        };
    }


    const priceType =
        String(
            body.price_type ||
            "negotiable"
        )
            .trim()
            .toLowerCase();


    if (
        ![
            "fixed",
            "negotiable"
        ].includes(
            priceType
        )
    ) {

        return {
            ok: false,
            error:
                "invalid_price_type"
        };
    }


    let minimumOffer =
        null;


    if (
        priceType ===
        "negotiable" &&
        String(
            body.minimum_offer ??
            ""
        ).trim() !==
        ""
    ) {

        minimumOffer =
            Number(
                body.minimum_offer
            );


        if (
            !Number.isFinite(
                minimumOffer
            ) ||
            minimumOffer <= 0 ||
            minimumOffer > price
        ) {

            return {
                ok: false,
                error:
                    "invalid_minimum_offer"
            };
        }
    }


    const category =
        normalizeCategory(
            body.category
        );


    const description =
        String(
            body.description ||
            ""
        )
            .trim()
            .slice(
                0,
                500
            );


    const contactValidation =
        validateContactInput(
            body
        );


    if (!contactValidation.ok) {
        return contactValidation;
    }


    const {
        contactType,
        contactValue,
        contacts
    } = contactValidation.data;


    return {

        ok: true,

        data: {

            username,
            price,
            priceType,
            minimumOffer,
            category,
            description,

            contactType,

            contactValue,

            contacts
        }
    };
}


/* =========================================================
   V38 TRUST / MODERATION HELPERS
   ========================================================= */

function normalizeContactText(
    value,
    max = 200
) {
    return String(
        value ||
        ""
    )
    .replace(/\u0000/g,"")
    .trim()
    .slice(0,max);
}


function encodeContactBundle(
    contacts
) {
    return "hmv2:" +
        JSON.stringify({
            telegram:contacts.telegram || "",
            whatsapp:contacts.whatsapp || "",
            email:contacts.email || "",
            other:contacts.other || ""
        });
}


function decodeContactBundle(
    contactType,
    contactValue
) {

    const result = {
        telegram:"",
        whatsapp:"",
        email:"",
        other:""
    };

    const raw =
        normalizeContactText(
            contactValue,
            1200
        );


    if (
        raw.startsWith(
            "hmv2:"
        )
    ) {
        try {
            const parsed =
                JSON.parse(
                    raw.slice(5)
                );

            for (
                const key of [
                    "telegram",
                    "whatsapp",
                    "email",
                    "other"
                ]
            ) {
                result[key] =
                    normalizeContactText(
                        parsed?.[key],
                        200
                    );
            }

            return result;
        } catch {}
    }


    const type =
        String(
            contactType ||
            "other"
        )
        .trim()
        .toLowerCase();


    if (raw) {
        if (
            Object.prototype.hasOwnProperty.call(
                result,
                type
            )
        ) {
            result[type] = raw;
        } else {
            result.other = raw;
        }
    }


    return result;
}


function firstContactFromBundle(
    contacts
) {
    for (
        const type of [
            "telegram",
            "whatsapp",
            "email",
            "other"
        ]
    ) {
        if (contacts?.[type]) {
            return {
                type,
                value:contacts[type]
            };
        }
    }

    return {
        type:"other",
        value:""
    };
}


function validateContactInput(
    body
) {

    const providedBundle =
        body?.contacts &&
        typeof body.contacts ===
        "object" &&
        !Array.isArray(
            body.contacts
        );

    let contacts;


    if (providedBundle) {
        contacts = {
            telegram:normalizeContactText(body.contacts.telegram),
            whatsapp:normalizeContactText(body.contacts.whatsapp),
            email:normalizeContactText(body.contacts.email),
            other:normalizeContactText(body.contacts.other)
        };
    } else {
        const contactType =
            String(
                body.contact_type ||
                ""
            )
            .trim()
            .toLowerCase();

        if (
            ![
                "telegram",
                "whatsapp",
                "email",
                "other"
            ].includes(
                contactType
            )
        ) {
            return {
                ok:false,
                error:"invalid_contact_type"
            };
        }

        contacts = {
            telegram:"",
            whatsapp:"",
            email:"",
            other:""
        };

        contacts[contactType] =
            normalizeContactText(
                body.contact_value
            );
    }


    if (
        !Object.values(
            contacts
        ).some(Boolean)
    ) {
        return {
            ok:false,
            error:"contact_required"
        };
    }


    if (
        contacts.email &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
            .test(
                contacts.email
            )
    ) {
        return {
            ok:false,
            error:"invalid_email"
        };
    }


    const contactType =
        providedBundle
            ? "other"
            : firstContactFromBundle(
                contacts
            ).type;

    const contactValue =
        providedBundle
            ? encodeContactBundle(
                contacts
            )
            : firstContactFromBundle(
                contacts
            ).value;


    return {
        ok:true,
        data:{
            contactType,
            contactValue,
            contacts
        }
    };
}


function contactHasExternalLink(
    value
) {

    const raw =
        String(
            value ||
            ""
        ).trim();


    return /(?:https?:\/\/|www\.|(?:[a-z0-9-]+\.)+(?:com|net|org|io|co|me|app|site|shop|xyz|info|biz|dev|ai|ru|kg)(?:\/|\b))/i
        .test(
            raw
        );
}


async function addListingChangeHistory(
    listingId,
    actorType,
    actorTelegramId,
    changeType,
    oldValue,
    newValue
) {

    try {

        await supabase
            .from(
                "listing_change_history"
            )
            .insert(
                {
                    listing_id:
                        listingId,

                    actor_type:
                        actorType,

                    actor_telegram_id:
                        actorTelegramId
                            ? Number(
                                actorTelegramId
                              )
                            : null,

                    change_type:
                        changeType,

                    old_value:
                        oldValue ?? null,

                    new_value:
                        newValue ?? null
                }
            );

    } catch (error) {

        console.error(
            "Listing change history:",
            error
        );
    }
}


async function addPriceHistory(
    listing,
    oldPrice,
    newPrice
) {

    try {

        await supabase
            .from(
                "listing_price_history"
            )
            .insert(
                {
                    listing_id:
                        listing.id,

                    seller_telegram_id:
                        listing.seller_telegram_id,

                    old_price:
                        oldPrice,

                    new_price:
                        newPrice,

                    changed_at:
                        nowIso()
                }
            );

    } catch (error) {

        console.error(
            "Price history:",
            error
        );
    }
}


async function ensureRiskFlag(
    listingId,
    flagType,
    severity = "medium",
    details = null
) {

    try {

        const {
            data:existing
        } =
            await supabase
                .from(
                    "listing_risk_flags"
                )
                .select("id")
                .eq(
                    "listing_id",
                    listingId
                )
                .eq(
                    "flag_type",
                    flagType
                )
                .eq(
                    "status",
                    "open"
                )
                .limit(1);


        if (
            existing?.length
        ) {

            return existing[0];
        }


        const {
            data
        } =
            await supabase
                .from(
                    "listing_risk_flags"
                )
                .insert(
                    {
                        listing_id:
                            listingId,

                        flag_type:
                            flagType,

                        severity:
                            severity,

                        status:
                            "open",

                        details:
                            details
                    }
                )
                .select()
                .single();


        return data || null;

    } catch (error) {

        console.error(
            "Risk flag:",
            error
        );

        return null;
    }
}


async function resolveRiskFlagType(
    listingId,
    flagType,
    adminTelegramId,
    note = "Resolved by moderation"
) {

    try {

        await supabase
            .from(
                "listing_risk_flags"
            )
            .update(
                {
                    status:
                        "resolved",

                    resolved_at:
                        nowIso(),

                    resolved_by:
                        Number(
                            adminTelegramId
                        ),

                    resolution_note:
                        note
                }
            )
            .eq(
                "listing_id",
                listingId
            )
            .eq(
                "flag_type",
                flagType
            )
            .eq(
                "status",
                "open"
            );

    } catch (error) {

        console.error(
            "Resolve risk flag:",
            error
        );
    }
}


async function logAdminActivity(
    adminTelegramId,
    action,
    targetType,
    targetId,
    details = null
) {

    try {

        await supabase
            .from(
                "admin_activity_log"
            )
            .insert(
                {
                    admin_telegram_id:
                        Number(
                            adminTelegramId
                        ),

                    action:
                        String(
                            action ||
                            "admin_action"
                        ).slice(
                            0,
                            120
                        ),

                    target_type:
                        targetType
                            ? String(
                                targetType
                              ).slice(0,80)
                            : null,

                    target_id:
                        targetId
                            ? String(
                                targetId
                              ).slice(0,160)
                            : null,

                    details:
                        details
                }
            );

    } catch (error) {

        console.error(
            "Admin activity log:",
            error
        );
    }
}


async function notifyAdminsContactChanged(
    listing
) {

    const lot =
        listing.listing_number
            ? `LOT #${String(listing.listing_number).padStart(6,"0")}`
            : "Listing";


    await notifyAdmins(
        `⚠️ Contact changed · ${lot}\n@${listing.whatsapp_username}\n\nThe listing was sent back to moderation and is hidden until the new contact is reviewed.`
    );
}


function normalizeWantedUsername(
    value
) {

    let username =
        String(
            value ||
            ""
        ).trim();


    if (
        username.startsWith("@")
    ) {

        username =
            username.slice(1);
    }


    if (
        username.length < 2 ||
        username.length > 64 ||
        !/^[a-zA-Z0-9._]+$/.test(
            username
        )
    ) {

        return null;
    }


    return username;
}


/* =========================================================
   ADMIN NOTIFICATIONS
   ========================================================= */

async function notifyAdmins(
    text
) {

    const {
        data: admins,
        error
    } =
        await supabase
            .from("users")
            .select(
                "telegram_id"
            )
            .eq(
                "is_admin",
                true
            );


    if (error) {

        console.error(
            "Admin notification lookup:",
            error
        );

        return;
    }


    for (
        const admin of
        admins || []
    ) {

        await safeSendMessage(
            admin.telegram_id,
            text
        );
    }
}


async function notifyAdminsNewListing(
    listing
) {

    const plan =
        String(
            listing.listing_plan ||
            "legacy"
        );


    let planText =
        "Legacy";


    if (
        plan === "free"
    ) {

        planText =
            `🎁 FREE · ${FREE_LISTING_DURATION_HOURS}H`;
    }


    if (
        plan === "paid"
    ) {

        planText =
            `🟢 PAID · ${PAID_LISTING_DURATION_DAYS} DAYS`;
    }


    if (
        plan === "referral"
    ) {

        planText =
            `🎁 REFERRAL REWARD · ${REFERRAL_LISTING_DURATION_HOURS / 24} DAYS`;
    }


    const price =
        Number(
            listing.asking_price ||
            0
        ).toLocaleString(
            "en-US",
            {
                maximumFractionDigits: 2
            }
        );


    await notifyAdmins(

        `🛡 New listing awaiting moderation\n\n` +

        `Username: @${listing.whatsapp_username}\n` +

        `Price: $${price}\n` +

        `Plan: ${planText}\n` +

        `Category: ${listing.category || "Other"}\n\n` +

        `Open Handle Market → Profile → Admin Panel → Pending Listings.\n\n` +

        `Please Approve or Reject this listing.`
    );
}


/* =========================================================
   FREE LISTING
   ========================================================= */

async function claimFreeListing(
    telegramId
) {

    const {
        data,
        error
    } =
        await supabase
            .from("users")
            .update(
                {
                    free_listing_used:
                        true,

                    free_listing_used_at:
                        nowIso()
                }
            )
            .eq(
                "telegram_id",
                Number(
                    telegramId
                )
            )
            .eq(
                "free_listing_used",
                false
            )
            .select(
                "telegram_id"
            )
            .maybeSingle();


    if (error) {

        throw error;
    }


    return Boolean(
        data
    );
}


async function releaseFreeListingClaim(
    telegramId
) {

    try {

        await supabase
            .from("users")
            .update(
                {
                    free_listing_used:
                        false,

                    free_listing_used_at:
                        null
                }
            )
            .eq(
                "telegram_id",
                Number(
                    telegramId
                )
            );

    } catch {}
}


async function createFreeListing(
    seller,
    input
) {

    const listingId =
        crypto.randomUUID();


    try {

        const {
            error:
                listingError
        } =
            await supabase
                .from("listings")
                .insert(
                    {
                        id:
                            listingId,

                        seller_telegram_id:
                            seller.telegram_id,

                        whatsapp_username:
                            input.username,

                        asking_price:
                            input.price,

                        price_type:
                            input.priceType,

                        minimum_offer:
                            input.minimumOffer,

                        currency:
                            "USD",

                        category:
                            input.category,

                        description:
                            input.description,

                        status:
                            "pending",

                        verification_status:
                            "unverified",

                        is_premium_name:
                            false,

                        is_featured:
                            false,

                        is_paused:
                            false,

                        is_frozen:
                            false,

                        listing_plan:
                            "free",

                        listing_period_started_at:
                            null,

                        listing_expires_at:
                            null,

                        renewal_count:
                            0
                    }
                );


        if (
            listingError
        ) {

            throw listingError;
        }


        const {
            error:
                contactError
        } =
            await supabase
                .from(
                    "listing_contacts"
                )
                .insert(
                    {
                        listing_id:
                            listingId,

                        contact_type:
                            input.contactType,

                        contact_value:
                            input.contactValue
                    }
                );


        if (
            contactError
        ) {

            throw contactError;
        }


        await ensureSellerProfile(
            seller.telegram_id
        );


        await safeSendMessage(

            seller.telegram_id,

            `🎁 Your first listing @${input.username} was submitted for moderation.\n\nYour free ${FREE_LISTING_DURATION_HOURS}-hour timer will start only after approval.`
        );


        /*
         * NEW:
         * Notify all admins immediately.
         */

        await notifyAdminsNewListing(
            {
                whatsapp_username:
                    input.username,

                asking_price:
                    input.price,

                category:
                    input.category,

                listing_plan:
                    "free"
            }
        );



        const {
            data:createdFreeListing
        } =
            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username,status"
                )
                .eq(
                    "id",
                    listingId
                )
                .maybeSingle();


        if (createdFreeListing) {
            await detectDuplicateUsernameRisk(
                createdFreeListing
            );
        }


        return listingId;

    } catch (error) {

        await supabase
            .from(
                "listing_contacts"
            )
            .delete()
            .eq(
                "listing_id",
                listingId
            );


        await supabase
            .from("listings")
            .delete()
            .eq(
                "id",
                listingId
            );


        throw error;
    }
}


async function createReferralRewardListingAtomic(
    seller,
    input
) {

    const listingId =
        crypto.randomUUID();


    const {
        data,
        error
    } =
        await supabase.rpc(
            "hm_create_referral_listing_v46",
            {
                p_telegram_id:
                    seller.telegram_id,
                p_listing_id:
                    listingId,
                p_username:
                    input.username,
                p_price:
                    input.price,
                p_price_type:
                    input.priceType,
                p_minimum_offer:
                    input.minimumOffer,
                p_category:
                    input.category,
                p_description:
                    input.description,
                p_contact_type:
                    input.contactType,
                p_contact_value:
                    input.contactValue
            }
        );


    if (
        error
    ) {

        throw error;
    }


    if (
        !data?.ok
    ) {

        const claimError =
            new Error(
                data?.error ||
                "referral_listing_create_failed"
            );


        claimError.code =
            data?.error ||
            "referral_listing_create_failed";


        throw claimError;
    }


    await ensureSellerProfile(
        seller.telegram_id
    );


    await safeSendMessage(
        seller.telegram_id,
        `🎁 Your referral reward listing @${input.username} was submitted for moderation.\n\nIts free ${REFERRAL_LISTING_DURATION_HOURS / 24}-day timer starts only after approval.`
    );


    await notifyAdminsNewListing(
        {
            whatsapp_username:
                input.username,
            asking_price:
                input.price,
            category:
                input.category,
            listing_plan:
                "referral"
        }
    );


    const {
        data:
            createdListing
    } =
        await supabase
            .from("listings")
            .select(
                "id,seller_telegram_id,listing_number,whatsapp_username,status"
            )
            .eq(
                "id",
                listingId
            )
            .maybeSingle();


    if (
        createdListing
    ) {

        await detectDuplicateUsernameRisk(
            createdListing
        );
    }


    return {
        listing_id:
            listingId,
        reward_id:
            data.reward_id,
        tier:
            data.tier
    };
}


/* =========================================================
   CONTACT ACCESS
   ========================================================= */

async function buyerHasContactAccess(
    buyerId,
    listingId
) {

    const {
        data,
        error
    } =
        await supabase
            .from(
                "contact_unlocks"
            )
            .select("id")
            .eq(
                "buyer_telegram_id",
                Number(
                    buyerId
                )
            )
            .eq(
                "listing_id",
                listingId
            )
            .eq(
                "status",
                "paid"
            )
            .maybeSingle();


    if (error) {

        console.error(
            "Contact access lookup:",
            error
        );


        return false;
    }


    return Boolean(
        data
    );
}


/* =========================================================
   STATS
   ========================================================= */

function countByListingId(
    rows
) {

    const counts =
        new Map();


    for (
        const row of
        rows || []
    ) {

        const key =
            String(
                row.listing_id
            );


        counts.set(
            key,
            (
                counts.get(key) ||
                0
            ) + 1
        );
    }


    return counts;
}


async function attachOwnerListingStats(
    listings
) {

    const rows =
        listings ||
        [];


    const ids =
        rows
            .map(
                row =>
                    row.id
            )
            .filter(
                Boolean
            );


    if (!ids.length) {

        return rows.map(
            row => ({

                ...row,

                stats: {
                    views: 0,
                    likes: 0,
                    watchlists: 0,
                    offers: 0
                }
            })
        );
    }


    const [
        viewsResult,
        likesResult,
        watchResult,
        offersResult
    ] =
        await Promise.all([

            supabase
                .from(
                    "listing_views"
                )
                .select(
                    "listing_id"
                )
                .in(
                    "listing_id",
                    ids
                ),


            supabase
                .from(
                    "listing_likes"
                )
                .select(
                    "listing_id"
                )
                .in(
                    "listing_id",
                    ids
                ),


            supabase
                .from(
                    "watchlist"
                )
                .select(
                    "listing_id"
                )
                .in(
                    "listing_id",
                    ids
                ),


            supabase
                .from(
                    "offers"
                )
                .select(
                    "listing_id"
                )
                .in(
                    "listing_id",
                    ids
                )
        ]);


    if (
        viewsResult.error
    ) {

        console.error(
            "Listing views stats error:",
            viewsResult.error
        );
    }


    if (
        likesResult.error
    ) {

        console.error(
            "Listing likes stats error:",
            likesResult.error
        );
    }


    if (
        watchResult.error
    ) {

        console.error(
            "Watchlist stats error:",
            watchResult.error
        );
    }


    if (
        offersResult.error
    ) {

        console.error(
            "Offers stats error:",
            offersResult.error
        );
    }


    const viewCounts =
        countByListingId(
            viewsResult.data ||
            []
        );


    const likeCounts =
        countByListingId(
            likesResult.data ||
            []
        );


    const watchCounts =
        countByListingId(
            watchResult.data ||
            []
        );


    const offerCounts =
        countByListingId(
            offersResult.data ||
            []
        );


    return rows.map(
        row => ({

            ...row,

            stats: {

                views:
                    viewCounts.get(
                        String(
                            row.id
                        )
                    ) ||
                    0,

                likes:
                    likeCounts.get(
                        String(
                            row.id
                        )
                    ) ||
                    0,

                watchlists:
                    watchCounts.get(
                        String(
                            row.id
                        )
                    ) ||
                    0,

                offers:
                    offerCounts.get(
                        String(
                            row.id
                        )
                    ) ||
                    0
            }
        })
    );
}


/* =========================================================
   OFFER HELPERS
   ========================================================= */

async function closeOtherOpenOffers(
    listingId,
    acceptedOfferId
) {

    const {
        data:
            openOffers
    } =
        await supabase
            .from("offers")
            .select(
                "id,buyer_telegram_id"
            )
            .eq(
                "listing_id",
                listingId
            )
            .neq(
                "id",
                acceptedOfferId
            )
            .in(
                "status",
                [
                    "pending",
                    "countered"
                ]
            );


    const {
        error
    } =
        await supabase
            .from("offers")
            .update(
                {
                    status:
                        "declined",

                    buyer_unread:
                        true,

                    updated_at:
                        nowIso()
                }
            )
            .eq(
                "listing_id",
                listingId
            )
            .neq(
                "id",
                acceptedOfferId
            )
            .in(
                "status",
                [
                    "pending",
                    "countered"
                ]
            );


    if (error) {

        console.error(
            "Close other offers:",
            error
        );
    }


    return openOffers ||
        [];
}


async function closeListingOpenOffers(
    listingId,
    message
) {

    const {
        data:
            offers
    } =
        await supabase
            .from("offers")
            .select(
                "id,buyer_telegram_id"
            )
            .eq(
                "listing_id",
                listingId
            )
            .in(
                "status",
                [
                    "pending",
                    "countered"
                ]
            );


    await supabase
        .from("offers")
        .update(
            {
                status:
                    "declined",

                updated_at:
                    nowIso()
            }
        )
        .eq(
            "listing_id",
            listingId
        )
        .in(
            "status",
            [
                "pending",
                "countered"
            ]
        );


    for (
        const offer of
        offers || []
    ) {

        safeSendOfferMessage(
            offer.buyer_telegram_id,
            message
        );
    }
}


/* =========================================================
   PROMOTION HELPERS
   ========================================================= */

function promotionPrice(
    type,
    durationHours
) {

    if (
        !PROMOTION_PRICES[
            type
        ] ||
        ![
            24,
            72,
            168
        ].includes(
            Number(
                durationHours
            )
        )
    ) {

        return null;
    }


    return PROMOTION_PRICES[
        type
    ][
        Number(
            durationHours
        )
    ];
}


function promotionPricesForClient() {

    const out = {};


    for (
        const type of
        [
            "bump",
            "hot",
            "vip"
        ]
    ) {

        out[type] = {};


        for (
            const hours of
            [
                24,
                72,
                168
            ]
        ) {

            out[type][hours] =
                promotionPrice(
                    type,
                    hours
                );
        }
    }


    return out;
}


function promotionMeta(
    listing
) {

    if (
        isFuture(
            listing.vip_until
        )
    ) {

        return {

            promotion_type:
                "vip",

            promotion_until:
                listing.vip_until,

            promotion_rank:
                3
        };
    }


    if (
        isFuture(
            listing.hot_until
        )
    ) {

        return {

            promotion_type:
                "hot",

            promotion_until:
                listing.hot_until,

            promotion_rank:
                2
        };
    }


    if (
        isFuture(
            listing.bump_until
        )
    ) {

        return {

            promotion_type:
                "bump",

            promotion_until:
                listing.bump_until,

            promotion_rank:
                1
        };
    }


    return {

        promotion_type:
            null,

        promotion_until:
            null,

        promotion_rank:
            0
    };
}


function promotionSortTime(
    listing
) {

    const meta =
        promotionMeta(
            listing
        );


    if (
        meta.promotion_type ===
        "vip"
    ) {

        return timeMs(
            listing.vip_promoted_at ||
            listing.created_at
        );
    }


    if (
        meta.promotion_type ===
        "hot"
    ) {

        return timeMs(
            listing.hot_promoted_at ||
            listing.created_at
        );
    }


    if (
        meta.promotion_type ===
        "bump"
    ) {

        return timeMs(
            listing.bump_promoted_at ||
            listing.created_at
        );
    }


    return timeMs(
        listing.created_at
    );
}


function sortListingsByPromotion(
    listings
) {

    return [
        ...(listings || [])
    ].sort(
        (a, b) => {

            const ar =
                promotionMeta(a)
                    .promotion_rank;


            const br =
                promotionMeta(b)
                    .promotion_rank;


            if (
                br !== ar
            ) {

                return br - ar;
            }


            const bt =
                promotionSortTime(
                    b
                );


            const at =
                promotionSortTime(
                    a
                );


            if (
                bt !== at
            ) {

                return bt - at;
            }


            return (
                timeMs(
                    b.created_at
                )
                -
                timeMs(
                    a.created_at
                )
            );
        }
    );
}


function withPromotion(
    listing
) {

    const meta =
        promotionMeta(
            listing
        );


    return withLifecycle({

        ...listing,

        promotion_type:
            meta.promotion_type,

        promotion_until:
            meta.promotion_until
    });
}


function allowedPromotionDurations(
    listing
) {

    if (
        String(
            listing.listing_plan ||
            "legacy"
        ) === "free"
    ) {

        return [
            24
        ];
    }


    return [
        24,
        72,
        168
    ];
}


function calculatePromotionUntil(
    listing,
    type,
    durationHours
) {

    const duration =
        Number(
            durationHours
        );


    if (
        ![
            "bump",
            "hot",
            "vip"
        ].includes(
            type
        )
    ) {

        return {
            ok: false,
            error:
                "invalid_promotion"
        };
    }


    if (
        !allowedPromotionDurations(
            listing
        ).includes(
            duration
        )
    ) {

        return {
            ok: false,
            error:
                "promotion_duration_not_allowed"
        };
    }


    if (
        !listingIsPubliclyAvailable(
            listing
        )
    ) {

        return {

            ok: false,

            error:
                isListingExpired(
                    listing
                )
                    ? "listing_expired"
                    : "listing_not_promotable"
        };
    }


    const untilField =
        `${type}_until`;


    const currentUntil =
        timeMs(
            listing[
                untilField
            ]
        );


    const now =
        Date.now();


    const base =
        currentUntil >
        now
            ? currentUntil
            : now;


    const requestedUntil =
        base +
        duration *
        60 *
        60 *
        1000;


    const plan =
        String(
            listing.listing_plan ||
            "legacy"
        );


    const listingExpiry =
        timeMs(
            listing.listing_expires_at
        );


    if (
        plan === "free" &&
        listingExpiry
    ) {

        const effectiveUntil =
            Math.min(
                requestedUntil,
                listingExpiry
            );


        if (
            effectiveUntil <=
            base
        ) {

            return {
                ok: false,
                error:
                    "promotion_no_additional_time"
            };
        }


        return {

            ok: true,

            applied_until:
                new Date(
                    effectiveUntil
                ).toISOString()
        };
    }


    if (
        [
            "paid",
            "referral"
        ].includes(
            plan
        ) &&
        listingExpiry &&
        requestedUntil >
        listingExpiry
    ) {

        return {
            ok: false,
            error:
                "promotion_exceeds_listing_period"
        };
    }


    return {

        ok: true,

        applied_until:
            new Date(
                requestedUntil
            ).toISOString()
    };
}


/* =========================================================
   PUBLIC SELLER PROFILES
   ========================================================= */

function sellerIsOnline(
    lastSeenAt
) {

    const seen =
        new Date(
            lastSeenAt ||
            0
        ).getTime();


    if (
        !Number.isFinite(
            seen
        )
    ) {

        return false;
    }


    return (
        Date.now() - seen
    ) <=
        5 * 60 * 1000;
}


async function attachPublicSellerProfiles(
    listings
) {

    const rows =
        listings ||
        [];


    const sellerIds = [
        ...new Set(
            rows
                .map(
                    row =>
                        Number(
                            row.seller_telegram_id
                        )
                )
                .filter(Boolean)
        )
    ];


    let profiles = [];
    let users = [];


    if (
        sellerIds.length
    ) {

        const [
            profilesResult,
            usersResult
        ] =
            await Promise.all([

                supabase
                    .from(
                        "seller_profiles"
                    )
                    .select(
                        "id,telegram_id,is_public"
                    )
                    .in(
                        "telegram_id",
                        sellerIds
                    ),

                supabase
                    .from("users")
                    .select(
                        "telegram_id,first_name,last_name,photo_url,last_seen_at"
                    )
                    .in(
                        "telegram_id",
                        sellerIds
                    )
            ]);


        profiles =
            profilesResult.data ||
            [];


        users =
            usersResult.data ||
            [];
    }


    const userMap =
        new Map(
            users.map(
                user => [
                    String(
                        user.telegram_id
                    ),
                    user
                ]
            )
        );


    const profileMap =
        new Map(

            profiles
                .filter(
                    profile =>
                        profile.is_public
                )
                .map(
                    profile => {

                        const user =
                            userMap.get(
                                String(
                                    profile.telegram_id
                                )
                            ) ||
                            null;


                        return [
                            String(
                                profile.telegram_id
                            ),
                            {
                                profile_id:
                                    profile.id,

                                display_name:
                                    safeSellerDisplayName(
                                        user
                                    ),

                                avatar_url:
                                    user?.photo_url ||
                                    null,

                                last_seen_at:
                                    user?.last_seen_at ||
                                    null,

                                is_online:
                                    sellerIsOnline(
                                        user?.last_seen_at
                                    )
                            }
                        ];
                    }
                )
        );


    return rows.map(
        row => {

            const copy =
                withPromotion(
                    row
                );


            const sellerId =
                copy.seller_telegram_id;


            const sellerSummary =
                profileMap.get(
                    String(
                        sellerId
                    )
                ) ||
                null;


            delete copy
                .seller_telegram_id;


            copy.seller_profile_id =
                sellerSummary?.profile_id ||
                null;


            copy.seller_summary =
                sellerSummary
                    ? {
                        display_name:
                            sellerSummary.display_name,

                        avatar_url:
                            sellerSummary.avatar_url,

                        last_seen_at:
                            sellerSummary.last_seen_at,

                        is_online:
                            sellerSummary.is_online
                    }
                    : null;


            return copy;
        }
    );
}


function safeSellerDisplayName(
    user
) {

    const first =
        String(
            user?.first_name ||
            "Seller"
        ).trim() ||
        "Seller";


    const last =
        String(
            user?.last_name ||
            ""
        ).trim();


    return last

        ? `${first} ${last.charAt(0).toUpperCase()}.`

        : first;
}


/* =========================================================
   SELLER RESPONSE TIME
   ========================================================= */

async function calculateSellerResponseStats(
    sellerTelegramId
) {

    const sellerId =
        Number(
            sellerTelegramId
        );


    const {
        data:
            chats,
        error:
            chatsError
    } =
        await supabase
            .from(
                "listing_chats"
            )
            .select("id")
            .eq(
                "seller_telegram_id",
                sellerId
            )
            .order(
                "updated_at",
                {
                    ascending:false
                }
            )
            .limit(100);


    if (
        chatsError ||
        !chats?.length
    ) {

        return {
            average_seconds:null,
            samples:0
        };
    }


    const chatIds =
        chats.map(
            row =>
                row.id
        );


    const {
        data:
            rawMessages,
        error:
            messagesError
    } =
        await supabase
            .from(
                "chat_messages"
            )
            .select(
                "chat_id,sender_telegram_id,created_at"
            )
            .in(
                "chat_id",
                chatIds
            )
            .order(
                "created_at",
                {
                    ascending:false
                }
            )
            .limit(1200);


    if (
        messagesError ||
        !rawMessages?.length
    ) {

        return {
            average_seconds:null,
            samples:0
        };
    }


    const messages =
        [
            ...rawMessages
        ].sort(
            (
                a,
                b
            ) =>
                new Date(
                    a.created_at
                ).getTime()
                -
                new Date(
                    b.created_at
                ).getTime()
        );


    const pendingByChat =
        new Map();


    const responseTimes =
        [];


    for (
        const message of
        messages
    ) {

        const chatId =
            String(
                message.chat_id
            );


        const senderId =
            Number(
                message.sender_telegram_id
            );


        const createdAt =
            new Date(
                message.created_at
            ).getTime();


        if (
            !Number.isFinite(
                createdAt
            )
        ) {

            continue;
        }


        if (
            senderId !==
            sellerId
        ) {

            if (
                !pendingByChat.has(
                    chatId
                )
            ) {

                pendingByChat.set(
                    chatId,
                    createdAt
                );
            }


            continue;
        }


        if (
            !pendingByChat.has(
                chatId
            )
        ) {

            continue;
        }


        const buyerMessageAt =
            pendingByChat.get(
                chatId
            );


        const differenceSeconds =
            Math.round(
                (
                    createdAt -
                    buyerMessageAt
                ) /
                1000
            );


        pendingByChat.delete(
            chatId
        );


        if (
            differenceSeconds >= 0 &&
            differenceSeconds <=
                7 * 24 * 60 * 60
        ) {

            responseTimes.push(
                differenceSeconds
            );
        }
    }


    if (
        !responseTimes.length
    ) {

        return {
            average_seconds:null,
            samples:0
        };
    }


    const recentSamples =
        responseTimes.slice(
            -50
        );


    const averageSeconds =
        Math.round(
            recentSamples.reduce(
                (
                    sum,
                    value
                ) =>
                    sum + value,
                0
            ) /
            recentSamples.length
        );


    return {
        average_seconds:
            averageSeconds,

        samples:
            recentSamples.length
    };
}


/* =========================================================
   SELLER PROFILE PAYLOAD
   ========================================================= */

async function buildSellerProfilePayload(
    profile,
    own = false
) {

    const {
        data: user
    } =
        await supabase
            .from("users")
            .select(
                "telegram_id,first_name,last_name,photo_url,last_seen_at"
            )
            .eq(
                "telegram_id",
                profile.telegram_id
            )
            .maybeSingle();


    if (!user) {

        return null;
    }


    const {
        data:
            allSellerListings
    } =
        await supabase
            .from("listings")
            .select("id")
            .eq(
                "seller_telegram_id",
                profile.telegram_id
            );


    const listingIds =
        (
            allSellerListings ||
            []
        ).map(
            row =>
                row.id
        );


    let acceptedAgreements =
        0;


    if (
        listingIds.length
    ) {

        const {
            count
        } =
            await supabase
                .from("offers")
                .select(
                    "id",
                    {
                        count:
                            "exact",

                        head:
                            true
                    }
                )
                .in(
                    "listing_id",
                    listingIds
                )
                .eq(
                    "status",
                    "accepted"
                );


        acceptedAgreements =
            Number(
                count ||
                0
            );
    }


    const {
        count:
            activeWanted
    } =
        await supabase
            .from(
                "wanted_requests"
            )
            .select(
                "id",
                {
                    count:
                        "exact",

                    head:
                        true
                }
            )
            .eq(
                "buyer_telegram_id",
                profile.telegram_id
            )
            .eq(
                "status",
                "active"
            );


    const [
        activeListingsResult,
        responseStats
    ] =
        await Promise.all([

            supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username,asking_price,price_type,minimum_offer,currency,category,description,is_premium_name,is_featured,views_count,likes_count,created_at,bump_until,hot_until,vip_until,bump_promoted_at,hot_promoted_at,vip_promoted_at,listing_plan,listing_period_started_at,listing_expires_at"
                )
                .eq(
                    "seller_telegram_id",
                    profile.telegram_id
                )
                .eq(
                    "status",
                    "active"
                )
                .eq(
                    "is_paused",
                    false
                )
                .eq(
                    "is_frozen",
                    false
                )
                .limit(200),

            calculateSellerResponseStats(
                profile.telegram_id
            )
        ]);


    const activeListings =
        activeListingsResult.data ||
        [];


    const visible =
        activeListings.filter(
            listing =>
                !isListingExpired(
                    listing
                )
        );


    const sorted =
        sortListingsByPromotion(
            visible
        ).map(
            row => {

                const copy =
                    withPromotion(
                        row
                    );


                delete copy
                    .seller_telegram_id;


                return copy;
            }
        );


    const totalViews =
        sorted.reduce(
            (
                sum,
                listing
            ) =>
                sum +
                Number(
                    listing.views_count ||
                    0
                ),
            0
        );


    const totalLikes =
        sorted.reduce(
            (
                sum,
                listing
            ) =>
                sum +
                Number(
                    listing.likes_count ||
                    0
                ),
            0
        );


    const payload = {

        id:
            profile.id,

        display_name:
            safeSellerDisplayName(
                user
            ),

        avatar_url:
            user.photo_url ||
            null,

        bio:
            profile.bio ||
            "",

        seller_since:
            profile.created_at,

        presence: {

            is_online:
                sellerIsOnline(
                    user.last_seen_at
                ),

            last_seen_at:
                user.last_seen_at ||
                null
        },

        response_time: {

            average_seconds:
                responseStats.average_seconds,

            samples:
                responseStats.samples
        },

        stats: {

            active_listings:
                sorted.length,

            total_views:
                totalViews,

            total_likes:
                totalLikes,

            accepted_agreements:
                acceptedAgreements,

            active_wanted:
                Number(
                    activeWanted ||
                    0
                )
        },

        listings:
            sorted
    };


    if (own) {

        payload.is_public =
            Boolean(
                profile.is_public
            );


        payload.updated_at =
            profile.updated_at;
    }


    return payload;
}


/* =========================================================
   EXPIRY NOTIFICATIONS
   ========================================================= */

let expiryProcessorRunning =
    false;


async function processListingExpiryNotifications() {

    if (
        !supabase ||
        expiryProcessorRunning
    ) {

        return;
    }


    expiryProcessorRunning =
        true;


    try {

        const now =
            new Date();


        const oneHourLater =
            new Date(
                now.getTime() +
                60 *
                60 *
                1000
            );


        const nowValue =
            now.toISOString();


        const oneHourValue =
            oneHourLater.toISOString();


        /* LISTING: 1 HOUR LEFT */

        const {
            data:
                endingListings
        } =
            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username,listing_plan,listing_expires_at"
                )
                .eq(
                    "status",
                    "active"
                )
                .not(
                    "listing_expires_at",
                    "is",
                    null
                )
                .is(
                    "listing_expiry_1h_notified_at",
                    null
                )
                .gt(
                    "listing_expires_at",
                    nowValue
                )
                .lte(
                    "listing_expires_at",
                    oneHourValue
                )
                .limit(200);


        for (
            const listing of
            endingListings ||
            []
        ) {

            const planText =
                listing.listing_plan ===
                "free"
                    ? "free listing"
                    : "listing";


            await safeSendMessage(

                listing.seller_telegram_id,

                `⏰ Your ${planText} @${listing.whatsapp_username} expires in less than 1 hour.\n\nAfter expiration it will be hidden from Marketplace.`
            );


            await supabase
                .from("listings")
                .update(
                    {
                        listing_expiry_1h_notified_at:
                            nowIso()
                    }
                )
                .eq(
                    "id",
                    listing.id
                )
                .is(
                    "listing_expiry_1h_notified_at",
                    null
                );
        }


        /* LISTING EXPIRED */

        const {
            data:
                expiredListings
        } =
            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username,listing_plan,listing_expires_at"
                )
                .eq(
                    "status",
                    "active"
                )
                .not(
                    "listing_expires_at",
                    "is",
                    null
                )
                .is(
                    "listing_expired_notified_at",
                    null
                )
                .lte(
                    "listing_expires_at",
                    nowValue
                )
                .limit(200);


        for (
            const listing of
            expiredListings ||
            []
        ) {

            await safeSendMessage(

                listing.seller_telegram_id,

                `⌛ @${listing.whatsapp_username} has expired and is now hidden from Marketplace.\n\nRenew the listing for $${LISTING_RENEWAL_PRICE_USD} to activate it for another ${PAID_LISTING_DURATION_DAYS} days.`
            );


            await supabase
                .from("listings")
                .update(
                    {
                        listing_expired_notified_at:
                            nowIso()
                    }
                )
                .eq(
                    "id",
                    listing.id
                )
                .is(
                    "listing_expired_notified_at",
                    null
                );
        }


        await processPromotionExpiryNotifications(
            "bump",
            "⬆️",
            "Bump",
            nowValue,
            oneHourValue
        );


        await processPromotionExpiryNotifications(
            "hot",
            "🔥",
            "HOT",
            nowValue,
            oneHourValue
        );


        await processPromotionExpiryNotifications(
            "vip",
            "💎",
            "VIP",
            nowValue,
            oneHourValue
        );

    } catch (error) {

        console.error(
            "Expiry notification processor:",
            error
        );

    } finally {

        expiryProcessorRunning =
            false;
    }
}


async function processPromotionExpiryNotifications(
    type,
    emoji,
    label,
    nowValue,
    oneHourValue
) {

    const untilField =
        `${type}_until`;


    const hourField =
        `${type}_expiry_1h_notified_at`;


    const expiredField =
        `${type}_expired_notified_at`;


    const {
        data:
            endingPromotions
    } =
        await supabase
            .from("listings")
            .select(
                `id,seller_telegram_id,whatsapp_username,listing_expires_at,${untilField}`
            )
            .eq(
                "status",
                "active"
            )
            .not(
                untilField,
                "is",
                null
            )
            .is(
                hourField,
                null
            )
            .gt(
                untilField,
                nowValue
            )
            .lte(
                untilField,
                oneHourValue
            )
            .limit(200);


    for (
        const listing of
        endingPromotions ||
        []
    ) {

        const promotionExpiry =
            timeMs(
                listing[
                    untilField
                ]
            );


        const listingExpiry =
            timeMs(
                listing.listing_expires_at
            );


        const sameAsListingExpiry =
            listingExpiry &&
            Math.abs(
                promotionExpiry -
                listingExpiry
            ) <=
            5 *
            60 *
            1000;


        if (
            !sameAsListingExpiry
        ) {

            await safeSendMessage(

                listing.seller_telegram_id,

                `${emoji} ${label} for @${listing.whatsapp_username} expires in less than 1 hour.`
            );
        }


        await supabase
            .from("listings")
            .update(
                {
                    [hourField]:
                        nowIso()
                }
            )
            .eq(
                "id",
                listing.id
            )
            .is(
                hourField,
                null
            );
    }


    const {
        data:
            expiredPromotions
    } =
        await supabase
            .from("listings")
            .select(
                `id,seller_telegram_id,whatsapp_username,listing_expires_at,${untilField}`
            )
            .eq(
                "status",
                "active"
            )
            .not(
                untilField,
                "is",
                null
            )
            .is(
                expiredField,
                null
            )
            .lte(
                untilField,
                nowValue
            )
            .limit(200);


    for (
        const listing of
        expiredPromotions ||
        []
    ) {

        const promotionExpiry =
            timeMs(
                listing[
                    untilField
                ]
            );


        const listingExpiry =
            timeMs(
                listing.listing_expires_at
            );


        const sameAsListingExpiry =
            listingExpiry &&
            Math.abs(
                promotionExpiry -
                listingExpiry
            ) <=
            5 *
            60 *
            1000;


        if (
            !sameAsListingExpiry
        ) {

            const listingStillActive =
                !isListingExpired(
                    listing
                );


            await safeSendMessage(

                listing.seller_telegram_id,

                `${emoji} ${label} promotion for @${listing.whatsapp_username} has ended.${listingStillActive ? "\n\nYour listing remains active." : ""}`
            );
        }


        await supabase
            .from("listings")
            .update(
                {
                    [expiredField]:
                        nowIso()
                }
            )
            .eq(
                "id",
                listing.id
            )
            .is(
                expiredField,
                null
            );
    }
}



/* =========================================================
   NOTIFICATION PREFERENCES
   ========================================================= */

const NOTIFICATION_KEYS = {
    chats:"chats",
    offers:"offers",
    support:"support",
    watchlist_updates:"watchlist_updates",
    price_drops:"price_drops",
    saved_searches:"saved_searches",
    seller_updates:"seller_updates"
};


async function getNotificationPreferences(
    telegramId
) {

    const id =
        Number(
            telegramId
        );


    if (
        !Number.isSafeInteger(id) ||
        id <= 0
    ) {

        return null;
    }


    const {
        data,
        error
    } =
        await supabase
            .from(
                "notification_preferences"
            )
            .select(
                "telegram_id,chats,offers,support,watchlist_updates,price_drops,saved_searches,seller_updates,updated_at"
            )
            .eq(
                "telegram_id",
                id
            )
            .maybeSingle();


    if (error) {

        console.error(
            "Notification preferences lookup:",
            error
        );

        return {
            telegram_id:id,
            chats:true,
            offers:true,
            support:true,
            watchlist_updates:true,
            price_drops:true,
            saved_searches:true,
            seller_updates:true
        };
    }


    if (data) {

        return data;
    }


    const defaults = {
        telegram_id:id,
        chats:true,
        offers:true,
        support:true,
        watchlist_updates:true,
        price_drops:true,
        saved_searches:true,
        seller_updates:true,
        updated_at:nowIso()
    };


    const {
        data:
            inserted,
        error:
            insertError
    } =
        await supabase
            .from(
                "notification_preferences"
            )
            .insert(
                defaults
            )
            .select(
                "telegram_id,chats,offers,support,watchlist_updates,price_drops,saved_searches,seller_updates,updated_at"
            )
            .single();


    if (insertError) {

        console.error(
            "Notification preferences create:",
            insertError
        );

        return defaults;
    }


    return inserted;
}


async function sendUserNotification(
    telegramId,
    key,
    text
) {

    const column =
        NOTIFICATION_KEYS[
            key
        ];


    if (!column) {

        return safeSendMessage(
            telegramId,
            text
        );
    }


    const preferences =
        await getNotificationPreferences(
            telegramId
        );


    if (
        preferences &&
        preferences[column] === false
    ) {

        return false;
    }


    return safeSendMessage(
        telegramId,
        text
    );
}


function safeSendChatMessage(
    telegramId,
    text
) {

    return sendUserNotification(
        telegramId,
        "chats",
        text
    );
}


function safeSendSupportMessage(
    telegramId,
    text
) {

    return sendUserNotification(
        telegramId,
        "support",
        text
    );
}


function safeSendOfferMessage(
    telegramId,
    text
) {

    return sendUserNotification(
        telegramId,
        "offers",
        text
    );
}


app.post(
    "/notification-settings/get",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok:false,
                        error:
                            auth.error
                    }
                );
        }


        const settings =
            await getNotificationPreferences(
                auth.user.telegram_id
            );


        res.json(
            {
                ok:true,
                settings
            }
        );
    }
);


app.post(
    "/notification-settings/update",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok:false,
                        error:
                            auth.error
                    }
                );
        }


        const current =
            await getNotificationPreferences(
                auth.user.telegram_id
            );


        const payload = {
            telegram_id:
                Number(
                    auth.user.telegram_id
                ),
            chats:
                req.body.chats === undefined
                    ? current?.chats !== false
                    : Boolean(req.body.chats),
            offers:
                req.body.offers === undefined
                    ? current?.offers !== false
                    : Boolean(req.body.offers),
            support:
                req.body.support === undefined
                    ? current?.support !== false
                    : Boolean(req.body.support),
            watchlist_updates:
                req.body.watchlist_updates === undefined
                    ? current?.watchlist_updates !== false
                    : Boolean(req.body.watchlist_updates),
            price_drops:
                req.body.price_drops === undefined
                    ? current?.price_drops !== false
                    : Boolean(req.body.price_drops),
            saved_searches:
                req.body.saved_searches === undefined
                    ? current?.saved_searches !== false
                    : Boolean(req.body.saved_searches),
            seller_updates:
                req.body.seller_updates === undefined
                    ? current?.seller_updates !== false
                    : Boolean(req.body.seller_updates),
            updated_at:
                nowIso()
        };


        const {
            data,
            error
        } =
            await supabase
                .from(
                    "notification_preferences"
                )
                .upsert(
                    payload,
                    {
                        onConflict:
                            "telegram_id"
                    }
                )
                .select(
                    "telegram_id,chats,offers,support,watchlist_updates,price_drops,saved_searches,seller_updates,updated_at"
                )
                .single();


        if (error) {

            console.error(
                "Notification settings update:",
                error
            );

            return res
                .status(500)
                .json(
                    {
                        ok:false,
                        error:
                            "notification_settings_update_failed"
                    }
                );
        }


        res.json(
            {
                ok:true,
                settings:data
            }
        );
    }
);


/* =========================================================
   SAVED SEARCHES
   ========================================================= */

const SAVED_SEARCH_CATEGORIES = [
    "all",
    "Business",
    "Brand",
    "Tech & AI",
    "Short",
    "Travel",
    "Finance",
    "Gaming",
    "Crypto",
    "Media",
    "Generic",
    "Other"
];

const SAVED_SEARCH_PROMOTIONS = [
    "all",
    "regular",
    "bump",
    "hot",
    "vip"
];


function normalizeSavedSearchInput(
    body
) {

    const searchQuery =
        String(
            body.search_query ||
            ""
        )
            .trim()
            .slice(
                0,
                64
            );


    const category =
        String(
            body.category ||
            "all"
        ).trim();


    const promotion =
        String(
            body.promotion ||
            "all"
        )
            .trim()
            .toLowerCase();


    const premiumOnly =
        Boolean(
            body.premium_only
        );


    const minText =
        String(
            body.min_price ??
            ""
        ).trim();


    const maxText =
        String(
            body.max_price ??
            ""
        ).trim();


    const minPrice =
        minText === ""
            ? null
            : Number(minText);


    const maxPrice =
        maxText === ""
            ? null
            : Number(maxText);


    if (
        !SAVED_SEARCH_CATEGORIES.includes(
            category
        ) ||
        !SAVED_SEARCH_PROMOTIONS.includes(
            promotion
        ) ||
        (
            minPrice !== null &&
            (
                !Number.isFinite(minPrice) ||
                minPrice < 0 ||
                minPrice > 100000000
            )
        ) ||
        (
            maxPrice !== null &&
            (
                !Number.isFinite(maxPrice) ||
                maxPrice < 0 ||
                maxPrice > 100000000
            )
        ) ||
        (
            minPrice !== null &&
            maxPrice !== null &&
            minPrice > maxPrice
        )
    ) {

        return {
            ok:false,
            error:
                "invalid_saved_search"
        };
    }


    let name =
        String(
            body.name ||
            ""
        )
            .trim()
            .slice(
                0,
                80
            );


    if (!name) {

        const parts = [];

        if (searchQuery) {
            parts.push(
                searchQuery
            );
        }

        if (
            category !==
            "all"
        ) {
            parts.push(
                category
            );
        }

        if (premiumOnly) {
            parts.push(
                "Premium"
            );
        }

        if (
            promotion !==
            "all"
        ) {
            parts.push(
                promotion.toUpperCase()
            );
        }

        if (
            minPrice !== null ||
            maxPrice !== null
        ) {
            parts.push(
                `$${minPrice ?? 0}–$${maxPrice ?? "∞"}`
            );
        }

        name =
            parts.join(
                " · "
            ) ||
            "All usernames";
    }


    return {
        ok:true,
        data:{
            name,
            search_query:
                searchQuery,
            category,
            promotion,
            premium_only:
                premiumOnly,
            min_price:
                minPrice,
            max_price:
                maxPrice
        }
    };
}


function savedSearchMatchesListing(
    search,
    listing
) {

    if (
        !listingIsPubliclyAvailable(
            listing
        )
    ) {

        return false;
    }


    const enriched =
        withPromotion(
            listing
        );


    const query =
        String(
            search.search_query ||
            ""
        )
            .trim()
            .toLowerCase();


    if (query) {

        const username =
            String(
                enriched.whatsapp_username ||
                ""
            ).toLowerCase();


        const normalizedQuery =
            query.replace(
                /^@/,
                ""
            );


        let queryMatches =
            username.includes(
                normalizedQuery
            );


        if (!queryMatches) {

            const lotQuery =
                query
                    .replace(
                        /^lot\s*#?\s*/i,
                        ""
                    )
                    .replace(
                        /\s+/g,
                        ""
                    );


            if (
                /^\d+$/.test(
                    lotQuery
                ) &&
                Number.isSafeInteger(
                    Number(
                        enriched.listing_number
                    )
                )
            ) {

                const raw =
                    String(
                        Number(
                            enriched.listing_number
                        )
                    );

                const padded =
                    raw.padStart(
                        6,
                        "0"
                    );

                const normalizedLot =
                    lotQuery.replace(
                        /^0+(?=\d)/,
                        ""
                    );

                queryMatches =
                    raw === normalizedLot ||
                    padded === lotQuery;
            }
        }


        if (!queryMatches) {

            return false;
        }
    }


    if (
        search.category &&
        search.category !==
        "all" &&
        String(
            enriched.category ||
            "Other"
        ) !==
        String(
            search.category
        )
    ) {

        return false;
    }


    if (
        search.premium_only &&
        !enriched.is_premium_name
    ) {

        return false;
    }


    const promotion =
        String(
            search.promotion ||
            "all"
        );


    if (
        promotion !==
        "all"
    ) {

        if (
            promotion ===
            "regular"
        ) {

            if (
                enriched.promotion_type
            ) {

                return false;
            }

        } else if (
            String(
                enriched.promotion_type ||
                ""
            ) !==
            promotion
        ) {

            return false;
        }
    }


    const price =
        Number(
            enriched.asking_price
        );


    if (
        search.min_price !== null &&
        search.min_price !== undefined &&
        price <
        Number(
            search.min_price
        )
    ) {

        return false;
    }


    if (
        search.max_price !== null &&
        search.max_price !== undefined &&
        price >
        Number(
            search.max_price
        )
    ) {

        return false;
    }


    return true;
}


app.post(
    "/saved-searches/list",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(auth.status)
                .json(
                    {
                        ok:false,
                        error:auth.error
                    }
                );
        }


        const {
            data,
            error
        } =
            await supabase
                .from(
                    "saved_searches"
                )
                .select(
                    "id,name,search_query,category,promotion,premium_only,min_price,max_price,alerts_enabled,created_at,updated_at"
                )
                .eq(
                    "telegram_id",
                    auth.user.telegram_id
                )
                .order(
                    "created_at",
                    {
                        ascending:false
                    }
                );


        if (error) {

            return res
                .status(500)
                .json(
                    {
                        ok:false,
                        error:
                            "saved_searches_load_failed"
                    }
                );
        }


        res.json(
            {
                ok:true,
                searches:
                    data || []
            }
        );
    }
);


app.post(
    "/saved-searches/create",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(auth.status)
                .json(
                    {
                        ok:false,
                        error:auth.error
                    }
                );
        }


        const security =
            await securityRateLimit(
                auth.user,
                "saved_search_create"
            );


        if (!security.ok) {
            return sendRateLimitResponse(
                res,
                security
            );
        }


        const validation =
            normalizeSavedSearchInput(
                req.body
            );


        if (!validation.ok) {

            return res
                .status(400)
                .json(
                    {
                        ok:false,
                        error:
                            validation.error
                    }
                );
        }


        const {
            count,
            error:
                countError
        } =
            await supabase
                .from(
                    "saved_searches"
                )
                .select(
                    "id",
                    {
                        head:true,
                        count:"exact"
                    }
                )
                .eq(
                    "telegram_id",
                    auth.user.telegram_id
                );


        if (countError) {

            return res
                .status(500)
                .json(
                    {
                        ok:false,
                        error:
                            "saved_search_create_failed"
                    }
                );
        }


        if (
            Number(
                count ||
                0
            ) >= 20
        ) {

            return res
                .status(409)
                .json(
                    {
                        ok:false,
                        error:
                            "saved_search_limit"
                    }
                );
        }


        const {
            data,
            error
        } =
            await supabase
                .from(
                    "saved_searches"
                )
                .insert(
                    {
                        telegram_id:
                            auth.user.telegram_id,
                        ...validation.data,
                        alerts_enabled:true,
                        updated_at:nowIso()
                    }
                )
                .select(
                    "id,name,search_query,category,promotion,premium_only,min_price,max_price,alerts_enabled,created_at,updated_at"
                )
                .single();


        if (error) {

            return res
                .status(500)
                .json(
                    {
                        ok:false,
                        error:
                            "saved_search_create_failed"
                    }
                );
        }


        res.json(
            {
                ok:true,
                search:data
            }
        );
    }
);


app.post(
    "/saved-searches/toggle",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(auth.status)
                .json(
                    {
                        ok:false,
                        error:auth.error
                    }
                );
        }


        const id =
            String(
                req.body.search_id ||
                ""
            ).trim();


        const enabled =
            Boolean(
                req.body.alerts_enabled
            );


        if (!id) {

            return res
                .status(400)
                .json(
                    {
                        ok:false,
                        error:
                            "invalid_saved_search"
                    }
                );
        }


        const {
            data,
            error
        } =
            await supabase
                .from(
                    "saved_searches"
                )
                .update(
                    {
                        alerts_enabled:
                            enabled,
                        updated_at:
                            nowIso()
                    }
                )
                .eq(
                    "id",
                    id
                )
                .eq(
                    "telegram_id",
                    auth.user.telegram_id
                )
                .select(
                    "id,alerts_enabled"
                )
                .maybeSingle();


        if (
            error ||
            !data
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok:false,
                        error:
                            "saved_search_not_found"
                    }
                );
        }


        res.json(
            {
                ok:true,
                search:data
            }
        );
    }
);


app.post(
    "/saved-searches/delete",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(auth.status)
                .json(
                    {
                        ok:false,
                        error:auth.error
                    }
                );
        }


        const id =
            String(
                req.body.search_id ||
                ""
            ).trim();


        if (!id) {

            return res
                .status(400)
                .json(
                    {
                        ok:false,
                        error:
                            "invalid_saved_search"
                    }
                );
        }


        const {
            error
        } =
            await supabase
                .from(
                    "saved_searches"
                )
                .delete()
                .eq(
                    "id",
                    id
                )
                .eq(
                    "telegram_id",
                    auth.user.telegram_id
                );


        if (error) {

            return res
                .status(500)
                .json(
                    {
                        ok:false,
                        error:
                            "saved_search_delete_failed"
                    }
                );
        }


        res.json(
            {
                ok:true
            }
        );
    }
);


async function processSavedSearchNotifications() {

    try {

        const {
            data:
                searches,
            error:
                searchError
        } =
            await supabase
                .from(
                    "saved_searches"
                )
                .select(
                    "id,telegram_id,name,search_query,category,promotion,premium_only,min_price,max_price,alerts_enabled,created_at"
                )
                .eq(
                    "alerts_enabled",
                    true
                )
                .limit(500);


        if (
            searchError ||
            !searches?.length
        ) {

            if (searchError) {
                console.error(
                    "Saved search processor searches:",
                    searchError
                );
            }

            return;
        }


        const {
            data:
                listings,
            error:
                listingError
        } =
            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username,asking_price,category,is_premium_name,status,is_paused,is_frozen,created_at,bump_until,hot_until,vip_until,bump_promoted_at,hot_promoted_at,vip_promoted_at,listing_plan,listing_period_started_at,listing_expires_at"
                )
                .eq(
                    "status",
                    "active"
                )
                .eq(
                    "is_paused",
                    false
                )
                .eq(
                    "is_frozen",
                    false
                )
                .order(
                    "created_at",
                    {
                        ascending:false
                    }
                )
                .limit(500);


        if (listingError) {

            console.error(
                "Saved search processor listings:",
                listingError
            );

            return;
        }


        for (
            const search of
            searches
        ) {

            const searchCreated =
                timeMs(
                    search.created_at
                );


            for (
                const listing of
                listings || []
            ) {

                if (
                    Number(
                        listing.seller_telegram_id
                    ) ===
                    Number(
                        search.telegram_id
                    )
                ) {

                    continue;
                }


                const availabilityStarted =
                    timeMs(
                        listing.listing_period_started_at ||
                        listing.created_at
                    );


                if (
                    searchCreated &&
                    availabilityStarted &&
                    availabilityStarted <
                    searchCreated
                ) {

                    continue;
                }


                if (
                    !savedSearchMatchesListing(
                        search,
                        listing
                    )
                ) {

                    continue;
                }


                const {
                    error:
                        matchError
                } =
                    await supabase
                        .from(
                            "saved_search_matches"
                        )
                        .insert(
                            {
                                search_id:
                                    search.id,
                                listing_id:
                                    listing.id,
                                notified_at:
                                    nowIso()
                            }
                        );


                if (matchError) {

                    if (
                        matchError.code ===
                        "23505"
                    ) {

                        continue;
                    }


                    console.error(
                        "Saved search match create:",
                        matchError
                    );

                    continue;
                }


                const lot =
                    Number.isSafeInteger(
                        Number(
                            listing.listing_number
                        )
                    )
                        ? `LOT #${String(Number(listing.listing_number)).padStart(6,"0")} · `
                        : "";


                await sendUserNotification(
                    search.telegram_id,
                    "saved_searches",
                    `📌 New match for your saved search “${search.name}”\n\n${lot}@${listing.whatsapp_username}\n$${Number(listing.asking_price).toLocaleString("en-US")}\n\nOpen Handle Market → Profile → Saved Searches.`
                );
            }
        }

    } catch (error) {

        console.error(
            "Saved search notification processor:",
            error
        );
    }
}


/* =========================================================
   DISCOVERY RANKINGS
   Rankings use real views, likes and watchlist saves only.
   ========================================================= */

app.get(
    "/discover",
    async (req, res) => {

        const {
            data:
                listings,
            error
        } =
            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username,asking_price,price_type,minimum_offer,currency,category,description,is_premium_name,is_featured,views_count,likes_count,created_at,bump_until,hot_until,vip_until,bump_promoted_at,hot_promoted_at,vip_promoted_at,status,is_paused,is_frozen,listing_plan,listing_period_started_at,listing_expires_at"
                )
                .eq(
                    "status",
                    "active"
                )
                .eq(
                    "is_paused",
                    false
                )
                .eq(
                    "is_frozen",
                    false
                )
                .limit(500);


        if (error) {

            return res
                .status(500)
                .json(
                    {
                        ok:false,
                        error:
                            "discover_load_failed"
                    }
                );
        }


        const visible =
            (
                listings ||
                []
            )
                .filter(
                    listing =>
                        listingIsPubliclyAvailable(
                            listing
                        )
                )
                .map(
                    withPromotion
                );


        if (!visible.length) {

            return res.json(
                {
                    ok:true,
                    trending:[],
                    most_viewed:[],
                    most_liked:[],
                    most_watched:[]
                }
            );
        }


        const ids =
            visible.map(
                row =>
                    row.id
            );


        const {
            data:
                watches,
            error:
                watchesError
        } =
            await supabase
                .from("watchlist")
                .select(
                    "listing_id"
                )
                .in(
                    "listing_id",
                    ids
                );


        if (watchesError) {

            console.error(
                "Discover watch counts:",
                watchesError
            );
        }


        const watchCounts =
            countByListingId(
                watches ||
                []
            );


        const ranked =
            visible.map(
                row => {

                    const ageHours =
                        Math.max(
                            1,
                            (
                                Date.now() -
                                timeMs(
                                    row.created_at
                                )
                            ) /
                            3600000
                        );


                    const views =
                        Number(
                            row.views_count ||
                            0
                        );


                    const likes =
                        Number(
                            row.likes_count ||
                            0
                        );


                    const watched =
                        Number(
                            watchCounts.get(
                                String(
                                    row.id
                                )
                            ) ||
                            0
                        );


                    return {
                        ...row,
                        __watch_count:
                            watched,
                        __trend_score:
                            (
                                views +
                                likes * 4 +
                                watched * 6
                            ) /
                            Math.pow(
                                ageHours + 6,
                                0.35
                            )
                    };
                }
            );


        const topIds =
            rows =>
                rows
                    .slice(
                        0,
                        6
                    )
                    .map(
                        row =>
                            String(
                                row.id
                            )
                    );


        const trendingIds =
            topIds(
                [...ranked].sort(
                    (a,b) =>
                        b.__trend_score -
                        a.__trend_score
                )
            );


        const viewedIds =
            topIds(
                [...ranked].sort(
                    (a,b) =>
                        Number(b.views_count || 0) -
                        Number(a.views_count || 0)
                )
            );


        const likedIds =
            topIds(
                [...ranked].sort(
                    (a,b) =>
                        Number(b.likes_count || 0) -
                        Number(a.likes_count || 0)
                )
            );


        const watchedIds =
            topIds(
                [...ranked].sort(
                    (a,b) =>
                        b.__watch_count -
                        a.__watch_count
                )
            );


        const cleanRows =
            ranked.map(
                row => {

                    const {
                        __watch_count,
                        __trend_score,
                        ...publicRow
                    } = row;

                    return publicRow;
                }
            );


        const withSellers =
            await attachPublicSellerProfiles(
                cleanRows
            );


        const rowMap =
            new Map(
                withSellers.map(
                    row => [
                        String(row.id),
                        row
                    ]
                )
            );


        const rowsFor =
            idsToUse =>
                idsToUse
                    .map(
                        id =>
                            rowMap.get(id)
                    )
                    .filter(Boolean);


        res.json(
            {
                ok:true,
                server_time:
                    nowIso(),
                trending:
                    rowsFor(
                        trendingIds
                    ),
                most_viewed:
                    rowsFor(
                        viewedIds
                    ),
                most_liked:
                    rowsFor(
                        likedIds
                    ),
                most_watched:
                    rowsFor(
                        watchedIds
                    )
            }
        );
    }
);


/* =========================================================
   V42 PERSONALIZED RECOMMENDATIONS
   Uses only existing marketplace activity: views, likes,
   watchlist, saved searches and seller follows.
   ========================================================= */

function medianNumber(
    values
) {

    const numbers =
        (values || [])
            .map(Number)
            .filter(
                value =>
                    Number.isFinite(value) &&
                    value > 0
            )
            .sort(
                (a,b) =>
                    a - b
            );


    if (!numbers.length) {
        return null;
    }


    const middle =
        Math.floor(
            numbers.length / 2
        );


    if (
        numbers.length % 2
    ) {
        return numbers[middle];
    }


    return (
        numbers[middle - 1] +
        numbers[middle]
    ) / 2;
}


app.post(
    "/recommendations",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {
            return res
                .status(auth.status)
                .json({
                    ok:false,
                    error:auth.error
                });
        }


        const userId =
            Number(
                auth.user.telegram_id
            );


        try {

            const [
                viewsResult,
                likesResult,
                watchResult,
                searchesResult,
                followsResult
            ] =
                await Promise.all([

                    supabase
                        .from("listing_views")
                        .select("listing_id")
                        .eq(
                            "viewer_telegram_id",
                            userId
                        )
                        .limit(300),

                    supabase
                        .from("listing_likes")
                        .select("listing_id")
                        .eq(
                            "user_telegram_id",
                            userId
                        )
                        .limit(300),

                    supabase
                        .from("watchlist")
                        .select("listing_id")
                        .eq(
                            "telegram_id",
                            userId
                        )
                        .limit(300),

                    supabase
                        .from("saved_searches")
                        .select(
                            "category,min_price,max_price,premium_only"
                        )
                        .eq(
                            "telegram_id",
                            userId
                        )
                        .limit(50),

                    supabase
                        .from("seller_follows")
                        .select("seller_telegram_id")
                        .eq(
                            "follower_telegram_id",
                            userId
                        )
                        .limit(100)
                ]);


            const viewedIds =
                new Set(
                    (viewsResult.data || [])
                        .map(row => String(row.listing_id))
                );

            const likedIds =
                new Set(
                    (likesResult.data || [])
                        .map(row => String(row.listing_id))
                );

            const watchedIds =
                new Set(
                    (watchResult.data || [])
                        .map(row => String(row.listing_id))
                );

            const interactedIds = [
                ...new Set([
                    ...viewedIds,
                    ...likedIds,
                    ...watchedIds
                ])
            ];


            let interactedListings = [];


            if (interactedIds.length) {

                const result =
                    await supabase
                        .from("listings")
                        .select(
                            "id,category,asking_price,is_premium_name"
                        )
                        .in(
                            "id",
                            interactedIds
                        );

                interactedListings =
                    result.data || [];
            }


            const categoryWeights =
                new Map();

            const priceSignals = [];


            for (
                const listing of
                interactedListings
            ) {

                const id =
                    String(listing.id);

                let weight = 0;

                if (viewedIds.has(id)) {
                    weight += 1;
                }

                if (likedIds.has(id)) {
                    weight += 3;
                }

                if (watchedIds.has(id)) {
                    weight += 5;
                }


                const category =
                    String(
                        listing.category ||
                        "Other"
                    );


                categoryWeights.set(
                    category,
                    Number(
                        categoryWeights.get(category) ||
                        0
                    ) + weight
                );


                const price =
                    Number(
                        listing.asking_price
                    );


                if (
                    Number.isFinite(price) &&
                    price > 0
                ) {

                    for (
                        let i = 0;
                        i < Math.max(1, weight);
                        i++
                    ) {
                        priceSignals.push(price);
                    }
                }
            }


            let premiumPreference = 0;


            for (
                const search of
                searchesResult.data || []
            ) {

                const category =
                    String(
                        search.category ||
                        "all"
                    );


                if (
                    category !== "all"
                ) {
                    categoryWeights.set(
                        category,
                        Number(
                            categoryWeights.get(category) ||
                            0
                        ) + 6
                    );
                }


                const min =
                    Number(search.min_price);

                const max =
                    Number(search.max_price);


                if (
                    Number.isFinite(min) &&
                    min > 0 &&
                    Number.isFinite(max) &&
                    max >= min
                ) {
                    priceSignals.push(
                        (min + max) / 2
                    );
                } else if (
                    Number.isFinite(min) &&
                    min > 0
                ) {
                    priceSignals.push(min);
                } else if (
                    Number.isFinite(max) &&
                    max > 0
                ) {
                    priceSignals.push(max);
                }


                if (
                    search.premium_only
                ) {
                    premiumPreference += 1;
                }
            }


            const followedSellerIds =
                new Set(
                    (followsResult.data || [])
                        .map(
                            row =>
                                Number(
                                    row.seller_telegram_id
                                )
                        )
                        .filter(Boolean)
                );


            const targetPrice =
                medianNumber(
                    priceSignals
                );


            const hasSignals =
                interactedIds.length > 0 ||
                categoryWeights.size > 0 ||
                priceSignals.length > 0 ||
                followedSellerIds.size > 0 ||
                premiumPreference > 0;


            const {
                data:
                    candidates,
                error
            } =
                await supabase
                    .from("listings")
                    .select(
                        "id,seller_telegram_id,listing_number,whatsapp_username,asking_price,price_type,minimum_offer,currency,category,description,is_premium_name,is_featured,views_count,likes_count,created_at,bump_until,hot_until,vip_until,bump_promoted_at,hot_promoted_at,vip_promoted_at,status,is_paused,is_frozen,listing_plan,listing_period_started_at,listing_expires_at"
                    )
                    .eq(
                        "status",
                        "active"
                    )
                    .eq(
                        "is_paused",
                        false
                    )
                    .eq(
                        "is_frozen",
                        false
                    )
                    .neq(
                        "seller_telegram_id",
                        userId
                    )
                    .limit(500);


            if (error) {
                throw error;
            }


            const ranked =
                (candidates || [])
                    .filter(
                        listing =>
                            listingIsPubliclyAvailable(
                                listing
                            )
                    )
                    .map(
                        listing => {

                            const category =
                                String(
                                    listing.category ||
                                    "Other"
                                );

                            const categoryScore =
                                Number(
                                    categoryWeights.get(category) ||
                                    0
                                );

                            const sellerFollowed =
                                followedSellerIds.has(
                                    Number(
                                        listing.seller_telegram_id
                                    )
                                );

                            const price =
                                Number(
                                    listing.asking_price ||
                                    0
                                );

                            let priceScore = 0;


                            if (
                                targetPrice &&
                                price > 0
                            ) {

                                const distance =
                                    Math.abs(
                                        Math.log(
                                            price /
                                            targetPrice
                                        )
                                    );

                                priceScore =
                                    Math.max(
                                        0,
                                        4 -
                                        distance * 3
                                    );
                            }


                            const ageHours =
                                Math.max(
                                    0,
                                    (
                                        Date.now() -
                                        timeMs(
                                            listing.created_at
                                        )
                                    ) /
                                    3600000
                                );

                            const recencyScore =
                                ageHours <= 72
                                    ? 1.5
                                    : ageHours <= 168
                                        ? 0.8
                                        : 0;

                            const popularityScore =
                                Math.log1p(
                                    Number(
                                        listing.views_count ||
                                        0
                                    )
                                ) * 0.25 +
                                Math.log1p(
                                    Number(
                                        listing.likes_count ||
                                        0
                                    )
                                ) * 0.8;

                            const premiumScore =
                                premiumPreference > 0 &&
                                listing.is_premium_name
                                    ? 2
                                    : 0;

                            const interactionPenalty =
                                interactedIds.includes(
                                    String(listing.id)
                                )
                                    ? 1.25
                                    : 0;

                            const score =
                                categoryScore +
                                priceScore +
                                recencyScore +
                                popularityScore +
                                premiumScore +
                                (sellerFollowed ? 6 : 0) -
                                interactionPenalty;


                            let reason =
                                "Popular now";


                            if (sellerFollowed) {
                                reason =
                                    "Seller you follow";
                            } else if (
                                categoryScore > 0
                            ) {
                                reason =
                                    `Because you like ${category}`;
                            } else if (
                                priceScore >= 2
                            ) {
                                reason =
                                    "In your usual price range";
                            } else if (
                                listing.is_premium_name &&
                                premiumPreference > 0
                            ) {
                                reason =
                                    "Matches your Premium searches";
                            }


                            return {
                                ...listing,
                                recommendation_reason:
                                    reason,
                                __recommendation_score:
                                    score
                            };
                        }
                    )
                    .sort(
                        (a,b) =>
                            b.__recommendation_score -
                            a.__recommendation_score
                    )
                    .slice(
                        0,
                        12
                    )
                    .map(
                        row => {

                            const {
                                __recommendation_score,
                                ...clean
                            } = row;

                            return clean;
                        }
                    );


            const publicRows =
                await attachPublicSellerProfiles(
                    ranked
                );


            res.json({
                ok:true,
                personalized:hasSignals,
                listings:publicRows
            });

        } catch (error) {

            console.error(
                "Recommendations:",
                error
            );

            await logSystemError(
                "recommendations",
                error
            );

            res
                .status(500)
                .json({
                    ok:false,
                    error:
                        "recommendations_load_failed"
                });
        }
    }
);


/* =========================================================
   V41 SECURITY / ANTI-ABUSE
   Durable rate limits are stored in Supabase via the
   hm_security_check_and_record RPC created by the v41 SQL.
   ========================================================= */

const SECURITY_LIMITS = {

    listing_create: {
        short_limit: 6,
        short_window_seconds: 3600,
        long_limit: 12,
        long_window_seconds: 86400,
        retry_after_seconds: 3600
    },

    listing_edit: {
        short_limit: 8,
        short_window_seconds: 900,
        long_limit: 30,
        long_window_seconds: 86400,
        retry_after_seconds: 900
    },

    contact_change: {
        short_limit: 2,
        short_window_seconds: 3600,
        long_limit: 5,
        long_window_seconds: 86400,
        retry_after_seconds: 3600
    },

    offer_create: {
        short_limit: 4,
        short_window_seconds: 600,
        long_limit: 20,
        long_window_seconds: 3600,
        retry_after_seconds: 600
    },

    chat_send: {
        short_limit: 20,
        short_window_seconds: 60,
        long_limit: 200,
        long_window_seconds: 3600,
        retry_after_seconds: 60
    },

    support_create: {
        short_limit: 2,
        short_window_seconds: 600,
        long_limit: 5,
        long_window_seconds: 86400,
        retry_after_seconds: 600
    },

    support_send: {
        short_limit: 12,
        short_window_seconds: 60,
        long_limit: 120,
        long_window_seconds: 3600,
        retry_after_seconds: 60
    },

    report_create: {
        short_limit: 3,
        short_window_seconds: 3600,
        long_limit: 10,
        long_window_seconds: 86400,
        retry_after_seconds: 3600
    },

    saved_search_create: {
        short_limit: 8,
        short_window_seconds: 3600,
        long_limit: 25,
        long_window_seconds: 86400,
        retry_after_seconds: 3600
    },

    contact_unlock_create: {
        short_limit: 12,
        short_window_seconds: 3600,
        long_limit: 40,
        long_window_seconds: 86400,
        retry_after_seconds: 3600
    },

    seller_follow_toggle: {
        short_limit: 20,
        short_window_seconds: 600,
        long_limit: 80,
        long_window_seconds: 86400,
        retry_after_seconds: 600
    }
};


function sanitizedLogText(
    value
) {

    let text =
        String(
            value ??
            ""
        );


    for (
        const secret of
        [
            BOT_TOKEN,
            SUPABASE_SECRET_KEY,
            TELEGRAM_WEBHOOK_SECRET
        ]
    ) {

        if (
            secret &&
            String(secret).length >= 8
        ) {

            text =
                text.split(
                    String(secret)
                ).join(
                    "[REDACTED]"
                );
        }
    }


    return text.slice(
        0,
        1500
    );
}


async function recordSecurityEvent(
    telegramId,
    eventType,
    severity = "low",
    targetType = null,
    targetId = null,
    details = null
) {

    try {

        await supabase
            .from(
                "security_events"
            )
            .insert(
                {
                    telegram_id:
                        Number(
                            telegramId ||
                            0
                        ) ||
                        null,

                    event_type:
                        String(
                            eventType ||
                            "security_event"
                        ).slice(0,100),

                    severity:
                        [
                            "low",
                            "medium",
                            "high"
                        ].includes(
                            severity
                        )
                            ? severity
                            : "low",

                    target_type:
                        targetType
                            ? String(targetType).slice(0,50)
                            : null,

                    target_id:
                        targetId
                            ? String(targetId).slice(0,150)
                            : null,

                    details:
                        details ||
                        null
                }
            );

    } catch (error) {

        console.error(
            "Security event log:",
            error
        );
    }
}


async function logSystemError(
    scope,
    error,
    details = null
) {

    try {

        const code =
            sanitizedLogText(
                error?.code ||
                error?.name ||
                "error"
            );

        const message =
            sanitizedLogText(
                error?.message ||
                error ||
                "Unknown error"
            );


        await supabase
            .from(
                "system_error_log"
            )
            .insert(
                {
                    scope:
                        String(
                            scope ||
                            "server"
                        ).slice(0,100),

                    error_code:
                        code.slice(0,100),

                    message,

                    details:
                        details ||
                        null
                }
            );

    } catch (logError) {

        console.error(
            "System error logger:",
            logError
        );
    }
}


async function securityRateLimit(
    user,
    action,
    targetId = null
) {

    /* Admin actions are already role-protected and are exempt. */
    if (
        user?.is_admin
    ) {
        return {
            ok:true
        };
    }


    const config =
        SECURITY_LIMITS[
            action
        ];


    if (!config) {
        return {
            ok:true
        };
    }


    try {

        const {
            data,
            error
        } =
            await supabase
                .rpc(
                    "hm_security_check_and_record",
                    {
                        p_telegram_id:
                            Number(
                                user.telegram_id
                            ),

                        p_action:
                            action,

                        p_target_id:
                            targetId
                                ? String(targetId)
                                : null,

                        p_short_limit:
                            config.short_limit,

                        p_short_window_seconds:
                            config.short_window_seconds,

                        p_long_limit:
                            config.long_limit,

                        p_long_window_seconds:
                            config.long_window_seconds
                    }
                );


        if (error) {

            console.error(
                "Security rate limit RPC:",
                error
            );

            await logSystemError(
                "security_rate_limit",
                error,
                {
                    action
                }
            );

            /* Fail open if the security table/RPC is temporarily unavailable. */
            return {
                ok:true
            };
        }


        if (!data) {

            await recordSecurityEvent(
                user.telegram_id,
                "rate_limit_hit",
                "low",
                "action",
                action,
                {
                    target_id:
                        targetId ||
                        null,
                    short_limit:
                        config.short_limit,
                    long_limit:
                        config.long_limit
                }
            );


            return {
                ok:false,
                retry_after_seconds:
                    config.retry_after_seconds ||
                    60
            };
        }


        return {
            ok:true
        };

    } catch (error) {

        console.error(
            "Security limiter:",
            error
        );

        await logSystemError(
            "security_rate_limit",
            error,
            {
                action
            }
        );

        return {
            ok:true
        };
    }
}


function sendRateLimitResponse(
    res,
    result
) {

    return res
        .status(429)
        .json(
            {
                ok:false,
                error:
                    "rate_limited",
                retry_after_seconds:
                    Number(
                        result?.retry_after_seconds ||
                        60
                    )
            }
        );
}


async function detectDuplicateUsernameRisk(
    listing
) {

    if (
        !listing?.id ||
        !listing?.whatsapp_username
    ) {
        return [];
    }


    try {

        const {
            data,
            error
        } =
            await supabase
                .from("listings")
                .select(
                    "id,listing_number,seller_telegram_id,whatsapp_username,status,created_at"
                )
                .ilike(
                    "whatsapp_username",
                    String(
                        listing.whatsapp_username
                    )
                )
                .neq(
                    "id",
                    listing.id
                )
                .neq(
                    "seller_telegram_id",
                    Number(
                        listing.seller_telegram_id ||
                        0
                    )
                )
                .in(
                    "status",
                    [
                        "pending",
                        "active",
                        "reserved"
                    ]
                )
                .limit(10);


        if (error) {

            await logSystemError(
                "duplicate_username_check",
                error,
                {
                    listing_id:
                        listing.id
                }
            );

            return [];
        }


        const duplicates =
            data ||
            [];


        if (!duplicates.length) {
            return [];
        }


        await ensureRiskFlag(
            listing.id,
            "duplicate_username",
            "high",
            {
                username:
                    listing.whatsapp_username,
                matches:
                    duplicates.map(
                        row => ({
                            listing_id:
                                row.id,
                            listing_number:
                                row.listing_number,
                            seller_telegram_id:
                                row.seller_telegram_id,
                            status:
                                row.status
                        })
                    )
            }
        );


        await recordSecurityEvent(
            listing.seller_telegram_id,
            "duplicate_username_submission",
            "medium",
            "listing",
            listing.id,
            {
                username:
                    listing.whatsapp_username,
                matches:
                    duplicates.map(
                        row =>
                            row.listing_number ||
                            row.id
                    )
            }
        );


        await notifyAdmins(
            `⚠️ Duplicate username detected\n\nNew listing: @${listing.whatsapp_username}${listing.listing_number ? ` · LOT #${String(listing.listing_number).padStart(6,"0")}` : ""}\nExisting matching listing(s): ${duplicates.map(row => row.listing_number ? `LOT #${String(row.listing_number).padStart(6,"0")}` : row.id).join(", ")}\n\nThis is a review flag only. No seller was automatically blocked.`
        );


        return duplicates;

    } catch (error) {

        await logSystemError(
            "duplicate_username_check",
            error,
            {
                listing_id:
                    listing.id
            }
        );

        return [];
    }
}


async function maybeFlagFrequentListingChanges(
    listingId,
    sellerTelegramId
) {

    try {

        const oneDayAgo =
            new Date(
                Date.now() -
                24 * 60 * 60 * 1000
            ).toISOString();

        const sevenDaysAgo =
            new Date(
                Date.now() -
                7 * 24 * 60 * 60 * 1000
            ).toISOString();


        const [
            priceResult,
            contactResult
        ] =
            await Promise.all([

                supabase
                    .from(
                        "listing_change_history"
                    )
                    .select(
                        "id",
                        {
                            head:true,
                            count:"exact"
                        }
                    )
                    .eq(
                        "listing_id",
                        listingId
                    )
                    .eq(
                        "change_type",
                        "price"
                    )
                    .gte(
                        "created_at",
                        oneDayAgo
                    ),

                supabase
                    .from(
                        "listing_change_history"
                    )
                    .select(
                        "id",
                        {
                            head:true,
                            count:"exact"
                        }
                    )
                    .eq(
                        "listing_id",
                        listingId
                    )
                    .eq(
                        "change_type",
                        "contact"
                    )
                    .gte(
                        "created_at",
                        sevenDaysAgo
                    )
            ]);


        if (
            Number(
                priceResult.count ||
                0
            ) >= 5
        ) {

            await ensureRiskFlag(
                listingId,
                "frequent_price_changes",
                "medium",
                {
                    changes_24h:
                        Number(
                            priceResult.count ||
                            0
                        )
                }
            );

            await recordSecurityEvent(
                sellerTelegramId,
                "frequent_price_changes",
                "low",
                "listing",
                listingId,
                {
                    changes_24h:
                        Number(
                            priceResult.count ||
                            0
                        )
                }
            );
        }


        if (
            Number(
                contactResult.count ||
                0
            ) >= 3
        ) {

            await ensureRiskFlag(
                listingId,
                "frequent_contact_changes",
                "high",
                {
                    changes_7d:
                        Number(
                            contactResult.count ||
                            0
                        )
                }
            );

            await recordSecurityEvent(
                sellerTelegramId,
                "frequent_contact_changes",
                "medium",
                "listing",
                listingId,
                {
                    changes_7d:
                        Number(
                            contactResult.count ||
                            0
                        )
                }
            );
        }

    } catch (error) {

        await logSystemError(
            "frequent_change_check",
            error,
            {
                listing_id:
                    listingId
            }
        );
    }
}


/* =========================================================
   HEALTH
   ========================================================= */

app.get(
    "/health",
    (req, res) => {

        res.json(
            {
                ok: true,

                service:
                    "Handle Market API",

                version:
                    "v47-production-pricing"
            }
        );
    }
);


app.get(
    "/db-health",
    async (req, res) => {

        if (!supabase) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        database:
                            "not_configured"
                    }
                );
        }


        const {
            error
        } =
            await supabase
                .from("users")
                .select(
                    "telegram_id",
                    {
                        head: true,
                        count: "exact"
                    }
                );


        if (error) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        database:
                            "error",

                        message:
                            error.message
                    }
                );
        }


        res.json(
            {
                ok: true,
                database:
                    "connected"
            }
        );
    }
);


/* =========================================================
   AUTH
   ========================================================= */

app.post(
    "/auth",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        let referral =
            null;


        try {

            const referralCode =
                v46NormalizeReferralCode(
                    req.body.referral_code
                );


            await v46EnsureReferralProfile(
                auth.user.telegram_id
            );


            if (
                referralCode
            ) {

                await v46RegisterReferral(
                    auth.user.telegram_id,
                    referralCode
                );
            }


            referral =
                await v46ReferralStatus(
                    auth.user.telegram_id
                );

        } catch (error) {

            await logSystemError(
                "v46_auth_referral",
                error,
                {
                    telegram_id:
                        auth.user.telegram_id
                }
            );
        }


        const u =
            auth.user;


        const p =
            u.seller_profile;


        res.json(
            {
                ok: true,

                user: {

                    id:
                        u.telegram_id,

                    first_name:
                        u.first_name,

                    last_name:
                        u.last_name,

                    username:
                        u.telegram_username,

                    language_code:
                        u.language_code,

                    photo_url:
                        u.photo_url,

                    is_admin:
                        Boolean(
                            u.is_admin
                        ),

                    admin_role:
                        u.is_admin
                            ? (
                                [
                                    "owner",
                                    "moderator",
                                    "support"
                                ].includes(
                                    String(
                                        u.admin_role ||
                                        ""
                                    ).toLowerCase()
                                )
                                    ? String(
                                        u.admin_role
                                    ).toLowerCase()
                                    : "owner"
                            )
                            : null,

                    ui_language:
                        [
                            "en",
                            "ru"
                        ].includes(
                            String(
                                u.ui_language ||
                                ""
                            ).toLowerCase()
                        )
                            ? String(
                                u.ui_language
                            ).toLowerCase()
                            : String(
                                u.language_code ||
                                ""
                            )
                                .toLowerCase()
                                .startsWith(
                                    "ru"
                                )
                                    ? "ru"
                                    : "en",

                    free_listing_used:
                        Boolean(
                            u.free_listing_used
                        ),

                    free_listing_available:
                        !Boolean(
                            u.free_listing_used
                        ),

                    seller_profile_id:
                        p?.id ||
                        null,

                    seller_profile_bio:
                        p?.bio ||
                        "",

                    seller_profile_is_public:
                        Boolean(
                            p?.is_public
                        )
                },

                listing_price_stars:
                    PAID_LISTING_PRICE_STARS,

                listing_renewal_price_stars:
                    LISTING_RENEWAL_PRICE_STARS,

                listing_renewal_price_usd:
                    LISTING_RENEWAL_PRICE_USD,

                free_listing_duration_hours:
                    FREE_LISTING_DURATION_HOURS,

                paid_listing_duration_days:
                    PAID_LISTING_DURATION_DAYS,

                contact_unlock_price_stars:
                    CONTACT_UNLOCK_PRICE_STARS,

                wanted_price_stars:
                    WANTED_PRICE_STARS,

                promotion_test_mode:
                    PROMOTION_TEST_MODE,

                promotion_prices:
                    promotionPricesForClient(),

                referral
            }
        );
    }
);


/* =========================================================
   LISTING CREATE / PAYMENT
   ========================================================= */

app.post(
    "/listing-payment/create",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        const createSecurity =
            await securityRateLimit(
                auth.user,
                "listing_create"
            );


        if (!createSecurity.ok) {
            return sendRateLimitResponse(
                res,
                createSecurity
            );
        }


        const validation =
            validateListingInput(
                req.body
            );


        if (
            !validation.ok
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            validation.error
                    }
                );
        }


        const seller =
            auth.user;


        const input =
            validation.data;


        const {
            data:
                existing,
            error:
                existingError
        } =
            await supabase
                .from("listings")
                .select("id")
                .eq(
                    "seller_telegram_id",
                    seller.telegram_id
                )
                .ilike(
                    "whatsapp_username",
                    input.username
                )
                .in(
                    "status",
                    [
                        "pending",
                        "active",
                        "reserved"
                    ]
                )
                .limit(1);


        if (
            existingError
        ) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_check_failed"
                    }
                );
        }


        if (
            existing?.length
        ) {

            return res
                .status(409)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_already_exists"
                    }
                );
        }


        /*
         * FIRST FREE LISTING
         */

        let freeClaimed =
            false;


        try {

            freeClaimed =
                await claimFreeListing(
                    seller.telegram_id
                );

        } catch (error) {

            console.error(
                "Free listing claim:",
                error
            );


            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "free_listing_check_failed"
                    }
                );
        }


        if (
            freeClaimed
        ) {

            try {

                const listingId =
                    await createFreeListing(
                        seller,
                        input
                    );


                return res.json(
                    {
                        ok: true,
                        free: true,

                        listing_id:
                            listingId,

                        status:
                            "pending",

                        listing_plan:
                            "free",

                        duration_hours:
                            FREE_LISTING_DURATION_HOURS
                    }
                );

            } catch (error) {

                console.error(
                    "Free listing create:",
                    error
                );


                await releaseFreeListingClaim(
                    seller.telegram_id
                );


                return res
                    .status(500)
                    .json(
                        {
                            ok: false,
                            error:
                                "free_listing_create_failed"
                        }
                    );
            }
        }


        /*
         * REFERRAL REWARD: FREE 7-DAY LISTING
         * The first ordinary free listing always remains first. After it is used,
         * the client may explicitly request one available referral listing credit.
         */

        if (
            Boolean(
                req.body.use_referral_credit
            )
        ) {
            try {

                const created =
                    await createReferralRewardListingAtomic(
                        seller,
                        input
                    );


                return res.json({
                    ok:true,
                    free:true,
                    referral_free:true,
                    listing_id:
                        created.listing_id,
                    status:
                        "pending",
                    listing_plan:
                        "referral",
                    duration_hours:
                        REFERRAL_LISTING_DURATION_HOURS
                });

            } catch (error) {

                console.error(
                    "Referral listing create:",
                    error
                );


                if (
                    error?.code ===
                    "referral_listing_reward_unavailable" ||
                    error?.message ===
                    "referral_listing_reward_unavailable"
                ) {

                    return res
                        .status(409)
                        .json({
                            ok:false,
                            error:
                                "referral_listing_reward_unavailable"
                        });
                }


                return res
                    .status(500)
                    .json({
                        ok:false,
                        error:
                            "referral_listing_create_failed"
                    });
            }
        }


        /*
         * PAID 30 DAY LISTING
         */

        const orderId =
            crypto.randomUUID();


        const payload =
            `listing:${orderId}`;


        const {
            error:
                orderError
        } =
            await supabase
                .from(
                    "listing_payment_orders"
                )
                .insert(
                    {
                        id:
                            orderId,

                        seller_telegram_id:
                            seller.telegram_id,

                        invoice_payload:
                            payload,

                        amount_stars:
                            PAID_LISTING_PRICE_STARS,

                        whatsapp_username:
                            input.username,

                        asking_price:
                            input.price,

                        price_type:
                            input.priceType,

                        minimum_offer:
                            input.minimumOffer,

                        category:
                            input.category,

                        description:
                            input.description,

                        contact_type:
                            input.contactType,

                        contact_value:
                            input.contactValue,

                        status:
                            "created"
                    }
                );


        if (
            orderError
        ) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "payment_order_failed"
                    }
                );
        }


        try {

            const invoiceLink =
                await createStarsInvoice(

                    "Handle Market Listing",

                    `${PAID_LISTING_DURATION_DAYS}-day listing for @${input.username}`,

                    payload,

                    PAID_LISTING_PRICE_STARS
                );


            res.json(
                {
                    ok: true,
                    free: false,

                    order_id:
                        orderId,

                    amount_stars:
                        PAID_LISTING_PRICE_STARS,

                    duration_days:
                        PAID_LISTING_DURATION_DAYS,

                    invoice_link:
                        invoiceLink
                }
            );

        } catch {

            await supabase
                .from(
                    "listing_payment_orders"
                )
                .update(
                    {
                        status:
                            "failed"
                    }
                )
                .eq(
                    "id",
                    orderId
                );


            res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "invoice_create_failed"
                    }
                );
        }
    }
);


app.post(
    "/listing-payment/status",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        const orderId =
            String(
                req.body.order_id ||
                ""
            ).trim();


        const {
            data:
                order,
            error
        } =
            await supabase
                .from(
                    "listing_payment_orders"
                )
                .select(
                    "id,amount_stars,status,listing_id"
                )
                .eq(
                    "id",
                    orderId
                )
                .eq(
                    "seller_telegram_id",
                    auth.user.telegram_id
                )
                .maybeSingle();


        if (
            error ||
            !order
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "payment_order_not_found"
                    }
                );
        }


        res.json(
            {
                ok: true,
                order
            }
        );
    }
);


/* =========================================================
   LISTING RENEWAL
   ========================================================= */

app.post(
    "/listing-renewal/create",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        const listingId =
            String(
                req.body.listing_id ||
                ""
            ).trim();


        const {
            data:
                listing,
            error:
                listingError
        } =
            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username,status,is_paused,is_frozen,listing_plan,listing_expires_at"
                )
                .eq(
                    "id",
                    listingId
                )
                .maybeSingle();


        if (
            listingError ||
            !listing
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_not_found"
                    }
                );
        }


        if (
            Number(
                listing.seller_telegram_id
            ) !==
            Number(
                auth.user.telegram_id
            )
        ) {

            return res
                .status(403)
                .json(
                    {
                        ok: false,
                        error:
                            "not_listing_owner"
                    }
                );
        }


        if (
            ![
                "free",
                "paid",
                "referral"
            ].includes(
                String(
                    listing.listing_plan
                )
            )
        ) {

            return res
                .status(409)
                .json(
                    {
                        ok: false,
                        error:
                            "legacy_listing_does_not_need_renewal"
                    }
                );
        }


        if (
            listing.status !==
            "active"
        ) {

            return res
                .status(409)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_not_renewable"
                    }
                );
        }


        if (
            listing.is_frozen
        ) {

            return res
                .status(409)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_frozen"
                    }
                );
        }


        if (
            !isListingExpired(
                listing
            )
        ) {

            return res
                .status(409)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_not_expired"
                    }
                );
        }


        const {
            data:
                accepted
        } =
            await supabase
                .from("offers")
                .select("id")
                .eq(
                    "listing_id",
                    listingId
                )
                .eq(
                    "status",
                    "accepted"
                )
                .limit(1);


        if (
            accepted?.length
        ) {

            return res
                .status(409)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_has_agreement"
                    }
                );
        }


        const orderId =
            crypto.randomUUID();


        const payload =
            `renewal:${orderId}`;


        const {
            error:
                orderError
        } =
            await supabase
                .from(
                    "listing_renewal_orders"
                )
                .insert(
                    {
                        id:
                            orderId,

                        seller_telegram_id:
                            auth.user.telegram_id,

                        listing_id:
                            listingId,

                        amount_usd:
                            LISTING_RENEWAL_PRICE_USD,

                        amount_stars:
                            LISTING_RENEWAL_PRICE_STARS,

                        duration_days:
                            PAID_LISTING_DURATION_DAYS,

                        invoice_payload:
                            payload,

                        status:
                            "created"
                    }
                );


        if (
            orderError
        ) {

            console.error(
                "Renewal order:",
                orderError
            );


            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "renewal_order_failed"
                    }
                );
        }


        try {

            const invoiceLink =
                await createStarsInvoice(

                    "Renew Listing",

                    `Renew @${listing.whatsapp_username} for ${PAID_LISTING_DURATION_DAYS} days`,

                    payload,

                    LISTING_RENEWAL_PRICE_STARS
                );


            res.json(
                {
                    ok: true,

                    order_id:
                        orderId,

                    amount_usd:
                        LISTING_RENEWAL_PRICE_USD,

                    amount_stars:
                        LISTING_RENEWAL_PRICE_STARS,

                    duration_days:
                        PAID_LISTING_DURATION_DAYS,

                    invoice_link:
                        invoiceLink
                }
            );

        } catch {

            await supabase
                .from(
                    "listing_renewal_orders"
                )
                .update(
                    {
                        status:
                            "failed"
                    }
                )
                .eq(
                    "id",
                    orderId
                );


            res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "invoice_create_failed"
                    }
                );
        }
    }
);


app.post(
    "/listing-renewal/status",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        const orderId =
            String(
                req.body.order_id ||
                ""
            ).trim();


        const {
            data:
                order,
            error
        } =
            await supabase
                .from(
                    "listing_renewal_orders"
                )
                .select(
                    "id,listing_id,amount_usd,amount_stars,duration_days,status,paid_at,completed_at"
                )
                .eq(
                    "id",
                    orderId
                )
                .eq(
                    "seller_telegram_id",
                    auth.user.telegram_id
                )
                .maybeSingle();


        if (
            error ||
            !order
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "renewal_order_not_found"
                    }
                );
        }


        res.json(
            {
                ok: true,
                order
            }
        );
    }
);


/* =========================================================
   V40 SELLER ANALYTICS
   Private analytics for the authenticated seller only.
   ========================================================= */

app.post(
    "/seller-analytics",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json({
                    ok:false,
                    error:auth.error
                });
        }


        const {
            data,
            error
        } =
            await supabase
                .from("listings")
                .select(
                    "id,listing_number,whatsapp_username,asking_price,price_type,minimum_offer,currency,category,status,is_premium_name,views_count,likes_count,is_paused,is_frozen,created_at,bump_until,hot_until,vip_until,bump_promoted_at,hot_promoted_at,vip_promoted_at,listing_plan,listing_period_started_at,listing_expires_at"
                )
                .eq(
                    "seller_telegram_id",
                    auth.user.telegram_id
                )
                .order(
                    "created_at",
                    {
                        ascending:false
                    }
                );


        if (error) {

            console.error(
                "Seller analytics listings:",
                error
            );

            return res
                .status(500)
                .json({
                    ok:false,
                    error:"seller_analytics_load_failed"
                });
        }


        const promoted =
            (
                data || []
            ).map(
                withPromotion
            );


        const withStats =
            await attachOwnerListingStats(
                promoted
            );


        const rows =
            withStats.map(
                row =>
                    withLifecycle(
                        row
                    )
            );


        const summary = {
            listings_total:
                rows.length,
            listings_active:
                0,
            listings_pending:
                0,
            listings_frozen:
                0,
            listings_expired:
                0,
            views:
                0,
            likes:
                0,
            watchlists:
                0,
            offers:
                0
        };


        const analytics =
            rows.map(
                row => {

                    const stats =
                        row.stats || {};

                    const views =
                        Number(
                            stats.views ??
                            row.views_count ??
                            0
                        );

                    const likes =
                        Number(
                            stats.likes ??
                            row.likes_count ??
                            0
                        );

                    const watchlists =
                        Number(
                            stats.watchlists ??
                            0
                        );

                    const offers =
                        Number(
                            stats.offers ??
                            0
                        );


                    summary.views +=
                        views;

                    summary.likes +=
                        likes;

                    summary.watchlists +=
                        watchlists;

                    summary.offers +=
                        offers;


                    if (
                        row.is_expired
                    ) {
                        summary.listings_expired += 1;

                    } else if (
                        row.is_frozen
                    ) {
                        summary.listings_frozen += 1;

                    } else if (
                        row.status ===
                        "pending"
                    ) {
                        summary.listings_pending += 1;

                    } else if (
                        row.status ===
                        "active" &&
                        !row.is_paused
                    ) {
                        summary.listings_active += 1;
                    }


                    const engagementRate =
                        views > 0
                            ? (
                                (
                                    likes +
                                    watchlists +
                                    offers
                                ) /
                                views
                            ) * 100
                            : 0;


                    const offerRate =
                        views > 0
                            ? (
                                offers /
                                views
                            ) * 100
                            : 0;


                    const performanceScore =
                        views +
                        likes * 3 +
                        watchlists * 5 +
                        offers * 8;


                    return {
                        id:
                            row.id,
                        listing_number:
                            row.listing_number,
                        whatsapp_username:
                            row.whatsapp_username,
                        asking_price:
                            row.asking_price,
                        price_type:
                            row.price_type,
                        minimum_offer:
                            row.minimum_offer,
                        currency:
                            row.currency,
                        category:
                            row.category,
                        status:
                            row.status,
                        is_paused:
                            Boolean(
                                row.is_paused
                            ),
                        is_frozen:
                            Boolean(
                                row.is_frozen
                            ),
                        is_expired:
                            Boolean(
                                row.is_expired
                            ),
                        is_premium_name:
                            Boolean(
                                row.is_premium_name
                            ),
                        promotion_type:
                            row.promotion_type ||
                            null,
                        created_at:
                            row.created_at,
                        listing_expires_at:
                            row.listing_expires_at,
                        stats:{
                            views,
                            likes,
                            watchlists,
                            offers
                        },
                        engagement_rate:
                            Number(
                                engagementRate.toFixed(2)
                            ),
                        offer_rate:
                            Number(
                                offerRate.toFixed(2)
                            ),
                        performance_score:
                            performanceScore
                    };
                }
            );


        const top =
            [...analytics]
                .sort(
                    (a,b) =>
                        b.performance_score -
                        a.performance_score
                )
                .slice(
                    0,
                    5
                );


        return res.json({
            ok:true,
            summary,
            top_listings:top,
            listings:analytics
        });
    }
);


/* =========================================================
   MY LISTINGS
   ========================================================= */

app.post(
    "/my-listings",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        const {
            data,
            error
        } =
            await supabase
                .from("listings")
                .select(
                    "id,listing_number,whatsapp_username,asking_price,price_type,minimum_offer,currency,category,description,status,verification_status,is_premium_name,is_featured,views_count,likes_count,is_paused,is_frozen,frozen_reason,frozen_at,created_at,bump_until,hot_until,vip_until,bump_promoted_at,hot_promoted_at,vip_promoted_at,listing_plan,listing_period_started_at,listing_expires_at,last_renewed_at,renewal_count,contact_review_required,contact_last_changed_at"
                )
                .eq(
                    "seller_telegram_id",
                    auth.user.telegram_id
                )
                .order(
                    "created_at",
                    {
                        ascending: false
                    }
                );


        if (error) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "listings_load_failed"
                    }
                );
        }


        const promoted =
            (
                data ||
                []
            ).map(
                withPromotion
            );


        const listingsWithStats =
            await attachOwnerListingStats(
                promoted
            );


        const listingIds =
            listingsWithStats.map(
                row =>
                    row.id
            );


        let contacts = [];


        if (
            listingIds.length
        ) {

            const {
                data:contactRows
            } =
                await supabase
                    .from(
                        "listing_contacts"
                    )
                    .select(
                        "listing_id,contact_type,contact_value"
                    )
                    .in(
                        "listing_id",
                        listingIds
                    );


            contacts =
                contactRows ||
                [];
        }


        const contactMap =
            new Map(
                contacts.map(
                    row => [
                        String(
                            row.listing_id
                        ),
                        row
                    ]
                )
            );


        res.json(
            {
                ok: true,

                seller_profile_id:
                    auth.user
                        .seller_profile
                        ?.id ||
                    null,

                renewal_price_usd:
                    LISTING_RENEWAL_PRICE_USD,

                renewal_price_stars:
                    LISTING_RENEWAL_PRICE_STARS,

                paid_duration_days:
                    PAID_LISTING_DURATION_DAYS,

                listings:
                    listingsWithStats.map(
                        row => {

                            const contact =
                                contactMap.get(
                                    String(
                                        row.id
                                    )
                                ) ||
                                null;


                            return {
                                ...row,

                                contact_type:
                                    contact?.contact_type ||
                                    "telegram",

                                contact_value:
                                    contact?.contact_value ||
                                    ""
                            };
                        }
                    )
            }
        );
    }
);


/* =========================================================
   UNIQUE VIEWS
   ========================================================= */

app.post(
    "/listing/view",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        const listingId =
            String(
                req.body.listing_id ||
                ""
            ).trim();


        if (!listingId) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_id_required"
                    }
                );
        }


        const {
            data:
                listing,
            error:
                listingError
        } =
            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,status,is_paused,is_frozen,listing_plan,listing_expires_at"
                )
                .eq(
                    "id",
                    listingId
                )
                .maybeSingle();


        if (
            listingError ||
            !listingIsPubliclyAvailable(
                listing
            )
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_not_available"
                    }
                );
        }


        const viewerId =
            Number(
                auth.user.telegram_id
            );


        if (
            viewerId ===
            Number(
                listing.seller_telegram_id
            )
        ) {

            return res.json(
                {
                    ok: true,
                    counted: false,
                    owner: true
                }
            );
        }


        const {
            error:
                insertError
        } =
            await supabase
                .from(
                    "listing_views"
                )
                .insert(
                    {
                        listing_id:
                            listingId,

                        viewer_telegram_id:
                            viewerId
                    }
                );


        if (
            insertError &&
            insertError.code !==
            "23505"
        ) {

            console.error(
                "Listing view insert error:",
                insertError
            );


            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "view_record_failed"
                    }
                );
        }


        const counted =
            !insertError;


        const {
            count,
            error:
                countError
        } =
            await supabase
                .from(
                    "listing_views"
                )
                .select(
                    "listing_id",
                    {
                        count:
                            "exact",

                        head:
                            true
                    }
                )
                .eq(
                    "listing_id",
                    listingId
                );


        if (
            !countError
        ) {

            await supabase
                .from("listings")
                .update(
                    {
                        views_count:
                            Number(
                                count ||
                                0
                            )
                    }
                )
                .eq(
                    "id",
                    listingId
                );
        }


        res.json(
            {
                ok: true,
                counted,
                owner: false,

                views:
                    Number(
                        count ||
                        0
                    )
            }
        );
    }
);


/* =========================================================
   LIKES
   ========================================================= */

app.post(
    "/listing-likes/state",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        const {
            data,
            error
        } =
            await supabase
                .from(
                    "listing_likes"
                )
                .select(
                    "listing_id"
                )
                .eq(
                    "user_telegram_id",
                    auth.user.telegram_id
                );


        if (error) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "likes_load_failed"
                    }
                );
        }


        res.json(
            {
                ok: true,

                listing_ids:
                    (
                        data ||
                        []
                    ).map(
                        row =>
                            row.listing_id
                    )
            }
        );
    }
);


app.post(
    "/listing-like/toggle",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        const listingId =
            String(
                req.body.listing_id ||
                ""
            ).trim();


        const {
            data:
                listing,
            error:
                listingError
        } =
            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,status,is_paused,is_frozen,listing_plan,listing_expires_at"
                )
                .eq(
                    "id",
                    listingId
                )
                .maybeSingle();


        if (
            listingError ||
            !listingIsPubliclyAvailable(
                listing
            )
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_not_available"
                    }
                );
        }


        const userId =
            Number(
                auth.user.telegram_id
            );


        if (
            userId ===
            Number(
                listing.seller_telegram_id
            )
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "cannot_like_own_listing"
                    }
                );
        }


        const {
            data:
                existing,
            error:
                existingError
        } =
            await supabase
                .from(
                    "listing_likes"
                )
                .select(
                    "listing_id"
                )
                .eq(
                    "listing_id",
                    listingId
                )
                .eq(
                    "user_telegram_id",
                    userId
                )
                .maybeSingle();


        if (
            existingError
        ) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "like_update_failed"
                    }
                );
        }


        let liked;


        if (
            existing
        ) {

            const {
                error:
                    deleteError
            } =
                await supabase
                    .from(
                        "listing_likes"
                    )
                    .delete()
                    .eq(
                        "listing_id",
                        listingId
                    )
                    .eq(
                        "user_telegram_id",
                        userId
                    );


            if (
                deleteError
            ) {

                return res
                    .status(500)
                    .json(
                        {
                            ok: false,
                            error:
                                "like_update_failed"
                        }
                    );
            }


            liked =
                false;

        } else {

            const {
                error:
                    insertError
            } =
                await supabase
                    .from(
                        "listing_likes"
                    )
                    .insert(
                        {
                            listing_id:
                                listingId,

                            user_telegram_id:
                                userId
                        }
                    );


            if (
                insertError
            ) {

                return res
                    .status(500)
                    .json(
                        {
                            ok: false,
                            error:
                                "like_update_failed"
                        }
                    );
            }


            liked =
                true;
        }


        const {
            count
        } =
            await supabase
                .from(
                    "listing_likes"
                )
                .select(
                    "listing_id",
                    {
                        count:
                            "exact",

                        head:
                            true
                    }
                )
                .eq(
                    "listing_id",
                    listingId
                );


        const likesCount =
            Number(
                count ||
                0
            );


        await supabase
            .from("listings")
            .update(
                {
                    likes_count:
                        likesCount
                }
            )
            .eq(
                "id",
                listingId
            );


        res.json(
            {
                ok: true,
                liked,

                likes_count:
                    likesCount
            }
        );
    }
);


/* =========================================================
   PUBLIC LISTINGS
   ========================================================= */

app.get(
    "/listings",
    async (req, res) => {

        const v45Maintenance =
            await v45GetMaintenanceState();


        if (
            v45Maintenance.enabled
        ) {

            res.set(
                "Retry-After",
                "60"
            );


            return res
                .status(503)
                .json({
                    ok:false,
                    error:"maintenance_mode",
                    message:
                        v45Maintenance.message,
                    retry_after_seconds:60
                });
        }

        const {
            data,
            error
        } =
            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username,asking_price,price_type,minimum_offer,currency,category,description,is_premium_name,is_featured,views_count,likes_count,created_at,bump_until,hot_until,vip_until,bump_promoted_at,hot_promoted_at,vip_promoted_at,listing_plan,listing_period_started_at,listing_expires_at"
                )
                .eq(
                    "status",
                    "active"
                )
                .eq(
                    "is_paused",
                    false
                )
                .eq(
                    "is_frozen",
                    false
                )
                .limit(500);


        if (error) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "marketplace_load_failed"
                    }
                );
        }


        const visible =
            (
                data ||
                []
            ).filter(
                listing =>
                    !isListingExpired(
                        listing
                    )
            );


        const sorted =
            sortListingsByPromotion(
                visible
            );


        const publicRows =
            await attachPublicSellerProfiles(
                sorted
            );


        res.json(
            {
                ok: true,

                server_time:
                    nowIso(),

                listings:
                    publicRows.slice(
                        0,
                        100
                    )
            }
        );
    }
);


/* =========================================================
   WATCHLIST ALERTS
   ========================================================= */

async function notifyListingWatchers(
    listingId,
    text,
    sellerTelegramId = null,
    notificationKey = "watchlist_updates"
) {

    try {

        const {
            data:
                rows,
            error
        } =
            await supabase
                .from("watchlist")
                .select("telegram_id")
                .eq(
                    "listing_id",
                    listingId
                );


        if (error) {

            console.error(
                "Watchlist alert lookup:",
                error
            );

            return;
        }


        const ids =
            [
                ...new Set(
                    (
                        rows ||
                        []
                    )
                    .map(
                        row =>
                            Number(
                                row.telegram_id
                            )
                    )
                    .filter(
                        id =>
                            Number.isSafeInteger(
                                id
                            ) &&
                            id > 0 &&
                            id !==
                            Number(
                                sellerTelegramId
                            )
                    )
                )
            ];


        for (
            const telegramId of
            ids
        ) {

            await sendUserNotification(
                telegramId,
                notificationKey,
                text
            );
        }

    } catch (error) {

        console.error(
            "Watchlist alert:",
            error
        );
    }
}


/* =========================================================
   LISTING EDIT
   V38: contact changes trigger re-moderation.
   ========================================================= */

app.post(
    "/listing/manage/edit",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok:false,
                        error:auth.error
                    }
                );
        }


        const listingId =
            String(
                req.body.listing_id ||
                ""
            ).trim();


        const price =
            Number(
                req.body.asking_price
            );


        const description =
            String(
                req.body.description ||
                ""
            )
                .trim()
                .slice(0,500);


        const priceType =
            String(
                req.body.price_type ||
                "negotiable"
            )
                .trim()
                .toLowerCase();


        let minimumOffer =
            null;


        if (
            priceType ===
            "negotiable" &&
            String(
                req.body.minimum_offer ??
                ""
            ).trim() !==
            ""
        ) {

            minimumOffer =
                Number(
                    req.body.minimum_offer
                );
        }


        if (
            !listingId ||
            !Number.isFinite(price) ||
            price <= 0 ||
            price > 100000000 ||
            ![
                "fixed",
                "negotiable"
            ].includes(
                priceType
            ) ||
            (
                priceType ===
                "negotiable" &&
                minimumOffer !== null &&
                (
                    !Number.isFinite(
                        minimumOffer
                    ) ||
                    minimumOffer <= 0 ||
                    minimumOffer > price
                )
            )
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok:false,
                        error:"invalid_price"
                    }
                );
        }


        const contactValidation =
            validateContactInput(
                req.body
            );


        if (
            !contactValidation.ok
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok:false,
                        error:
                            contactValidation.error
                    }
                );
        }


        const {
            contactType,
            contactValue,
            contacts
        } =
            contactValidation.data;


        const {
            data:listing
        } =
            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username,asking_price,price_type,minimum_offer,description,status,is_frozen,contact_review_required"
                )
                .eq(
                    "id",
                    listingId
                )
                .maybeSingle();


        if (
            !listing ||
            Number(
                listing.seller_telegram_id
            ) !==
            Number(
                auth.user.telegram_id
            )
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok:false,
                        error:"listing_not_found"
                    }
                );
        }


        if (
            listing.is_frozen
        ) {

            return res
                .status(409)
                .json(
                    {
                        ok:false,
                        error:"listing_frozen"
                    }
                );
        }


        if (
            ![
                "active",
                "pending"
            ].includes(
                listing.status
            )
        ) {

            return res
                .status(409)
                .json(
                    {
                        ok:false,
                        error:"listing_not_editable"
                    }
                );
        }



        const editSecurity =
            await securityRateLimit(
                auth.user,
                "listing_edit",
                listingId
            );


        if (!editSecurity.ok) {
            return sendRateLimitResponse(
                res,
                editSecurity
            );
        }


        const {
            data:oldContact,
            error:contactLoadError
        } =
            await supabase
                .from(
                    "listing_contacts"
                )
                .select(
                    "contact_type,contact_value"
                )
                .eq(
                    "listing_id",
                    listingId
                )
                .maybeSingle();


        if (
            contactLoadError ||
            !oldContact
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok:false,
                        error:"seller_contact_not_found"
                    }
                );
        }


        const oldContacts =
            decodeContactBundle(
                oldContact.contact_type,
                oldContact.contact_value
            );


        const contactChanged =
            [
                "telegram",
                "whatsapp",
                "email",
                "other"
            ].some(
                key =>
                    String(
                        oldContacts[key] ||
                        ""
                    ).trim() !==
                    String(
                        contacts[key] ||
                        ""
                    ).trim()
            );



        if (
            contactChanged
        ) {

            const contactSecurity =
                await securityRateLimit(
                    auth.user,
                    "contact_change",
                    listingId
                );


            if (!contactSecurity.ok) {
                return sendRateLimitResponse(
                    res,
                    contactSecurity
                );
            }
        }


        const priceChanged =
            Number(
                listing.asking_price
            ) !==
            price;


        const priceTypeChanged =
            String(
                listing.price_type ||
                "negotiable"
            ) !==
            priceType;


        const minimumOfferChanged =
            Number(
                listing.minimum_offer ||
                0
            ) !==
            Number(
                minimumOffer ||
                0
            );


        const descriptionChanged =
            String(
                listing.description ||
                ""
            ) !==
            description;


        const update = {
            asking_price:price,
            price_type:priceType,
            minimum_offer:
                priceType ===
                "negotiable"
                    ? minimumOffer
                    : null,
            description,
            updated_at:nowIso()
        };


        if (
            contactChanged
        ) {

            update.status =
                "pending";

            update.contact_review_required =
                true;

            update.contact_last_changed_at =
                nowIso();

            update.contact_last_changed_by =
                Number(
                    auth.user.telegram_id
                );
        }


        const {
            data:updatedListing,
            error:updateError
        } =
            await supabase
                .from("listings")
                .update(
                    update
                )
                .eq(
                    "id",
                    listingId
                )
                .select()
                .single();


        if (
            updateError
        ) {

            return res
                .status(500)
                .json(
                    {
                        ok:false,
                        error:"listing_update_failed"
                    }
                );
        }


        if (
            contactChanged
        ) {

            const {
                error:contactUpdateError
            } =
                await supabase
                    .from(
                        "listing_contacts"
                    )
                    .update(
                        {
                            contact_type:
                                contactType,

                            contact_value:
                                contactValue
                        }
                    )
                    .eq(
                        "listing_id",
                        listingId
                    );


            if (
                contactUpdateError
            ) {

                console.error(
                    "Contact update:",
                    contactUpdateError
                );


                return res
                    .status(500)
                    .json(
                        {
                            ok:false,
                            error:"contact_update_failed"
                        }
                    );
            }
        }


        const sellerId =
            Number(
                auth.user.telegram_id
            );


        if (
            priceChanged
        ) {

            await addPriceHistory(
                listing,
                Number(
                    listing.asking_price
                ),
                price
            );


            await addListingChangeHistory(
                listingId,
                "seller",
                sellerId,
                "price",
                {
                    asking_price:
                        Number(
                            listing.asking_price
                        )
                },
                {
                    asking_price:
                        price
                }
            );


            const oldPrice =
                Number(
                    listing.asking_price
                );


            if (
                oldPrice > 0 &&
                Math.abs(
                    price -
                    oldPrice
                ) /
                oldPrice >=
                0.5
            ) {

                await ensureRiskFlag(
                    listingId,
                    "large_price_change",
                    "medium",
                    {
                        old_price:oldPrice,
                        new_price:price
                    }
                );
            }


            if (
                oldPrice >
                price
            ) {

                await notifyListingWatchers(
                    listingId,
                    `📉 Price dropped on LOT ${listing.listing_number ? "#" + String(listing.listing_number).padStart(6,"0") : ""} · @${listing.whatsapp_username}\n\n$${oldPrice.toLocaleString("en-US")} → $${price.toLocaleString("en-US")}\n\nOpen Handle Market → Watchlist.`,
                    sellerId,
                    "price_drops"
                );
            }
        }


        if (
            priceTypeChanged ||
            minimumOfferChanged
        ) {

            await addListingChangeHistory(
                listingId,
                "seller",
                sellerId,
                "pricing_terms",
                {
                    price_type:
                        listing.price_type ||
                        "negotiable",
                    minimum_offer:
                        listing.minimum_offer
                },
                {
                    price_type:
                        priceType,
                    minimum_offer:
                        minimumOffer
                }
            );
        }


        if (
            descriptionChanged
        ) {

            await addListingChangeHistory(
                listingId,
                "seller",
                sellerId,
                "description",
                {
                    description:
                        listing.description ||
                        ""
                },
                {
                    description:
                        description
                }
            );
        }


        if (
            contactChanged
        ) {

            await addListingChangeHistory(
                listingId,
                "seller",
                sellerId,
                "contact",
                {
                    contact_type:
                        oldContact.contact_type,
                    contact_value:
                        oldContact.contact_value
                },
                {
                    contact_type:
                        contactType,
                    contact_value:
                        contactValue
                }
            );


            await ensureRiskFlag(
                listingId,
                "contact_changed",
                "medium",
                {
                    previous_type:
                        oldContact.contact_type,
                    new_type:
                        contactType,
                    changed_at:
                        nowIso()
                }
            );


            if (
                contactHasExternalLink(
                    contactValue
                )
            ) {

                await ensureRiskFlag(
                    listingId,
                    "external_link_contact",
                    "medium",
                    {
                        contact_type:
                            contactType
                    }
                );
            }


            await notifyAdminsContactChanged(
                listing
            );


            await safeSendMessage(
                sellerId,
                `⚠️ Your contact for @${listing.whatsapp_username} was changed.\n\nThe listing has been sent back to moderation and is temporarily hidden. Its existing listing timer continues to run.`
            );
        }



        if (
            priceChanged ||
            contactChanged
        ) {

            await maybeFlagFrequentListingChanges(
                listingId,
                sellerId
            );
        }


        return res.json(
            {
                ok:true,
                contact_changed:
                    contactChanged,
                review_required:
                    contactChanged ||
                    Boolean(
                        listing.contact_review_required
                    ),
                listing:
                    withLifecycle(
                        updatedListing
                    )
            }
        );
    }
);


/* =========================================================
   LISTING PAUSE / RESUME
   ========================================================= */

app.post(
    "/listing/manage/pause",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        const listingId =
            String(
                req.body.listing_id ||
                ""
            ).trim();


        const action =
            String(
                req.body.action ||
                ""
            ).trim();


        if (
            ![
                "pause",
                "resume"
            ].includes(
                action
            )
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "invalid_action"
                    }
                );
        }


        const {
            data:
                listing
        } =
            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username,status,is_frozen,listing_plan,listing_expires_at"
                )
                .eq(
                    "id",
                    listingId
                )
                .maybeSingle();


        if (
            !listing ||
            Number(
                listing.seller_telegram_id
            ) !==
            Number(
                auth.user.telegram_id
            )
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_not_found"
                    }
                );
        }


        if (
            listing.status !==
            "active"
        ) {

            return res
                .status(409)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_not_active"
                    }
                );
        }


        if (
            listing.is_frozen
        ) {

            return res
                .status(409)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_frozen"
                    }
                );
        }


        if (
            action === "resume" &&
            isListingExpired(
                listing
            )
        ) {

            return res
                .status(409)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_expired"
                    }
                );
        }


        if (
            action ===
            "resume"
        ) {

            const {
                data:
                    accepted
            } =
                await supabase
                    .from("offers")
                    .select("id")
                    .eq(
                        "listing_id",
                        listingId
                    )
                    .eq(
                        "status",
                        "accepted"
                    )
                    .limit(1);


            if (
                accepted?.length
            ) {

                return res
                    .status(409)
                    .json(
                        {
                            ok: false,
                            error:
                                "listing_has_agreement"
                        }
                    );
            }
        }


        const {
            data,
            error
        } =
            await supabase
                .from("listings")
                .update(
                    {
                        is_paused:
                            action ===
                            "pause",

                        updated_at:
                            nowIso()
                    }
                )
                .eq(
                    "id",
                    listingId
                )
                .select()
                .single();


        if (error) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_update_failed"
                    }
                );
        }


        await notifyListingWatchers(
            listingId,
            `${action === "pause" ? "⏸" : "▶️"} Watchlist update: LOT ${listing.listing_number ? "#" + String(listing.listing_number).padStart(6,"0") : ""} · @${listing.whatsapp_username} was ${action === "pause" ? "paused" : "resumed"}.`,
            auth.user.telegram_id
        );


        res.json(
            {
                ok: true,
                listing:
                    data
            }
        );
    }
);


/* =========================================================
   REMOVE LISTING
   ========================================================= */

app.post(
    "/listing/manage/remove",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        const listingId =
            String(
                req.body.listing_id ||
                ""
            ).trim();


        const {
            data:
                listing
        } =
            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username,status,is_frozen"
                )
                .eq(
                    "id",
                    listingId
                )
                .maybeSingle();


        if (
            !listing ||
            Number(
                listing.seller_telegram_id
            ) !==
            Number(
                auth.user.telegram_id
            )
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_not_found"
                    }
                );
        }


        if (
            listing.is_frozen
        ) {

            return res
                .status(409)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_frozen"
                    }
                );
        }


        if (
            listing.status ===
            "removed"
        ) {

            return res.json(
                {
                    ok: true
                }
            );
        }


        const {
            error
        } =
            await supabase
                .from("listings")
                .update(
                    {
                        status:
                            "removed",

                        is_paused:
                            true,

                        updated_at:
                            nowIso()
                    }
                )
                .eq(
                    "id",
                    listingId
                );


        if (error) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_remove_failed"
                    }
                );
        }


        await closeListingOpenOffers(

            listingId,

            `❌ @${listing.whatsapp_username} was removed. Your open offer was closed.`
        );


        await notifyListingWatchers(
            listingId,
            `🗑 Watchlist update: LOT ${listing.listing_number ? "#" + String(listing.listing_number).padStart(6,"0") : ""} · @${listing.whatsapp_username} was removed by the seller.`,
            auth.user.telegram_id
        );


        res.json(
            {
                ok: true
            }
        );
    }
);


/* =========================================================
   PROMOTION CREATE
   ========================================================= */

app.post(
    "/promotion-payment/create",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        const listingId =
            String(
                req.body.listing_id ||
                ""
            ).trim();


        const type =
            String(
                req.body.promotion_type ||
                ""
            )
                .trim()
                .toLowerCase();


        const durationHours =
            Number(
                req.body.duration_hours
            );


        const amountStars =
            promotionPrice(
                type,
                durationHours
            );


        if (
            !listingId ||
            !amountStars
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "invalid_promotion"
                    }
                );
        }


        const {
            data:
                listing,
            error:
                listingError
        } =
            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username,status,is_paused,is_frozen,listing_plan,listing_expires_at,bump_until,hot_until,vip_until"
                )
                .eq(
                    "id",
                    listingId
                )
                .maybeSingle();


        if (
            listingError ||
            !listing
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_not_found"
                    }
                );
        }


        if (
            Number(
                listing.seller_telegram_id
            ) !==
            Number(
                auth.user.telegram_id
            )
        ) {

            return res
                .status(403)
                .json(
                    {
                        ok: false,
                        error:
                            "not_listing_owner"
                    }
                );
        }


        const eligibility =
            calculatePromotionUntil(
                listing,
                type,
                durationHours
            );


        if (
            !eligibility.ok
        ) {

            return res
                .status(409)
                .json(
                    {
                        ok: false,
                        error:
                            eligibility.error
                    }
                );
        }


        const {
            data:
                accepted
        } =
            await supabase
                .from("offers")
                .select("id")
                .eq(
                    "listing_id",
                    listingId
                )
                .eq(
                    "status",
                    "accepted"
                )
                .limit(1);


        if (
            accepted?.length
        ) {

            return res
                .status(409)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_has_agreement"
                    }
                );
        }


        const orderId =
            crypto.randomUUID();


        const payload =
            `promotion:${orderId}`;


        const {
            error:
                orderError
        } =
            await supabase
                .from(
                    "promotion_payment_orders"
                )
                .insert(
                    {
                        id:
                            orderId,

                        seller_telegram_id:
                            auth.user.telegram_id,

                        listing_id:
                            listingId,

                        promotion_type:
                            type,

                        duration_hours:
                            durationHours,

                        amount_stars:
                            amountStars,

                        invoice_payload:
                            payload,

                        status:
                            "created"
                    }
                );


        if (
            orderError
        ) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "promotion_order_failed"
                    }
                );
        }


        const labels = {
            bump: "Bump",
            hot: "HOT",
            vip: "VIP"
        };


        const durationLabel =
            durationHours === 24
                ? "24 hours"
                : durationHours === 72
                    ? "3 days"
                    : "7 days";


        const freeText =
            listing.listing_plan ===
            "free"
                ? " Promotion cannot continue after the free listing expires."
                : "";


        try {

            const invoiceLink =
                await createStarsInvoice(

                    `${labels[type]} Listing`,

                    `${labels[type]} promotion for @${listing.whatsapp_username} · ${durationLabel}.${freeText}`,

                    payload,

                    amountStars
                );


            res.json(
                {
                    ok: true,

                    order_id:
                        orderId,

                    amount_stars:
                        amountStars,

                    invoice_link:
                        invoiceLink,

                    promotion_type:
                        type,

                    duration_hours:
                        durationHours,

                    expected_until:
                        eligibility.applied_until
                }
            );

        } catch {

            await supabase
                .from(
                    "promotion_payment_orders"
                )
                .update(
                    {
                        status:
                            "failed"
                    }
                )
                .eq(
                    "id",
                    orderId
                );


            res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "invoice_create_failed"
                    }
                );
        }
    }
);


app.post(
    "/promotion-payment/status",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        const orderId =
            String(
                req.body.order_id ||
                ""
            ).trim();


        const {
            data:
                order,
            error
        } =
            await supabase
                .from(
                    "promotion_payment_orders"
                )
                .select(
                    "id,listing_id,promotion_type,duration_hours,amount_stars,status,applied_until,paid_at,completed_at"
                )
                .eq(
                    "id",
                    orderId
                )
                .eq(
                    "seller_telegram_id",
                    auth.user.telegram_id
                )
                .maybeSingle();


        if (
            error ||
            !order
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "promotion_order_not_found"
                    }
                );
        }


        res.json(
            {
                ok: true,
                order
            }
        );
    }
);


/* =========================================================
   CONTACT
   ========================================================= */

app.post(
    "/listing-contact",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        const listingId =
            String(
                req.body.listing_id ||
                ""
            ).trim();


        const {
            data:
                listing,
            error:
                listingError
        } =
            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,status,is_paused,is_frozen,listing_plan,listing_expires_at"
                )
                .eq(
                    "id",
                    listingId
                )
                .maybeSingle();


        if (
            listingError ||
            !listing
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_not_found"
                    }
                );
        }


        const buyerId =
            Number(
                auth.user.telegram_id
            );


        const sellerId =
            Number(
                listing.seller_telegram_id
            );


        const owner =
            buyerId ===
            sellerId;


        let unlocked =
            owner;


        if (
            !unlocked
        ) {

            unlocked =
                await buyerHasContactAccess(
                    buyerId,
                    listingId
                );
        }


        if (
            !unlocked &&
            !listingIsPubliclyAvailable(
                listing
            )
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,

                        error:
                            isListingExpired(
                                listing
                            )
                                ? "listing_expired"
                                : "listing_not_available"
                    }
                );
        }


        if (
            !unlocked
        ) {

            return res.json(
                {
                    ok: true,
                    unlocked: false,

                    price_stars:
                        CONTACT_UNLOCK_PRICE_STARS
                }
            );
        }


        const {
            data:
                contact,
            error:
                contactError
        } =
            await supabase
                .from(
                    "listing_contacts"
                )
                .select(
                    "contact_type,contact_value"
                )
                .eq(
                    "listing_id",
                    listingId
                )
                .maybeSingle();


        if (
            contactError ||
            !contact
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "seller_contact_not_found"
                    }
                );
        }


        const contacts =
            decodeContactBundle(
                contact.contact_type,
                contact.contact_value
            );

        const primaryContact =
            firstContactFromBundle(
                contacts
            );


        res.json(
            {
                ok: true,
                unlocked: true,
                owner,
                contacts,
                contact:primaryContact
            }
        );
    }
);


/* =========================================================
   CONTACT UNLOCK
   ========================================================= */

app.post(
    "/contact-unlock/create",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        const unlockSecurity =
            await securityRateLimit(
                auth.user,
                "contact_unlock_create",
                req.body.listing_id ||
                null
            );


        if (!unlockSecurity.ok) {
            return sendRateLimitResponse(
                res,
                unlockSecurity
            );
        }


        const buyerId =
            Number(
                auth.user.telegram_id
            );


        const listingId =
            String(
                req.body.listing_id ||
                ""
            ).trim();


        const {
            data:
                listing,
            error:
                listingError
        } =
            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username,status,is_paused,is_frozen,listing_plan,listing_expires_at"
                )
                .eq(
                    "id",
                    listingId
                )
                .maybeSingle();


        if (
            listingError ||
            !listingIsPubliclyAvailable(
                listing
            )
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_not_available"
                    }
                );
        }


        if (
            Number(
                listing.seller_telegram_id
            ) ===
            buyerId
        ) {

            return res.json(
                {
                    ok: true,
                    already_unlocked:
                        true
                }
            );
        }


        if (
            await buyerHasContactAccess(
                buyerId,
                listingId
            )
        ) {

            return res.json(
                {
                    ok: true,
                    already_unlocked:
                        true
                }
            );
        }


        const {
            data:
                contact
        } =
            await supabase
                .from(
                    "listing_contacts"
                )
                .select(
                    "listing_id"
                )
                .eq(
                    "listing_id",
                    listingId
                )
                .maybeSingle();


        if (!contact) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "seller_contact_not_found"
                    }
                );
        }


        const {
            data:
                existingUnlock
        } =
            await supabase
                .from(
                    "contact_unlocks"
                )
                .select("*")
                .eq(
                    "buyer_telegram_id",
                    buyerId
                )
                .eq(
                    "listing_id",
                    listingId
                )
                .maybeSingle();


        const orderId =
            existingUnlock?.id ||
            crypto.randomUUID();


        const payload =
            `contact:${orderId}:${crypto.randomBytes(8).toString("hex")}`;


        let databaseError;


        if (
            existingUnlock
        ) {

            const {
                error
            } =
                await supabase
                    .from(
                        "contact_unlocks"
                    )
                    .update(
                        {
                            invoice_payload:
                                payload,

                            amount_stars:
                                CONTACT_UNLOCK_PRICE_STARS,

                            payment_method:
                                "stars",

                            telegram_payment_charge_id:
                                null,

                            status:
                                "pending",

                            paid_at:
                                null
                        }
                    )
                    .eq(
                        "id",
                        orderId
                    );


            databaseError =
                error;

        } else {

            const {
                error
            } =
                await supabase
                    .from(
                        "contact_unlocks"
                    )
                    .insert(
                        {
                            id:
                                orderId,

                            buyer_telegram_id:
                                buyerId,

                            listing_id:
                                listingId,

                            payment_method:
                                "stars",

                            amount_stars:
                                CONTACT_UNLOCK_PRICE_STARS,

                            invoice_payload:
                                payload,

                            status:
                                "pending"
                        }
                    );


            databaseError =
                error;
        }


        if (
            databaseError
        ) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "contact_payment_order_failed"
                    }
                );
        }


        try {

            const invoiceLink =
                await createStarsInvoice(

                    "Unlock Seller Contact",

                    `Unlock contact for @${listing.whatsapp_username}`,

                    payload,

                    CONTACT_UNLOCK_PRICE_STARS
                );


            res.json(
                {
                    ok: true,

                    order_id:
                        orderId,

                    amount_stars:
                        CONTACT_UNLOCK_PRICE_STARS,

                    invoice_link:
                        invoiceLink
                }
            );

        } catch {

            await supabase
                .from(
                    "contact_unlocks"
                )
                .update(
                    {
                        status:
                            "failed"
                    }
                )
                .eq(
                    "id",
                    orderId
                );


            res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "invoice_create_failed"
                    }
                );
        }
    }
);


app.post(
    "/contact-unlock/status",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        const orderId =
            String(
                req.body.order_id ||
                ""
            ).trim();


        const {
            data:
                order,
            error
        } =
            await supabase
                .from(
                    "contact_unlocks"
                )
                .select(
                    "id,listing_id,amount_stars,status,paid_at"
                )
                .eq(
                    "id",
                    orderId
                )
                .eq(
                    "buyer_telegram_id",
                    auth.user.telegram_id
                )
                .maybeSingle();


        if (
            error ||
            !order
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "contact_order_not_found"
                    }
                );
        }


        res.json(
            {
                ok: true,
                order
            }
        );
    }
);


/* =========================================================
   WATCHLIST
   ========================================================= */

app.post(
    "/watchlist/toggle",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        const listingId =
            String(
                req.body.listing_id ||
                ""
            ).trim();


        const {
            data:
                existing
        } =
            await supabase
                .from("watchlist")
                .select(
                    "listing_id"
                )
                .eq(
                    "telegram_id",
                    auth.user.telegram_id
                )
                .eq(
                    "listing_id",
                    listingId
                )
                .maybeSingle();


        if (
            existing
        ) {

            await supabase
                .from("watchlist")
                .delete()
                .eq(
                    "telegram_id",
                    auth.user.telegram_id
                )
                .eq(
                    "listing_id",
                    listingId
                );


            return res.json(
                {
                    ok: true,
                    watched: false
                }
            );
        }


        const {
            data:
                listing
        } =
            await supabase
                .from("listings")
                .select(
                    "id,status,is_paused,is_frozen,listing_plan,listing_expires_at"
                )
                .eq(
                    "id",
                    listingId
                )
                .maybeSingle();


        if (
            !listingIsPubliclyAvailable(
                listing
            )
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_not_available"
                    }
                );
        }


        const {
            error
        } =
            await supabase
                .from("watchlist")
                .insert(
                    {
                        telegram_id:
                            auth.user.telegram_id,

                        listing_id:
                            listingId
                    }
                );


        if (error) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "watchlist_update_failed"
                    }
                );
        }


        res.json(
            {
                ok: true,
                watched: true
            }
        );
    }
);


app.post(
    "/watchlist/list",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        const {
            data:
                watched,
            error
        } =
            await supabase
                .from("watchlist")
                .select(
                    "listing_id"
                )
                .eq(
                    "telegram_id",
                    auth.user.telegram_id
                );


        if (error) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "watchlist_load_failed"
                    }
                );
        }


        const listingIds =
            (
                watched ||
                []
            ).map(
                row =>
                    row.listing_id
            );


        if (
            !listingIds.length
        ) {

            return res.json(
                {
                    ok: true,
                    listing_ids: [],
                    listings: []
                }
            );
        }


        const {
            data:
                listings
        } =
            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username,asking_price,price_type,minimum_offer,currency,category,description,is_premium_name,is_featured,views_count,likes_count,created_at,bump_until,hot_until,vip_until,bump_promoted_at,hot_promoted_at,vip_promoted_at,status,is_paused,is_frozen,listing_plan,listing_period_started_at,listing_expires_at"
                )
                .in(
                    "id",
                    listingIds
                );


        const visible =
            (
                listings ||
                []
            ).filter(
                listing =>
                    listingIsPubliclyAvailable(
                        listing
                    )
            );


        const publicRows =
            await attachPublicSellerProfiles(
                sortListingsByPromotion(
                    visible
                )
            );


        res.json(
            {
                ok: true,

                listing_ids:
                    listingIds,

                listings:
                    publicRows
            }
        );
    }
);


/* =========================================================
   WANTED
   ========================================================= */

app.get(
    "/wanted",
    async (req, res) => {

        const {
            data:
                posts,
            error
        } =
            await supabase
                .from(
                    "wanted_requests"
                )
                .select(
                    "id,buyer_telegram_id,desired_username,budget,currency,category,description,status,created_at"
                )
                .eq(
                    "status",
                    "active"
                )
                .order(
                    "created_at",
                    {
                        ascending: false
                    }
                )
                .limit(100);


        if (error) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "wanted_load_failed"
                    }
                );
        }


        const buyerIds = [
            ...new Set(
                (
                    posts ||
                    []
                ).map(
                    row =>
                        row.buyer_telegram_id
                )
            )
        ];


        let buyers = [];


        if (
            buyerIds.length
        ) {

            const {
                data
            } =
                await supabase
                    .from("users")
                    .select(
                        "telegram_id,first_name,telegram_username"
                    )
                    .in(
                        "telegram_id",
                        buyerIds
                    );


            buyers =
                data ||
                [];
        }


        const map =
            new Map(

                buyers.map(
                    row => [
                        String(
                            row.telegram_id
                        ),
                        row
                    ]
                )
            );


        const wantedIds =
            (posts || []).map(
                row => row.id
            );

        let wantedContacts = [];

        if (wantedIds.length) {
            const { data } =
                await supabase
                    .from("wanted_contacts")
                    .select("wanted_id,telegram,whatsapp,email,other")
                    .in("wanted_id",wantedIds);

            wantedContacts =
                data || [];
        }

        const wantedContactMap =
            new Map(
                wantedContacts.map(
                    row => [
                        String(row.wanted_id),
                        {
                            telegram:row.telegram || "",
                            whatsapp:row.whatsapp || "",
                            email:row.email || "",
                            other:row.other || ""
                        }
                    ]
                )
            );


        res.json(
            {
                ok: true,

                posts:
                    (
                        posts ||
                        []
                    ).map(
                        row => ({

                            ...row,

                            buyer:
                                map.get(
                                    String(
                                        row.buyer_telegram_id
                                    )
                                ) ||
                                null,

                            contacts:
                                wantedContactMap.get(
                                    String(row.id)
                                ) ||
                                { telegram:"",whatsapp:"",email:"",other:"" }
                        })
                    )
            }
        );
    }
);


app.post(
    "/my-wanted",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        const {
            data,
            error
        } =
            await supabase
                .from(
                    "wanted_requests"
                )
                .select(
                    "id,desired_username,budget,currency,category,description,status,created_at,updated_at"
                )
                .eq(
                    "buyer_telegram_id",
                    auth.user.telegram_id
                )
                .order(
                    "created_at",
                    {
                        ascending: false
                    }
                );


        if (error) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "wanted_load_failed"
                    }
                );
        }


        const rows =
            data ||
            [];

        let contactRows = [];

        if (rows.length) {
            const result =
                await supabase
                    .from("wanted_contacts")
                    .select("wanted_id,telegram,whatsapp,email,other")
                    .in(
                        "wanted_id",
                        rows.map(row => row.id)
                    );

            contactRows =
                result.data || [];
        }

        const contactMap =
            new Map(
                contactRows.map(
                    row => [
                        String(row.wanted_id),
                        {
                            telegram:row.telegram || "",
                            whatsapp:row.whatsapp || "",
                            email:row.email || "",
                            other:row.other || ""
                        }
                    ]
                )
            );


        res.json(
            {
                ok: true,
                posts:
                    rows.map(
                        row => ({
                            ...row,
                            contacts:
                                contactMap.get(String(row.id)) ||
                                { telegram:"",whatsapp:"",email:"",other:"" }
                        })
                    )
            }
        );
    }
);


app.post(
    "/wanted/close",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        const wantedId =
            String(
                req.body.wanted_id ||
                ""
            ).trim();


        const {
            data,
            error
        } =
            await supabase
                .from(
                    "wanted_requests"
                )
                .update(
                    {
                        status:
                            "closed",

                        updated_at:
                            nowIso()
                    }
                )
                .eq(
                    "id",
                    wantedId
                )
                .eq(
                    "buyer_telegram_id",
                    auth.user.telegram_id
                )
                .eq(
                    "status",
                    "active"
                )
                .select()
                .maybeSingle();


        if (
            error ||
            !data
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "wanted_not_found"
                    }
                );
        }


        res.json(
            {
                ok: true,
                post:
                    data
            }
        );
    }
);


/* =========================================================
   WANTED PAYMENT
   ========================================================= */

app.post(
    "/wanted-payment/create",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }



        const username =
            normalizeWantedUsername(
                req.body
                    .desired_username
            );


        const budget =
            Number(
                req.body.budget
            );


        if (!username) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "invalid_username"
                    }
                );
        }


        if (
            !Number.isFinite(
                budget
            ) ||
            budget <= 0 ||
            budget >
            100000000
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "invalid_budget"
                    }
                );
        }


        const category =
            normalizeCategory(
                req.body.category
            );


        const description =
            String(
                req.body.description ||
                ""
            )
                .trim()
                .slice(
                    0,
                    500
                );


        const contactValidation =
            validateContactInput(
                req.body
            );


        if (!contactValidation.ok) {
            return res
                .status(400)
                .json({
                    ok:false,
                    error:contactValidation.error
                });
        }


        const wantedContacts =
            contactValidation.data.contacts;


        const {
            data:
                duplicate
        } =
            await supabase
                .from(
                    "wanted_requests"
                )
                .select("id")
                .eq(
                    "buyer_telegram_id",
                    auth.user.telegram_id
                )
                .ilike(
                    "desired_username",
                    username
                )
                .eq(
                    "status",
                    "active"
                )
                .limit(1);


        if (
            duplicate?.length
        ) {

            return res
                .status(409)
                .json(
                    {
                        ok: false,
                        error:
                            "wanted_already_exists"
                    }
                );
        }


        const orderId =
            crypto.randomUUID();


        const payload =
            `wanted:${orderId}`;


        const {
            error
        } =
            await supabase
                .from(
                    "wanted_payment_orders"
                )
                .insert(
                    {
                        id:
                            orderId,

                        buyer_telegram_id:
                            auth.user.telegram_id,

                        invoice_payload:
                            payload,

                        amount_stars:
                            WANTED_PRICE_STARS,

                        desired_username:
                            username,

                        budget,

                        category,

                        description,

                        status:
                            "created"
                    }
                );


        if (error) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "wanted_payment_order_failed"
                    }
                );
        }


        const { error:wantedContactError } =
            await supabase
                .from("wanted_contacts")
                .upsert(
                    {
                        wanted_id:orderId,
                        buyer_telegram_id:auth.user.telegram_id,
                        telegram:wantedContacts.telegram || null,
                        whatsapp:wantedContacts.whatsapp || null,
                        email:wantedContacts.email || null,
                        other:wantedContacts.other || null,
                        updated_at:nowIso()
                    },
                    { onConflict:"wanted_id" }
                );


        if (wantedContactError) {
            await supabase
                .from("wanted_payment_orders")
                .delete()
                .eq("id",orderId);

            return res
                .status(500)
                .json({
                    ok:false,
                    error:"wanted_contact_save_failed"
                });
        }


        try {

            const invoiceLink =
                await createStarsInvoice(

                    "Publish Wanted Request",

                    `Publish Wanted request for @${username}`,

                    payload,

                    WANTED_PRICE_STARS
                );


            res.json(
                {
                    ok: true,

                    order_id:
                        orderId,

                    amount_stars:
                        WANTED_PRICE_STARS,

                    invoice_link:
                        invoiceLink
                }
            );

        } catch {

            await supabase
                .from(
                    "wanted_payment_orders"
                )
                .update(
                    {
                        status:
                            "failed"
                    }
                )
                .eq(
                    "id",
                    orderId
                );

            await supabase
                .from("wanted_contacts")
                .delete()
                .eq("wanted_id",orderId);


            res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "invoice_create_failed"
                    }
                );
        }
    }
);


app.post(
    "/wanted-payment/status",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        const orderId =
            String(
                req.body.order_id ||
                ""
            ).trim();


        const {
            data:
                order,
            error
        } =
            await supabase
                .from(
                    "wanted_payment_orders"
                )
                .select(
                    "id,amount_stars,status,wanted_post_id"
                )
                .eq(
                    "id",
                    orderId
                )
                .eq(
                    "buyer_telegram_id",
                    auth.user.telegram_id
                )
                .maybeSingle();


        if (
            error ||
            !order
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "wanted_order_not_found"
                    }
                );
        }


        res.json(
            {
                ok: true,
                order
            }
        );
    }
);



/* =========================================================
   V64 WANTED INTERNAL CHAT
   ========================================================= */

async function getWantedChatForParticipant(
    chatId,
    telegramId
) {
    const { data:chat,error } =
        await supabase
            .from("wanted_chats")
            .select("id,wanted_id,buyer_telegram_id,seller_telegram_id,created_at,updated_at")
            .eq("id",chatId)
            .maybeSingle();

    if (error || !chat) {
        return { ok:false,error:"chat_not_found" };
    }

    const userId = Number(telegramId);

    if (
        Number(chat.buyer_telegram_id) !== userId &&
        Number(chat.seller_telegram_id) !== userId
    ) {
        return { ok:false,error:"chat_access_denied" };
    }

    return { ok:true,chat };
}


app.post(
    "/wanted-chat/open",
    async (req,res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );

        if (!auth.ok) {
            return res.status(auth.status).json({ ok:false,error:auth.error });
        }

        const sellerId =
            Number(auth.user.telegram_id);

        const wantedId =
            String(req.body.wanted_id || "").trim();

        if (!wantedId) {
            return res.status(400).json({ ok:false,error:"wanted_not_found" });
        }

        const { data:wanted,error:wantedError } =
            await supabase
                .from("wanted_requests")
                .select("id,buyer_telegram_id,desired_username,status")
                .eq("id",wantedId)
                .maybeSingle();

        if (
            wantedError ||
            !wanted ||
            wanted.status !== "active"
        ) {
            return res.status(404).json({ ok:false,error:"wanted_not_found" });
        }

        const buyerId =
            Number(wanted.buyer_telegram_id);

        if (buyerId === sellerId) {
            return res.status(400).json({ ok:false,error:"wanted_owner_chat" });
        }

        const { data:existing,error:existingError } =
            await supabase
                .from("wanted_chats")
                .select("id,wanted_id,buyer_telegram_id,seller_telegram_id,created_at,updated_at")
                .eq("wanted_id",wantedId)
                .eq("seller_telegram_id",sellerId)
                .maybeSingle();

        if (existingError) {
            return res.status(500).json({ ok:false,error:"wanted_chat_lookup_failed" });
        }

        if (existing) {
            return res.json({ ok:true,chat:existing,wanted_username:wanted.desired_username });
        }

        const chatId =
            crypto.randomUUID();

        const { data:created,error:createError } =
            await supabase
                .from("wanted_chats")
                .insert({
                    id:chatId,
                    wanted_id:wantedId,
                    buyer_telegram_id:buyerId,
                    seller_telegram_id:sellerId,
                    updated_at:nowIso()
                })
                .select("id,wanted_id,buyer_telegram_id,seller_telegram_id,created_at,updated_at")
                .single();

        if (createError) {
            if (createError.code === "23505") {
                const { data:duplicate } =
                    await supabase
                        .from("wanted_chats")
                        .select("id,wanted_id,buyer_telegram_id,seller_telegram_id,created_at,updated_at")
                        .eq("wanted_id",wantedId)
                        .eq("seller_telegram_id",sellerId)
                        .maybeSingle();

                if (duplicate) {
                    return res.json({ ok:true,chat:duplicate,wanted_username:wanted.desired_username });
                }
            }

            console.error("Wanted chat create:",createError);
            return res.status(500).json({ ok:false,error:"wanted_chat_create_failed" });
        }

        return res.json({ ok:true,chat:created,wanted_username:wanted.desired_username });
    }
);


app.post(
    "/wanted-chats/list",
    async (req,res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );

        if (!auth.ok) {
            return res.status(auth.status).json({ ok:false,error:auth.error });
        }

        const userId =
            Number(auth.user.telegram_id);

        const { data:chats,error:chatsError } =
            await supabase
                .from("wanted_chats")
                .select("id,wanted_id,buyer_telegram_id,seller_telegram_id,created_at,updated_at")
                .or(`buyer_telegram_id.eq.${userId},seller_telegram_id.eq.${userId}`)
                .order("updated_at",{ ascending:false });

        if (chatsError) {
            console.error("Wanted chats list:",chatsError);
            return res.status(500).json({ ok:false,error:"chats_load_failed" });
        }

        if (!chats?.length) {
            return res.json({ ok:true,chats:[] });
        }

        const wantedIds = [...new Set(chats.map(chat => chat.wanted_id))];
        const counterpartIds = [...new Set(chats.map(chat =>
            Number(chat.buyer_telegram_id) === userId
                ? Number(chat.seller_telegram_id)
                : Number(chat.buyer_telegram_id)
        ))];

        const [wantedResult,usersResult,messagesResult] =
            await Promise.all([
                supabase
                    .from("wanted_requests")
                    .select("id,desired_username")
                    .in("id",wantedIds),
                supabase
                    .from("users")
                    .select("telegram_id,first_name,last_name,telegram_username")
                    .in("telegram_id",counterpartIds),
                supabase
                    .from("wanted_chat_messages")
                    .select("id,chat_id,sender_telegram_id,message,read_at,created_at")
                    .in("chat_id",chats.map(chat => chat.id))
                    .order("created_at",{ ascending:false })
            ]);

        const wantedMap =
            new Map((wantedResult.data || []).map(row => [String(row.id),row]));
        const userMap =
            new Map((usersResult.data || []).map(row => [Number(row.telegram_id),row]));
        const lastMessageMap = new Map();

        for (const message of messagesResult.data || []) {
            if (!lastMessageMap.has(String(message.chat_id))) {
                lastMessageMap.set(String(message.chat_id),message);
            }
        }

        const payload =
            chats.map(chat => {
                const counterpartId =
                    Number(chat.buyer_telegram_id) === userId
                        ? Number(chat.seller_telegram_id)
                        : Number(chat.buyer_telegram_id);
                const counterpart = userMap.get(counterpartId) || null;
                const wanted = wantedMap.get(String(chat.wanted_id)) || null;

                return {
                    ...chat,
                    chat_type:"wanted",
                    role:Number(chat.buyer_telegram_id) === userId ? "buyer" : "seller",
                    listing_username:wanted?.desired_username || "username",
                    listing_number:null,
                    counterpart:counterpart
                        ? {
                            telegram_id:Number(counterpart.telegram_id),
                            first_name:counterpart.first_name || "",
                            last_name:counterpart.last_name || "",
                            telegram_username:counterpart.telegram_username || null
                        }
                        : {
                            telegram_id:counterpartId,
                            first_name:"",
                            last_name:"",
                            telegram_username:null
                        },
                    last_message:lastMessageMap.get(String(chat.id)) || null
                };
            });

        return res.json({ ok:true,chats:payload });
    }
);


app.post(
    "/wanted-chat/messages",
    async (req,res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );

        if (!auth.ok) {
            return res.status(auth.status).json({ ok:false,error:auth.error });
        }

        const userId = Number(auth.user.telegram_id);
        const chatId = String(req.body.chat_id || "").trim();
        const access = await getWantedChatForParticipant(chatId,userId);

        if (!access.ok) {
            return res.status(access.error === "chat_access_denied" ? 403 : 404)
                .json({ ok:false,error:access.error });
        }

        const chat = access.chat;

        const { data:wanted } =
            await supabase
                .from("wanted_requests")
                .select("id,desired_username")
                .eq("id",chat.wanted_id)
                .maybeSingle();

        const counterpartId =
            Number(chat.buyer_telegram_id) === userId
                ? Number(chat.seller_telegram_id)
                : Number(chat.buyer_telegram_id);

        const { data:counterpart } =
            await supabase
                .from("users")
                .select("telegram_id,first_name,last_name,telegram_username")
                .eq("telegram_id",counterpartId)
                .maybeSingle();

        const { data:messages,error:messagesError } =
            await supabase
                .from("wanted_chat_messages")
                .select("id,chat_id,sender_telegram_id,message,read_at,created_at")
                .eq("chat_id",chatId)
                .order("created_at",{ ascending:false })
                .limit(100);

        if (messagesError) {
            return res.status(500).json({ ok:false,error:"chat_messages_load_failed" });
        }

        await supabase
            .from("wanted_chat_messages")
            .update({ read_at:nowIso() })
            .eq("chat_id",chatId)
            .neq("sender_telegram_id",userId)
            .is("read_at",null);

        return res.json({
            ok:true,
            chat:{
                ...chat,
                chat_type:"wanted",
                role:Number(chat.buyer_telegram_id) === userId ? "buyer" : "seller",
                listing_username:wanted?.desired_username || "username",
                listing_number:null,
                counterpart:counterpart || {
                    telegram_id:counterpartId,
                    first_name:"",
                    last_name:"",
                    telegram_username:null
                }
            },
            messages:(messages || []).reverse()
        });
    }
);


app.post(
    "/wanted-chat/send",
    async (req,res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );

        if (!auth.ok) {
            return res.status(auth.status).json({ ok:false,error:auth.error });
        }

        const userId = Number(auth.user.telegram_id);
        const chatId = String(req.body.chat_id || "").trim();
        const message = String(req.body.message || "")
            .replace(/\u0000/g,"")
            .trim();

        if (!message || message.length > 1000) {
            return res.status(400).json({ ok:false,error:"invalid_chat_message" });
        }

        const rate =
            await securityRateLimit(
                auth.user,
                "chat_send",
                `wanted:${chatId}`
            );

        if (!rate.ok) {
            return sendRateLimitResponse(res,rate);
        }

        const access =
            await getWantedChatForParticipant(
                chatId,
                userId
            );

        if (!access.ok) {
            return res.status(access.error === "chat_access_denied" ? 403 : 404)
                .json({ ok:false,error:access.error });
        }

        const { data:latestOwn } =
            await supabase
                .from("wanted_chat_messages")
                .select("created_at")
                .eq("chat_id",chatId)
                .eq("sender_telegram_id",userId)
                .order("created_at",{ ascending:false })
                .limit(1)
                .maybeSingle();

        if (
            latestOwn?.created_at &&
            Date.now() - new Date(latestOwn.created_at).getTime() < 1000
        ) {
            return res.status(429).json({ ok:false,error:"chat_too_fast" });
        }

        const messageId = crypto.randomUUID();
        const { data:created,error:createError } =
            await supabase
                .from("wanted_chat_messages")
                .insert({
                    id:messageId,
                    chat_id:chatId,
                    sender_telegram_id:userId,
                    message
                })
                .select("id,chat_id,sender_telegram_id,message,read_at,created_at")
                .single();

        if (createError) {
            return res.status(500).json({ ok:false,error:"chat_send_failed" });
        }

        await recordChatSafetyFlags(
            "wanted",
            chatId,
            created
        );

        await supabase
            .from("wanted_chats")
            .update({ updated_at:nowIso() })
            .eq("id",chatId);

        const chat = access.chat;
        const counterpartId =
            Number(chat.buyer_telegram_id) === userId
                ? Number(chat.seller_telegram_id)
                : Number(chat.buyer_telegram_id);

        const { data:wanted } =
            await supabase
                .from("wanted_requests")
                .select("desired_username")
                .eq("id",chat.wanted_id)
                .maybeSingle();

        await safeSendMessage(
            counterpartId,
            `💬 New Handle Market message about Wanted @${wanted?.desired_username || "username"}.\n\nOpen Handle Market → Profile → Chats.`
        );

        return res.json({ ok:true,message:created });
    }
);


/* =========================================================
   SELLER PROFILES
   ========================================================= */

app.post(
    "/seller-profile/mine",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        const profile =
            auth.user
                .seller_profile ||
            await ensureSellerProfile(
                auth.user.telegram_id
            );


        const payload =
            await buildSellerProfilePayload(
                profile,
                true
            );


        if (!payload) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "seller_profile_not_found"
                    }
                );
        }


        res.json(
            {
                ok: true,
                profile:
                    payload
            }
        );
    }
);


app.post(
    "/seller-profile/update",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        const bio =
            String(
                req.body.bio ||
                ""
            ).trim();


        if (
            bio.length >
            300
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "bio_too_long"
                    }
                );
        }


        if (
            typeof
            req.body.is_public !==
            "boolean"
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "invalid_visibility"
                    }
                );
        }


        const {
            data:
                profile,
            error
        } =
            await supabase
                .from(
                    "seller_profiles"
                )
                .update(
                    {
                        bio:
                            bio ||
                            null,

                        is_public:
                            req.body.is_public,

                        updated_at:
                            nowIso()
                    }
                )
                .eq(
                    "telegram_id",
                    auth.user.telegram_id
                )
                .select(
                    "id,telegram_id,bio,is_public,created_at,updated_at"
                )
                .single();


        if (error) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "seller_profile_update_failed"
                    }
                );
        }


        const payload =
            await buildSellerProfilePayload(
                profile,
                true
            );


        res.json(
            {
                ok: true,
                profile:
                    payload
            }
        );
    }
);


app.get(
    "/seller-profile/:profileId",
    async (req, res) => {

        const profileId =
            String(
                req.params.profileId ||
                ""
            ).trim();


        if (
            !/^[0-9a-fA-F-]{36}$/.test(
                profileId
            )
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "invalid_profile_id"
                    }
                );
        }


        const {
            data:
                profile,
            error
        } =
            await supabase
                .from(
                    "seller_profiles"
                )
                .select(
                    "id,telegram_id,bio,is_public,created_at,updated_at"
                )
                .eq(
                    "id",
                    profileId
                )
                .eq(
                    "is_public",
                    true
                )
                .maybeSingle();


        if (
            error ||
            !profile
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "seller_profile_not_found"
                    }
                );
        }


        const payload =
            await buildSellerProfilePayload(
                profile,
                false
            );


        if (!payload) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "seller_profile_not_found"
                    }
                );
        }


        res.json(
            {
                ok: true,
                profile:
                    payload
            }
        );
    }
);


/* =========================================================
   V42 FOLLOW SELLER
   Followers never receive the seller's Telegram username,
   Telegram ID, email or other private contact details.
   ========================================================= */

async function resolvePublicSellerProfileForFollow(
    profileId
) {

    const id =
        String(
            profileId ||
            ""
        ).trim();


    if (
        !/^[0-9a-fA-F-]{36}$/.test(id)
    ) {
        return null;
    }


    const {
        data:
            profile
    } =
        await supabase
            .from("seller_profiles")
            .select(
                "id,telegram_id,is_public"
            )
            .eq(
                "id",
                id
            )
            .eq(
                "is_public",
                true
            )
            .maybeSingle();


    return profile ||
        null;
}


async function sellerFollowerCount(
    sellerTelegramId
) {

    const {
        count
    } =
        await supabase
            .from("seller_follows")
            .select(
                "follower_telegram_id",
                {
                    count:"exact",
                    head:true
                }
            )
            .eq(
                "seller_telegram_id",
                Number(
                    sellerTelegramId
                )
            );


    return Number(
        count ||
        0
    );
}


app.post(
    "/seller-follow/status",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {
            return res
                .status(auth.status)
                .json({
                    ok:false,
                    error:auth.error
                });
        }


        const profile =
            await resolvePublicSellerProfileForFollow(
                req.body.profile_id
            );


        if (!profile) {
            return res
                .status(404)
                .json({
                    ok:false,
                    error:
                        "seller_profile_not_found"
                });
        }


        const followerId =
            Number(
                auth.user.telegram_id
            );

        const sellerId =
            Number(
                profile.telegram_id
            );

        const canFollow =
            followerId !==
            sellerId;


        let following = false;


        if (canFollow) {

            const {
                data:
                    existing
            } =
                await supabase
                    .from("seller_follows")
                    .select(
                        "seller_telegram_id"
                    )
                    .eq(
                        "follower_telegram_id",
                        followerId
                    )
                    .eq(
                        "seller_telegram_id",
                        sellerId
                    )
                    .maybeSingle();

            following =
                Boolean(existing);
        }


        res.json({
            ok:true,
            can_follow:canFollow,
            following,
            followers_count:
                await sellerFollowerCount(
                    sellerId
                )
        });
    }
);


app.post(
    "/seller-follow/toggle",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {
            return res
                .status(auth.status)
                .json({
                    ok:false,
                    error:auth.error
                });
        }


        const profile =
            await resolvePublicSellerProfileForFollow(
                req.body.profile_id
            );


        if (!profile) {
            return res
                .status(404)
                .json({
                    ok:false,
                    error:
                        "seller_profile_not_found"
                });
        }


        const followerId =
            Number(
                auth.user.telegram_id
            );

        const sellerId =
            Number(
                profile.telegram_id
            );


        if (
            followerId ===
            sellerId
        ) {
            return res
                .status(400)
                .json({
                    ok:false,
                    error:
                        "cannot_follow_yourself"
                });
        }


        const limit =
            await securityRateLimit(
                auth.user,
                "seller_follow_toggle",
                profile.id
            );


        if (!limit.ok) {
            return sendRateLimitResponse(
                res,
                limit
            );
        }


        const {
            data:
                existing
        } =
            await supabase
                .from("seller_follows")
                .select(
                    "seller_telegram_id"
                )
                .eq(
                    "follower_telegram_id",
                    followerId
                )
                .eq(
                    "seller_telegram_id",
                    sellerId
                )
                .maybeSingle();


        let following;


        if (existing) {

            const {
                error
            } =
                await supabase
                    .from("seller_follows")
                    .delete()
                    .eq(
                        "follower_telegram_id",
                        followerId
                    )
                    .eq(
                        "seller_telegram_id",
                        sellerId
                    );


            if (error) {
                return res
                    .status(500)
                    .json({
                        ok:false,
                        error:
                            "seller_follow_update_failed"
                    });
            }


            following = false;

        } else {

            const {
                error
            } =
                await supabase
                    .from("seller_follows")
                    .insert({
                        follower_telegram_id:
                            followerId,
                        seller_telegram_id:
                            sellerId
                    });


            if (
                error &&
                error.code !== "23505"
            ) {
                return res
                    .status(500)
                    .json({
                        ok:false,
                        error:
                            "seller_follow_update_failed"
                    });
            }


            following = true;
        }


        res.json({
            ok:true,
            following,
            followers_count:
                await sellerFollowerCount(
                    sellerId
                )
        });
    }
);


app.post(
    "/seller-follow/list",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {
            return res
                .status(auth.status)
                .json({
                    ok:false,
                    error:auth.error
                });
        }


        const {
            data:
                follows,
            error
        } =
            await supabase
                .from("seller_follows")
                .select(
                    "seller_telegram_id,created_at"
                )
                .eq(
                    "follower_telegram_id",
                    auth.user.telegram_id
                )
                .order(
                    "created_at",
                    {
                        ascending:false
                    }
                )
                .limit(100);


        if (error) {
            return res
                .status(500)
                .json({
                    ok:false,
                    error:
                        "seller_follows_load_failed"
                });
        }


        const sellerIds =
            (follows || [])
                .map(
                    row =>
                        Number(
                            row.seller_telegram_id
                        )
                )
                .filter(Boolean);


        if (!sellerIds.length) {
            return res.json({
                ok:true,
                sellers:[]
            });
        }


        const {
            data:
                profiles
        } =
            await supabase
                .from("seller_profiles")
                .select(
                    "id,telegram_id,bio,is_public,created_at,updated_at"
                )
                .in(
                    "telegram_id",
                    sellerIds
                )
                .eq(
                    "is_public",
                    true
                );


        const orderMap =
            new Map(
                sellerIds.map(
                    (id,index) => [
                        String(id),
                        index
                    ]
                )
            );


        const sellers = [];


        for (
            const profile of
            (profiles || [])
                .sort(
                    (a,b) =>
                        Number(
                            orderMap.get(
                                String(a.telegram_id)
                            ) ||
                            0
                        ) -
                        Number(
                            orderMap.get(
                                String(b.telegram_id)
                            ) ||
                            0
                        )
                )
        ) {

            const payload =
                await buildSellerProfilePayload(
                    profile,
                    false
                );


            if (!payload) {
                continue;
            }


            sellers.push({
                id:payload.id,
                display_name:
                    payload.display_name,
                avatar_url:
                    payload.avatar_url,
                seller_since:
                    payload.seller_since,
                presence:
                    payload.presence,
                response_time:
                    payload.response_time,
                stats:
                    payload.stats,
                latest_listings:
                    (payload.listings || [])
                        .slice(0,3)
            });
        }


        res.json({
            ok:true,
            sellers
        });
    }
);


async function notifySellerFollowersOfListing(
    listingId
) {

    try {

        const {
            data:
                listing
        } =
            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username,asking_price,status,is_paused,is_frozen,listing_plan,listing_expires_at,seller_follow_notified_at"
                )
                .eq(
                    "id",
                    listingId
                )
                .maybeSingle();


        if (
            !listing ||
            listing.seller_follow_notified_at ||
            !listingIsPubliclyAvailable(
                listing
            )
        ) {
            return;
        }


        const {
            data:
                profile
        } =
            await supabase
                .from("seller_profiles")
                .select(
                    "id,is_public"
                )
                .eq(
                    "telegram_id",
                    listing.seller_telegram_id
                )
                .eq(
                    "is_public",
                    true
                )
                .maybeSingle();


        /* Mark even if the profile currently has no followers.
           This prevents old listings from becoming "new" later. */
        const markedAt =
            nowIso();

        const {
            data:
                marked
        } =
            await supabase
                .from("listings")
                .update({
                    seller_follow_notified_at:
                        markedAt
                })
                .eq(
                    "id",
                    listing.id
                )
                .is(
                    "seller_follow_notified_at",
                    null
                )
                .select("id")
                .maybeSingle();


        if (!marked) {
            return;
        }


        if (!profile) {
            return;
        }


        const {
            data:
                followers
        } =
            await supabase
                .from("seller_follows")
                .select(
                    "follower_telegram_id"
                )
                .eq(
                    "seller_telegram_id",
                    listing.seller_telegram_id
                )
                .limit(1000);


        const lot =
            Number.isSafeInteger(
                Number(
                    listing.listing_number
                )
            )
                ? `LOT #${String(Number(listing.listing_number)).padStart(6,"0")} · `
                : "";


        const text =
            `🏪 A seller you follow added a new listing\n\n${lot}@${listing.whatsapp_username}\n$${Number(listing.asking_price || 0).toLocaleString("en-US")}\n\nOpen Handle Market → Profile → Following Sellers.`;


        for (
            const follower of
            followers || []
        ) {

            if (
                Number(
                    follower.follower_telegram_id
                ) ===
                Number(
                    listing.seller_telegram_id
                )
            ) {
                continue;
            }


            await sendUserNotification(
                follower.follower_telegram_id,
                "seller_updates",
                text
            );
        }

    } catch (error) {

        console.error(
            "Seller follower notification:",
            error
        );

        await logSystemError(
            "seller_follower_notification",
            error,
            {
                listing_id:
                    String(
                        listingId ||
                        ""
                    )
            }
        );
    }
}


/* =========================================================
   INTERNAL CHAT
   Buyer can start a chat only after seller contact is unlocked.
   Seller and buyer can continue the conversation from Profile → Chats.
   ========================================================= */

async function getChatForParticipant(
    chatId,
    telegramId
) {

    const {
        data:
            chat,
        error
    } =
        await supabase
            .from(
                "listing_chats"
            )
            .select(
                "id,listing_id,buyer_telegram_id,seller_telegram_id,created_at,updated_at"
            )
            .eq(
                "id",
                chatId
            )
            .maybeSingle();


    if (
        error ||
        !chat
    ) {

        return {
            ok:false,
            error:
                "chat_not_found"
        };
    }


    const userId =
        Number(
            telegramId
        );


    if (
        Number(
            chat.buyer_telegram_id
        ) !==
        userId &&
        Number(
            chat.seller_telegram_id
        ) !==
        userId
    ) {

        return {
            ok:false,
            error:
                "chat_access_denied"
        };
    }


    return {
        ok:true,
        chat
    };
}


app.post(
    "/chat/open",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok:false,
                        error:
                            auth.error
                    }
                );
        }


        const buyerId =
            Number(
                auth.user.telegram_id
            );


        const listingId =
            String(
                req.body.listing_id ||
                ""
            ).trim();


        if (!listingId) {

            return res
                .status(400)
                .json(
                    {
                        ok:false,
                        error:
                            "invalid_listing_id"
                    }
                );
        }


        const {
            data:
                listing,
            error:
                listingError
        } =
            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username"
                )
                .eq(
                    "id",
                    listingId
                )
                .maybeSingle();


        if (
            listingError ||
            !listing
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok:false,
                        error:
                            "listing_not_found"
                    }
                );
        }


        const sellerId =
            Number(
                listing.seller_telegram_id
            );


        if (
            buyerId ===
            sellerId
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok:false,
                        error:
                            "owner_chat_requires_buyer"
                    }
                );
        }


        const unlocked =
            await buyerHasContactAccess(
                buyerId,
                listingId
            );


        if (!unlocked) {

            return res
                .status(403)
                .json(
                    {
                        ok:false,
                        error:
                            "contact_unlock_required"
                    }
                );
        }


        const {
            data:
                existing,
            error:
                existingError
        } =
            await supabase
                .from(
                    "listing_chats"
                )
                .select(
                    "id,listing_id,buyer_telegram_id,seller_telegram_id,created_at,updated_at"
                )
                .eq(
                    "listing_id",
                    listingId
                )
                .eq(
                    "buyer_telegram_id",
                    buyerId
                )
                .maybeSingle();


        if (existingError) {

            console.error(
                "Chat lookup:",
                existingError
            );


            return res
                .status(500)
                .json(
                    {
                        ok:false,
                        error:
                            "chat_lookup_failed"
                    }
                );
        }


        if (existing) {

            return res.json(
                {
                    ok:true,
                    chat:
                        existing,
                    listing_username:
                        listing.whatsapp_username
                }
            );
        }


        const chatId =
            crypto.randomUUID();


        const {
            data:
                created,
            error:
                createError
        } =
            await supabase
                .from(
                    "listing_chats"
                )
                .insert(
                    {
                        id:
                            chatId,

                        listing_id:
                            listingId,

                        buyer_telegram_id:
                            buyerId,

                        seller_telegram_id:
                            sellerId,

                        updated_at:
                            nowIso()
                    }
                )
                .select(
                    "id,listing_id,buyer_telegram_id,seller_telegram_id,created_at,updated_at"
                )
                .single();


        if (createError) {

            /* A simultaneous request may have created the same chat. */
            if (
                createError.code ===
                "23505"
            ) {

                const {
                    data:
                        duplicate
                } =
                    await supabase
                        .from(
                            "listing_chats"
                        )
                        .select(
                            "id,listing_id,buyer_telegram_id,seller_telegram_id,created_at,updated_at"
                        )
                        .eq(
                            "listing_id",
                            listingId
                        )
                        .eq(
                            "buyer_telegram_id",
                            buyerId
                        )
                        .maybeSingle();


                if (duplicate) {

                    return res.json(
                        {
                            ok:true,
                            chat:
                                duplicate,
                            listing_username:
                                listing.whatsapp_username
                        }
                    );
                }
            }


            console.error(
                "Chat create:",
                createError
            );


            return res
                .status(500)
                .json(
                    {
                        ok:false,
                        error:
                            "chat_create_failed"
                    }
                );
        }


        return res.json(
            {
                ok:true,
                chat:
                    created,
                listing_username:
                    listing.whatsapp_username
            }
        );
    }
);


app.post(
    "/chats/list",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok:false,
                        error:
                            auth.error
                    }
                );
        }


        const userId =
            Number(
                auth.user.telegram_id
            );


        const {
            data:
                chats,
            error:
                chatsError
        } =
            await supabase
                .from(
                    "listing_chats"
                )
                .select(
                    "id,listing_id,buyer_telegram_id,seller_telegram_id,created_at,updated_at"
                )
                .or(
                    `buyer_telegram_id.eq.${userId},seller_telegram_id.eq.${userId}`
                )
                .order(
                    "updated_at",
                    {
                        ascending:false
                    }
                );


        if (chatsError) {

            console.error(
                "Chats list:",
                chatsError
            );


            return res
                .status(500)
                .json(
                    {
                        ok:false,
                        error:
                            "chats_load_failed"
                    }
                );
        }


        if (
            !chats?.length
        ) {

            return res.json(
                {
                    ok:true,
                    chats:[]
                }
            );
        }


        const listingIds =
            [
                ...new Set(
                    chats.map(
                        chat =>
                            chat.listing_id
                    )
                )
            ];


        const counterpartIds =
            [
                ...new Set(
                    chats.map(
                        chat =>
                            Number(
                                chat.buyer_telegram_id
                            ) ===
                            userId
                                ? Number(
                                    chat.seller_telegram_id
                                )
                                : Number(
                                    chat.buyer_telegram_id
                                )
                    )
                )
            ];


        const [
            listingsResult,
            usersResult,
            messagesResult
        ] =
            await Promise.all(
                [
                    supabase
                        .from("listings")
                        .select(
                            "id,listing_number,whatsapp_username"
                        )
                        .in(
                            "id",
                            listingIds
                        ),

                    supabase
                        .from("users")
                        .select(
                            "telegram_id,first_name,last_name,telegram_username"
                        )
                        .in(
                            "telegram_id",
                            counterpartIds
                        ),

                    supabase
                        .from(
                            "chat_messages"
                        )
                        .select(
                            "id,chat_id,sender_telegram_id,message,read_at,created_at"
                        )
                        .in(
                            "chat_id",
                            chats.map(
                                chat =>
                                    chat.id
                            )
                        )
                        .order(
                            "created_at",
                            {
                                ascending:false
                            }
                        )
                ]
            );


        const listingMap =
            new Map(
                (
                    listingsResult.data ||
                    []
                ).map(
                    listing =>
                        [
                            listing.id,
                            listing
                        ]
                )
            );


        const userMap =
            new Map(
                (
                    usersResult.data ||
                    []
                ).map(
                    user =>
                        [
                            Number(
                                user.telegram_id
                            ),
                            user
                        ]
                )
            );


        const lastMessageMap =
            new Map();


        for (
            const message of
            messagesResult.data ||
            []
        ) {

            if (
                !lastMessageMap.has(
                    message.chat_id
                )
            ) {

                lastMessageMap.set(
                    message.chat_id,
                    message
                );
            }
        }


        const payload =
            chats.map(
                chat => {

                    const counterpartId =
                        Number(
                            chat.buyer_telegram_id
                        ) ===
                        userId
                            ? Number(
                                chat.seller_telegram_id
                            )
                            : Number(
                                chat.buyer_telegram_id
                            );


                    const counterpart =
                        userMap.get(
                            counterpartId
                        ) ||
                        null;


                    const listing =
                        listingMap.get(
                            chat.listing_id
                        ) ||
                        null;


                    const lastMessage =
                        lastMessageMap.get(
                            chat.id
                        ) ||
                        null;


                    return {
                        ...chat,

                        role:
                            Number(
                                chat.buyer_telegram_id
                            ) ===
                            userId
                                ? "buyer"
                                : "seller",

                        listing_username:
                            listing?.whatsapp_username ||
                            "username",

                        listing_number:
                            listing?.listing_number ||
                            null,

                        counterpart:
                            counterpart
                                ? {
                                    telegram_id:
                                        Number(
                                            counterpart.telegram_id
                                        ),

                                    first_name:
                                        counterpart.first_name ||
                                        "",

                                    last_name:
                                        counterpart.last_name ||
                                        "",

                                    telegram_username:
                                        counterpart.telegram_username ||
                                        null
                                }
                                : {
                                    telegram_id:
                                        counterpartId,
                                    first_name:"",
                                    last_name:"",
                                    telegram_username:null
                                },

                        last_message:
                            lastMessage
                    };
                }
            );


        return res.json(
            {
                ok:true,
                chats:
                    payload
            }
        );
    }
);


app.post(
    "/chat/messages",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok:false,
                        error:
                            auth.error
                    }
                );
        }


        const userId =
            Number(
                auth.user.telegram_id
            );


        const chatId =
            String(
                req.body.chat_id ||
                ""
            ).trim();


        const access =
            await getChatForParticipant(
                chatId,
                userId
            );


        if (!access.ok) {

            return res
                .status(
                    access.error ===
                    "chat_access_denied"
                        ? 403
                        : 404
                )
                .json(
                    {
                        ok:false,
                        error:
                            access.error
                    }
                );
        }


        const chat =
            access.chat;


        const {
            data:
                listing
        } =
            await supabase
                .from("listings")
                .select(
                    "id,listing_number,whatsapp_username"
                )
                .eq(
                    "id",
                    chat.listing_id
                )
                .maybeSingle();


        const counterpartId =
            Number(
                chat.buyer_telegram_id
            ) ===
            userId
                ? Number(
                    chat.seller_telegram_id
                )
                : Number(
                    chat.buyer_telegram_id
                );


        const {
            data:
                counterpart
        } =
            await supabase
                .from("users")
                .select(
                    "telegram_id,first_name,last_name,telegram_username"
                )
                .eq(
                    "telegram_id",
                    counterpartId
                )
                .maybeSingle();


        const {
            data:
                messages,
            error:
                messagesError
        } =
            await supabase
                .from(
                    "chat_messages"
                )
                .select(
                    "id,chat_id,sender_telegram_id,message,read_at,created_at"
                )
                .eq(
                    "chat_id",
                    chatId
                )
                .order(
                    "created_at",
                    {
                        ascending:false
                    }
                )
                .limit(100);


        if (messagesError) {

            console.error(
                "Chat messages:",
                messagesError
            );


            return res
                .status(500)
                .json(
                    {
                        ok:false,
                        error:
                            "chat_messages_load_failed"
                    }
                );
        }


        await supabase
            .from("chat_messages")
            .update(
                {
                    read_at:
                        nowIso()
                }
            )
            .eq(
                "chat_id",
                chatId
            )
            .neq(
                "sender_telegram_id",
                userId
            )
            .is(
                "read_at",
                null
            );


        return res.json(
            {
                ok:true,

                chat:{
                    ...chat,

                    role:
                        Number(
                            chat.buyer_telegram_id
                        ) ===
                        userId
                            ? "buyer"
                            : "seller",

                    listing_username:
                        listing?.whatsapp_username ||
                        "username",

                    listing_number:
                        listing?.listing_number ||
                        null,

                    counterpart:
                        counterpart ||
                        {
                            telegram_id:
                                counterpartId,
                            first_name:"",
                            last_name:"",
                            telegram_username:null
                        }
                },

                messages:
                    (
                        messages ||
                        []
                    ).reverse()
            }
        );
    }
);


app.post(
    "/chat/send",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok:false,
                        error:
                            auth.error
                    }
                );
        }


        const userId =
            Number(
                auth.user.telegram_id
            );



        const chatSecurity =
            await securityRateLimit(
                auth.user,
                "chat_send",
                req.body.chat_id ||
                null
            );


        if (!chatSecurity.ok) {
            return sendRateLimitResponse(
                res,
                chatSecurity
            );
        }


        const chatId =
            String(
                req.body.chat_id ||
                ""
            ).trim();


        const message =
            String(
                req.body.message ||
                ""
            )
                .replace(
                    /\u0000/g,
                    ""
                )
                .trim();


        if (
            !message ||
            message.length >
            1000
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok:false,
                        error:
                            "invalid_chat_message"
                    }
                );
        }


        const access =
            await getChatForParticipant(
                chatId,
                userId
            );


        if (!access.ok) {

            return res
                .status(
                    access.error ===
                    "chat_access_denied"
                        ? 403
                        : 404
                )
                .json(
                    {
                        ok:false,
                        error:
                            access.error
                    }
                );
        }


        /* Basic anti-spam: at least one second between messages. */
        const {
            data:
                latestOwn
        } =
            await supabase
                .from(
                    "chat_messages"
                )
                .select(
                    "created_at"
                )
                .eq(
                    "chat_id",
                    chatId
                )
                .eq(
                    "sender_telegram_id",
                    userId
                )
                .order(
                    "created_at",
                    {
                        ascending:false
                    }
                )
                .limit(1)
                .maybeSingle();


        if (
            latestOwn?.created_at &&
            Date.now() -
            new Date(
                latestOwn.created_at
            ).getTime() <
            1000
        ) {

            return res
                .status(429)
                .json(
                    {
                        ok:false,
                        error:
                            "chat_too_fast"
                    }
                );
        }


        const messageId =
            crypto.randomUUID();


        const {
            data:
                created,
            error:
                createError
        } =
            await supabase
                .from(
                    "chat_messages"
                )
                .insert(
                    {
                        id:
                            messageId,

                        chat_id:
                            chatId,

                        sender_telegram_id:
                            userId,

                        message
                    }
                )
                .select(
                    "id,chat_id,sender_telegram_id,message,read_at,created_at"
                )
                .single();


        if (createError) {

            console.error(
                "Chat message create:",
                createError
            );


            return res
                .status(500)
                .json(
                    {
                        ok:false,
                        error:
                            "chat_send_failed"
                    }
                );
        }


        await recordChatSafetyFlags(
            "listing",
            chatId,
            created
        );


        await supabase
            .from(
                "listing_chats"
            )
            .update(
                {
                    updated_at:
                        nowIso()
                }
            )
            .eq(
                "id",
                chatId
            );


        const chat =
            access.chat;


        const recipientId =
            Number(
                chat.buyer_telegram_id
            ) ===
            userId
                ? Number(
                    chat.seller_telegram_id
                )
                : Number(
                    chat.buyer_telegram_id
                );


        const {
            data:
                listing
        } =
            await supabase
                .from("listings")
                .select(
                    "listing_number,whatsapp_username"
                )
                .eq(
                    "id",
                    chat.listing_id
                )
                .maybeSingle();


        await safeSendChatMessage(
            recipientId,
            `💬 New Handle Market chat message about @${listing?.whatsapp_username || "username"}.\n\nOpen Handle Market → Profile → Chats.`
        );


        return res.json(
            {
                ok:true,
                message:
                    created
            }
        );
    }
);



/* =========================================================
   SUPPORT CENTER / SUPPORT TICKETS
   Users can contact Handle Market support inside the Mini App.
   Admins can answer and manage ticket status from Admin Panel.
   ========================================================= */

const SUPPORT_CATEGORIES = [
    "General Question",
    "Listing Problem",
    "Payment / Stars",
    "Contact Problem",
    "Report a Problem",
    "Account Problem",
    "Other"
];


function supportTicketNumberText(
    value
) {

    const number =
        Number(
            value
        );


    if (
        !Number.isFinite(
            number
        ) ||
        number <= 0
    ) {

        return "#------";
    }


    return "#" +
        String(
            Math.trunc(
                number
            )
        ).padStart(
            6,
            "0"
        );
}


async function getSupportTicketAccess(
    ticketId,
    authUser
) {

    const {
        data:
            ticket,
        error
    } =
        await supabase
            .from(
                "support_tickets"
            )
            .select(
                "id,ticket_number,user_telegram_id,category,related_listing_id,status,created_at,updated_at"
            )
            .eq(
                "id",
                ticketId
            )
            .maybeSingle();


    if (
        error ||
        !ticket
    ) {

        return {
            ok:false,
            error:
                "support_ticket_not_found"
        };
    }


    const userId =
        Number(
            authUser.telegram_id
        );


    const isOwner =
        Number(
            ticket.user_telegram_id
        ) ===
        userId;


    const isAdmin =
        Boolean(
            authUser.is_admin
        );


    if (
        !isOwner &&
        !isAdmin
    ) {

        return {
            ok:false,
            error:
                "support_ticket_access_denied"
        };
    }


    return {
        ok:true,
        ticket,
        isOwner,
        isAdmin
    };
}


async function buildSupportTicketPayload(
    ticket,
    viewerTelegramId,
    viewerIsAdmin = false
) {

    const userId =
        Number(
            ticket.user_telegram_id
        );


    const [
        userResult,
        listingResult
    ] =
        await Promise.all(
            [
                supabase
                    .from("users")
                    .select(
                        "telegram_id,first_name,last_name,telegram_username"
                    )
                    .eq(
                        "telegram_id",
                        userId
                    )
                    .maybeSingle(),

                ticket.related_listing_id
                    ? supabase
                        .from("listings")
                        .select(
                            "id,listing_number,whatsapp_username"
                        )
                        .eq(
                            "id",
                            ticket.related_listing_id
                        )
                        .maybeSingle()
                    : Promise.resolve(
                        {
                            data:null,
                            error:null
                        }
                    )
            ]
        );


    const owner =
        userResult.data ||
        {
            telegram_id:
                userId,
            first_name:"",
            last_name:"",
            telegram_username:null
        };


    const listing =
        listingResult.data ||
        null;


    return {
        ...ticket,

        viewer_role:
            viewerIsAdmin &&
            Number(
                viewerTelegramId
            ) !==
            userId
                ? "admin"
                : "user",

        user:{
            telegram_id:
                Number(
                    owner.telegram_id
                ),
            first_name:
                owner.first_name ||
                "",
            last_name:
                owner.last_name ||
                "",
            telegram_username:
                owner.telegram_username ||
                null
        },

        related_listing:
            listing
                ? {
                    id:
                        listing.id,
                    listing_number:
                        listing.listing_number ||
                        null,
                    whatsapp_username:
                        listing.whatsapp_username ||
                        null
                }
                : null
    };
}


app.post(
    "/support/create",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok:false,
                        error:
                            auth.error
                    }
                );
        }


        const userId =
            Number(
                auth.user.telegram_id
            );



        const supportSecurity =
            await securityRateLimit(
                auth.user,
                "support_create"
            );


        if (!supportSecurity.ok) {
            return sendRateLimitResponse(
                res,
                supportSecurity
            );
        }


        const category =
            String(
                req.body.category ||
                "General Question"
            )
                .trim();


        if (
            !SUPPORT_CATEGORIES.includes(
                category
            )
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok:false,
                        error:
                            "invalid_support_category"
                    }
                );
        }


        const message =
            String(
                req.body.message ||
                ""
            )
                .replace(
                    /\u0000/g,
                    ""
                )
                .trim();


        if (
            !message ||
            message.length >
            2000
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok:false,
                        error:
                            "invalid_support_message"
                    }
                );
        }


        let relatedListing =
            null;


        const rawListingNumber =
            String(
                req.body.related_listing_number ||
                ""
            )
                .replace(
                    /[^0-9]/g,
                    ""
                )
                .trim();


        if (rawListingNumber) {

            const listingNumber =
                Number(
                    rawListingNumber
                );


            if (
                !Number.isSafeInteger(
                    listingNumber
                ) ||
                listingNumber <= 0
            ) {

                return res
                    .status(400)
                    .json(
                        {
                            ok:false,
                            error:
                                "invalid_related_listing_number"
                        }
                    );
            }


            const {
                data:
                    listing,
                error:
                    listingError
            } =
                await supabase
                    .from("listings")
                    .select(
                        "id,listing_number,whatsapp_username"
                    )
                    .eq(
                        "listing_number",
                        listingNumber
                    )
                    .maybeSingle();


            if (
                listingError ||
                !listing
            ) {

                return res
                    .status(404)
                    .json(
                        {
                            ok:false,
                            error:
                                "related_listing_not_found"
                        }
                    );
            }


            relatedListing =
                listing;
        }


        const ticketId =
            crypto.randomUUID();


        const {
            data:
                ticket,
            error:
                ticketError
        } =
            await supabase
                .from(
                    "support_tickets"
                )
                .insert(
                    {
                        id:
                            ticketId,
                        user_telegram_id:
                            userId,
                        category,
                        related_listing_id:
                            relatedListing?.id ||
                            null,
                        status:
                            "open",
                        updated_at:
                            nowIso()
                    }
                )
                .select(
                    "id,ticket_number,user_telegram_id,category,related_listing_id,status,created_at,updated_at"
                )
                .single();


        if (ticketError) {

            console.error(
                "Support ticket create:",
                ticketError
            );


            return res
                .status(500)
                .json(
                    {
                        ok:false,
                        error:
                            "support_ticket_create_failed"
                    }
                );
        }


        const {
            error:
                messageError
        } =
            await supabase
                .from(
                    "support_messages"
                )
                .insert(
                    {
                        id:
                            crypto.randomUUID(),
                        ticket_id:
                            ticketId,
                        sender_telegram_id:
                            userId,
                        sender_role:
                            "user",
                        message
                    }
                );


        if (messageError) {

            console.error(
                "Support first message create:",
                messageError
            );


            await supabase
                .from(
                    "support_tickets"
                )
                .delete()
                .eq(
                    "id",
                    ticketId
                );


            return res
                .status(500)
                .json(
                    {
                        ok:false,
                        error:
                            "support_ticket_create_failed"
                    }
                );
        }


        const userName =
            [
                auth.user.first_name,
                auth.user.last_name
            ]
                .filter(Boolean)
                .join(" ") ||
            (
                auth.user.telegram_username
                    ? "@" +
                        auth.user.telegram_username
                    : "Telegram User"
            );


        await notifyAdmins(
            `🎧 New Support Ticket ${supportTicketNumberText(ticket.ticket_number)}\n\n` +
            `User: ${userName}\n` +
            `Telegram ID: ${userId}\n` +
            `Category: ${category}` +
            (
                relatedListing
                    ? `\nRelated: LOT ${supportTicketNumberText(relatedListing.listing_number)} · @${relatedListing.whatsapp_username}`
                    : ""
            ) +
            `\n\nOpen Handle Market → Profile → Admin Panel → Support Tickets.`
        );


        const payload =
            await buildSupportTicketPayload(
                ticket,
                userId,
                Boolean(
                    auth.user.is_admin
                )
            );


        return res.json(
            {
                ok:true,
                ticket:
                    payload
            }
        );
    }
);


app.post(
    "/support/list",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok:false,
                        error:
                            auth.error
                    }
                );
        }


        const userId =
            Number(
                auth.user.telegram_id
            );


        const {
            data:
                tickets,
            error:
                ticketsError
        } =
            await supabase
                .from(
                    "support_tickets"
                )
                .select(
                    "id,ticket_number,user_telegram_id,category,related_listing_id,status,created_at,updated_at"
                )
                .eq(
                    "user_telegram_id",
                    userId
                )
                .order(
                    "updated_at",
                    {
                        ascending:false
                    }
                )
                .limit(50);


        if (ticketsError) {

            console.error(
                "Support ticket list:",
                ticketsError
            );


            return res
                .status(500)
                .json(
                    {
                        ok:false,
                        error:
                            "support_tickets_load_failed"
                    }
                );
        }


        if (!tickets?.length) {

            return res.json(
                {
                    ok:true,
                    tickets:[]
                }
            );
        }


        const listingIds =
            [
                ...new Set(
                    tickets
                        .map(
                            ticket =>
                                ticket.related_listing_id
                        )
                        .filter(Boolean)
                )
            ];


        const [
            listingResult,
            messageResult
        ] =
            await Promise.all(
                [
                    listingIds.length
                        ? supabase
                            .from("listings")
                            .select(
                                "id,listing_number,whatsapp_username"
                            )
                            .in(
                                "id",
                                listingIds
                            )
                        : Promise.resolve(
                            {
                                data:[],
                                error:null
                            }
                        ),

                    supabase
                        .from(
                            "support_messages"
                        )
                        .select(
                            "id,ticket_id,sender_telegram_id,sender_role,message,read_at,created_at"
                        )
                        .in(
                            "ticket_id",
                            tickets.map(
                                ticket =>
                                    ticket.id
                            )
                        )
                        .order(
                            "created_at",
                            {
                                ascending:false
                            }
                        )
                ]
            );


        const listingMap =
            new Map(
                (
                    listingResult.data ||
                    []
                ).map(
                    listing =>
                        [
                            listing.id,
                            listing
                        ]
                )
            );


        const lastMessageMap =
            new Map();


        for (
            const message of
            messageResult.data ||
            []
        ) {

            if (
                !lastMessageMap.has(
                    message.ticket_id
                )
            ) {

                lastMessageMap.set(
                    message.ticket_id,
                    message
                );
            }
        }


        return res.json(
            {
                ok:true,
                tickets:
                    tickets.map(
                        ticket => {

                            const listing =
                                listingMap.get(
                                    ticket.related_listing_id
                                ) ||
                                null;


                            return {
                                ...ticket,
                                related_listing:
                                    listing,
                                last_message:
                                    lastMessageMap.get(
                                        ticket.id
                                    ) ||
                                    null
                            };
                        }
                    )
            }
        );
    }
);


app.post(
    "/support/messages",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok:false,
                        error:
                            auth.error
                    }
                );
        }


        const ticketId =
            String(
                req.body.ticket_id ||
                ""
            ).trim();


        const access =
            await getSupportTicketAccess(
                ticketId,
                auth.user
            );


        if (!access.ok) {

            return res
                .status(
                    access.error ===
                    "support_ticket_access_denied"
                        ? 403
                        : 404
                )
                .json(
                    {
                        ok:false,
                        error:
                            access.error
                    }
                );
        }


        const {
            data:
                messages,
            error:
                messagesError
        } =
            await supabase
                .from(
                    "support_messages"
                )
                .select(
                    "id,ticket_id,sender_telegram_id,sender_role,message,read_at,created_at"
                )
                .eq(
                    "ticket_id",
                    ticketId
                )
                .order(
                    "created_at",
                    {
                        ascending:false
                    }
                )
                .limit(200);


        if (messagesError) {

            console.error(
                "Support messages:",
                messagesError
            );


            return res
                .status(500)
                .json(
                    {
                        ok:false,
                        error:
                            "support_messages_load_failed"
                    }
                );
        }


        if (
            auth.user.is_admin
        ) {

            await supabase
                .from("support_messages")
                .update(
                    {
                        read_at:
                            nowIso()
                    }
                )
                .eq(
                    "ticket_id",
                    ticketId
                )
                .eq(
                    "sender_role",
                    "user"
                )
                .is(
                    "read_at",
                    null
                );

        } else {

            await supabase
                .from("support_messages")
                .update(
                    {
                        read_at:
                            nowIso()
                    }
                )
                .eq(
                    "ticket_id",
                    ticketId
                )
                .eq(
                    "sender_role",
                    "admin"
                )
                .is(
                    "read_at",
                    null
                );
        }


        const ticket =
            await buildSupportTicketPayload(
                access.ticket,
                auth.user.telegram_id,
                Boolean(
                    auth.user.is_admin
                )
            );


        return res.json(
            {
                ok:true,
                ticket,
                messages:
                    (
                        messages ||
                        []
                    ).reverse()
            }
        );
    }
);


app.post(
    "/support/send",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok:false,
                        error:
                            auth.error
                    }
                );
        }


        const userId =
            Number(
                auth.user.telegram_id
            );



        const supportSecurity =
            await securityRateLimit(
                auth.user,
                "support_send",
                req.body.ticket_id ||
                null
            );


        if (!supportSecurity.ok) {
            return sendRateLimitResponse(
                res,
                supportSecurity
            );
        }


        const ticketId =
            String(
                req.body.ticket_id ||
                ""
            ).trim();


        const message =
            String(
                req.body.message ||
                ""
            )
                .replace(
                    /\u0000/g,
                    ""
                )
                .trim();


        if (
            !message ||
            message.length >
            2000
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok:false,
                        error:
                            "invalid_support_message"
                    }
                );
        }


        const access =
            await getSupportTicketAccess(
                ticketId,
                auth.user
            );


        if (!access.ok) {

            return res
                .status(
                    access.error ===
                    "support_ticket_access_denied"
                        ? 403
                        : 404
                )
                .json(
                    {
                        ok:false,
                        error:
                            access.error
                    }
                );
        }


        if (
            access.ticket.status ===
            "closed"
        ) {

            return res
                .status(409)
                .json(
                    {
                        ok:false,
                        error:
                            "support_ticket_closed"
                    }
                );
        }


        const {
            data:
                latestOwn
        } =
            await supabase
                .from(
                    "support_messages"
                )
                .select(
                    "created_at"
                )
                .eq(
                    "ticket_id",
                    ticketId
                )
                .eq(
                    "sender_telegram_id",
                    userId
                )
                .order(
                    "created_at",
                    {
                        ascending:false
                    }
                )
                .limit(1)
                .maybeSingle();


        if (
            latestOwn?.created_at &&
            Date.now() -
            new Date(
                latestOwn.created_at
            ).getTime() <
            1000
        ) {

            return res
                .status(429)
                .json(
                    {
                        ok:false,
                        error:
                            "support_message_too_fast"
                    }
                );
        }


        const adminReply =
            Boolean(
                auth.user.is_admin
            ) &&
            Number(
                access.ticket.user_telegram_id
            ) !==
            userId;


        const {
            data:
                created,
            error:
                createError
        } =
            await supabase
                .from(
                    "support_messages"
                )
                .insert(
                    {
                        id:
                            crypto.randomUUID(),
                        ticket_id:
                            ticketId,
                        sender_telegram_id:
                            userId,
                        sender_role:
                            adminReply
                                ? "admin"
                                : "user",
                        message
                    }
                )
                .select(
                    "id,ticket_id,sender_telegram_id,sender_role,message,read_at,created_at"
                )
                .single();


        if (createError) {

            console.error(
                "Support message create:",
                createError
            );


            return res
                .status(500)
                .json(
                    {
                        ok:false,
                        error:
                            "support_message_send_failed"
                    }
                );
        }


        let nextStatus =
            access.ticket.status;


        if (adminReply) {

            if (
                nextStatus ===
                "open"
            ) {

                nextStatus =
                    "in_progress";
            }

        } else if (
            nextStatus ===
            "resolved"
        ) {

            nextStatus =
                "open";
        }


        await supabase
            .from(
                "support_tickets"
            )
            .update(
                {
                    status:
                        nextStatus,
                    updated_at:
                        nowIso()
                }
            )
            .eq(
                "id",
                ticketId
            );


        if (adminReply) {

            await safeSendSupportMessage(
                access.ticket.user_telegram_id,
                `🎧 Handle Market Support replied to Ticket ${supportTicketNumberText(access.ticket.ticket_number)}.\n\nOpen Handle Market → Profile → Help & Support.`
            );

        } else {

            await notifyAdmins(
                `💬 New reply in Support Ticket ${supportTicketNumberText(access.ticket.ticket_number)}.\n\nOpen Handle Market → Profile → Admin Panel → Support Tickets.`
            );
        }


        return res.json(
            {
                ok:true,
                message:
                    created,
                status:
                    nextStatus
            }
        );
    }
);


app.post(
    "/support/ticket-status",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok:false,
                        error:
                            auth.error
                    }
                );
        }


        const ticketId =
            String(
                req.body.ticket_id ||
                ""
            ).trim();


        const action =
            String(
                req.body.action ||
                ""
            )
                .trim()
                .toLowerCase();


        if (
            ![
                "close",
                "reopen"
            ].includes(
                action
            )
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok:false,
                        error:
                            "invalid_support_status_action"
                    }
                );
        }


        const access =
            await getSupportTicketAccess(
                ticketId,
                auth.user
            );


        if (!access.ok) {

            return res
                .status(
                    access.error ===
                    "support_ticket_access_denied"
                        ? 403
                        : 404
                )
                .json(
                    {
                        ok:false,
                        error:
                            access.error
                    }
                );
        }


        if (
            !access.isOwner &&
            !access.isAdmin
        ) {

            return res
                .status(403)
                .json(
                    {
                        ok:false,
                        error:
                            "support_ticket_access_denied"
                    }
                );
        }


        const nextStatus =
            action ===
            "close"
                ? "closed"
                : "open";


        const {
            error
        } =
            await supabase
                .from(
                    "support_tickets"
                )
                .update(
                    {
                        status:
                            nextStatus,
                        updated_at:
                            nowIso()
                    }
                )
                .eq(
                    "id",
                    ticketId
                );


        if (error) {

            return res
                .status(500)
                .json(
                    {
                        ok:false,
                        error:
                            "support_status_update_failed"
                    }
                );
        }


        if (
            access.isOwner
        ) {

            await notifyAdmins(
                `🎧 Support Ticket ${supportTicketNumberText(access.ticket.ticket_number)} was ${nextStatus === "closed" ? "closed" : "reopened"} by the user.`
            );
        }


        return res.json(
            {
                ok:true,
                status:
                    nextStatus
            }
        );
    }
);



/* =========================================================
   V39 UI LANGUAGE
   ========================================================= */

app.post(
    "/settings/language",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json({
                    ok:false,
                    error:auth.error
                });
        }


        const language =
            String(
                req.body.language ||
                ""
            )
                .trim()
                .toLowerCase();


        if (
            ![
                "en",
                "ru"
            ].includes(
                language
            )
        ) {

            return res
                .status(400)
                .json({
                    ok:false,
                    error:"invalid_language"
                });
        }


        const {
            error
        } =
            await supabase
                .from("users")
                .update({
                    ui_language:
                        language
                })
                .eq(
                    "telegram_id",
                    auth.user.telegram_id
                );


        if (error) {

            return res
                .status(500)
                .json({
                    ok:false,
                    error:"language_update_failed"
                });
        }


        return res.json({
            ok:true,
            language
        });
    }
);


/* =========================================================
   V39 ADMIN ROLE GATE
   Owner: full access.
   Moderator: moderation/listing safety.
   Support: support tickets only + dashboard.
   ========================================================= */

const ADMIN_ROUTE_ROLES = {

    "/admin/dashboard": [
        "owner",
        "moderator",
        "support"
    ],

    "/admin/security-status": [
        "owner",
        "moderator"
    ],

    "/admin/security-events": [
        "owner",
        "moderator"
    ],

    "/admin/system-errors": [
        "owner"
    ],

    "/admin/search": [
        "owner",
        "moderator"
    ],

    "/admin/support-tickets": [
        "owner",
        "moderator",
        "support"
    ],

    "/admin/support-status": [
        "owner",
        "moderator",
        "support"
    ],

    "/admin/listing-contact": [
        "owner",
        "moderator"
    ],

    "/admin/seller-block": [
        "owner",
        "moderator"
    ],

    "/admin/blocked-sellers": [
        "owner",
        "moderator"
    ],

    "/admin/pending-listings": [
        "owner",
        "moderator"
    ],

    "/admin/listing-status": [
        "owner",
        "moderator"
    ],

    "/admin/reports": [
        "owner",
        "moderator"
    ],

    "/admin/frozen-listings": [
        "owner",
        "moderator"
    ],

    "/admin/report-action": [
        "owner",
        "moderator"
    ],

    "/admin/listing-freeze": [
        "owner",
        "moderator"
    ],

    "/admin/listing-remove": [
        "owner",
        "moderator"
    ],

    "/admin/risk-flags": [
        "owner",
        "moderator"
    ],

    "/admin/risk-flag-action": [
        "owner",
        "moderator"
    ],

    "/admin/listing-history": [
        "owner",
        "moderator"
    ],

    "/admin/create-listing": [
        "owner"
    ],

    "/admin/listing-promotion": [
        "owner"
    ],

    "/admin/listing-premium": [
        "owner"
    ],

    "/admin/activity-log": [
        "owner"
    ],

    "/admin/team": [
        "owner"
    ],

    "/admin/team-set": [
        "owner"
    ],

    "/admin/chat-safety": [
        "owner"
    ],

    "/admin/chat-safety/messages": [
        "owner"
    ],

    "/admin/chat-safety/action": [
        "owner"
    ]
};


app.use(
    "/admin",
    async (req, res, next) => {

        const path =
            String(
                req.originalUrl ||
                ""
            )
                .split("?")[0];


        const allowedRoles =
            ADMIN_ROUTE_ROLES[
                path
            ] ||
            [
                "owner"
            ];


        const auth =
            await getDatabaseUser(
                req.body?.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json({
                    ok:false,
                    error:auth.error
                });
        }


        if (
            !auth.user.is_admin
        ) {

            return res
                .status(403)
                .json({
                    ok:false,
                    error:"admin_required"
                });
        }


        if (
            !adminRoleAllowed(
                auth.user,
                allowedRoles
            )
        ) {

            return res
                .status(403)
                .json({
                    ok:false,
                    error:"admin_role_forbidden",
                    role:
                        normalizedAdminRole(
                            auth.user
                        )
                });
        }


        req.adminAuth =
            auth;

        req.adminRole =
            normalizedAdminRole(
                auth.user
            );


        next();
    }
);


/* =========================================================
   V41 ADMIN SECURITY CENTER
   Owner / Moderator: status + security events.
   Owner only: recent technical errors.
   ========================================================= */

app.post(
    "/admin/security-status",
    async (req, res) => {

        const startedAt =
            Date.now();


        let database = {
            ok:false,
            latency_ms:null
        };


        try {

            const dbStarted =
                Date.now();

            const {
                error
            } =
                await supabase
                    .from("users")
                    .select(
                        "telegram_id",
                        {
                            head:true,
                            count:"exact"
                        }
                    );


            database = {
                ok:!error,
                latency_ms:
                    Date.now() -
                    dbStarted
            };


            if (error) {
                await logSystemError(
                    "security_status_db",
                    error
                );
            }

        } catch (error) {

            await logSystemError(
                "security_status_db",
                error
            );
        }


        let telegram = {
            ok:false,
            webhook_configured:false,
            pending_updates:0,
            last_error:null
        };


        try {

            const info =
                await telegramApi(
                    "getWebhookInfo"
                );


            telegram = {
                ok:true,
                webhook_configured:
                    Boolean(
                        info?.url
                    ),
                pending_updates:
                    Number(
                        info?.pending_update_count ||
                        0
                    ),
                last_error:
                    info?.last_error_message
                        ? sanitizedLogText(
                            info.last_error_message
                        )
                        : null
            };

        } catch (error) {

            telegram.last_error =
                sanitizedLogText(
                    error?.message ||
                    error
                );

            await logSystemError(
                "security_status_telegram",
                error
            );
        }


        return res.json({
            ok:true,
            version:
                "v47-production-pricing",
            uptime_seconds:
                Math.floor(
                    process.uptime()
                ),
            response_ms:
                Date.now() -
                startedAt,
            database,
            telegram,
            protections:
                SECURITY_LIMITS
        });
    }
);


app.post(
    "/admin/security-events",
    async (req, res) => {

        const {
            data,
            error
        } =
            await supabase
                .from(
                    "security_events"
                )
                .select(
                    "id,telegram_id,event_type,severity,target_type,target_id,details,created_at"
                )
                .order(
                    "created_at",
                    {
                        ascending:false
                    }
                )
                .limit(60);


        if (error) {

            await logSystemError(
                "security_events_load",
                error
            );

            return res
                .status(500)
                .json({
                    ok:false,
                    error:"security_events_load_failed"
                });
        }


        return res.json({
            ok:true,
            events:
                data ||
                []
        });
    }
);


app.post(
    "/admin/system-errors",
    async (req, res) => {

        const {
            data,
            error
        } =
            await supabase
                .from(
                    "system_error_log"
                )
                .select(
                    "id,scope,error_code,message,details,created_at"
                )
                .order(
                    "created_at",
                    {
                        ascending:false
                    }
                )
                .limit(40);


        if (error) {

            return res
                .status(500)
                .json({
                    ok:false,
                    error:"system_errors_load_failed"
                });
        }


        return res.json({
            ok:true,
            errors:
                data ||
                []
        });
    }
);


/* =========================================================
   V40 ADMIN GLOBAL SEARCH
   Owner / Moderator only via V39 role gate.
   Searches LOT number, listing UUID, WhatsApp username,
   or exact seller Telegram ID.
   ========================================================= */

app.post(
    "/admin/search",
    async (req, res) => {

        const raw =
            String(
                req.body.q ||
                ""
            )
                .trim()
                .slice(
                    0,
                    100
                );


        if (!raw) {

            return res.json({
                ok:true,
                listings:[]
            });
        }


        let query =
            supabase
                .from("listings")
                .select(
                    "id,listing_number,seller_telegram_id,whatsapp_username,asking_price,price_type,minimum_offer,currency,category,status,is_paused,is_frozen,frozen_reason,is_premium_name,created_at,bump_until,hot_until,vip_until,bump_promoted_at,hot_promoted_at,vip_promoted_at,listing_plan,listing_period_started_at,listing_expires_at,contact_review_required,contact_last_changed_at"
                );


        const lotMatch =
            raw.match(
                /^(?:lot\s*#?\s*)?(\d{1,12})$/i
            );

        const uuidMatch =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
                .test(raw);


        if (uuidMatch) {

            query =
                query.eq(
                    "id",
                    raw
                );

        } else if (lotMatch) {

            const numeric =
                Number(
                    lotMatch[1]
                );


            if (
                !Number.isSafeInteger(
                    numeric
                ) ||
                numeric <= 0
            ) {

                return res
                    .status(400)
                    .json({
                        ok:false,
                        error:"invalid_admin_search"
                    });
            }


            if (
                numeric <=
                2147483647
            ) {

                query =
                    query.or(
                        `listing_number.eq.${numeric},seller_telegram_id.eq.${numeric}`
                    );

            } else {

                query =
                    query.eq(
                        "seller_telegram_id",
                        numeric
                    );
            }

        } else {

            const username =
                raw
                    .replace(
                        /^@/,
                        ""
                    )
                    .replace(
                        /[^a-zA-Z0-9_.]/g,
                        ""
                    )
                    .slice(
                        0,
                        64
                    );


            if (!username) {

                return res
                    .status(400)
                    .json({
                        ok:false,
                        error:"invalid_admin_search"
                    });
            }


            query =
                query.ilike(
                    "whatsapp_username",
                    `%${username}%`
                );
        }


        const {
            data,
            error
        } =
            await query
                .order(
                    "created_at",
                    {
                        ascending:false
                    }
                )
                .limit(30);


        if (error) {

            console.error(
                "Admin global search:",
                error
            );

            return res
                .status(500)
                .json({
                    ok:false,
                    error:"admin_search_failed"
                });
        }


        const rows =
            (
                data || []
            ).map(
                row =>
                    withLifecycle(
                        withPromotion(
                            row
                        )
                    )
            );


        const sellerIds = [
            ...new Set(
                rows.map(
                    row =>
                        Number(
                            row.seller_telegram_id
                        )
                )
                .filter(
                    Number.isFinite
                )
            )
        ];


        let sellers = [];


        if (
            sellerIds.length
        ) {

            const {
                data:sellerRows
            } =
                await supabase
                    .from("users")
                    .select(
                        "telegram_id,first_name,last_name,is_blocked"
                    )
                    .in(
                        "telegram_id",
                        sellerIds
                    );


            sellers =
                sellerRows || [];
        }


        const sellerMap =
            new Map(
                sellers.map(
                    seller => [
                        String(
                            seller.telegram_id
                        ),
                        seller
                    ]
                )
            );


        return res.json({
            ok:true,
            listings:
                rows.map(
                    row => ({
                        ...row,
                        seller:
                            sellerMap.get(
                                String(
                                    row.seller_telegram_id
                                )
                            ) ||
                            null
                    })
                )
        });
    }
);


app.post(
    "/admin/support-tickets",
    async (req, res) => {

        const admin =
            await requireAdmin(
                req.body.initData
            );


        if (!admin.ok) {

            return res
                .status(
                    admin.status
                )
                .json(
                    {
                        ok:false,
                        error:
                            admin.error
                    }
                );
        }


        const {
            data:
                tickets,
            error:
                ticketsError
        } =
            await supabase
                .from(
                    "support_tickets"
                )
                .select(
                    "id,ticket_number,user_telegram_id,category,related_listing_id,status,created_at,updated_at"
                )
                .order(
                    "updated_at",
                    {
                        ascending:false
                    }
                )
                .limit(100);


        if (ticketsError) {

            console.error(
                "Admin support tickets:",
                ticketsError
            );


            return res
                .status(500)
                .json(
                    {
                        ok:false,
                        error:
                            "support_tickets_load_failed"
                    }
                );
        }


        if (!tickets?.length) {

            return res.json(
                {
                    ok:true,
                    tickets:[]
                }
            );
        }


        const userIds =
            [
                ...new Set(
                    tickets.map(
                        ticket =>
                            Number(
                                ticket.user_telegram_id
                            )
                    )
                )
            ];


        const listingIds =
            [
                ...new Set(
                    tickets
                        .map(
                            ticket =>
                                ticket.related_listing_id
                        )
                        .filter(Boolean)
                )
            ];


        const [
            usersResult,
            listingsResult,
            messagesResult
        ] =
            await Promise.all(
                [
                    supabase
                        .from("users")
                        .select(
                            "telegram_id,first_name,last_name,telegram_username"
                        )
                        .in(
                            "telegram_id",
                            userIds
                        ),

                    listingIds.length
                        ? supabase
                            .from("listings")
                            .select(
                                "id,listing_number,whatsapp_username"
                            )
                            .in(
                                "id",
                                listingIds
                            )
                        : Promise.resolve(
                            {
                                data:[],
                                error:null
                            }
                        ),

                    supabase
                        .from(
                            "support_messages"
                        )
                        .select(
                            "id,ticket_id,sender_telegram_id,sender_role,message,read_at,created_at"
                        )
                        .in(
                            "ticket_id",
                            tickets.map(
                                ticket =>
                                    ticket.id
                            )
                        )
                        .order(
                            "created_at",
                            {
                                ascending:false
                            }
                        )
                ]
            );


        const userMap =
            new Map(
                (
                    usersResult.data ||
                    []
                ).map(
                    user =>
                        [
                            Number(
                                user.telegram_id
                            ),
                            user
                        ]
                )
            );


        const listingMap =
            new Map(
                (
                    listingsResult.data ||
                    []
                ).map(
                    listing =>
                        [
                            listing.id,
                            listing
                        ]
                )
            );


        const lastMessageMap =
            new Map();


        for (
            const message of
            messagesResult.data ||
            []
        ) {

            if (
                !lastMessageMap.has(
                    message.ticket_id
                )
            ) {

                lastMessageMap.set(
                    message.ticket_id,
                    message
                );
            }
        }


        const payload =
            tickets.map(
                ticket => {

                    const user =
                        userMap.get(
                            Number(
                                ticket.user_telegram_id
                            )
                        ) ||
                        {
                            telegram_id:
                                Number(
                                    ticket.user_telegram_id
                                ),
                            first_name:"",
                            last_name:"",
                            telegram_username:null
                        };


                    return {
                        ...ticket,
                        user,
                        related_listing:
                            listingMap.get(
                                ticket.related_listing_id
                            ) ||
                            null,
                        last_message:
                            lastMessageMap.get(
                                ticket.id
                            ) ||
                            null
                    };
                }
            );


        return res.json(
            {
                ok:true,
                tickets:
                    payload
            }
        );
    }
);


app.post(
    "/admin/support-status",
    async (req, res) => {

        const admin =
            await requireAdmin(
                req.body.initData
            );


        if (!admin.ok) {

            return res
                .status(
                    admin.status
                )
                .json(
                    {
                        ok:false,
                        error:
                            admin.error
                    }
                );
        }


        const ticketId =
            String(
                req.body.ticket_id ||
                ""
            ).trim();


        const status =
            String(
                req.body.status ||
                ""
            )
                .trim()
                .toLowerCase();


        if (
            ![
                "open",
                "in_progress",
                "resolved",
                "closed"
            ].includes(
                status
            )
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok:false,
                        error:
                            "invalid_support_status"
                    }
                );
        }


        const {
            data:
                ticket,
            error:
                ticketError
        } =
            await supabase
                .from(
                    "support_tickets"
                )
                .select(
                    "id,ticket_number,user_telegram_id,status"
                )
                .eq(
                    "id",
                    ticketId
                )
                .maybeSingle();


        if (
            ticketError ||
            !ticket
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok:false,
                        error:
                            "support_ticket_not_found"
                    }
                );
        }


        const {
            error:
                updateError
        } =
            await supabase
                .from(
                    "support_tickets"
                )
                .update(
                    {
                        status,
                        updated_at:
                            nowIso()
                    }
                )
                .eq(
                    "id",
                    ticketId
                );


        if (updateError) {

            return res
                .status(500)
                .json(
                    {
                        ok:false,
                        error:
                            "support_status_update_failed"
                    }
                );
        }


        await safeSendSupportMessage(
            ticket.user_telegram_id,
            `🎧 Support Ticket ${supportTicketNumberText(ticket.ticket_number)} status: ${status.replace("_", " ").toUpperCase()}.\n\nOpen Handle Market → Profile → Help & Support.`
        );


        return res.json(
            {
                ok:true,
                status
            }
        );
    }
);



/* =========================================================
   UNREAD COUNTS
   ========================================================= */

app.post(
    "/unread-counts",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok:false,
                        error:
                            auth.error
                    }
                );
        }


        await expireStaleOffers();


        const userId =
            Number(
                auth.user.telegram_id
            );


        const {
            data:
                chats
        } =
            await supabase
                .from("listing_chats")
                .select("id")
                .or(
                    `buyer_telegram_id.eq.${userId},seller_telegram_id.eq.${userId}`
                );


        const chatIds =
            (
                chats ||
                []
            ).map(
                row =>
                    row.id
            );


        let chatUnread =
            0;


        if (chatIds.length) {

            const {
                count
            } =
                await supabase
                    .from("chat_messages")
                    .select(
                        "id",
                        {
                            count:"exact",
                            head:true
                        }
                    )
                    .in(
                        "chat_id",
                        chatIds
                    )
                    .neq(
                        "sender_telegram_id",
                        userId
                    )
                    .is(
                        "read_at",
                        null
                    );


            chatUnread =
                Number(
                    count ||
                    0
                );
        }


        const {
            count:
                buyerOfferUnread
        } =
            await supabase
                .from("offers")
                .select(
                    "id",
                    {
                        count:"exact",
                        head:true
                    }
                )
                .eq(
                    "buyer_telegram_id",
                    userId
                )
                .eq(
                    "buyer_unread",
                    true
                );


        const {
            data:
                sellerListings
        } =
            await supabase
                .from("listings")
                .select("id")
                .eq(
                    "seller_telegram_id",
                    userId
                );


        let sellerOfferUnread =
            0;


        const sellerListingIds =
            (
                sellerListings ||
                []
            ).map(
                row =>
                    row.id
            );


        if (sellerListingIds.length) {

            const {
                count
            } =
                await supabase
                    .from("offers")
                    .select(
                        "id",
                        {
                            count:"exact",
                            head:true
                        }
                    )
                    .in(
                        "listing_id",
                        sellerListingIds
                    )
                    .eq(
                        "seller_unread",
                        true
                    );


            sellerOfferUnread =
                Number(
                    count ||
                    0
                );
        }


        const {
            data:
                ownTickets
        } =
            await supabase
                .from("support_tickets")
                .select("id")
                .eq(
                    "user_telegram_id",
                    userId
                );


        let supportUnread =
            0;


        const ownTicketIds =
            (
                ownTickets ||
                []
            ).map(
                row =>
                    row.id
            );


        if (ownTicketIds.length) {

            const {
                count
            } =
                await supabase
                    .from("support_messages")
                    .select(
                        "id",
                        {
                            count:"exact",
                            head:true
                        }
                    )
                    .in(
                        "ticket_id",
                        ownTicketIds
                    )
                    .eq(
                        "sender_role",
                        "admin"
                    )
                    .is(
                        "read_at",
                        null
                    );


            supportUnread =
                Number(
                    count ||
                    0
                );
        }


        return res.json(
            {
                ok:true,
                chats:
                    chatUnread,
                offers:
                    Number(
                        buyerOfferUnread ||
                        0
                    ) +
                    sellerOfferUnread,
                support:
                    supportUnread
            }
        );
    }
);


/* =========================================================
   V44 NOTIFICATION CENTER
   Read-only activity feed. Opening the actual chat / offer /
   support ticket keeps the existing read-state behavior.
   ========================================================= */

app.post(
    "/notification-center",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok:false,
                        error:
                            auth.error
                    }
                );
        }


        await expireStaleOffers();


        const userId =
            Number(
                auth.user.telegram_id
            );


        const items = [];


        try {

            /* ---------- UNREAD CHATS ---------- */

            const {
                data:
                    chatRows
            } =
                await supabase
                    .from("listing_chats")
                    .select(
                        "id,listing_id,buyer_telegram_id,seller_telegram_id"
                    )
                    .or(
                        `buyer_telegram_id.eq.${userId},seller_telegram_id.eq.${userId}`
                    );


            const chatIds =
                (
                    chatRows ||
                    []
                ).map(
                    row =>
                        row.id
                );


            let unreadChatMessages = [];


            if (chatIds.length) {

                const {
                    data
                } =
                    await supabase
                        .from("chat_messages")
                        .select(
                            "id,chat_id,sender_telegram_id,message,created_at"
                        )
                        .in(
                            "chat_id",
                            chatIds
                        )
                        .neq(
                            "sender_telegram_id",
                            userId
                        )
                        .is(
                            "read_at",
                            null
                        )
                        .order(
                            "created_at",
                            {
                                ascending:false
                            }
                        )
                        .limit(20);


                unreadChatMessages =
                    data ||
                    [];
            }


            const chatMap =
                new Map(
                    (
                        chatRows ||
                        []
                    ).map(
                        row => [
                            String(
                                row.id
                            ),
                            row
                        ]
                    )
                );


            /* ---------- UNREAD OFFERS ---------- */

            const {
                data:
                    buyerOffers
            } =
                await supabase
                    .from("offers")
                    .select(
                        "id,listing_id,amount,seller_counter_amount,status,updated_at,created_at"
                    )
                    .eq(
                        "buyer_telegram_id",
                        userId
                    )
                    .eq(
                        "buyer_unread",
                        true
                    )
                    .order(
                        "updated_at",
                        {
                            ascending:false
                        }
                    )
                    .limit(20);


            const {
                data:
                    sellerListings
            } =
                await supabase
                    .from("listings")
                    .select("id")
                    .eq(
                        "seller_telegram_id",
                        userId
                    );


            const sellerListingIds =
                (
                    sellerListings ||
                    []
                ).map(
                    row =>
                        row.id
                );


            let sellerOffers = [];


            if (sellerListingIds.length) {

                const {
                    data
                } =
                    await supabase
                        .from("offers")
                        .select(
                            "id,listing_id,buyer_telegram_id,amount,seller_counter_amount,status,updated_at,created_at"
                        )
                        .in(
                            "listing_id",
                            sellerListingIds
                        )
                        .eq(
                            "seller_unread",
                            true
                        )
                        .order(
                            "updated_at",
                            {
                                ascending:false
                            }
                        )
                        .limit(20);


                sellerOffers =
                    data ||
                    [];
            }


            /* ---------- UNREAD SUPPORT ---------- */

            const {
                data:
                    ticketRows
            } =
                await supabase
                    .from("support_tickets")
                    .select(
                        "id,ticket_number,related_listing_id,status"
                    )
                    .eq(
                        "user_telegram_id",
                        userId
                    );


            const ticketIds =
                (
                    ticketRows ||
                    []
                ).map(
                    row =>
                        row.id
                );


            let unreadSupportMessages = [];


            if (ticketIds.length) {

                const {
                    data
                } =
                    await supabase
                        .from("support_messages")
                        .select(
                            "id,ticket_id,message,created_at"
                        )
                        .in(
                            "ticket_id",
                            ticketIds
                        )
                        .eq(
                            "sender_role",
                            "admin"
                        )
                        .is(
                            "read_at",
                            null
                        )
                        .order(
                            "created_at",
                            {
                                ascending:false
                            }
                        )
                        .limit(20);


                unreadSupportMessages =
                    data ||
                    [];
            }


            const ticketMap =
                new Map(
                    (
                        ticketRows ||
                        []
                    ).map(
                        row => [
                            String(
                                row.id
                            ),
                            row
                        ]
                    )
                );


            /* ---------- LISTING LABELS ---------- */

            const listingIds = [
                ...new Set(
                    [
                        ...(
                            chatRows ||
                            []
                        ).map(
                            row =>
                                row.listing_id
                        ),
                        ...(
                            buyerOffers ||
                            []
                        ).map(
                            row =>
                                row.listing_id
                        ),
                        ...(
                            sellerOffers ||
                            []
                        ).map(
                            row =>
                                row.listing_id
                        ),
                        ...(
                            ticketRows ||
                            []
                        ).map(
                            row =>
                                row.related_listing_id
                        )
                    ].filter(Boolean)
                )
            ];


            let listingRows = [];


            if (listingIds.length) {

                const {
                    data
                } =
                    await supabase
                        .from("listings")
                        .select(
                            "id,listing_number,whatsapp_username,asking_price"
                        )
                        .in(
                            "id",
                            listingIds
                        );


                listingRows =
                    data ||
                    [];
            }


            const listingMap =
                new Map(
                    listingRows.map(
                        row => [
                            String(
                                row.id
                            ),
                            row
                        ]
                    )
                );


            for (
                const message of
                unreadChatMessages
            ) {

                const chat =
                    chatMap.get(
                        String(
                            message.chat_id
                        )
                    );


                if (!chat) {
                    continue;
                }


                const listing =
                    listingMap.get(
                        String(
                            chat.listing_id
                        )
                    ) ||
                    null;


                items.push(
                    {
                        type:"chat",
                        target_id:
                            chat.id,
                        listing_id:
                            chat.listing_id,
                        listing_number:
                            listing?.listing_number ||
                            null,
                        username:
                            listing?.whatsapp_username ||
                            null,
                        title:
                            "New chat message",
                        subtitle:
                            String(
                                message.message ||
                                ""
                            ).slice(
                                0,
                                160
                            ),
                        created_at:
                            message.created_at
                    }
                );
            }


            const offerTitle =
                (offer, role) => {

                    const status =
                        String(
                            offer.status ||
                            "pending"
                        );


                    if (
                        role ===
                        "seller" &&
                        status ===
                        "pending"
                    ) {
                        return "New offer received";
                    }


                    if (
                        role ===
                        "buyer" &&
                        status ===
                        "countered"
                    ) {
                        return "Seller sent a counter offer";
                    }


                    if (
                        status ===
                        "accepted"
                    ) {
                        return "Offer accepted";
                    }


                    if (
                        status ===
                        "declined"
                    ) {
                        return "Offer declined";
                    }


                    if (
                        status ===
                        "expired"
                    ) {
                        return "Offer expired";
                    }


                    if (
                        role ===
                        "seller" &&
                        status ===
                        "countered"
                    ) {
                        return "Counter offer updated";
                    }


                    return "Offer update";
                };


            for (
                const [
                    role,
                    rows
                ] of [
                    [
                        "buyer",
                        buyerOffers ||
                        []
                    ],
                    [
                        "seller",
                        sellerOffers ||
                        []
                    ]
                ]
            ) {

                for (
                    const offer of
                    rows
                ) {

                    const listing =
                        listingMap.get(
                            String(
                                offer.listing_id
                            )
                        ) ||
                        null;


                    const amount =
                        role ===
                            "buyer" &&
                        Number(
                            offer.seller_counter_amount
                        ) > 0
                            ? Number(
                                offer.seller_counter_amount
                            )
                            : Number(
                                offer.amount ||
                                0
                            );


                    items.push(
                        {
                            type:"offer",
                            target_id:
                                offer.id,
                            listing_id:
                                offer.listing_id,
                            listing_number:
                                listing?.listing_number ||
                                null,
                            username:
                                listing?.whatsapp_username ||
                                null,
                            title:
                                offerTitle(
                                    offer,
                                    role
                                ),
                            subtitle:
                                amount > 0
                                    ? `$${amount.toLocaleString("en-US")}`
                                    : "Open Offers for details",
                            created_at:
                                offer.updated_at ||
                                offer.created_at
                        }
                    );
                }
            }


            for (
                const message of
                unreadSupportMessages
            ) {

                const ticket =
                    ticketMap.get(
                        String(
                            message.ticket_id
                        )
                    );


                if (!ticket) {
                    continue;
                }


                const listing =
                    ticket.related_listing_id
                        ? listingMap.get(
                            String(
                                ticket.related_listing_id
                            )
                          ) ||
                          null
                        : null;


                items.push(
                    {
                        type:"support",
                        target_id:
                            ticket.id,
                        listing_id:
                            ticket.related_listing_id ||
                            null,
                        listing_number:
                            listing?.listing_number ||
                            null,
                        username:
                            listing?.whatsapp_username ||
                            null,
                        ticket_number:
                            ticket.ticket_number ||
                            null,
                        title:
                            "New support reply",
                        subtitle:
                            String(
                                message.message ||
                                ""
                            ).slice(
                                0,
                                160
                            ),
                        created_at:
                            message.created_at
                    }
                );
            }


            items.sort(
                (a, b) =>
                    new Date(
                        b.created_at ||
                        0
                    ).getTime()
                    -
                    new Date(
                        a.created_at ||
                        0
                    ).getTime()
            );


            return res.json(
                {
                    ok:true,
                    items:
                        items.slice(
                            0,
                            40
                        )
                }
            );

        } catch (error) {

            console.error(
                "Notification center:",
                error
            );


            return res
                .status(500)
                .json(
                    {
                        ok:false,
                        error:
                            "notification_center_failed"
                    }
                );
        }
    }
);


/* =========================================================
   OFFER V35 HELPERS
   ========================================================= */

async function recordOfferEvent(
    offerId,
    actorTelegramId,
    eventType,
    amount = null
) {

    try {

        await supabase
            .from("offer_events")
            .insert(
                {
                    id:
                        crypto.randomUUID(),
                    offer_id:
                        offerId,
                    actor_telegram_id:
                        actorTelegramId === null
                            ? null
                            : Number(
                                actorTelegramId
                            ),
                    event_type:
                        eventType,
                    amount:
                        amount === null
                            ? null
                            : Number(
                                amount
                            )
                }
            );

    } catch (error) {

        console.error(
            "Offer event:",
            error
        );
    }
}


async function expireStaleOffers() {

    try {

        const {
            data:
                stale
        } =
            await supabase
                .from("offers")
                .select("id,buyer_telegram_id")
                .in(
                    "status",
                    [
                        "pending",
                        "countered"
                    ]
                )
                .lte(
                    "expires_at",
                    nowIso()
                );


        if (!stale?.length) {

            return;
        }


        const ids =
            stale.map(
                row =>
                    row.id
            );


        await supabase
            .from("offers")
            .update(
                {
                    status:
                        "expired",
                    buyer_unread:
                        true,
                    seller_unread:
                        true,
                    updated_at:
                        nowIso()
                }
            )
            .in(
                "id",
                ids
            );


        for (
            const row of
            stale
        ) {

            await recordOfferEvent(
                row.id,
                null,
                "expired"
            );
        }

    } catch (error) {

        console.error(
            "Expire offers:",
            error
        );
    }
}


async function attachOfferEvents(
    offers
) {

    const rows =
        offers ||
        [];


    const ids =
        rows.map(
            row =>
                row.id
        );


    if (!ids.length) {

        return rows;
    }


    const {
        data:
            events,
        error
    } =
        await supabase
            .from("offer_events")
            .select(
                "id,offer_id,actor_telegram_id,event_type,amount,created_at"
            )
            .in(
                "offer_id",
                ids
            )
            .order(
                "created_at",
                {
                    ascending:true
                }
            );


    if (error) {

        console.error(
            "Offer history:",
            error
        );

        return rows.map(
            row => ({
                ...row,
                history:[]
            })
        );
    }


    const map =
        new Map();


    for (
        const event of
        events ||
        []
    ) {

        const list =
            map.get(
                String(
                    event.offer_id
                )
            ) ||
            [];


        list.push(
            event
        );


        map.set(
            String(
                event.offer_id
            ),
            list
        );
    }


    return rows.map(
        row => ({
            ...row,
            history:
                map.get(
                    String(
                        row.id
                    )
                ) ||
                []
        })
    );
}


/* =========================================================
   OFFERS CREATE
   ========================================================= */

app.post(
    "/offers/create",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        const buyerId =
            Number(
                auth.user.telegram_id
            );



        const offerSecurity =
            await securityRateLimit(
                auth.user,
                "offer_create",
                req.body.listing_id ||
                null
            );


        if (!offerSecurity.ok) {
            return sendRateLimitResponse(
                res,
                offerSecurity
            );
        }


        const listingId =
            String(
                req.body.listing_id ||
                ""
            ).trim();


        const amount =
            Number(
                req.body.amount
            );


        const message =
            String(
                req.body.message ||
                ""
            )
                .trim()
                .slice(
                    0,
                    500
                );


        const durationHours =
            Number(
                req.body.duration_hours ||
                24
            );


        if (
            !listingId ||
            !Number.isFinite(
                amount
            ) ||
            amount <= 0 ||
            amount >
            100000000 ||
            ![
                24,
                72,
                168
            ].includes(
                durationHours
            )
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "invalid_offer"
                    }
                );
        }


        const {
            data:
                listing,
            error:
                listingError
        } =
            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username,asking_price,price_type,minimum_offer,status,is_paused,is_frozen,listing_plan,listing_expires_at"
                )
                .eq(
                    "id",
                    listingId
                )
                .maybeSingle();


        if (
            listingError ||
            !listingIsPubliclyAvailable(
                listing
            )
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_not_available"
                    }
                );
        }


        if (
            Number(
                listing.seller_telegram_id
            ) ===
            buyerId
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "cannot_offer_own_listing"
                    }
                );
        }


        if (
            String(
                listing.price_type ||
                "negotiable"
            ) ===
            "fixed" &&
            Math.abs(
                amount -
                Number(
                    listing.asking_price
                )
            ) >
            0.009
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok:false,
                        error:
                            "fixed_price_required"
                    }
                );
        }


        if (
            String(
                listing.price_type ||
                "negotiable"
            ) ===
            "negotiable" &&
            listing.minimum_offer !==
            null &&
            Number.isFinite(
                Number(
                    listing.minimum_offer
                )
            ) &&
            amount <
            Number(
                listing.minimum_offer
            )
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok:false,
                        error:
                            "offer_below_minimum"
                    }
                );
        }


        if (
            !await buyerHasContactAccess(
                buyerId,
                listingId
            )
        ) {

            return res
                .status(403)
                .json(
                    {
                        ok: false,
                        error:
                            "contact_unlock_required"
                    }
                );
        }


        await expireStaleOffers();


        const {
            data:
                acceptedOffer
        } =
            await supabase
                .from("offers")
                .select("id")
                .eq(
                    "listing_id",
                    listingId
                )
                .eq(
                    "status",
                    "accepted"
                )
                .limit(1);


        if (
            acceptedOffer?.length
        ) {

            return res
                .status(409)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_has_agreement"
                    }
                );
        }


        const {
            data:
                existingOffer
        } =
            await supabase
                .from("offers")
                .select(
                    "id,status"
                )
                .eq(
                    "listing_id",
                    listingId
                )
                .eq(
                    "buyer_telegram_id",
                    buyerId
                )
                .in(
                    "status",
                    [
                        "pending",
                        "countered"
                    ]
                )
                .limit(1);


        if (
            existingOffer?.length
        ) {

            return res
                .status(409)
                .json(
                    {
                        ok: false,
                        error:
                            "open_offer_already_exists"
                    }
                );
        }


        const {
            data:
                offer,
            error
        } =
            await supabase
                .from("offers")
                .insert(
                    {
                        listing_id:
                            listingId,

                        buyer_telegram_id:
                            buyerId,

                        amount,

                        currency:
                            "USD",

                        message,

                        seller_counter_amount:
                            null,

                        expires_at:
                            addHoursIso(
                                nowIso(),
                                durationHours
                            ),

                        buyer_unread:
                            false,

                        seller_unread:
                            true,

                        status:
                            "pending"
                    }
                )
                .select()
                .single();


        if (error) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "offer_create_failed"
                    }
                );
        }


        await recordOfferEvent(
            offer.id,
            buyerId,
            "offer_created",
            amount
        );


        safeSendOfferMessage(

            listing.seller_telegram_id,

            `💬 New offer for @${listing.whatsapp_username}\n\nOffer: $${amount.toLocaleString("en-US")}${message ? `\n\nMessage: ${message}` : ""}\n\nOpen Handle Market → Profile → Offers.`
        );


        res.json(
            {
                ok: true,
                offer
            }
        );
    }
);


/* =========================================================
   SENT OFFERS
   ========================================================= */

app.post(
    "/offers/sent",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        await expireStaleOffers();


        const {
            data:
                offers,
            error
        } =
            await supabase
                .from("offers")
                .select(
                    "id,listing_id,amount,currency,message,seller_counter_amount,status,expires_at,buyer_unread,seller_unread,created_at,updated_at"
                )
                .eq(
                    "buyer_telegram_id",
                    auth.user.telegram_id
                )
                .order(
                    "created_at",
                    {
                        ascending: false
                    }
                );


        if (error) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "offers_load_failed"
                    }
                );
        }


        const listingIds = [
            ...new Set(
                (
                    offers ||
                    []
                ).map(
                    row =>
                        row.listing_id
                )
            )
        ];


        let listings = [];


        if (
            listingIds.length
        ) {

            const {
                data
            } =
                await supabase
                    .from("listings")
                    .select(
                        "id,listing_number,whatsapp_username,asking_price,price_type,minimum_offer,category,is_frozen,is_paused,status,listing_plan,listing_expires_at"
                    )
                    .in(
                        "id",
                        listingIds
                    );


            listings =
                (
                    data ||
                    []
                ).map(
                    withLifecycle
                );
        }


        const listingMap =
            new Map(

                listings.map(
                    row => [
                        String(
                            row.id
                        ),
                        row
                    ]
                )
            );


        const enhancedOffers =
            await attachOfferEvents(
                offers ||
                []
            );


        const buyerUnreadIds =
            enhancedOffers
                .filter(
                    row =>
                        row.buyer_unread
                )
                .map(
                    row =>
                        row.id
                );


        if (buyerUnreadIds.length) {

            await supabase
                .from("offers")
                .update(
                    {
                        buyer_unread:false
                    }
                )
                .in(
                    "id",
                    buyerUnreadIds
                );
        }


        res.json(
            {
                ok: true,

                offers:
                    (
                        enhancedOffers
                    ).map(
                        row => ({

                            ...row,

                            listing:
                                listingMap.get(
                                    String(
                                        row.listing_id
                                    )
                                ) ||
                                null
                        })
                    )
            }
        );
    }
);


/* =========================================================
   RECEIVED OFFERS
   ========================================================= */

app.post(
    "/offers/received",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        const sellerId =
            Number(
                auth.user.telegram_id
            );


        await expireStaleOffers();


        const {
            data:
                sellerListings,
            error:
                listingsError
        } =
            await supabase
                .from("listings")
                .select(
                    "id,listing_number,whatsapp_username,asking_price,price_type,minimum_offer,category,is_frozen,is_paused,status,listing_plan,listing_expires_at"
                )
                .eq(
                    "seller_telegram_id",
                    sellerId
                );


        if (
            listingsError
        ) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "offers_load_failed"
                    }
                );
        }


        const listingIds =
            (
                sellerListings ||
                []
            ).map(
                row =>
                    row.id
            );


        if (
            !listingIds.length
        ) {

            return res.json(
                {
                    ok: true,
                    offers: []
                }
            );
        }


        const {
            data:
                offers,
            error
        } =
            await supabase
                .from("offers")
                .select(
                    "id,listing_id,buyer_telegram_id,amount,currency,message,seller_counter_amount,status,expires_at,buyer_unread,seller_unread,created_at,updated_at"
                )
                .in(
                    "listing_id",
                    listingIds
                )
                .order(
                    "created_at",
                    {
                        ascending: false
                    }
                );


        if (error) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "offers_load_failed"
                    }
                );
        }


        const buyerIds = [
            ...new Set(
                (
                    offers ||
                    []
                ).map(
                    row =>
                        row.buyer_telegram_id
                )
            )
        ];


        let buyers = [];


        if (
            buyerIds.length
        ) {

            const {
                data
            } =
                await supabase
                    .from("users")
                    .select(
                        "telegram_id,first_name,last_name,telegram_username"
                    )
                    .in(
                        "telegram_id",
                        buyerIds
                    );


            buyers =
                data ||
                [];
        }


        const listingMap =
            new Map(

                (
                    sellerListings ||
                    []
                ).map(
                    row => [
                        String(
                            row.id
                        ),
                        withLifecycle(
                            row
                        )
                    ]
                )
            );


        const buyerMap =
            new Map(

                buyers.map(
                    row => [
                        String(
                            row.telegram_id
                        ),
                        row
                    ]
                )
            );


        const enhancedOffers =
            await attachOfferEvents(
                offers ||
                []
            );


        const sellerUnreadIds =
            enhancedOffers
                .filter(
                    row =>
                        row.seller_unread
                )
                .map(
                    row =>
                        row.id
                );


        if (sellerUnreadIds.length) {

            await supabase
                .from("offers")
                .update(
                    {
                        seller_unread:false
                    }
                )
                .in(
                    "id",
                    sellerUnreadIds
                );
        }


        res.json(
            {
                ok: true,

                offers:
                    (
                        enhancedOffers
                    ).map(
                        row => ({

                            ...row,

                            listing:
                                listingMap.get(
                                    String(
                                        row.listing_id
                                    )
                                ) ||
                                null,

                            buyer:
                                buyerMap.get(
                                    String(
                                        row.buyer_telegram_id
                                    )
                                ) ||
                                null
                        })
                    )
            }
        );
    }
);


/* =========================================================
   SELLER OFFER ACTION
   ========================================================= */

app.post(
    "/offers/seller-action",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        const sellerId =
            Number(
                auth.user.telegram_id
            );


        const offerId =
            String(
                req.body.offer_id ||
                ""
            ).trim();


        const action =
            String(
                req.body.action ||
                ""
            ).trim();


        const counterAmount =
            Number(
                req.body.counter_amount
            );


        if (
            !offerId ||
            ![
                "accept",
                "decline",
                "counter"
            ].includes(
                action
            )
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "invalid_offer_action"
                    }
                );
        }


        await expireStaleOffers();


        const {
            data:
                offer
        } =
            await supabase
                .from("offers")
                .select("*")
                .eq(
                    "id",
                    offerId
                )
                .maybeSingle();


        if (!offer) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "offer_not_found"
                    }
                );
        }


        const {
            data:
                listing
        } =
            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username,asking_price,price_type,minimum_offer,is_frozen,listing_plan,listing_expires_at"
                )
                .eq(
                    "id",
                    offer.listing_id
                )
                .maybeSingle();


        if (
            !listing ||
            Number(
                listing.seller_telegram_id
            ) !==
            sellerId
        ) {

            return res
                .status(403)
                .json(
                    {
                        ok: false,
                        error:
                            "not_listing_owner"
                    }
                );
        }


        if (
            ![
                "pending",
                "countered"
            ].includes(
                offer.status
            )
        ) {

            return res
                .status(409)
                .json(
                    {
                        ok: false,
                        error:
                            "offer_not_open"
                    }
                );
        }


        if (
            [
                "accept",
                "counter"
            ].includes(
                action
            ) &&
            isListingExpired(
                listing
            )
        ) {

            return res
                .status(409)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_expired"
                    }
                );
        }


        if (
            listing.is_frozen &&
            [
                "accept",
                "counter"
            ].includes(
                action
            )
        ) {

            return res
                .status(409)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_frozen"
                    }
                );
        }


        if (
            action ===
            "counter" &&
            String(
                listing.price_type ||
                "negotiable"
            ) ===
            "fixed"
        ) {

            return res
                .status(409)
                .json(
                    {
                        ok:false,
                        error:
                            "fixed_price_no_counter"
                    }
                );
        }


        if (
            action ===
            "counter" &&
            (
                !Number.isFinite(
                    counterAmount
                ) ||
                counterAmount <= 0 ||
                counterAmount >
                100000000
            )
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "invalid_counter_amount"
                    }
                );
        }


        if (
            action ===
            "accept"
        ) {

            const {
                data:
                    accepted
            } =
                await supabase
                    .from("offers")
                    .select("id")
                    .eq(
                        "listing_id",
                        offer.listing_id
                    )
                    .eq(
                        "status",
                        "accepted"
                    )
                    .neq(
                        "id",
                        offer.id
                    )
                    .limit(1);


            if (
                accepted?.length
            ) {

                return res
                    .status(409)
                    .json(
                        {
                            ok: false,
                            error:
                                "listing_has_agreement"
                        }
                    );
            }
        }


        const updateData = {
            updated_at:
                nowIso(),
            buyer_unread:
                true,
            seller_unread:
                false
        };


        if (
            action ===
            "accept"
        ) {

            updateData.status =
                "accepted";
        }


        if (
            action ===
            "decline"
        ) {

            updateData.status =
                "declined";
        }


        if (
            action ===
            "counter"
        ) {

            updateData.status =
                "countered";


            updateData
                .seller_counter_amount =
                counterAmount;
        }


        const {
            data:
                updatedOffer,
            error
        } =
            await supabase
                .from("offers")
                .update(
                    updateData
                )
                .eq(
                    "id",
                    offer.id
                )
                .select()
                .single();


        if (error) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,

                        error:
                            error.code ===
                            "23505"
                                ? "listing_has_agreement"
                                : "offer_update_failed"
                    }
                );
        }


        await recordOfferEvent(
            offer.id,
            sellerId,
            action === "accept"
                ? "seller_accepted"
                : action === "decline"
                    ? "seller_declined"
                    : "seller_countered",
            action === "counter"
                ? counterAmount
                : action === "accept"
                    ? offer.amount
                    : null
        );


        if (
            action ===
            "accept"
        ) {

            await supabase
                .from("listings")
                .update(
                    {
                        is_paused:
                            true,

                        updated_at:
                            nowIso()
                    }
                )
                .eq(
                    "id",
                    offer.listing_id
                );


            const others =
                await closeOtherOpenOffers(
                    offer.listing_id,
                    offer.id
                );


            for (
                const other of
                others
            ) {

                safeSendOfferMessage(

                    other.buyer_telegram_id,

                    `❌ Another offer for @${listing.whatsapp_username} was accepted. Your open offer was closed.`
                );
            }
        }


        let text =
            `Update for @${listing.whatsapp_username}\n\n`;


        if (
            action ===
            "accept"
        ) {

            text +=
                `✅ Seller accepted your offer of $${Number(offer.amount).toLocaleString("en-US")}.`;
        }


        if (
            action ===
            "decline"
        ) {

            text +=
                "❌ Seller declined your offer.";
        }


        if (
            action ===
            "counter"
        ) {

            text +=
                `💬 Seller countered with $${counterAmount.toLocaleString("en-US")}.`;
        }


        text +=
            "\n\nOpen Handle Market → Profile → Offers.";


        safeSendOfferMessage(
            offer.buyer_telegram_id,
            text
        );


        res.json(
            {
                ok: true,
                offer:
                    updatedOffer
            }
        );
    }
);


/* =========================================================
   BUYER OFFER ACTION
   ========================================================= */

app.post(
    "/offers/buyer-action",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        const buyerId =
            Number(
                auth.user.telegram_id
            );


        const offerId =
            String(
                req.body.offer_id ||
                ""
            ).trim();


        const action =
            String(
                req.body.action ||
                ""
            ).trim();


        if (
            !offerId ||
            ![
                "accept_counter",
                "cancel"
            ].includes(
                action
            )
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "invalid_offer_action"
                    }
                );
        }


        await expireStaleOffers();


        const {
            data:
                offer
        } =
            await supabase
                .from("offers")
                .select("*")
                .eq(
                    "id",
                    offerId
                )
                .eq(
                    "buyer_telegram_id",
                    buyerId
                )
                .maybeSingle();


        if (!offer) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "offer_not_found"
                    }
                );
        }


        const {
            data:
                listing
        } =
            await recordOfferEvent(
                offer.id,
                buyerId,
                "buyer_accepted_counter",
                offer.seller_counter_amount
            );


            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username,is_frozen,listing_plan,listing_expires_at"
                )
                .eq(
                    "id",
                    offer.listing_id
                )
                .maybeSingle();


        if (!listing) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_not_found"
                    }
                );
        }


        if (
            action ===
            "accept_counter"
        ) {

            if (
                isListingExpired(
                    listing
                )
            ) {

                return res
                    .status(409)
                    .json(
                        {
                            ok: false,
                            error:
                                "listing_expired"
                        }
                    );
            }


            if (
                listing.is_frozen
            ) {

                return res
                    .status(409)
                    .json(
                        {
                            ok: false,
                            error:
                                "listing_frozen"
                        }
                    );
            }


            if (
                offer.status !==
                "countered" ||
                !Number.isFinite(
                    Number(
                        offer.seller_counter_amount
                    )
                ) ||
                Number(
                    offer.seller_counter_amount
                ) <= 0
            ) {

                return res
                    .status(409)
                    .json(
                        {
                            ok: false,
                            error:
                                "counter_not_available"
                        }
                    );
            }


            const {
                data:
                    accepted
            } =
                await supabase
                    .from("offers")
                    .select("id")
                    .eq(
                        "listing_id",
                        offer.listing_id
                    )
                    .eq(
                        "status",
                        "accepted"
                    )
                    .neq(
                        "id",
                        offer.id
                    )
                    .limit(1);


            if (
                accepted?.length
            ) {

                return res
                    .status(409)
                    .json(
                        {
                            ok: false,
                            error:
                                "listing_has_agreement"
                        }
                    );
            }


            const {
                data:
                    updatedOffer,
                error
            } =
                await supabase
                    .from("offers")
                    .update(
                        {
                            status:
                                "accepted",

                            buyer_unread:
                                false,

                            seller_unread:
                                true,

                            updated_at:
                                nowIso()
                        }
                    )
                    .eq(
                        "id",
                        offer.id
                    )
                    .select()
                    .single();


            if (error) {

                return res
                    .status(500)
                    .json(
                        {
                            ok: false,

                            error:
                                error.code ===
                                "23505"
                                    ? "listing_has_agreement"
                                    : "offer_update_failed"
                        }
                    );
            }


            await supabase
                .from("listings")
                .update(
                    {
                        is_paused:
                            true,

                        updated_at:
                            nowIso()
                    }
                )
                .eq(
                    "id",
                    offer.listing_id
                );


            const others =
                await closeOtherOpenOffers(
                    offer.listing_id,
                    offer.id
                );


            for (
                const other of
                others
            ) {

                safeSendOfferMessage(

                    other.buyer_telegram_id,

                    `❌ Another offer for @${listing.whatsapp_username} was accepted. Your open offer was closed.`
                );
            }


            safeSendOfferMessage(

                listing.seller_telegram_id,

                `✅ Buyer accepted your counter offer for @${listing.whatsapp_username}: $${Number(offer.seller_counter_amount).toLocaleString("en-US")}.\n\nOpen Handle Market → Profile → Offers.`
            );


            return res.json(
                {
                    ok: true,
                    offer:
                        updatedOffer
                }
            );
        }


        if (
            ![
                "pending",
                "countered"
            ].includes(
                offer.status
            )
        ) {

            return res
                .status(409)
                .json(
                    {
                        ok: false,
                        error:
                            "offer_not_open"
                    }
                );
        }


        const {
            data:
                updatedOffer,
            error
        } =
            await supabase
                .from("offers")
                .update(
                    {
                        status:
                            "cancelled",

                        buyer_unread:
                            false,

                        seller_unread:
                            true,

                        updated_at:
                            nowIso()
                    }
                )
                .eq(
                    "id",
                    offer.id
                )
                .select()
                .single();


        if (error) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "offer_update_failed"
                    }
                );
        }


        await recordOfferEvent(
            offer.id,
            buyerId,
            "buyer_cancelled"
        );


        safeSendOfferMessage(

            listing.seller_telegram_id,

            `↩️ Buyer cancelled their offer for @${listing.whatsapp_username}.`
        );


        res.json(
            {
                ok: true,
                offer:
                    updatedOffer
            }
        );
    }
);


/* =========================================================
   REPORTS
   ========================================================= */

app.post(
    "/reports/mine",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        const {
            data,
            error
        } =
            await supabase
                .from("reports")
                .select(
                    "listing_id"
                )
                .eq(
                    "reporter_telegram_id",
                    auth.user.telegram_id
                );


        if (error) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "reports_load_failed"
                    }
                );
        }


        res.json(
            {
                ok: true,

                listing_ids:
                    (
                        data ||
                        []
                    ).map(
                        row =>
                            row.listing_id
                    )
            }
        );
    }
);


app.post(
    "/reports/create",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(
                    auth.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            auth.error
                    }
                );
        }


        const reportSecurity =
            await securityRateLimit(
                auth.user,
                "report_create",
                req.body.listing_id ||
                null
            );


        if (!reportSecurity.ok) {
            return sendRateLimitResponse(
                res,
                reportSecurity
            );
        }


        const listingId =
            String(
                req.body.listing_id ||
                ""
            ).trim();


        const allowedReasons = [
            "suspected_scam",
            "false_information",
            "spam",
            "misleading",
            "other"
        ];


        const reason =
            allowedReasons.includes(
                req.body.reason
            )
                ? req.body.reason
                : "other";


        const details =
            String(
                req.body.details ||
                ""
            )
                .trim()
                .slice(
                    0,
                    1000
                );


        const {
            data:
                listing
        } =
            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username,status"
                )
                .eq(
                    "id",
                    listingId
                )
                .maybeSingle();


        if (!listing) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_not_found"
                    }
                );
        }


        if (
            Number(
                listing.seller_telegram_id
            ) ===
            Number(
                auth.user.telegram_id
            )
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "cannot_report_own_listing"
                    }
                );
        }


        const {
            data:
                report,
            error
        } =
            await supabase
                .from("reports")
                .insert(
                    {
                        reporter_telegram_id:
                            auth.user.telegram_id,

                        listing_id:
                            listingId,

                        reason,

                        details:
                            details ||
                            null,

                        status:
                            "open"
                    }
                )
                .select()
                .single();


        if (error) {

            if (
                error.code ===
                "23505"
            ) {

                return res
                    .status(409)
                    .json(
                        {
                            ok: false,
                            error:
                                "already_reported"
                        }
                    );
            }


            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "report_create_failed"
                    }
                );
        }


        notifyAdmins(

            `🚩 New report for @${listing.whatsapp_username}\nReason: ${reason}${details ? `\nDetails: ${details}` : ""}\n\nOpen Handle Market → Admin Panel.`
        );


        res.json(
            {
                ok: true,
                report
            }
        );
    }
);


/* =========================================================
   V38 ADMIN AUDIT MIDDLEWARE
   Logs successful mutating admin actions without initData/contact secrets.
   ========================================================= */

const ADMIN_AUDIT_MUTATION_PATHS =
    new Set([
        "/admin/create-listing",
        "/admin/seller-block",
        "/admin/listing-promotion",
        "/admin/listing-status",
        "/admin/listing-premium",
        "/admin/report-action",
        "/admin/listing-freeze",
        "/admin/listing-remove",
        "/admin/support-status",
        "/admin/risk-flag-action",
        "/admin/team-set"
    ]);


app.use(
    "/admin",
    (req, res, next) => {

        const auditPath =
            String(
                req.originalUrl ||
                ""
            ).split("?")[0];


        if (
            req.method !==
            "POST" ||
            !ADMIN_AUDIT_MUTATION_PATHS.has(
                auditPath
            )
        ) {

            return next();
        }


        res.on(
            "finish",
            async () => {

                if (
                    res.statusCode < 200 ||
                    res.statusCode >= 400
                ) {

                    return;
                }


                try {

                    const admin =
                        await requireAdmin(
                            req.body?.initData
                        );


                    if (
                        !admin.ok
                    ) {

                        return;
                    }


                    const body =
                        req.body ||
                        {};


                    const details = {};


                    for (
                        const [key,value] of
                        Object.entries(
                            body
                        )
                    ) {

                        if (
                            [
                                "initData",
                                "contact_value"
                            ].includes(
                                key
                            )
                        ) {

                            continue;
                        }


                        details[key] =
                            value;
                    }


                    const targetId =
                        body.listing_id ||
                        body.seller_telegram_id ||
                        body.report_id ||
                        body.ticket_id ||
                        body.flag_id ||
                        null;


                    await logAdminActivity(
                        admin.user.telegram_id,
                        auditPath,
                        body.listing_id
                            ? "listing"
                            : body.seller_telegram_id
                                ? "seller"
                                : body.ticket_id
                                    ? "support_ticket"
                                    : body.flag_id
                                        ? "risk_flag"
                                        : "admin",
                        targetId,
                        details
                    );

                } catch (error) {

                    console.error(
                        "Admin audit middleware:",
                        error
                    );
                }
            }
        );


        next();
    }
);



/* =========================================================
   V39 ADMIN DASHBOARD
   ========================================================= */

app.post(
    "/admin/dashboard",
    async (req, res) => {

        const admin =
            req.adminAuth ||
            await requireAdmin(
                req.body.initData
            );


        if (!admin.ok) {

            return res
                .status(
                    admin.status
                )
                .json({
                    ok:false,
                    error:admin.error
                });
        }


        try {

            const now =
                new Date();

            const dayAgo =
                new Date(
                    now.getTime() -
                    24 * 60 * 60 * 1000
                ).toISOString();

            const today =
                new Date(
                    now.getFullYear(),
                    now.getMonth(),
                    now.getDate()
                ).toISOString();


            const [
                usersResult,
                listingsResult,
                reportsResult,
                riskResult,
                supportResult,
                contactOrdersResult,
                listingOrdersResult,
                renewalOrdersResult,
                promotionOrdersResult,
                wantedOrdersResult
            ] =
                await Promise.all([

                    supabase
                        .from("users")
                        .select(
                            "telegram_id,last_seen_at,is_blocked,is_admin"
                        ),

                    supabase
                        .from("listings")
                        .select(
                            "id,status,is_paused,is_frozen,listing_plan,listing_expires_at,created_at"
                        ),

                    supabase
                        .from("reports")
                        .select("id,status"),

                    supabase
                        .from("listing_risk_flags")
                        .select("id,status"),

                    supabase
                        .from("support_tickets")
                        .select("id,status"),

                    supabase
                        .from("contact_unlocks")
                        .select("amount_stars,status"),

                    supabase
                        .from("listing_payment_orders")
                        .select("amount_stars,status"),

                    supabase
                        .from("listing_renewal_orders")
                        .select("amount_stars,status"),

                    supabase
                        .from("promotion_payment_orders")
                        .select("amount_stars,status"),

                    supabase
                        .from("wanted_payment_orders")
                        .select("amount_stars,status")
                ]);


            const results = [
                usersResult,
                listingsResult,
                reportsResult,
                riskResult,
                supportResult,
                contactOrdersResult,
                listingOrdersResult,
                renewalOrdersResult,
                promotionOrdersResult,
                wantedOrdersResult
            ];


            const failed =
                results.find(
                    result =>
                        result.error
                );


            if (failed) {

                throw failed.error;
            }


            const users =
                usersResult.data ||
                [];

            const listings =
                listingsResult.data ||
                [];

            const reports =
                reportsResult.data ||
                [];

            const risks =
                riskResult.data ||
                [];

            const support =
                supportResult.data ||
                [];


            const totalStars =
                [
                    ...(contactOrdersResult.data || [])
                        .filter(row => row.status === "paid"),
                    ...(listingOrdersResult.data || [])
                        .filter(row => row.status === "completed"),
                    ...(renewalOrdersResult.data || [])
                        .filter(row => row.status === "completed"),
                    ...(promotionOrdersResult.data || [])
                        .filter(row => row.status === "completed"),
                    ...(wantedOrdersResult.data || [])
                        .filter(row => row.status === "completed")
                ]
                    .reduce(
                        (sum,row) =>
                            sum +
                            Number(
                                row.amount_stars ||
                                0
                            ),
                        0
                    );


            const activeListings =
                listings.filter(
                    listing =>
                        listingIsPubliclyAvailable(
                            listing
                        )
                ).length;


            return res.json({
                ok:true,
                role:
                    normalizedAdminRole(
                        admin.user
                    ),
                stats:{
                    users_total:
                        users.length,
                    users_active_24h:
                        users.filter(
                            user =>
                                user.last_seen_at &&
                                user.last_seen_at >=
                                dayAgo
                        ).length,
                    admins_total:
                        users.filter(
                            user =>
                                user.is_admin
                        ).length,
                    blocked_sellers:
                        users.filter(
                            user =>
                                user.is_blocked &&
                                !user.is_admin
                        ).length,
                    listings_active:
                        activeListings,
                    listings_pending:
                        listings.filter(
                            listing =>
                                listing.status ===
                                "pending"
                        ).length,
                    listings_frozen:
                        listings.filter(
                            listing =>
                                listing.is_frozen
                        ).length,
                    listings_new_today:
                        listings.filter(
                            listing =>
                                listing.created_at &&
                                listing.created_at >=
                                today
                        ).length,
                    reports_open:
                        reports.filter(
                            row =>
                                row.status ===
                                "open"
                        ).length,
                    risk_flags_open:
                        risks.filter(
                            row =>
                                row.status ===
                                "open"
                        ).length,
                    support_open:
                        support.filter(
                            row =>
                                [
                                    "open",
                                    "in_progress"
                                ].includes(
                                    row.status
                                )
                        ).length,
                    stars_collected:
                        normalizedAdminRole(
                            admin.user
                        ) ===
                        "owner"
                            ? totalStars
                            : null
                }
            });

        } catch (error) {

            console.error(
                "Admin dashboard:",
                error
            );


            return res
                .status(500)
                .json({
                    ok:false,
                    error:"admin_dashboard_failed"
                });
        }
    }
);


/* =========================================================
   V39 ADMIN TEAM / ROLES
   ========================================================= */

app.post(
    "/admin/team",
    async (req, res) => {

        const admin =
            req.adminAuth ||
            await requireAdmin(
                req.body.initData
            );


        if (!admin.ok) {

            return res
                .status(
                    admin.status
                )
                .json({
                    ok:false,
                    error:admin.error
                });
        }


        const {
            data,
            error
        } =
            await supabase
                .from("users")
                .select(
                    "telegram_id,first_name,last_name,telegram_username,is_admin,admin_role,last_seen_at"
                )
                .eq(
                    "is_admin",
                    true
                )
                .order(
                    "telegram_id",
                    {
                        ascending:true
                    }
                );


        if (error) {

            return res
                .status(500)
                .json({
                    ok:false,
                    error:"admin_team_load_failed"
                });
        }


        return res.json({
            ok:true,
            admins:(data || []).map(
                row => ({
                    ...row,
                    admin_role:
                        [
                            "owner",
                            "moderator",
                            "support"
                        ].includes(
                            String(
                                row.admin_role ||
                                ""
                            ).toLowerCase()
                        )
                            ? String(
                                row.admin_role
                            ).toLowerCase()
                            : "owner"
                })
            )
        });
    }
);


app.post(
    "/admin/team-set",
    async (req, res) => {

        const admin =
            req.adminAuth ||
            await requireAdmin(
                req.body.initData
            );


        if (!admin.ok) {

            return res
                .status(
                    admin.status
                )
                .json({
                    ok:false,
                    error:admin.error
                });
        }


        const targetId =
            Number(
                req.body.telegram_id
            );

        const action =
            String(
                req.body.action ||
                "set"
            )
                .trim()
                .toLowerCase();

        const role =
            String(
                req.body.role ||
                "moderator"
            )
                .trim()
                .toLowerCase();


        if (
            !Number.isSafeInteger(
                targetId
            ) ||
            targetId <= 0 ||
            ![
                "set",
                "remove"
            ].includes(
                action
            ) ||
            (
                action === "set" &&
                ![
                    "owner",
                    "moderator",
                    "support"
                ].includes(
                    role
                )
            )
        ) {

            return res
                .status(400)
                .json({
                    ok:false,
                    error:"invalid_admin_team_action"
                });
        }


        if (
            Number(
                admin.user.telegram_id
            ) ===
            targetId
        ) {

            return res
                .status(409)
                .json({
                    ok:false,
                    error:"cannot_change_own_admin_role"
                });
        }


        const {
            data:target,
            error:targetError
        } =
            await supabase
                .from("users")
                .select(
                    "telegram_id,first_name,last_name,telegram_username,is_admin,is_blocked,admin_role"
                )
                .eq(
                    "telegram_id",
                    targetId
                )
                .maybeSingle();


        if (
            targetError ||
            !target
        ) {

            return res
                .status(404)
                .json({
                    ok:false,
                    error:"admin_target_user_not_found"
                });
        }


        if (
            action === "set" &&
            target.is_blocked
        ) {

            return res
                .status(409)
                .json({
                    ok:false,
                    error:"blocked_user_cannot_be_admin"
                });
        }


        if (
            action === "remove" &&
            target.is_admin &&
            String(
                target.admin_role ||
                "owner"
            ).toLowerCase() ===
            "owner"
        ) {

            const {
                count,
                error:ownerCountError
            } =
                await supabase
                    .from("users")
                    .select(
                        "telegram_id",
                        {
                            count:"exact",
                            head:true
                        }
                    )
                    .eq(
                        "is_admin",
                        true
                    )
                    .eq(
                        "admin_role",
                        "owner"
                    );


            if (ownerCountError) {

                return res
                    .status(500)
                    .json({
                        ok:false,
                        error:"admin_owner_check_failed"
                    });
            }


            if (
                Number(
                    count ||
                    0
                ) <= 1
            ) {

                return res
                    .status(409)
                    .json({
                        ok:false,
                        error:"cannot_remove_last_owner"
                    });
            }
        }


        const update =
            action === "remove"
                ? {
                    is_admin:false,
                    admin_role:null
                }
                : {
                    is_admin:true,
                    admin_role:role
                };


        const {
            data:updated,
            error:updateError
        } =
            await supabase
                .from("users")
                .update(
                    update
                )
                .eq(
                    "telegram_id",
                    targetId
                )
                .select(
                    "telegram_id,first_name,last_name,telegram_username,is_admin,admin_role"
                )
                .single();


        if (updateError) {

            return res
                .status(500)
                .json({
                    ok:false,
                    error:"admin_team_update_failed"
                });
        }


        const actionText =
            action === "remove"
                ? "Administrator access removed."
                : `Administrator role set to ${role}.`;


        await safeSendMessage(
            targetId,
            `🛡 Handle Market\n\n${actionText}`
        );


        return res.json({
            ok:true,
            admin:updated
        });
    }
);


/* =========================================================
   ADMIN CONTACT REVIEW
   Admin-only access to the raw seller contact for moderation.
   No Stars payment or buyer unlock is required.
   ========================================================= */

app.post(
    "/admin/listing-contact",
    async (req, res) => {

        const admin =
            await requireAdmin(
                req.body.initData
            );


        if (!admin.ok) {

            return res
                .status(
                    admin.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            admin.error
                    }
                );
        }


        const listingId =
            String(
                req.body.listing_id ||
                ""
            ).trim();


        if (!listingId) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_id_required"
                    }
                );
        }


        const {
            data:
                listing,
            error:
                listingError
        } =
            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username,status,is_paused,is_frozen,category"
                )
                .eq(
                    "id",
                    listingId
                )
                .maybeSingle();


        if (
            listingError ||
            !listing
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_not_found"
                    }
                );
        }


        const {
            data:
                contact,
            error:
                contactError
        } =
            await supabase
                .from(
                    "listing_contacts"
                )
                .select(
                    "contact_type,contact_value"
                )
                .eq(
                    "listing_id",
                    listingId
                )
                .maybeSingle();


        if (
            contactError ||
            !contact
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "seller_contact_not_found"
                    }
                );
        }


        return res.json(
            {
                ok: true,

                listing: {
                    id:
                        listing.id,

                    listing_number:
                        listing.listing_number ||
                        null,

                    seller_telegram_id:
                        listing.seller_telegram_id,

                    whatsapp_username:
                        listing.whatsapp_username,

                    status:
                        listing.status,

                    is_paused:
                        Boolean(
                            listing.is_paused
                        ),

                    is_frozen:
                        Boolean(
                            listing.is_frozen
                        ),

                    category:
                        listing.category ||
                        "Other"
                },

                contact: {
                    type:
                        contact.contact_type,

                    value:
                        contact.contact_value
                }
            }
        );
    }
);


/* =========================================================
   ADMIN CREATE LISTING WITHOUT PAYMENT
   ========================================================= */

app.post(
    "/admin/create-listing",
    async (req, res) => {

        const admin =
            await requireAdmin(
                req.body.initData
            );


        if (!admin.ok) {

            return res
                .status(
                    admin.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            admin.error
                    }
                );
        }


        const sellerTelegramId =
            Number(
                req.body.seller_telegram_id
            );


        if (
            !Number.isSafeInteger(
                sellerTelegramId
            ) ||
            sellerTelegramId <= 0
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "invalid_seller_telegram_id"
                    }
                );
        }


        const validation =
            validateListingInput(
                req.body
            );


        if (
            !validation.ok
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            validation.error
                    }
                );
        }


        const listingPlan =
            String(
                req.body.listing_plan ||
                "paid"
            )
                .trim()
                .toLowerCase();


        if (
            ![
                "legacy",
                "free",
                "paid"
            ].includes(
                listingPlan
            )
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "invalid_listing_plan"
                    }
                );
        }


        const listingStatus =
            String(
                req.body.status ||
                "active"
            )
                .trim()
                .toLowerCase();


        if (
            ![
                "pending",
                "active"
            ].includes(
                listingStatus
            )
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "invalid_listing_status"
                    }
                );
        }


        const input =
            validation.data;


        const {
            data:
                seller,
            error:
                sellerError
        } =
            await supabase
                .from("users")
                .select(
                    "telegram_id,first_name,last_name,telegram_username,free_listing_used,free_listing_used_at"
                )
                .eq(
                    "telegram_id",
                    sellerTelegramId
                )
                .maybeSingle();


        if (
            sellerError
        ) {

            console.error(
                "Admin seller lookup:",
                sellerError
            );


            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "seller_lookup_failed"
                    }
                );
        }


        if (
            !seller
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "seller_not_found"
                    }
                );
        }


        const {
            data:
                duplicate,
            error:
                duplicateError
        } =
            await supabase
                .from("listings")
                .select("id")
                .eq(
                    "seller_telegram_id",
                    sellerTelegramId
                )
                .ilike(
                    "whatsapp_username",
                    input.username
                )
                .in(
                    "status",
                    [
                        "pending",
                        "active",
                        "reserved"
                    ]
                )
                .limit(1);


        if (
            duplicateError
        ) {

            console.error(
                "Admin duplicate listing check:",
                duplicateError
            );


            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_check_failed"
                    }
                );
        }


        if (
            duplicate?.length
        ) {

            return res
                .status(409)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_already_exists"
                    }
                );
        }


        const listingId =
            crypto.randomUUID();


        const startedAt =
            listingStatus ===
            "active"
                ? nowIso()
                : null;


        let expiresAt =
            null;


        if (
            startedAt &&
            listingPlan ===
            "free"
        ) {

            expiresAt =
                addHoursIso(
                    startedAt,
                    FREE_LISTING_DURATION_HOURS
                );
        }


        if (
            startedAt &&
            listingPlan ===
            "paid"
        ) {

            expiresAt =
                addDaysIso(
                    startedAt,
                    PAID_LISTING_DURATION_DAYS
                );
        }


        try {

            const {
                data:
                    listing,
                error:
                    listingError
            } =
                await supabase
                    .from("listings")
                    .insert(
                        {
                            id:
                                listingId,

                            seller_telegram_id:
                                sellerTelegramId,

                            whatsapp_username:
                                input.username,

                            asking_price:
                                input.price,

                            price_type:
                                input.priceType,

                            minimum_offer:
                                input.minimumOffer,

                            currency:
                                "USD",

                            category:
                                input.category,

                            description:
                                input.description,

                            status:
                                listingStatus,

                            verification_status:
                                "unverified",

                            is_premium_name:
                                false,

                            is_featured:
                                false,

                            views_count:
                                0,

                            likes_count:
                                0,

                            is_paused:
                                false,

                            is_frozen:
                                false,

                            listing_plan:
                                listingPlan,

                            listing_period_started_at:
                                listingPlan ===
                                "legacy"
                                    ? null
                                    : startedAt,

                            listing_expires_at:
                                listingPlan ===
                                "legacy"
                                    ? null
                                    : expiresAt,

                            listing_expiry_1h_notified_at:
                                null,

                            listing_expired_notified_at:
                                null,

                            renewal_count:
                                0
                        }
                    )
                    .select(
                        "id,seller_telegram_id,whatsapp_username,asking_price,price_type,minimum_offer,currency,category,description,status,is_premium_name,is_featured,views_count,likes_count,is_paused,is_frozen,created_at,listing_plan,listing_period_started_at,listing_expires_at"
                    )
                    .single();


            if (
                listingError
            ) {

                throw listingError;
            }


            const {
                error:
                    contactError
            } =
                await supabase
                    .from(
                        "listing_contacts"
                    )
                    .insert(
                        {
                            listing_id:
                                listingId,

                            contact_type:
                                input.contactType,

                            contact_value:
                                input.contactValue
                        }
                    );


            if (
                contactError
            ) {

                throw contactError;
            }


            await ensureSellerProfile(
                sellerTelegramId
            );


            if (
                listingPlan ===
                "free"
            ) {

                const {
                    error:
                        freeFlagError
                } =
                    await supabase
                        .from("users")
                        .update(
                            {
                                free_listing_used:
                                    true,

                                free_listing_used_at:
                                    seller.free_listing_used_at ||
                                    nowIso()
                            }
                        )
                        .eq(
                            "telegram_id",
                            sellerTelegramId
                        );


                if (
                    freeFlagError
                ) {

                    throw freeFlagError;
                }
            }


            let sellerMessage =
                `🛡 Handle Market admin added @${input.username} to your account without a payment.`;


            if (
                listingStatus ===
                "pending"
            ) {

                sellerMessage +=
                    "\n\nStatus: ⏳ Pending moderation.";

            } else if (
                listingPlan ===
                "free"
            ) {

                sellerMessage +=
                    `\n\nStatus: ✅ Active\n🎁 Free listing · ${FREE_LISTING_DURATION_HOURS} hours.`;

            } else if (
                listingPlan ===
                "paid"
            ) {

                sellerMessage +=
                    `\n\nStatus: ✅ Active\n🟢 Listing period · ${PAID_LISTING_DURATION_DAYS} days.`;

            } else {

                sellerMessage +=
                    "\n\nStatus: ✅ Active\n∞ Legacy listing · no automatic expiration.";
            }


            await safeSendMessage(
                sellerTelegramId,
                sellerMessage
            );


            if (
                listingStatus ===
                "active"
            ) {
                await notifySellerFollowersOfListing(
                    listing.id
                );
            }


            await detectDuplicateUsernameRisk(
                listing
            );


            return res.json(
                {
                    ok: true,
                    no_payment: true,
                    listing:
                        withLifecycle(
                            listing
                        )
                }
            );

        } catch (error) {

            console.error(
                "Admin listing create:",
                error
            );


            await supabase
                .from(
                    "listing_contacts"
                )
                .delete()
                .eq(
                    "listing_id",
                    listingId
                );


            await supabase
                .from("listings")
                .delete()
                .eq(
                    "id",
                    listingId
                );


            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "admin_listing_create_failed"
                    }
                );
        }
    }
);




/* =========================================================
   ADMIN BLOCK / UNBLOCK SELLER
   Uses the existing users.is_blocked account flag.
   Blocking also freezes the seller's current listings.
   No new SQL columns are required.
   ========================================================= */

const SELLER_BLOCK_FREEZE_PREFIX =
    "Seller account blocked by moderation";


async function resolveSellerForAdminBlock(
    body
) {

    let sellerTelegramId =
        Number(
            body.seller_telegram_id
        );


    const listingId =
        String(
            body.listing_id ||
            ""
        ).trim();


    if (
        !Number.isSafeInteger(
            sellerTelegramId
        ) ||
        sellerTelegramId <= 0
    ) {

        sellerTelegramId =
            0;
    }


    if (
        !sellerTelegramId &&
        listingId
    ) {

        const {
            data:
                listing,
            error:
                listingError
        } =
            await supabase
                .from("listings")
                .select(
                    "seller_telegram_id"
                )
                .eq(
                    "id",
                    listingId
                )
                .maybeSingle();


        if (
            listingError
        ) {

            throw listingError;
        }


        sellerTelegramId =
            Number(
                listing?.seller_telegram_id ||
                0
            );
    }


    if (
        !Number.isSafeInteger(
            sellerTelegramId
        ) ||
        sellerTelegramId <= 0
    ) {

        throw new Error(
            "invalid_seller_telegram_id"
        );
    }


    const {
        data:
            seller,
        error:
            sellerError
    } =
        await supabase
            .from("users")
            .select(
                "telegram_id,first_name,last_name,telegram_username,is_admin,is_blocked"
            )
            .eq(
                "telegram_id",
                sellerTelegramId
            )
            .maybeSingle();


    if (
        sellerError
    ) {

        throw sellerError;
    }


    if (!seller) {

        throw new Error(
            "seller_not_found"
        );
    }


    return seller;
}


app.post(
    "/admin/seller-block",
    async (req, res) => {

        const admin =
            await requireAdmin(
                req.body.initData
            );


        if (!admin.ok) {

            return res
                .status(
                    admin.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            admin.error
                    }
                );
        }


        const action =
            String(
                req.body.action ||
                "block"
            )
                .trim()
                .toLowerCase();


        if (
            ![
                "block",
                "unblock"
            ].includes(
                action
            )
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "invalid_seller_block_action"
                    }
                );
        }


        const reason =
            String(
                req.body.reason ||
                ""
            )
                .trim()
                .slice(
                    0,
                    300
                );


        try {

            const seller =
                await resolveSellerForAdminBlock(
                    req.body
                );


            if (
                seller.is_admin
            ) {

                return res
                    .status(409)
                    .json(
                        {
                            ok: false,
                            error:
                                "cannot_block_admin"
                        }
                    );
            }


            if (
                Number(
                    seller.telegram_id
                ) ===
                Number(
                    admin.user.telegram_id
                )
            ) {

                return res
                    .status(409)
                    .json(
                        {
                            ok: false,
                            error:
                                "cannot_block_self"
                        }
                    );
            }


            if (
                action ===
                "block"
            ) {

                const {
                    error:
                        userError
                } =
                    await supabase
                        .from("users")
                        .update(
                            {
                                is_blocked:
                                    true
                            }
                        )
                        .eq(
                            "telegram_id",
                            seller.telegram_id
                        );


                if (
                    userError
                ) {

                    throw userError;
                }


                const freezeReason =
                    reason
                        ? `${SELLER_BLOCK_FREEZE_PREFIX}: ${reason}`
                        : SELLER_BLOCK_FREEZE_PREFIX;


                const {
                    error:
                        freezeError
                } =
                    await supabase
                        .from("listings")
                        .update(
                            {
                                is_frozen:
                                    true,

                                frozen_reason:
                                    freezeReason,

                                frozen_at:
                                    nowIso(),

                                frozen_by:
                                    Number(
                                        admin.user.telegram_id
                                    ),

                                updated_at:
                                    nowIso()
                            }
                        )
                        .eq(
                            "seller_telegram_id",
                            seller.telegram_id
                        )
                        .in(
                            "status",
                            [
                                "pending",
                                "active",
                                "reserved"
                            ]
                        )
                        .eq(
                            "is_frozen",
                            false
                        );


                if (
                    freezeError
                ) {

                    console.error(
                        "Seller block listing freeze:",
                        freezeError
                    );
                }


                await safeSendMessage(
                    seller.telegram_id,

                    `🚫 Your Handle Market account was blocked by moderation.` +
                    `\n\nYour current listings were frozen and you cannot use Handle Market while the block is active.` +
                    (
                        reason
                            ? `\n\nReason: ${reason}`
                            : ""
                    )
                );


                return res.json(
                    {
                        ok: true,
                        action:
                            "block",
                        seller:
                            {
                                telegram_id:
                                    seller.telegram_id,

                                first_name:
                                    seller.first_name,

                                last_name:
                                    seller.last_name,

                                telegram_username:
                                    seller.telegram_username,

                                is_blocked:
                                    true
                            }
                    }
                );
            }


            const {
                error:
                    userError
            } =
                await supabase
                    .from("users")
                    .update(
                        {
                            is_blocked:
                                false
                        }
                    )
                    .eq(
                        "telegram_id",
                        seller.telegram_id
                    );


            if (
                userError
            ) {

                throw userError;
            }


            /*
             * Only unfreeze listings that were frozen specifically
             * because of the seller account block.
             * Manual moderation freezes are preserved.
             */

            const {
                error:
                    unfreezeError
            } =
                await supabase
                    .from("listings")
                    .update(
                        {
                            is_frozen:
                                false,

                            frozen_reason:
                                null,

                            frozen_at:
                                null,

                            frozen_by:
                                null,

                            updated_at:
                                nowIso()
                        }
                    )
                    .eq(
                        "seller_telegram_id",
                        seller.telegram_id
                    )
                    .eq(
                        "is_frozen",
                        true
                    )
                    .ilike(
                        "frozen_reason",
                        `${SELLER_BLOCK_FREEZE_PREFIX}%`
                    );


            if (
                unfreezeError
            ) {

                console.error(
                    "Seller unblock listing unfreeze:",
                    unfreezeError
                );
            }


            await safeSendMessage(
                seller.telegram_id,

                `✅ Your Handle Market account was unblocked by moderation.` +
                `\n\nListings that were frozen only because of the account block were restored.`
            );


            return res.json(
                {
                    ok: true,
                    action:
                        "unblock",
                    seller:
                        {
                            telegram_id:
                                seller.telegram_id,

                            first_name:
                                seller.first_name,

                            last_name:
                                seller.last_name,

                            telegram_username:
                                seller.telegram_username,

                            is_blocked:
                                false
                        }
                }
            );

        } catch (error) {

            console.error(
                "Admin seller block:",
                error
            );


            const code =
                String(
                    error?.message ||
                    "seller_block_failed"
                );


            const status =
                code ===
                "seller_not_found"
                    ? 404
                    : code ===
                        "invalid_seller_telegram_id"
                        ? 400
                        : 500;


            return res
                .status(
                    status
                )
                .json(
                    {
                        ok: false,
                        error:
                            code
                    }
                );
        }
    }
);


app.post(
    "/admin/blocked-sellers",
    async (req, res) => {

        const admin =
            await requireAdmin(
                req.body.initData
            );


        if (!admin.ok) {

            return res
                .status(
                    admin.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            admin.error
                    }
                );
        }


        const {
            data,
            error
        } =
            await supabase
                .from("users")
                .select(
                    "telegram_id,first_name,last_name,telegram_username,last_seen_at,is_admin,is_blocked"
                )
                .eq(
                    "is_blocked",
                    true
                )
                .eq(
                    "is_admin",
                    false
                )
                .order(
                    "last_seen_at",
                    {
                        ascending:
                            false
                    }
                );


        if (
            error
        ) {

            console.error(
                "Blocked sellers load:",
                error
            );


            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "blocked_sellers_load_failed"
                    }
                );
        }


        return res.json(
            {
                ok: true,
                sellers:
                    data ||
                    []
            }
        );
    }
);


/* =========================================================
   ADMIN FREE PROMOTION MANAGEMENT
   ========================================================= */

app.post(
    "/admin/listing-promotion",
    async (req, res) => {

        const admin =
            await requireAdmin(
                req.body.initData
            );


        if (!admin.ok) {

            return res
                .status(
                    admin.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            admin.error
                    }
                );
        }


        const listingId =
            String(
                req.body.listing_id ||
                ""
            ).trim();


        const action =
            String(
                req.body.action ||
                "apply"
            )
                .trim()
                .toLowerCase();


        if (!listingId) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_id_required"
                    }
                );
        }


        const {
            data:
                listing,
            error:
                listingError
        } =
            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username,status,is_paused,is_frozen,listing_plan,listing_expires_at,bump_until,hot_until,vip_until"
                )
                .eq(
                    "id",
                    listingId
                )
                .maybeSingle();


        if (
            listingError ||
            !listing
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_not_found"
                    }
                );
        }


        if (
            listing.status !==
            "active"
        ) {

            return res
                .status(409)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_not_active"
                    }
                );
        }


        if (
            isListingExpired(
                listing
            )
        ) {

            return res
                .status(409)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_expired"
                    }
                );
        }


        /* ---------------------------------------------
           CLEAR ALL PAID / ADMIN PROMOTIONS
           --------------------------------------------- */

        if (
            action ===
            "clear"
        ) {

            const {
                data,
                error
            } =
                await supabase
                    .from("listings")
                    .update(
                        {
                            bump_until:
                                null,

                            hot_until:
                                null,

                            vip_until:
                                null,

                            bump_promoted_at:
                                null,

                            hot_promoted_at:
                                null,

                            vip_promoted_at:
                                null,

                            bump_expiry_1h_notified_at:
                                null,

                            bump_expired_notified_at:
                                null,

                            hot_expiry_1h_notified_at:
                                null,

                            hot_expired_notified_at:
                                null,

                            vip_expiry_1h_notified_at:
                                null,

                            vip_expired_notified_at:
                                null,

                            updated_at:
                                nowIso()
                        }
                    )
                    .eq(
                        "id",
                        listingId
                    )
                    .select(
                        "id,whatsapp_username,bump_until,hot_until,vip_until"
                    )
                    .single();


            if (error) {

                console.error(
                    "Admin promotion clear:",
                    error
                );


                return res
                    .status(500)
                    .json(
                        {
                            ok: false,
                            error:
                                "admin_promotion_update_failed"
                        }
                    );
            }


            await safeSendMessage(
                listing.seller_telegram_id,
                `ℹ️ Handle Market admin removed active promotion from @${listing.whatsapp_username}.`
            );


            return res.json(
                {
                    ok: true,
                    action:
                        "clear",
                    listing:
                        data
                }
            );
        }


        if (
            action !==
            "apply"
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "invalid_promotion_action"
                    }
                );
        }


        const type =
            String(
                req.body.promotion_type ||
                ""
            )
                .trim()
                .toLowerCase();


        const durationHours =
            Number(
                req.body.duration_hours
            );


        if (
            ![
                "bump",
                "hot",
                "vip"
            ].includes(
                type
            ) ||
            ![
                24,
                72,
                168
            ].includes(
                durationHours
            )
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "invalid_promotion"
                    }
                );
        }


        /*
         * Admin assignment starts a fresh timer from now.
         * It never extends the listing itself.
         * If the listing expires sooner, promotion is capped
         * at the listing expiration time.
         */

        const now =
            Date.now();


        let appliedUntilMs =
            now +
            durationHours *
            60 *
            60 *
            1000;


        const listingExpiryMs =
            timeMs(
                listing.listing_expires_at
            );


        let cappedByListingExpiry =
            false;


        if (
            listingExpiryMs &&
            appliedUntilMs >
            listingExpiryMs
        ) {

            appliedUntilMs =
                listingExpiryMs;


            cappedByListingExpiry =
                true;
        }


        if (
            appliedUntilMs <=
            now
        ) {

            return res
                .status(409)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_expired"
                    }
                );
        }


        const appliedUntil =
            new Date(
                appliedUntilMs
            ).toISOString();


        const untilField =
            `${type}_until`;


        const promotedAtField =
            `${type}_promoted_at`;


        const hourField =
            `${type}_expiry_1h_notified_at`;


        const expiredField =
            `${type}_expired_notified_at`;


        const {
            data,
            error
        } =
            await supabase
                .from("listings")
                .update(
                    {
                        [untilField]:
                            appliedUntil,

                        [promotedAtField]:
                            nowIso(),

                        [hourField]:
                            null,

                        [expiredField]:
                            null,

                        updated_at:
                            nowIso()
                    }
                )
                .eq(
                    "id",
                    listingId
                )
                .select(
                    "id,whatsapp_username,bump_until,hot_until,vip_until,bump_promoted_at,hot_promoted_at,vip_promoted_at"
                )
                .single();


        if (error) {

            console.error(
                "Admin promotion apply:",
                error
            );


            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "admin_promotion_update_failed"
                    }
                );
        }


        const label =
            type === "vip"
                ? "💎 VIP"
                : type === "hot"
                    ? "🔥 HOT"
                    : "⬆️ Bump";


        const durationLabel =
            durationHours === 24
                ? "24 hours"
                : durationHours === 72
                    ? "3 days"
                    : "7 days";


        await safeSendMessage(
            listing.seller_telegram_id,
            `${label} promotion was added to @${listing.whatsapp_username} by Handle Market admin for ${durationLabel}.${cappedByListingExpiry ? "\n\nThe promotion will end earlier because the listing itself expires first." : ""}`
        );


        res.json(
            {
                ok: true,
                action:
                    "apply",
                promotion_type:
                    type,
                duration_hours:
                    durationHours,
                applied_until:
                    appliedUntil,
                capped_by_listing_expiry:
                    cappedByListingExpiry,
                listing:
                    data
            }
        );
    }
);

/* =========================================================
   ADMIN PENDING
   ========================================================= */

app.post(
    "/admin/pending-listings",
    async (req, res) => {

        const admin =
            await requireAdmin(
                req.body.initData
            );


        if (!admin.ok) {

            return res
                .status(
                    admin.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            admin.error
                    }
                );
        }


        const {
            data:
                listings,
            error
        } =
            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username,asking_price,price_type,minimum_offer,currency,category,description,status,is_premium_name,created_at,listing_plan,contact_review_required,contact_last_changed_at"
                )
                .eq(
                    "status",
                    "pending"
                )
                .order(
                    "created_at",
                    {
                        ascending: true
                    }
                );


        if (error) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "admin_load_failed"
                    }
                );
        }


        const sellerIds = [
            ...new Set(
                (
                    listings ||
                    []
                ).map(
                    row =>
                        row.seller_telegram_id
                )
            )
        ];


        let users = [];


        if (
            sellerIds.length
        ) {

            const {
                data
            } =
                await supabase
                    .from("users")
                    .select(
                        "telegram_id,first_name,telegram_username"
                    )
                    .in(
                        "telegram_id",
                        sellerIds
                    );


            users =
                data ||
                [];
        }


        const map =
            new Map(

                users.map(
                    row => [
                        String(
                            row.telegram_id
                        ),
                        row
                    ]
                )
            );



        const pendingIds =
            (
                listings ||
                []
            ).map(
                row =>
                    row.id
            );


        let openFlags = [];


        if (
            pendingIds.length
        ) {

            const {
                data
            } =
                await supabase
                    .from(
                        "listing_risk_flags"
                    )
                    .select(
                        "id,listing_id,flag_type,severity,status,details,created_at"
                    )
                    .in(
                        "listing_id",
                        pendingIds
                    )
                    .eq(
                        "status",
                        "open"
                    );


            openFlags =
                data ||
                [];
        }


        const riskMap =
            new Map();


        for (
            const flag of
            openFlags
        ) {

            const key =
                String(
                    flag.listing_id
                );

            const list =
                riskMap.get(
                    key
                ) ||
                [];

            list.push(
                flag
            );

            riskMap.set(
                key,
                list
            );
        }


        res.json(
            {
                ok: true,

                listings:
                    (
                        listings ||
                        []
                    ).map(
                        row => ({

                            ...row,

                            seller:
                                map.get(
                                    String(
                                        row.seller_telegram_id
                                    )
                                ) ||
                                null,

                            risk_flags:
                                riskMap.get(
                                    String(
                                        row.id
                                    )
                                ) ||
                                []
                        })
                    )
            }
        );
    }
);


/* =========================================================
   ADMIN STATUS
   ========================================================= */

app.post(
    "/admin/listing-status",
    async (req, res) => {

        const admin =
            await requireAdmin(
                req.body.initData
            );


        if (!admin.ok) {

            return res
                .status(
                    admin.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            admin.error
                    }
                );
        }


        const listingId =
            String(
                req.body.listing_id ||
                ""
            ).trim();


        const newStatus =
            req.body.status;


        if (
            ![
                "active",
                "rejected"
            ].includes(
                newStatus
            )
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "invalid_admin_action"
                    }
                );
        }


        const {
            data:
                existing
        } =
            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username,status,is_premium_name,listing_plan,listing_period_started_at,listing_expires_at,contact_review_required,contact_last_changed_by"
                )
                .eq(
                    "id",
                    listingId
                )
                .eq(
                    "status",
                    "pending"
                )
                .maybeSingle();


        if (!existing) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "pending_listing_not_found"
                    }
                );
        }


        const update = {

            status:
                newStatus,

            updated_at:
                nowIso()
        };


        if (
            newStatus ===
            "active"
        ) {

            const startedAt =
                nowIso();


            /*
             * A contact re-review must not restart the seller's
             * existing FREE/PAID listing timer.
             */

            const restartingExistingPeriod =
                Boolean(
                    existing.contact_review_required &&
                    existing.listing_period_started_at
                );


            if (
                restartingExistingPeriod
            ) {

                update.contact_review_required =
                    false;

                update.contact_last_changed_by =
                    existing.contact_last_changed_by ||
                    null;
            }


            if (
                !restartingExistingPeriod &&
                existing.listing_plan ===
                "free"
            ) {

                update.listing_period_started_at =
                    startedAt;


                update.listing_expires_at =
                    addHoursIso(
                        startedAt,
                        FREE_LISTING_DURATION_HOURS
                    );


                update.listing_expiry_1h_notified_at =
                    null;


                update.listing_expired_notified_at =
                    null;
            }


            if (
                !restartingExistingPeriod &&
                existing.listing_plan ===
                "paid"
            ) {

                update.listing_period_started_at =
                    startedAt;


                update.listing_expires_at =
                    addDaysIso(
                        startedAt,
                        PAID_LISTING_DURATION_DAYS
                    );


                update.listing_expiry_1h_notified_at =
                    null;


                update.listing_expired_notified_at =
                    null;
            }


            if (
                !restartingExistingPeriod &&
                existing.listing_plan ===
                "referral"
            ) {

                update.listing_period_started_at =
                    startedAt;


                update.listing_expires_at =
                    addHoursIso(
                        startedAt,
                        REFERRAL_LISTING_DURATION_HOURS
                    );


                update.listing_expiry_1h_notified_at =
                    null;


                update.listing_expired_notified_at =
                    null;
            }
        }


        if (
            existing.contact_review_required
        ) {

            update.contact_review_required =
                false;
        }


        const {
            data,
            error
        } =
            await supabase
                .from("listings")
                .update(
                    update
                )
                .eq(
                    "id",
                    listingId
                )
                .eq(
                    "status",
                    "pending"
                )
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username,status,is_premium_name,listing_plan,listing_period_started_at,listing_expires_at,contact_review_required"
                )
                .maybeSingle();


        if (
            error ||
            !data
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "pending_listing_not_found"
                    }
                );
        }


        let message;


        if (
            existing.contact_review_required &&
            newStatus ===
            "active"
        ) {

            message =
                `✅ The updated contact for @${data.whatsapp_username} was approved. The listing is live again.\n\nYour original listing expiration timer continues unchanged.`;

        } else if (
            existing.contact_review_required &&
            newStatus ===
            "rejected"
        ) {

            message =
                `❌ The updated contact for @${data.whatsapp_username} was rejected by moderation.`;

        } else if (
            newStatus ===
            "active"
        ) {

            if (
                data.listing_plan ===
                "free"
            ) {

                message =
                    `✅ @${data.whatsapp_username} was approved and is now live.\n\n🎁 Your free ${FREE_LISTING_DURATION_HOURS}-hour timer has started.`;

            } else if (
                data.listing_plan ===
                "paid"
            ) {

                message =
                    `✅ @${data.whatsapp_username} was approved and is now live for ${PAID_LISTING_DURATION_DAYS} days.`;

            } else if (
                data.listing_plan ===
                "referral"
            ) {

                message =
                    `✅ @${data.whatsapp_username} was approved. Your referral reward listing is now live for ${REFERRAL_LISTING_DURATION_HOURS / 24} days.`;

            } else {

                message =
                    `✅ @${data.whatsapp_username} was approved and is now live.`;
            }


            if (
                data.is_premium_name
            ) {

                message +=
                    "\n\n⭐ Premium status awarded by Handle Market.";
            }

        } else {

            message =
                `❌ @${data.whatsapp_username} was rejected by moderation.`;
        }


        if (
            existing.contact_review_required
        ) {

            if (
                newStatus ===
                "active"
            ) {

                await resolveRiskFlagType(
                    listingId,
                    "contact_changed",
                    admin.user.telegram_id,
                    "New seller contact approved"
                );
            }


            await addListingChangeHistory(
                listingId,
                "admin",
                admin.user.telegram_id,
                newStatus === "active"
                    ? "contact_review_approved"
                    : "contact_review_rejected",
                null,
                { status:newStatus }
            );
        }


        safeSendMessage(
            data.seller_telegram_id,
            message
        );


        if (
            newStatus ===
            "active"
        ) {
            await notifySellerFollowersOfListing(
                data.id
            );
        }


        res.json(
            {
                ok: true,

                listing:
                    withLifecycle(
                        data
                    )
            }
        );
    }
);


/* =========================================================
   ADMIN PREMIUM
   ========================================================= */

app.post(
    "/admin/listing-premium",
    async (req, res) => {

        const admin =
            await requireAdmin(
                req.body.initData
            );


        if (!admin.ok) {

            return res
                .status(
                    admin.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            admin.error
                    }
                );
        }


        const listingId =
            String(
                req.body.listing_id ||
                ""
            ).trim();


        const isPremium =
            req.body.is_premium;


        if (
            !listingId ||
            typeof isPremium !==
            "boolean"
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "invalid_premium_action"
                    }
                );
        }


        const {
            data:
                existing
        } =
            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username,status"
                )
                .eq(
                    "id",
                    listingId
                )
                .maybeSingle();


        if (!existing) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "listing_not_found"
                    }
                );
        }


        const update =
            isPremium

                ? {

                    is_premium_name:
                        true,

                    premium_marked_at:
                        nowIso(),

                    premium_marked_by:
                        Number(
                            admin.user.telegram_id
                        ),

                    updated_at:
                        nowIso()
                }

                : {

                    is_premium_name:
                        false,

                    premium_marked_at:
                        null,

                    premium_marked_by:
                        null,

                    updated_at:
                        nowIso()
                };


        const {
            data,
            error
        } =
            await supabase
                .from("listings")
                .update(
                    update
                )
                .eq(
                    "id",
                    listingId
                )
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username,status,is_premium_name,premium_marked_at"
                )
                .single();


        if (error) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "premium_update_failed"
                    }
                );
        }


        safeSendMessage(

            data.seller_telegram_id,

            isPremium
                ? `⭐ @${data.whatsapp_username} is now Premium on Handle Market.`
                : `☆ Premium status was removed from @${data.whatsapp_username}.`
        );


        res.json(
            {
                ok: true,
                listing:
                    data
            }
        );
    }
);


/* =========================================================
   ADMIN REPORTS
   ========================================================= */

app.post(
    "/admin/reports",
    async (req, res) => {

        const admin =
            await requireAdmin(
                req.body.initData
            );


        if (!admin.ok) {

            return res
                .status(
                    admin.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            admin.error
                    }
                );
        }


        const {
            data:
                reports,
            error
        } =
            await supabase
                .from("reports")
                .select(
                    "id,reporter_telegram_id,listing_id,reason,details,status,created_at"
                )
                .eq(
                    "status",
                    "open"
                )
                .order(
                    "created_at",
                    {
                        ascending: true
                    }
                );


        if (error) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "reports_load_failed"
                    }
                );
        }


        const listingIds = [
            ...new Set(
                (
                    reports ||
                    []
                ).map(
                    row =>
                        row.listing_id
                )
            )
        ];


        let listings = [];


        if (
            listingIds.length
        ) {

            const {
                data
            } =
                await supabase
                    .from("listings")
                    .select(
                        "id,seller_telegram_id,listing_number,whatsapp_username,asking_price,price_type,minimum_offer,category,status,is_premium_name,is_paused,is_frozen,frozen_reason,listing_plan,listing_expires_at"
                    )
                    .in(
                        "id",
                        listingIds
                    );


            listings =
                (
                    data ||
                    []
                ).map(
                    withLifecycle
                );
        }


        const map =
            new Map(

                listings.map(
                    row => [
                        String(
                            row.id
                        ),
                        row
                    ]
                )
            );


        res.json(
            {
                ok: true,

                reports:
                    (
                        reports ||
                        []
                    ).map(
                        row => ({

                            ...row,

                            listing:
                                map.get(
                                    String(
                                        row.listing_id
                                    )
                                ) ||
                                null
                        })
                    )
            }
        );
    }
);


/* =========================================================
   ADMIN FROZEN
   ========================================================= */

app.post(
    "/admin/frozen-listings",
    async (req, res) => {

        const admin =
            await requireAdmin(
                req.body.initData
            );


        if (!admin.ok) {

            return res
                .status(
                    admin.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            admin.error
                    }
                );
        }


        const {
            data,
            error
        } =
            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username,asking_price,price_type,minimum_offer,currency,category,description,status,is_premium_name,is_paused,is_frozen,frozen_reason,frozen_at,frozen_by,created_at,listing_plan,listing_expires_at"
                )
                .eq(
                    "is_frozen",
                    true
                )
                .order(
                    "frozen_at",
                    {
                        ascending: false
                    }
                );


        if (error) {

            return res
                .status(500)
                .json(
                    {
                        ok: false,
                        error:
                            "frozen_load_failed"
                    }
                );
        }


        res.json(
            {
                ok: true,

                listings:
                    (
                        data ||
                        []
                    ).map(
                        withLifecycle
                    )
            }
        );
    }
);


/* =========================================================
   MODERATION HELPERS
   ========================================================= */

async function freezeListing(
    listingId,
    adminId,
    reason
) {

    const {
        data:
            listing
    } =
        await supabase
            .from("listings")
            .select(
                "id,seller_telegram_id,listing_number,whatsapp_username,status,is_frozen"
            )
            .eq(
                "id",
                listingId
            )
            .maybeSingle();


    if (!listing) {

        throw new Error(
            "listing_not_found"
        );
    }


    const {
        data,
        error
    } =
        await supabase
            .from("listings")
            .update(
                {
                    is_frozen:
                        true,

                    frozen_reason:
                        String(
                            reason ||
                            "Under moderation review"
                        ).slice(
                            0,
                            500
                        ),

                    frozen_at:
                        nowIso(),

                    frozen_by:
                        Number(
                            adminId
                        ),

                    updated_at:
                        nowIso()
                }
            )
            .eq(
                "id",
                listingId
            )
            .select()
            .single();


    if (error) {

        throw error;
    }


    safeSendMessage(

        listing.seller_telegram_id,

        `🧊 @${listing.whatsapp_username} was temporarily frozen by moderation.${reason ? `\n\nReason: ${reason}` : ""}`
    );


    return data;
}


async function unfreezeListing(
    listingId
) {

    const {
        data,
        error
    } =
        await supabase
            .from("listings")
            .update(
                {
                    is_frozen:
                        false,

                    frozen_reason:
                        null,

                    frozen_at:
                        null,

                    frozen_by:
                        null,

                    updated_at:
                        nowIso()
                }
            )
            .eq(
                "id",
                listingId
            )
            .eq(
                "is_frozen",
                true
            )
            .select(
                "id,seller_telegram_id,whatsapp_username"
            )
            .maybeSingle();


    if (
        error ||
        !data
    ) {

        throw new Error(
            "listing_not_frozen"
        );
    }


    safeSendMessage(

        data.seller_telegram_id,

        `✅ @${data.whatsapp_username} was unfrozen by moderation.`
    );


    return data;
}


async function adminRemoveListingInternal(
    listingId
) {

    const {
        data:
            listing
    } =
        await supabase
            .from("listings")
            .select(
                "id,seller_telegram_id,listing_number,whatsapp_username"
            )
            .eq(
                "id",
                listingId
            )
            .maybeSingle();


    if (!listing) {

        throw new Error(
            "listing_not_found"
        );
    }


    const {
        error
    } =
        await supabase
            .from("listings")
            .update(
                {
                    status:
                        "removed",

                    is_paused:
                        true,

                    is_frozen:
                        false,

                    frozen_reason:
                        null,

                    frozen_at:
                        null,

                    frozen_by:
                        null,

                    updated_at:
                        nowIso()
                }
            )
            .eq(
                "id",
                listingId
            );


    if (error) {

        throw error;
    }


    await closeListingOpenOffers(

        listingId,

        `❌ @${listing.whatsapp_username} was removed by moderation. Your open offer was closed.`
    );


    safeSendMessage(

        listing.seller_telegram_id,

        `❌ @${listing.whatsapp_username} was removed by Handle Market moderation.`
    );


    return listing;
}


/* =========================================================
   ADMIN REPORT ACTION
   ========================================================= */

app.post(
    "/admin/report-action",
    async (req, res) => {

        const admin =
            await requireAdmin(
                req.body.initData
            );


        if (!admin.ok) {

            return res
                .status(
                    admin.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            admin.error
                    }
                );
        }


        const reportId =
            String(
                req.body.report_id ||
                ""
            ).trim();


        const action =
            String(
                req.body.action ||
                ""
            ).trim();


        if (
            ![
                "dismiss",
                "freeze",
                "remove"
            ].includes(
                action
            )
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "invalid_admin_action"
                    }
                );
        }


        const {
            data:
                report
        } =
            await supabase
                .from("reports")
                .select("*")
                .eq(
                    "id",
                    reportId
                )
                .eq(
                    "status",
                    "open"
                )
                .maybeSingle();


        if (!report) {

            return res
                .status(404)
                .json(
                    {
                        ok: false,
                        error:
                            "report_not_found"
                    }
                );
        }


        try {

            if (
                action ===
                "freeze"
            ) {

                await freezeListing(

                    report.listing_id,

                    admin.user.telegram_id,

                    report.details ||
                    report.reason
                );
            }


            if (
                action ===
                "remove"
            ) {

                await adminRemoveListingInternal(
                    report.listing_id
                );
            }


            const newStatus =
                action ===
                "dismiss"
                    ? "dismissed"
                    : "resolved";


            await supabase
                .from("reports")
                .update(
                    {
                        status:
                            newStatus,

                        reviewed_at:
                            nowIso(),

                        reviewed_by:
                            admin.user.telegram_id
                    }
                )
                .eq(
                    "id",
                    reportId
                );


            res.json(
                {
                    ok: true
                }
            );

        } catch (error) {

            res
                .status(500)
                .json(
                    {
                        ok: false,

                        error:
                            error.message ||
                            "admin_action_failed"
                    }
                );
        }
    }
);


/* =========================================================
   ADMIN FREEZE
   ========================================================= */

app.post(
    "/admin/listing-freeze",
    async (req, res) => {

        const admin =
            await requireAdmin(
                req.body.initData
            );


        if (!admin.ok) {

            return res
                .status(
                    admin.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            admin.error
                    }
                );
        }


        const listingId =
            String(
                req.body.listing_id ||
                ""
            ).trim();


        const action =
            String(
                req.body.action ||
                ""
            ).trim();


        if (
            ![
                "freeze",
                "unfreeze"
            ].includes(
                action
            )
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "invalid_admin_action"
                    }
                );
        }


        try {

            const listing =
                action ===
                "freeze"

                    ? await freezeListing(
                        listingId,
                        admin.user.telegram_id,
                        req.body.reason
                    )

                    : await unfreezeListing(
                        listingId
                    );


            res.json(
                {
                    ok: true,
                    listing
                }
            );

        } catch (error) {

            res
                .status(404)
                .json(
                    {
                        ok: false,

                        error:
                            error.message ||
                            "listing_action_failed"
                    }
                );
        }
    }
);


/* =========================================================
   ADMIN REMOVE
   ========================================================= */

app.post(
    "/admin/listing-remove",
    async (req, res) => {

        const admin =
            await requireAdmin(
                req.body.initData
            );


        if (!admin.ok) {

            return res
                .status(
                    admin.status
                )
                .json(
                    {
                        ok: false,
                        error:
                            admin.error
                    }
                );
        }


        const listingId =
            String(
                req.body.listing_id ||
                ""
            ).trim();


        try {

            const listing =
                await adminRemoveListingInternal(
                    listingId
                );


            res.json(
                {
                    ok: true,
                    listing
                }
            );

        } catch (error) {

            res
                .status(404)
                .json(
                    {
                        ok: false,

                        error:
                            error.message ||
                            "listing_remove_failed"
                    }
                );
        }
    }
);


/* =========================================================
   V38 PUBLIC PRICE HISTORY
   ========================================================= */

app.get(
    "/listing/price-history/:listingId",
    async (req, res) => {

        const listingId =
            String(
                req.params.listingId ||
                ""
            ).trim();


        const {
            data:listing
        } =
            await supabase
                .from("listings")
                .select(
                    "id,listing_number,whatsapp_username,status,is_paused,is_frozen,listing_plan,listing_expires_at"
                )
                .eq(
                    "id",
                    listingId
                )
                .maybeSingle();


        if (
            !listingIsPubliclyAvailable(
                listing
            )
        ) {

            return res
                .status(404)
                .json(
                    {
                        ok:false,
                        error:"listing_not_available"
                    }
                );
        }


        const {
            data:history,
            error
        } =
            await supabase
                .from(
                    "listing_price_history"
                )
                .select(
                    "old_price,new_price,changed_at"
                )
                .eq(
                    "listing_id",
                    listingId
                )
                .order(
                    "changed_at",
                    {
                        ascending:false
                    }
                )
                .limit(30);


        if (error) {

            return res
                .status(500)
                .json(
                    {
                        ok:false,
                        error:"price_history_load_failed"
                    }
                );
        }


        return res.json(
            {
                ok:true,
                listing:{
                    id:listing.id,
                    listing_number:
                        listing.listing_number ||
                        null,
                    whatsapp_username:
                        listing.whatsapp_username
                },
                history:
                    history ||
                    []
            }
        );
    }
);


/* =========================================================
   V38 ADMIN RISK FLAGS
   ========================================================= */

app.post(
    "/admin/risk-flags",
    async (req, res) => {

        const admin =
            await requireAdmin(
                req.body.initData
            );


        if (!admin.ok) {

            return res
                .status(admin.status)
                .json({
                    ok:false,
                    error:admin.error
                });
        }


        /* Existing and future external links are reviewed, not called scams. */
        try {

            const {
                data:contacts
            } =
                await supabase
                    .from(
                        "listing_contacts"
                    )
                    .select(
                        "listing_id,contact_type,contact_value"
                    )
                    .limit(1000);


            for (
                const contact of
                contacts || []
            ) {

                if (
                    contactHasExternalLink(
                        contact.contact_value
                    )
                ) {

                    await ensureRiskFlag(
                        contact.listing_id,
                        "external_link_contact",
                        "medium",
                        {
                            contact_type:
                                contact.contact_type
                        }
                    );
                }
            }


            const {
                data:openReports
            } =
                await supabase
                    .from("reports")
                    .select("listing_id")
                    .eq("status","open")
                    .limit(2000);


            const counts =
                new Map();


            for (
                const row of
                openReports || []
            ) {

                const key =
                    String(
                        row.listing_id
                    );

                counts.set(
                    key,
                    (
                        counts.get(key) ||
                        0
                    ) + 1
                );
            }


            for (
                const [listingId,count] of
                counts.entries()
            ) {

                if (
                    count >= 2
                ) {

                    await ensureRiskFlag(
                        listingId,
                        "multiple_reports",
                        count >= 4
                            ? "high"
                            : "medium",
                        {
                            open_reports:count
                        }
                    );
                }
            }

        } catch (error) {

            console.error(
                "Risk scan:",
                error
            );
        }


        const {
            data:flags,
            error
        } =
            await supabase
                .from(
                    "listing_risk_flags"
                )
                .select(
                    "id,listing_id,flag_type,severity,status,details,created_at"
                )
                .eq(
                    "status",
                    "open"
                )
                .order(
                    "created_at",
                    {
                        ascending:false
                    }
                )
                .limit(100);


        if (error) {

            return res
                .status(500)
                .json({
                    ok:false,
                    error:"risk_flags_load_failed"
                });
        }


        const listingIds =
            [
                ...new Set(
                    (flags || [])
                        .map(row => row.listing_id)
                )
            ];


        let listings = [];


        if (
            listingIds.length
        ) {

            const {
                data
            } =
                await supabase
                    .from("listings")
                    .select(
                        "id,listing_number,whatsapp_username,seller_telegram_id,status,is_frozen,contact_review_required"
                    )
                    .in(
                        "id",
                        listingIds
                    );


            listings =
                data || [];
        }


        const listingMap =
            new Map(
                listings.map(
                    row => [
                        String(row.id),
                        row
                    ]
                )
            );


        return res.json({
            ok:true,
            flags:(flags || []).map(
                row => ({
                    ...row,
                    listing:
                        listingMap.get(
                            String(row.listing_id)
                        ) || null
                })
            )
        });
    }
);


app.post(
    "/admin/risk-flag-action",
    async (req, res) => {

        const admin =
            await requireAdmin(
                req.body.initData
            );


        if (!admin.ok) {

            return res
                .status(admin.status)
                .json({
                    ok:false,
                    error:admin.error
                });
        }


        const flagId =
            Number(
                req.body.flag_id
            );


        const action =
            String(
                req.body.action ||
                ""
            ).trim();


        if (
            !Number.isSafeInteger(flagId) ||
            ![
                "resolve",
                "dismiss"
            ].includes(action)
        ) {

            return res
                .status(400)
                .json({
                    ok:false,
                    error:"invalid_risk_action"
                });
        }


        const {
            data,
            error
        } =
            await supabase
                .from(
                    "listing_risk_flags"
                )
                .update({
                    status:
                        action === "resolve"
                            ? "resolved"
                            : "dismissed",
                    resolved_at:nowIso(),
                    resolved_by:
                        Number(
                            admin.user.telegram_id
                        ),
                    resolution_note:
                        String(
                            req.body.note ||
                            ""
                        ).trim().slice(0,300) || null
                })
                .eq("id",flagId)
                .eq("status","open")
                .select()
                .maybeSingle();


        if (
            error ||
            !data
        ) {

            return res
                .status(404)
                .json({
                    ok:false,
                    error:"risk_flag_not_found"
                });
        }


        return res.json({
            ok:true,
            flag:data
        });
    }
);


/* =========================================================
   V38 ADMIN LISTING HISTORY
   ========================================================= */

app.post(
    "/admin/listing-history",
    async (req, res) => {

        const admin =
            await requireAdmin(
                req.body.initData
            );


        if (!admin.ok) {

            return res
                .status(admin.status)
                .json({
                    ok:false,
                    error:admin.error
                });
        }


        const raw =
            String(
                req.body.lookup ||
                req.body.listing_id ||
                ""
            )
                .trim()
                .replace(/^LOT\s*#?/i,"")
                .trim();


        let query =
            supabase
                .from("listings")
                .select(
                    "id,listing_number,whatsapp_username,seller_telegram_id,asking_price,status,contact_review_required,created_at,updated_at"
                );


        if (
            /^\d+$/.test(raw)
        ) {

            query =
                query.eq(
                    "listing_number",
                    Number(raw)
                );

        } else {

            query =
                query.eq(
                    "id",
                    raw
                );
        }


        const {
            data:listing
        } =
            await query.maybeSingle();


        if (!listing) {

            return res
                .status(404)
                .json({
                    ok:false,
                    error:"listing_not_found"
                });
        }


        const [
            changeResult,
            priceResult,
            riskResult
        ] =
            await Promise.all([
                supabase
                    .from("listing_change_history")
                    .select("id,actor_type,actor_telegram_id,change_type,old_value,new_value,created_at")
                    .eq("listing_id",listing.id)
                    .order("created_at",{ascending:false})
                    .limit(100),
                supabase
                    .from("listing_price_history")
                    .select("old_price,new_price,changed_at")
                    .eq("listing_id",listing.id)
                    .order("changed_at",{ascending:false})
                    .limit(50),
                supabase
                    .from("listing_risk_flags")
                    .select("id,flag_type,severity,status,details,created_at,resolved_at,resolved_by,resolution_note")
                    .eq("listing_id",listing.id)
                    .order("created_at",{ascending:false})
                    .limit(100)
            ]);


        return res.json({
            ok:true,
            listing,
            changes:
                changeResult.data || [],
            price_history:
                priceResult.data || [],
            risk_flags:
                riskResult.data || []
        });
    }
);


/* =========================================================
   V38 ADMIN ACTIVITY LOG
   ========================================================= */

app.post(
    "/admin/activity-log",
    async (req, res) => {

        const admin =
            await requireAdmin(
                req.body.initData
            );


        if (!admin.ok) {

            return res
                .status(admin.status)
                .json({
                    ok:false,
                    error:admin.error
                });
        }


        const {
            data,
            error
        } =
            await supabase
                .from(
                    "admin_activity_log"
                )
                .select(
                    "id,admin_telegram_id,action,target_type,target_id,details,created_at"
                )
                .order(
                    "created_at",
                    {
                        ascending:false
                    }
                )
                .limit(100);


        if (error) {

            return res
                .status(500)
                .json({
                    ok:false,
                    error:"admin_activity_load_failed"
                });
        }


        return res.json({
            ok:true,
            activities:data || []
        });
    }
);


/* =========================================================
   TELEGRAM WEBHOOK
   ========================================================= */

app.post(
    "/telegram-webhook",
    async (req, res) => {

        const secret =
            req.get(
                "X-Telegram-Bot-Api-Secret-Token"
            );


        if (
            !TELEGRAM_WEBHOOK_SECRET ||
            secret !==
            TELEGRAM_WEBHOOK_SECRET
        ) {

            return res
                .sendStatus(403);
        }


        const update =
            req.body;


        res.sendStatus(200);


        try {

            /* =================================================
               PRE CHECKOUT
               ================================================= */

            if (
                update.pre_checkout_query
            ) {

                const query =
                    update.pre_checkout_query;


                const payload =
                    String(
                        query.invoice_payload ||
                        ""
                    );


                /* PAID LISTING */

                if (
                    payload.startsWith(
                        "listing:"
                    )
                ) {

                    const {
                        data:
                            order
                    } =
                        await supabase
                            .from(
                                "listing_payment_orders"
                            )
                            .select("*")
                            .eq(
                                "invoice_payload",
                                payload
                            )
                            .maybeSingle();


                    let valid =
                        Boolean(
                            order
                        );


                    if (
                        valid &&
                        order.status !==
                        "created"
                    ) {

                        valid =
                            false;
                    }


                    if (
                        valid &&
                        Number(
                            query.from.id
                        ) !==
                        Number(
                            order.seller_telegram_id
                        )
                    ) {

                        valid =
                            false;
                    }


                    if (
                        valid &&
                        (
                            query.currency !==
                            "XTR" ||
                            Number(
                                query.total_amount
                            ) !==
                            Number(
                                order.amount_stars
                            )
                        )
                    ) {

                        valid =
                            false;
                    }


                    if (valid) {

                        const {
                            data:
                                duplicate
                        } =
                            await supabase
                                .from("listings")
                                .select("id")
                                .eq(
                                    "seller_telegram_id",
                                    order.seller_telegram_id
                                )
                                .ilike(
                                    "whatsapp_username",
                                    order.whatsapp_username
                                )
                                .in(
                                    "status",
                                    [
                                        "pending",
                                        "active",
                                        "reserved"
                                    ]
                                )
                                .limit(1);


                        if (
                            duplicate?.length
                        ) {

                            valid =
                                false;
                        }
                    }


                    await telegramApi(

                        "answerPreCheckoutQuery",

                        valid

                            ? {
                                pre_checkout_query_id:
                                    query.id,

                                ok:
                                    true
                            }

                            : {
                                pre_checkout_query_id:
                                    query.id,

                                ok:
                                    false,

                                error_message:
                                    "This listing payment is no longer valid."
                            }
                    );


                    return;
                }


                /* RENEWAL */

                if (
                    payload.startsWith(
                        "renewal:"
                    )
                ) {

                    const {
                        data:
                            order
                    } =
                        await supabase
                            .from(
                                "listing_renewal_orders"
                            )
                            .select("*")
                            .eq(
                                "invoice_payload",
                                payload
                            )
                            .maybeSingle();


                    let valid =
                        Boolean(
                            order
                        );


                    if (
                        valid &&
                        order.status !==
                        "created"
                    ) {

                        valid =
                            false;
                    }


                    if (
                        valid &&
                        Number(
                            query.from.id
                        ) !==
                        Number(
                            order.seller_telegram_id
                        )
                    ) {

                        valid =
                            false;
                    }


                    if (
                        valid &&
                        (
                            query.currency !==
                            "XTR" ||
                            Number(
                                query.total_amount
                            ) !==
                            Number(
                                order.amount_stars
                            )
                        )
                    ) {

                        valid =
                            false;
                    }


                    if (valid) {

                        const {
                            data:
                                listing
                        } =
                            await supabase
                                .from("listings")
                                .select(
                                    "id,seller_telegram_id,status,is_frozen,listing_plan,listing_expires_at"
                                )
                                .eq(
                                    "id",
                                    order.listing_id
                                )
                                .maybeSingle();


                        if (
                            !listing ||
                            Number(
                                listing.seller_telegram_id
                            ) !==
                            Number(
                                order.seller_telegram_id
                            ) ||
                            listing.status !==
                            "active" ||
                            listing.is_frozen ||
                            ![
                                "free",
                                "paid"
                            ].includes(
                                listing.listing_plan
                            ) ||
                            !isListingExpired(
                                listing
                            )
                        ) {

                            valid =
                                false;
                        }
                    }


                    await telegramApi(

                        "answerPreCheckoutQuery",

                        valid

                            ? {
                                pre_checkout_query_id:
                                    query.id,

                                ok:
                                    true
                            }

                            : {
                                pre_checkout_query_id:
                                    query.id,

                                ok:
                                    false,

                                error_message:
                                    "This renewal is no longer available."
                            }
                    );


                    return;
                }


                /* CONTACT */

                if (
                    payload.startsWith(
                        "contact:"
                    )
                ) {

                    const {
                        data:
                            order
                    } =
                        await supabase
                            .from(
                                "contact_unlocks"
                            )
                            .select("*")
                            .eq(
                                "invoice_payload",
                                payload
                            )
                            .maybeSingle();


                    let valid =
                        Boolean(order);


                    if (
                        valid &&
                        order.status !==
                        "pending"
                    ) {

                        valid =
                            false;
                    }


                    if (
                        valid &&
                        Number(
                            query.from.id
                        ) !==
                        Number(
                            order.buyer_telegram_id
                        )
                    ) {

                        valid =
                            false;
                    }


                    if (
                        valid &&
                        (
                            query.currency !==
                            "XTR" ||
                            Number(
                                query.total_amount
                            ) !==
                            Number(
                                order.amount_stars
                            )
                        )
                    ) {

                        valid =
                            false;
                    }


                    await telegramApi(

                        "answerPreCheckoutQuery",

                        valid

                            ? {
                                pre_checkout_query_id:
                                    query.id,
                                ok: true
                            }

                            : {
                                pre_checkout_query_id:
                                    query.id,
                                ok: false,

                                error_message:
                                    "This contact unlock is no longer available."
                            }
                    );


                    return;
                }


                /* WANTED */

                if (
                    payload.startsWith(
                        "wanted:"
                    )
                ) {

                    const {
                        data:
                            order
                    } =
                        await supabase
                            .from(
                                "wanted_payment_orders"
                            )
                            .select("*")
                            .eq(
                                "invoice_payload",
                                payload
                            )
                            .maybeSingle();


                    let valid =
                        Boolean(order);


                    if (
                        valid &&
                        order.status !==
                        "created"
                    ) {

                        valid =
                            false;
                    }


                    if (
                        valid &&
                        Number(
                            query.from.id
                        ) !==
                        Number(
                            order.buyer_telegram_id
                        )
                    ) {

                        valid =
                            false;
                    }


                    if (
                        valid &&
                        (
                            query.currency !==
                            "XTR" ||
                            Number(
                                query.total_amount
                            ) !==
                            Number(
                                order.amount_stars
                            )
                        )
                    ) {

                        valid =
                            false;
                    }


                    await telegramApi(

                        "answerPreCheckoutQuery",

                        valid

                            ? {
                                pre_checkout_query_id:
                                    query.id,

                                ok:
                                    true
                            }

                            : {
                                pre_checkout_query_id:
                                    query.id,

                                ok:
                                    false,

                                error_message:
                                    "This Wanted payment is no longer valid."
                            }
                    );


                    return;
                }


                /* PROMOTION */

                if (
                    payload.startsWith(
                        "promotion:"
                    )
                ) {

                    const {
                        data:
                            order
                    } =
                        await supabase
                            .from(
                                "promotion_payment_orders"
                            )
                            .select("*")
                            .eq(
                                "invoice_payload",
                                payload
                            )
                            .maybeSingle();


                    let valid =
                        Boolean(order);


                    if (
                        valid &&
                        order.status !==
                        "created"
                    ) {

                        valid =
                            false;
                    }


                    if (
                        valid &&
                        Number(
                            query.from.id
                        ) !==
                        Number(
                            order.seller_telegram_id
                        )
                    ) {

                        valid =
                            false;
                    }


                    if (
                        valid &&
                        (
                            query.currency !==
                            "XTR" ||
                            Number(
                                query.total_amount
                            ) !==
                            Number(
                                order.amount_stars
                            )
                        )
                    ) {

                        valid =
                            false;
                    }


                    if (valid) {

                        const {
                            data:
                                listing
                        } =
                            await supabase
                                .from("listings")
                                .select(
                                    "id,seller_telegram_id,status,is_paused,is_frozen,listing_plan,listing_expires_at,bump_until,hot_until,vip_until"
                                )
                                .eq(
                                    "id",
                                    order.listing_id
                                )
                                .maybeSingle();


                        if (!listing) {

                            valid =
                                false;

                        } else {

                            const eligibility =
                                calculatePromotionUntil(
                                    listing,
                                    order.promotion_type,
                                    Number(
                                        order.duration_hours
                                    )
                                );


                            if (
                                !eligibility.ok
                            ) {

                                valid =
                                    false;
                            }
                        }
                    }


                    await telegramApi(

                        "answerPreCheckoutQuery",

                        valid

                            ? {
                                pre_checkout_query_id:
                                    query.id,

                                ok:
                                    true
                            }

                            : {
                                pre_checkout_query_id:
                                    query.id,

                                ok:
                                    false,

                                error_message:
                                    "This promotion is no longer available."
                            }
                    );


                    return;
                }


                await telegramApi(
                    "answerPreCheckoutQuery",
                    {
                        pre_checkout_query_id:
                            query.id,

                        ok:
                            false,

                        error_message:
                            "Unknown payment."
                    }
                );


                return;
            }


            /* =================================================
               SUCCESSFUL PAYMENT
               ================================================= */

            const message =
                update.message;


            const payment =
                message
                    ?.successful_payment;


            if (!payment) {

                return;
            }


            const payload =
                String(
                    payment.invoice_payload ||
                    ""
                );


            const payerId =
                Number(
                    message.from?.id
                );


            const chargeId =
                payment
                    .telegram_payment_charge_id;


            /* -------------------------------------------------
               NEW PAID LISTING
               ------------------------------------------------- */

            if (
                payload.startsWith(
                    "listing:"
                )
            ) {

                const {
                    data:
                        order
                } =
                    await supabase
                        .from(
                            "listing_payment_orders"
                        )
                        .select("*")
                        .eq(
                            "invoice_payload",
                            payload
                        )
                        .maybeSingle();


                if (
                    !order ||
                    [
                        "completed",
                        "refunded"
                    ].includes(
                        order.status
                    )
                ) {

                    return;
                }


                const valid =
                    payerId ===
                    Number(
                        order.seller_telegram_id
                    )
                    &&
                    payment.currency ===
                    "XTR"
                    &&
                    Number(
                        payment.total_amount
                    ) ===
                    Number(
                        order.amount_stars
                    );


                if (!valid) {

                    return;
                }


                await supabase
                    .from(
                        "listing_payment_orders"
                    )
                    .update(
                        {
                            status:
                                "paid",

                            telegram_payment_charge_id:
                                chargeId,

                            paid_at:
                                nowIso()
                        }
                    )
                    .eq(
                        "id",
                        order.id
                    );


                try {

                    const {
                        data:
                            alreadyCreated
                    } =
                        await supabase
                            .from("listings")
                            .select("id")
                            .eq(
                                "id",
                                order.id
                            )
                            .maybeSingle();


                    if (
                        !alreadyCreated
                    ) {

                        const {
                            error
                        } =
                            await supabase
                                .from("listings")
                                .insert(
                                    {
                                        id:
                                            order.id,

                                        seller_telegram_id:
                                            order.seller_telegram_id,

                                        whatsapp_username:
                                            order.whatsapp_username,

                                        asking_price:
                                            order.asking_price,

                                        price_type:
                                            order.price_type ||
                                            "negotiable",

                                        minimum_offer:
                                            order.minimum_offer ??
                                            null,

                                        currency:
                                            "USD",

                                        category:
                                            normalizeCategory(
                                                order.category
                                            ),

                                        description:
                                            order.description,

                                        status:
                                            "pending",

                                        verification_status:
                                            "unverified",

                                        is_premium_name:
                                            false,

                                        is_featured:
                                            false,

                                        is_paused:
                                            false,

                                        is_frozen:
                                            false,

                                        listing_plan:
                                            "paid",

                                        listing_period_started_at:
                                            null,

                                        listing_expires_at:
                                            null,

                                        renewal_count:
                                            0
                                    }
                                );


                        if (error) {

                            throw error;
                        }
                    }


                    await ensureSellerProfile(
                        order.seller_telegram_id
                    );


                    const {
                        error:
                            contactError
                    } =
                        await supabase
                            .from(
                                "listing_contacts"
                            )
                            .upsert(
                                {
                                    listing_id:
                                        order.id,

                                    contact_type:
                                        order.contact_type,

                                    contact_value:
                                        order.contact_value
                                },
                                {
                                    onConflict:
                                        "listing_id"
                                }
                            );


                    if (
                        contactError
                    ) {

                        throw contactError;
                    }


                    await supabase
                        .from(
                            "listing_payment_orders"
                        )
                        .update(
                            {
                                status:
                                    "completed",

                                listing_id:
                                    order.id,

                                completed_at:
                                    nowIso()
                            }
                        )
                        .eq(
                            "id",
                            order.id
                        );


                    await safeSendMessage(

                        order.seller_telegram_id,

                        `✅ Payment received. @${order.whatsapp_username} was submitted for moderation.\n\nYour ${PAID_LISTING_DURATION_DAYS}-day listing timer will start after approval.`
                    );


                    /*
                     * NEW:
                     * notify admin after successful paid listing.
                     */

                    await notifyAdminsNewListing(
                        {
                            whatsapp_username:
                                order.whatsapp_username,

                            asking_price:
                                order.asking_price,

                            category:
                                normalizeCategory(
                                    order.category
                                ),

                            listing_plan:
                                "paid"
                        }
                    );



                    const {
                        data:createdPaidListing
                    } =
                        await supabase
                            .from("listings")
                            .select(
                                "id,seller_telegram_id,listing_number,whatsapp_username,status"
                            )
                            .eq(
                                "id",
                                order.id
                            )
                            .maybeSingle();


                    if (createdPaidListing) {
                        await detectDuplicateUsernameRisk(
                            createdPaidListing
                        );
                    }

                } catch (error) {

                    console.error(
                        "Listing fulfillment failed:",
                        error
                    );


                    await logSystemError(
                        "listing_fulfillment",
                        error,
                        {
                            order_id:
                                order?.id ||
                                null
                        }
                    );


                    await supabase
                        .from(
                            "listing_contacts"
                        )
                        .delete()
                        .eq(
                            "listing_id",
                            order.id
                        );


                    await supabase
                        .from("listings")
                        .delete()
                        .eq(
                            "id",
                            order.id
                        );


                    try {

                        await refundStars(
                            payerId,
                            chargeId
                        );


                        await supabase
                            .from(
                                "listing_payment_orders"
                            )
                            .update(
                                {
                                    status:
                                        "refunded"
                                }
                            )
                            .eq(
                                "id",
                                order.id
                            );

                    } catch (
                        refundError
                    ) {

                        console.error(
                            "Listing refund failed:",
                            refundError.message
                        );
                    }
                }


                return;
            }


            /* -------------------------------------------------
               RENEWAL SUCCESS
               ------------------------------------------------- */

            if (
                payload.startsWith(
                    "renewal:"
                )
            ) {

                const {
                    data:
                        order
                } =
                    await supabase
                        .from(
                            "listing_renewal_orders"
                        )
                        .select("*")
                        .eq(
                            "invoice_payload",
                            payload
                        )
                        .maybeSingle();


                if (
                    !order ||
                    [
                        "completed",
                        "refunded"
                    ].includes(
                        order.status
                    )
                ) {

                    return;
                }


                const valid =
                    payerId ===
                    Number(
                        order.seller_telegram_id
                    )
                    &&
                    payment.currency ===
                    "XTR"
                    &&
                    Number(
                        payment.total_amount
                    ) ===
                    Number(
                        order.amount_stars
                    );


                if (!valid) {

                    return;
                }


                await supabase
                    .from(
                        "listing_renewal_orders"
                    )
                    .update(
                        {
                            status:
                                "paid",

                            telegram_payment_charge_id:
                                chargeId,

                            paid_at:
                                nowIso()
                        }
                    )
                    .eq(
                        "id",
                        order.id
                    );


                try {

                    const {
                        data:
                            listing
                    } =
                        await supabase
                            .from("listings")
                            .select(
                                "id,seller_telegram_id,listing_number,whatsapp_username,status,is_frozen,listing_plan,listing_expires_at,renewal_count"
                            )
                            .eq(
                                "id",
                                order.listing_id
                            )
                            .maybeSingle();


                    if (
                        !listing ||
                        Number(
                            listing.seller_telegram_id
                        ) !==
                        Number(
                            order.seller_telegram_id
                        ) ||
                        listing.status !==
                        "active" ||
                        listing.is_frozen ||
                        ![
                            "free",
                            "paid"
                        ].includes(
                            listing.listing_plan
                        ) ||
                        !isListingExpired(
                            listing
                        )
                    ) {

                        throw new Error(
                            "listing_not_renewable"
                        );
                    }


                    const startedAt =
                        nowIso();


                    const expiresAt =
                        addDaysIso(
                            startedAt,
                            PAID_LISTING_DURATION_DAYS
                        );


                    const {
                        error:
                            updateError
                    } =
                        await supabase
                            .from("listings")
                            .update(
                                {
                                    listing_plan:
                                        "paid",

                                    listing_period_started_at:
                                        startedAt,

                                    listing_expires_at:
                                        expiresAt,

                                    last_renewed_at:
                                        startedAt,

                                    renewal_count:
                                        Number(
                                            listing.renewal_count ||
                                            0
                                        ) + 1,

                                    is_paused:
                                        false,

                                    listing_expiry_1h_notified_at:
                                        null,

                                    listing_expired_notified_at:
                                        null,

                                    updated_at:
                                        nowIso()
                                }
                            )
                            .eq(
                                "id",
                                listing.id
                            );


                    if (
                        updateError
                    ) {

                        throw updateError;
                    }


                    await supabase
                        .from(
                            "listing_renewal_orders"
                        )
                        .update(
                            {
                                status:
                                    "completed",

                                completed_at:
                                    nowIso()
                            }
                        )
                        .eq(
                            "id",
                            order.id
                        );


                    await safeSendMessage(

                        listing.seller_telegram_id,

                        `✅ @${listing.whatsapp_username} was renewed successfully.\n\nYour listing is active for another ${PAID_LISTING_DURATION_DAYS} days.`
                    );

                } catch (error) {

                    console.error(
                        "Renewal fulfillment failed:",
                        error
                    );


                    try {

                        await refundStars(
                            payerId,
                            chargeId
                        );


                        await supabase
                            .from(
                                "listing_renewal_orders"
                            )
                            .update(
                                {
                                    status:
                                        "refunded"
                                }
                            )
                            .eq(
                                "id",
                                order.id
                            );

                    } catch (
                        refundError
                    ) {

                        console.error(
                            "Renewal refund failed:",
                            refundError.message
                        );
                    }
                }


                return;
            }


            /* -------------------------------------------------
               CONTACT SUCCESS
               ------------------------------------------------- */

            if (
                payload.startsWith(
                    "contact:"
                )
            ) {

                const {
                    data:
                        order
                } =
                    await supabase
                        .from(
                            "contact_unlocks"
                        )
                        .select("*")
                        .eq(
                            "invoice_payload",
                            payload
                        )
                        .maybeSingle();


                if (!order) {

                    return;
                }


                await supabase
                    .from(
                        "contact_unlocks"
                    )
                    .update(
                        {
                            status:
                                "paid",

                            telegram_payment_charge_id:
                                chargeId,

                            paid_at:
                                nowIso()
                        }
                    )
                    .eq(
                        "id",
                        order.id
                    );


                return;
            }


            /* -------------------------------------------------
               WANTED SUCCESS
               ------------------------------------------------- */

            if (
                payload.startsWith(
                    "wanted:"
                )
            ) {

                const {
                    data:
                        order
                } =
                    await supabase
                        .from(
                            "wanted_payment_orders"
                        )
                        .select("*")
                        .eq(
                            "invoice_payload",
                            payload
                        )
                        .maybeSingle();


                if (
                    !order ||
                    [
                        "completed",
                        "refunded"
                    ].includes(
                        order.status
                    )
                ) {

                    return;
                }


                const wantedId =
                    order.id;


                await supabase
                    .from(
                        "wanted_requests"
                    )
                    .insert(
                        {
                            id:
                                wantedId,

                            buyer_telegram_id:
                                order.buyer_telegram_id,

                            desired_username:
                                order.desired_username,

                            budget:
                                order.budget,

                            currency:
                                "USD",

                            category:
                                normalizeCategory(
                                    order.category
                                ),

                            description:
                                order.description,

                            status:
                                "active"
                        }
                    );


                await supabase
                    .from(
                        "wanted_payment_orders"
                    )
                    .update(
                        {
                            status:
                                "completed",

                            wanted_post_id:
                                wantedId,

                            telegram_payment_charge_id:
                                chargeId,

                            paid_at:
                                nowIso(),

                            completed_at:
                                nowIso()
                        }
                    )
                    .eq(
                        "id",
                        order.id
                    );


                await safeSendMessage(

                    order.buyer_telegram_id,

                    `✅ Wanted request for @${order.desired_username} is now live.`
                );


                return;
            }


            /* -------------------------------------------------
               PROMOTION SUCCESS
               ------------------------------------------------- */

            if (
                payload.startsWith(
                    "promotion:"
                )
            ) {

                const {
                    data:
                        order
                } =
                    await supabase
                        .from(
                            "promotion_payment_orders"
                        )
                        .select("*")
                        .eq(
                            "invoice_payload",
                            payload
                        )
                        .maybeSingle();


                if (
                    !order ||
                    [
                        "completed",
                        "refunded"
                    ].includes(
                        order.status
                    )
                ) {

                    return;
                }


                const {
                    data:
                        listing
                } =
                    await supabase
                        .from("listings")
                        .select(
                            "id,seller_telegram_id,listing_number,whatsapp_username,status,is_paused,is_frozen,listing_plan,listing_expires_at,bump_until,hot_until,vip_until"
                        )
                        .eq(
                            "id",
                            order.listing_id
                        )
                        .maybeSingle();


                if (!listing) {

                    return;
                }


                const eligibility =
                    calculatePromotionUntil(
                        listing,
                        order.promotion_type,
                        Number(
                            order.duration_hours
                        )
                    );


                if (
                    !eligibility.ok
                ) {

                    return;
                }


                const type =
                    order.promotion_type;


                const untilField =
                    `${type}_until`;


                const promotedAtField =
                    `${type}_promoted_at`;


                const hourField =
                    `${type}_expiry_1h_notified_at`;


                const expiredField =
                    `${type}_expired_notified_at`;


                const appliedUntil =
                    eligibility.applied_until;


                await supabase
                    .from("listings")
                    .update(
                        {
                            [untilField]:
                                appliedUntil,

                            [promotedAtField]:
                                nowIso(),

                            [hourField]:
                                null,

                            [expiredField]:
                                null,

                            updated_at:
                                nowIso()
                        }
                    )
                    .eq(
                        "id",
                        order.listing_id
                    );


                await supabase
                    .from(
                        "promotion_payment_orders"
                    )
                    .update(
                        {
                            status:
                                "completed",

                            telegram_payment_charge_id:
                                chargeId,

                            paid_at:
                                nowIso(),

                            applied_until:
                                appliedUntil,

                            completed_at:
                                nowIso()
                        }
                    )
                    .eq(
                        "id",
                        order.id
                    );


                const label =
                    type ===
                    "vip"
                        ? "💎 VIP"
                        : type ===
                        "hot"
                            ? "🔥 HOT"
                            : "⬆️ Bump";


                await safeSendMessage(

                    order.seller_telegram_id,

                    `${label} promotion activated for @${listing.whatsapp_username}.\n\nActive until: ${new Date(appliedUntil).toUTCString()}`
                );


                return;
            }

        } catch (error) {

            console.error(
                "Webhook processing error:",
                error
            );

            await logSystemError(
                "telegram_webhook",
                error
            );
        }
    }
);



/* =========================================================
   V45 — LAUNCH READINESS & PERFORMANCE
   - Server-side marketplace pagination / filtering / sorting.
   - Short-lived response cache to absorb duplicate refreshes.
   - Persistent Maintenance Mode controlled by Owner.
   - Public system status + Owner launch diagnostics.
   ========================================================= */

const V45_MARKETPLACE_PAGE_SIZE =
    24;

const V45_MARKETPLACE_MAX_PAGE_SIZE =
    48;

const V45_MARKETPLACE_CACHE_MS =
    8 * 1000;

const v45MarketplaceCache =
    new Map();

let v45MaintenanceCache = {
    expires_at:0,
    value:{
        enabled:false,
        message:
            "Handle Market is temporarily undergoing maintenance. Please try again shortly.",
        updated_at:null
    }
};


function v45SafeMaintenanceMessage(
    value
) {

    const text =
        String(
            value ||
            ""
        )
            .trim()
            .slice(
                0,
                240
            );


    return text ||
        "Handle Market is temporarily undergoing maintenance. Please try again shortly.";
}


async function v45GetMaintenanceState(
    force = false
) {

    if (
        !force &&
        Date.now() <
        Number(
            v45MaintenanceCache.expires_at ||
            0
        )
    ) {
        return v45MaintenanceCache.value;
    }


    try {

        const {
            data,
            error
        } =
            await supabase
                .from(
                    "platform_settings"
                )
                .select(
                    "value,updated_at"
                )
                .eq(
                    "key",
                    "maintenance_mode"
                )
                .maybeSingle();


        if (error) {
            throw error;
        }


        const raw =
            data?.value &&
            typeof data.value ===
            "object"
                ? data.value
                : {};


        v45MaintenanceCache = {
            expires_at:
                Date.now() +
                10 * 1000,
            value:{
                enabled:
                    Boolean(
                        raw.enabled
                    ),
                message:
                    v45SafeMaintenanceMessage(
                        raw.message
                    ),
                updated_at:
                    data?.updated_at ||
                    null
            }
        };


        return v45MaintenanceCache.value;

    } catch (error) {

        await logSystemError(
            "v45_maintenance_state",
            error
        );


        v45MaintenanceCache.expires_at =
            Date.now() +
            5 * 1000;


        return v45MaintenanceCache.value;
    }
}


function v45MarketplaceParams(
    req
) {

    const page =
        Math.max(
            1,
            Math.min(
                100000,
                Math.trunc(
                    Number(
                        req.query.page ||
                        1
                    )
                ) ||
                1
            )
        );


    const limit =
        Math.max(
            1,
            Math.min(
                V45_MARKETPLACE_MAX_PAGE_SIZE,
                Math.trunc(
                    Number(
                        req.query.limit ||
                        V45_MARKETPLACE_PAGE_SIZE
                    )
                ) ||
                V45_MARKETPLACE_PAGE_SIZE
            )
        );


    const rawSearch =
        String(
            req.query.search ||
            ""
        )
            .trim()
            .slice(
                0,
                80
            );


    const lotText =
        rawSearch
            .replace(
                /^lot\s*#?\s*/i,
                ""
            )
            .replace(
                /\s+/g,
                ""
            );


    let lotNumber =
        null;


    if (
        /^\d+$/.test(
            lotText
        )
    ) {

        const parsed =
            Number(
                lotText.replace(
                    /^0+(?=\d)/,
                    ""
                ) ||
                "0"
            );


        if (
            Number.isSafeInteger(
                parsed
            ) &&
            parsed > 0
        ) {
            lotNumber =
                parsed;
        }
    }


    const explicitLotSearch =
        /^lot\s*#?\s*\d+\s*$/i.test(
            rawSearch
        );


    const search =
        explicitLotSearch
            ? ""
            : rawSearch
                .replace(
                    /^@/,
                    ""
                )
                .replace(
                    /%/g,
                    ""
                )
                .trim();


    const category =
        String(
            req.query.category ||
            "all"
        )
            .trim()
            .slice(
                0,
                80
            ) ||
        "all";


    const promotionCandidate =
        String(
            req.query.promotion ||
            "all"
        ).toLowerCase();


    const promotion =
        [
            "all",
            "vip",
            "hot",
            "bump",
            "regular"
        ].includes(
            promotionCandidate
        )
            ? promotionCandidate
            : "all";


    const sortCandidate =
        String(
            req.query.sort ||
            "recommended"
        ).toLowerCase();


    const sort =
        [
            "recommended",
            "newest",
            "price_low",
            "price_high",
            "az",
            "za"
        ].includes(
            sortCandidate
        )
            ? sortCandidate
            : "recommended";


    const minCandidate =
        req.query.min_price ===
        undefined ||
        req.query.min_price ===
        ""
            ? null
            : Number(
                req.query.min_price
            );


    const maxCandidate =
        req.query.max_price ===
        undefined ||
        req.query.max_price ===
        ""
            ? null
            : Number(
                req.query.max_price
            );


    const minPrice =
        Number.isFinite(
            minCandidate
        ) &&
        minCandidate >= 0
            ? minCandidate
            : null;


    const maxPrice =
        Number.isFinite(
            maxCandidate
        ) &&
        maxCandidate >= 0
            ? maxCandidate
            : null;


    return {
        page,
        limit,
        offset:
            (page - 1) *
            limit,
        search,
        lot_number:
            lotNumber,
        category,
        promotion,
        premium_only:
            String(
                req.query.premium_only ||
                ""
            ) ===
            "1" ||
            String(
                req.query.premium_only ||
                ""
            ).toLowerCase() ===
            "true",
        min_price:
            minPrice,
        max_price:
            maxPrice,
        sort
    };
}


function v45MarketplaceCacheKey(
    params
) {
    return JSON.stringify(
        params
    );
}


function v45PruneMarketplaceCache() {

    const now =
        Date.now();


    for (
        const [
            key,
            entry
        ] of
        v45MarketplaceCache
    ) {

        if (
            Number(
                entry.expires_at ||
                0
            ) <=
            now
        ) {
            v45MarketplaceCache.delete(
                key
            );
        }
    }


    while (
        v45MarketplaceCache.size >
        80
    ) {

        const oldestKey =
            v45MarketplaceCache
                .keys()
                .next()
                .value;


        if (!oldestKey) {
            break;
        }


        v45MarketplaceCache.delete(
            oldestKey
        );
    }
}


async function v45LoadMarketplacePage(
    params
) {

    v45PruneMarketplaceCache();


    const key =
        v45MarketplaceCacheKey(
            params
        );


    const cached =
        v45MarketplaceCache.get(
            key
        );


    if (
        cached &&
        Date.now() <
        cached.expires_at
    ) {
        return await cached.promise;
    }


    const promise =
        (async () => {

            const {
                data,
                error
            } =
                await supabase.rpc(
                    "get_marketplace_page_v45",
                    {
                        p_search:
                            params.search ||
                            null,
                        p_lot_number:
                            params.lot_number,
                        p_category:
                            params.category ===
                            "all"
                                ? null
                                : params.category,
                        p_promotion:
                            params.promotion ===
                            "all"
                                ? null
                                : params.promotion,
                        p_premium_only:
                            Boolean(
                                params.premium_only
                            ),
                        p_min_price:
                            params.min_price,
                        p_max_price:
                            params.max_price,
                        p_sort:
                            params.sort,
                        p_limit:
                            params.limit,
                        p_offset:
                            params.offset
                    }
                );


            if (error) {
                throw error;
            }


            const rows =
                data ||
                [];


            const items =
                rows
                    .map(
                        row =>
                            row?.item ||
                            null
                    )
                    .filter(Boolean);


            const total =
                rows.length
                    ? Math.max(
                        0,
                        Number(
                            rows[0]
                                .total_count ||
                            0
                        )
                    )
                    : 0;


            const listings =
                await attachPublicSellerProfiles(
                    items
                );


            return {
                listings,
                total
            };
        })();


    v45MarketplaceCache.set(
        key,
        {
            expires_at:
                Date.now() +
                V45_MARKETPLACE_CACHE_MS,
            promise
        }
    );


    try {
        return await promise;
    } catch (error) {
        v45MarketplaceCache.delete(
            key
        );
        throw error;
    }
}


app.get(
    "/marketplace/listings",
    async (req, res) => {

        const startedAt =
            Date.now();


        try {

            const maintenance =
                await v45GetMaintenanceState();


            if (
                maintenance.enabled
            ) {

                res.set(
                    "Retry-After",
                    "60"
                );


                return res
                    .status(503)
                    .json({
                        ok:false,
                        error:"maintenance_mode",
                        message:
                            maintenance.message,
                        retry_after_seconds:60,
                        server_time:
                            nowIso()
                    });
            }


            const params =
                v45MarketplaceParams(
                    req
                );


            const result =
                await v45LoadMarketplacePage(
                    params
                );


            const shown =
                params.offset +
                result.listings.length;


            res.set(
                "Cache-Control",
                "public, max-age=5, stale-while-revalidate=10"
            );


            return res.json({
                ok:true,
                version:
                    "v47-production-pricing",
                server_time:
                    nowIso(),
                page:
                    params.page,
                page_size:
                    params.limit,
                total:
                    result.total,
                has_more:
                    shown <
                    result.total,
                response_ms:
                    Date.now() -
                    startedAt,
                listings:
                    result.listings
            });

        } catch (error) {

            await logSystemError(
                "v45_marketplace_page",
                error,
                {
                    query:
                        String(
                            req.originalUrl ||
                            ""
                        )
                            .split("?")[0]
                }
            );


            return res
                .status(500)
                .json({
                    ok:false,
                    error:"marketplace_load_failed"
                });
        }
    }
);


app.get(
    "/system-status",
    async (req, res) => {

        const maintenance =
            await v45GetMaintenanceState();


        res.set(
            "Cache-Control",
            "no-store"
        );


        return res.json({
            ok:true,
            version:
                "v47-production-pricing",
            service:
                "Handle Market API",
            maintenance:
                maintenance.enabled,
            maintenance_message:
                maintenance.enabled
                    ? maintenance.message
                    : null,
            uptime_seconds:
                Math.floor(
                    process.uptime()
                ),
            server_time:
                nowIso()
        });
    }
);


app.post(
    "/admin/launch-status",
    async (req, res) => {

        const startedAt =
            Date.now();


        const maintenance =
            await v45GetMaintenanceState(
                true
            );


        const marketplaceStarted =
            Date.now();


        const {
            data:
                marketplaceRows,
            error:
                marketplaceError
        } =
            await supabase.rpc(
                "get_marketplace_page_v45",
                {
                    p_search:null,
                    p_lot_number:null,
                    p_category:null,
                    p_promotion:null,
                    p_premium_only:false,
                    p_min_price:null,
                    p_max_price:null,
                    p_sort:"recommended",
                    p_limit:1,
                    p_offset:0
                }
            );


        const marketplaceLatency =
            Date.now() -
            marketplaceStarted;


        if (marketplaceError) {
            await logSystemError(
                "v45_launch_status_marketplace",
                marketplaceError
            );
        }


        const activeCount =
            marketplaceRows?.length
                ? Number(
                    marketplaceRows[0]
                        .total_count ||
                    0
                )
                : 0;


        const memory =
            process.memoryUsage();


        return res.json({
            ok:true,
            version:
                "v47-production-pricing",
            maintenance,
            marketplace:{
                ok:
                    !marketplaceError,
                active_listings:
                    activeCount,
                latency_ms:
                    marketplaceLatency,
                page_size:
                    V45_MARKETPLACE_PAGE_SIZE
            },
            process:{
                uptime_seconds:
                    Math.floor(
                        process.uptime()
                    ),
                rss_mb:
                    Math.round(
                        memory.rss /
                        1024 /
                        1024
                    ),
                heap_used_mb:
                    Math.round(
                        memory.heapUsed /
                        1024 /
                        1024
                    )
            },
            response_ms:
                Date.now() -
                startedAt
        });
    }
);


app.post(
    "/admin/maintenance-set",
    async (req, res) => {

        const enabled =
            Boolean(
                req.body.enabled
            );


        const message =
            v45SafeMaintenanceMessage(
                req.body.message
            );


        const {
            error
        } =
            await supabase
                .from(
                    "platform_settings"
                )
                .upsert(
                    {
                        key:
                            "maintenance_mode",
                        value:{
                            enabled,
                            message
                        },
                        updated_at:
                            nowIso(),
                        updated_by:
                            Number(
                                req.adminAuth
                                    ?.user
                                    ?.telegram_id ||
                                0
                            ) ||
                            null
                    },
                    {
                        onConflict:
                            "key"
                    }
                );


        if (error) {

            await logSystemError(
                "v45_maintenance_set",
                error
            );


            return res
                .status(500)
                .json({
                    ok:false,
                    error:"maintenance_update_failed"
                });
        }


        v45MaintenanceCache.expires_at =
            0;

        v45MarketplaceCache.clear();


        await logAdminActivity(
            req.adminAuth.user.telegram_id,
            enabled
                ? "maintenance_enabled"
                : "maintenance_disabled",
            "platform",
            "maintenance_mode",
            {
                message
            }
        );


        return res.json({
            ok:true,
            maintenance:
                await v45GetMaintenanceState(
                    true
                )
        });
    }
);


/* =========================================================
   V46 — REFERRAL SYSTEM
   - Cumulative one-time rewards at 3 / 10 / 25 qualified invites.
   - Telegram-authenticated attribution for new Handle Market accounts only.
   - Atomic promotion claims and reserved 7-day listing credits.
   ========================================================= */

const V46_REFERRAL_REWARDS = [
    {
        tier:3,
        reward_type:"bump_24h",
        kind:"promotion",
        title:"⬆️ BUMP · 24 hours"
    },
    {
        tier:10,
        reward_type:"hot_7d",
        kind:"promotion",
        title:"🔥 HOT · 7 days"
    },
    {
        tier:10,
        reward_type:"listing_7d",
        kind:"listing",
        title:"📦 Free listing · 7 days"
    },
    {
        tier:25,
        reward_type:"vip_7d",
        kind:"promotion",
        title:"💎 VIP · 7 days"
    },
    {
        tier:25,
        reward_type:"listing_7d",
        kind:"listing",
        title:"📦 Free listing · 7 days"
    }
];


let v46BotUsernameCache =
    TELEGRAM_BOT_USERNAME ||
    null;


function v46NormalizeReferralCode(
    value
) {

    const code =
        String(
            value ||
            ""
        )
            .trim()
            .replace(
                /^ref[_-]?/i,
                ""
            )
            .toUpperCase();


    return /^[A-Z0-9]{8,20}$/.test(
        code
    )
        ? code
        : "";
}


function v46ReferralCodeFor(
    telegramId
) {

    const secret =
        BOT_TOKEN ||
        SUPABASE_SECRET_KEY ||
        "handle-market-v46";


    return crypto
        .createHmac(
            "sha256",
            secret
        )
        .update(
            `referral:${Number(telegramId)}`
        )
        .digest("hex")
        .slice(0,12)
        .toUpperCase();
}


async function v46EnsureReferralProfile(
    telegramId
) {

    const {
        data:
            existing,
        error:
            existingError
    } =
        await supabase
            .from(
                "referral_profiles"
            )
            .select(
                "telegram_id,referral_code,created_at"
            )
            .eq(
                "telegram_id",
                Number(
                    telegramId
                )
            )
            .maybeSingle();


    if (
        existingError
    ) {

        throw existingError;
    }


    if (
        existing
    ) {

        return existing;
    }

    const code =
        v46ReferralCodeFor(
            telegramId
        );


    const {
        data,
        error
    } =
        await supabase
            .from(
                "referral_profiles"
            )
            .insert(
                {
                    telegram_id:
                        Number(
                            telegramId
                        ),
                    referral_code:
                        code,
                    updated_at:
                        nowIso()
                }
            )
            .select(
                "telegram_id,referral_code,created_at"
            )
            .single();


    if (
        error
    ) {

        const {
            data:
                concurrent,
            error:
                concurrentError
        } =
            await supabase
                .from(
                    "referral_profiles"
                )
                .select(
                    "telegram_id,referral_code,created_at"
                )
                .eq(
                    "telegram_id",
                    Number(
                        telegramId
                    )
                )
                .maybeSingle();


        if (
            concurrentError ||
            !concurrent
        ) {

            throw error;
        }


        return concurrent;
    }


    return data;
}


async function v46GetBotUsername() {

    if (
        v46BotUsernameCache
    ) {

        return v46BotUsernameCache;
    }


    try {

        const me =
            await telegramApi(
                "getMe"
            );


        v46BotUsernameCache =
            String(
                me?.username ||
                ""
            )
                .trim()
                .replace(/^@/, "") ||
            null;

    } catch (error) {

        console.error(
            "Referral bot username:",
            error.message
        );
    }


    return v46BotUsernameCache;
}


async function v46ReferralLink(
    code
) {

    const botUsername =
        await v46GetBotUsername();


    if (
        !botUsername
    ) {

        return "";
    }


    const appPath =
        TELEGRAM_MINI_APP_SHORT_NAME
            ? `/${encodeURIComponent(TELEGRAM_MINI_APP_SHORT_NAME)}`
            : "";


    return `https://t.me/${encodeURIComponent(botUsername)}${appPath}?startapp=ref_${encodeURIComponent(code)}`;
}


async function v46RegisterReferral(
    referredTelegramId,
    code
) {

    const {
        data,
        error
    } =
        await supabase.rpc(
            "hm_register_referral_v46",
            {
                p_referred_telegram_id:
                    Number(
                        referredTelegramId
                    ),
                p_referral_code:
                    code
            }
        );


    if (
        error
    ) {

        throw error;
    }


    if (
        data?.ok &&
        data?.new_referral &&
        data?.referrer_id
    ) {

        const count =
            Number(
                data.qualified_count ||
                0
            );


        let unlocked =
            "";


        if (
            count === 3
        ) {

            unlocked =
                "\n\n🎁 Unlocked: BUMP for 24 hours.";
        }


        if (
            count === 10
        ) {

            unlocked =
                "\n\n🎁 Unlocked: HOT for 7 days + one free 7-day listing.";
        }


        if (
            count === 25
        ) {

            unlocked =
                "\n\n🎁 Unlocked: VIP for 7 days + one free 7-day listing.";
        }


        await safeSendMessage(
            Number(
                data.referrer_id
            ),
            `🎉 New qualified referral!\n\nProgress: ${count} invited.${unlocked}`
        );
    }


    return data;
}


async function v46ReferralStatus(
    telegramId
) {

    const profile =
        await v46EnsureReferralProfile(
            telegramId
        );


    await supabase
        .from(
            "referral_rewards"
        )
        .update({
            status:"available",
            reserved_until:null
        })
        .eq(
            "telegram_id",
            Number(
                telegramId
            )
        )
        .eq(
            "status",
            "reserved"
        )
        .lt(
            "reserved_until",
            nowIso()
        );


    const [
        referralsResult,
        rewardsResult
    ] =
        await Promise.all([
            supabase
                .from("referrals")
                .select(
                    "id",
                    {
                        head:true,
                        count:"exact"
                    }
                )
                .eq(
                    "referrer_telegram_id",
                    Number(
                        telegramId
                    )
                )
                .eq(
                    "status",
                    "qualified"
                ),
            supabase
                .from(
                    "referral_rewards"
                )
                .select(
                    "id,tier,reward_type,status,listing_id,claimed_at,reserved_until"
                )
                .eq(
                    "telegram_id",
                    Number(
                        telegramId
                    )
                )
                .order(
                    "tier",
                    {
                        ascending:true
                    }
                )
        ]);


    if (
        referralsResult.error
    ) {

        throw referralsResult.error;
    }


    if (
        rewardsResult.error
    ) {

        throw rewardsResult.error;
    }


    const qualifiedCount =
        Number(
            referralsResult.count ||
            0
        );


    const rewardRows =
        rewardsResult.data ||
        [];


    const rewardMap =
        new Map(
            rewardRows.map(
                reward => [
                    `${reward.tier}:${reward.reward_type}`,
                    reward
                ]
            )
        );


    const rewards =
        V46_REFERRAL_REWARDS.map(
            definition => {

                const row =
                    rewardMap.get(
                        `${definition.tier}:${definition.reward_type}`
                    );


                return {
                    ...definition,
                    id:
                        row?.id ||
                        null,
                    status:
                        row?.status ||
                        (
                            qualifiedCount >=
                            definition.tier
                                ? "available"
                                : "locked"
                        ),
                    listing_id:
                        row?.listing_id ||
                        null,
                    claimed_at:
                        row?.claimed_at ||
                        null
                };
            }
        );


    const nextThreshold =
        [
            3,
            10,
            25
        ].find(
            threshold =>
                qualifiedCount <
                threshold
        ) ||
        null;


    return {
        code:
            profile.referral_code,
        link:
            await v46ReferralLink(
                profile.referral_code
            ),
        qualified_count:
            qualifiedCount,
        next_threshold:
            nextThreshold,
        rewards,
        available_listing_credits:
            rewards.filter(
                reward =>
                    reward.kind ===
                    "listing" &&
                    reward.status ===
                    "available"
            ).length,
        rules:{
            new_accounts_only:true,
            unique_telegram_account:true,
            self_referrals:false,
            cumulative:true,
            each_reward_once:true
        }
    };
}


app.post(
    "/referrals/status",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (
            !auth.ok
        ) {

            return res
                .status(
                    auth.status
                )
                .json({
                    ok:false,
                    error:
                        auth.error
                });
        }


        try {

            return res.json({
                ok:true,
                referral:
                    await v46ReferralStatus(
                        auth.user.telegram_id
                    )
            });

        } catch (error) {

            await logSystemError(
                "v46_referral_status",
                error,
                {
                    telegram_id:
                        auth.user.telegram_id
                }
            );


            return res
                .status(500)
                .json({
                    ok:false,
                    error:
                        "referral_status_failed"
                });
        }
    }
);


app.post(
    "/referrals/claim-promotion",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (
            !auth.ok
        ) {

            return res
                .status(
                    auth.status
                )
                .json({
                    ok:false,
                    error:
                        auth.error
                });
        }


        const rewardId =
            String(
                req.body.reward_id ||
                ""
            ).trim();


        const listingId =
            String(
                req.body.listing_id ||
                ""
            ).trim();


        if (
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                rewardId
            ) ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                listingId
            )
        ) {

            return res
                .status(400)
                .json({
                    ok:false,
                    error:
                        "invalid_referral_claim"
                });
        }


        try {

            const {
                data,
                error
            } =
                await supabase.rpc(
                    "hm_claim_referral_promotion_v46",
                    {
                        p_telegram_id:
                            auth.user.telegram_id,
                        p_reward_id:
                            rewardId,
                        p_listing_id:
                            listingId
                    }
                );


            if (
                error
            ) {

                throw error;
            }


            if (
                !data?.ok
            ) {

                return res
                    .status(409)
                    .json({
                        ok:false,
                        error:
                            data?.error ||
                            "referral_reward_unavailable"
                    });
            }


            v45MarketplaceCache.clear();


            const label =
                data.promotion_type ===
                "vip"
                    ? "💎 VIP"
                    : data.promotion_type ===
                        "hot"
                        ? "🔥 HOT"
                        : "⬆️ BUMP";


            await safeSendMessage(
                auth.user.telegram_id,
                `${label} referral reward activated.\n\nActive until: ${new Date(data.applied_until).toUTCString()}`
            );


            return res.json({
                ok:true,
                claim:data,
                referral:
                    await v46ReferralStatus(
                        auth.user.telegram_id
                    )
            });

        } catch (error) {

            await logSystemError(
                "v46_referral_claim",
                error,
                {
                    telegram_id:
                        auth.user.telegram_id,
                    reward_id:
                        rewardId,
                    listing_id:
                        listingId
                }
            );


            return res
                .status(500)
                .json({
                    ok:false,
                    error:
                        "referral_claim_failed"
                });
        }
    }
);


/* =========================================================
   V65 OWNER CHAT SAFETY / ANTI-SCAM MODERATION
   Automated flags are warnings for manual review only.
   Owner-only access. Every reviewed chat is logged.
   ========================================================= */

let lastChatSafetyRescanAt = 0;


function analyzeChatSafetyMessage(
    rawMessage
) {

    const message =
        String(
            rawMessage ||
            ""
        ).trim();


    if (!message) {
        return [];
    }


    const flags = [];
    const seen = new Set();


    function add(
        riskType,
        severity,
        details = null
    ) {

        if (
            seen.has(
                riskType
            )
        ) {
            return;
        }


        seen.add(
            riskType
        );


        flags.push(
            {
                risk_type:
                    riskType,
                severity,
                details:
                    {
                        detector_version:
                            "v65",
                        ...(details || {})
                    }
            }
        );
    }


    if (
        /(?:https?:\/\/|www\.|(?:[a-z0-9-]+\.)+(?:com|net|org|io|co|me|app|site|shop|xyz|info|biz|dev|ai|ru|kg)(?:\/|\b))/i
            .test(
                message
            )
    ) {
        add(
            "external_link",
            "medium"
        );
    }


    if (
        /\b(?:seed\s*phrase|recovery\s*phrase|mnemonic|private\s*key|password|passcode|2fa\s*code|verification\s*code|recovery\s*code|api\s*key)\b/i
            .test(
                message
            )
    ) {
        add(
            "credential_or_secret_request",
            "high"
        );
    }


    if (
        /\b0x[a-fA-F0-9]{40}\b/.test(message) ||
        /\b(?:bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}\b/.test(message) ||
        /\bT[A-Za-z0-9]{33}\b/.test(message)
    ) {
        add(
            "crypto_payment_identifier",
            "medium"
        );
    }


    if (
        /\b(?:pay|payment|send|transfer)\b.{0,35}\b(?:direct|directly|outside|off\s*platform|crypto|usdt|btc|eth|wallet)\b/i
            .test(
                message
            ) ||
        /\b(?:avoid|skip|bypass)\b.{0,25}\b(?:fee|fees|platform|handle\s*market)\b/i
            .test(
                message
            )
    ) {
        add(
            "off_platform_payment_language",
            "medium"
        );
    }


    if (
        /\b(?:message|dm|contact|write|text)\s+(?:me\s+)?(?:on|via)\s+(?:telegram|whatsapp|discord|signal)\b/i
            .test(
                message
            ) ||
        /\b(?:move|continue)\s+(?:this\s+)?(?:chat|conversation)\s+(?:to|on)\b/i
            .test(
                message
            )
    ) {
        add(
            "move_conversation_off_platform",
            "low"
        );
    }


    if (
        /\b(?:pay\s+now|send\s+now|hurry|urgent|right\s+now|only\s+today|last\s+chance)\b/i
            .test(
                message
            )
    ) {
        add(
            "payment_pressure_language",
            "low"
        );
    }


    return flags;
}


function buildChatSafetyFlagRows(
    chatType,
    chatId,
    message
) {

    const type =
        chatType ===
        "wanted"
            ? "wanted"
            : "listing";


    return analyzeChatSafetyMessage(
        message?.message
    ).map(
        flag => ({
            chat_type:
                type,
            chat_id:
                String(
                    chatId
                ),
            message_id:
                String(
                    message.id
                ),
            sender_telegram_id:
                Number(
                    message.sender_telegram_id
                ),
            risk_type:
                flag.risk_type,
            severity:
                flag.severity,
            status:
                "open",
            details:
                flag.details
        })
    );
}


async function recordChatSafetyFlags(
    chatType,
    chatId,
    message
) {

    try {

        const rows =
            buildChatSafetyFlagRows(
                chatType,
                chatId,
                message
            );


        if (!rows.length) {
            return;
        }


        const {
            error
        } =
            await supabase
                .from(
                    "chat_safety_flags"
                )
                .upsert(
                    rows,
                    {
                        onConflict:
                            "chat_type,message_id,risk_type",
                        ignoreDuplicates:
                            true
                    }
                );


        if (error) {
            console.error(
                "Chat safety flag save:",
                error
            );
        }

    } catch (error) {
        console.error(
            "Chat safety scan:",
            error
        );
    }
}


async function scanRecentChatMessagesForSafety() {

    const now = Date.now();


    if (
        now -
        lastChatSafetyRescanAt <
        5 * 60 * 1000
    ) {
        return;
    }


    lastChatSafetyRescanAt = now;


    try {

        const [
            listingResult,
            wantedResult
        ] =
            await Promise.all(
                [
                    supabase
                        .from(
                            "chat_messages"
                        )
                        .select(
                            "id,chat_id,sender_telegram_id,message,created_at"
                        )
                        .order(
                            "created_at",
                            {
                                ascending:false
                            }
                        )
                        .limit(300),

                    supabase
                        .from(
                            "wanted_chat_messages"
                        )
                        .select(
                            "id,chat_id,sender_telegram_id,message,created_at"
                        )
                        .order(
                            "created_at",
                            {
                                ascending:false
                            }
                        )
                        .limit(300)
                ]
            );


        const rows = [];


        for (
            const message of
            listingResult.data || []
        ) {
            rows.push(
                ...buildChatSafetyFlagRows(
                    "listing",
                    message.chat_id,
                    message
                )
            );
        }


        for (
            const message of
            wantedResult.data || []
        ) {
            rows.push(
                ...buildChatSafetyFlagRows(
                    "wanted",
                    message.chat_id,
                    message
                )
            );
        }


        if (rows.length) {

            const {
                error
            } =
                await supabase
                    .from(
                        "chat_safety_flags"
                    )
                    .upsert(
                        rows,
                        {
                            onConflict:
                                "chat_type,message_id,risk_type",
                            ignoreDuplicates:
                                true
                        }
                    );


            if (error) {
                console.error(
                    "Chat safety rescan save:",
                    error
                );
            }
        }

    } catch (error) {
        console.error(
            "Chat safety rescan:",
            error
        );
    }
}


function chatSafetySeverityRank(
    severity
) {

    return {
        low:1,
        medium:2,
        high:3
    }[
        String(
            severity ||
            ""
        ).toLowerCase()
    ] || 0;
}


function chatSafetyAggregateMap(
    flags
) {

    const map =
        new Map();


    for (
        const flag of
        flags || []
    ) {

        if (
            flag.status !==
            "open"
        ) {
            continue;
        }


        const key =
            `${flag.chat_type}:${flag.chat_id}`;


        const current =
            map.get(
                key
            ) ||
            {
                count:0,
                severity:null
            };


        current.count += 1;


        if (
            chatSafetySeverityRank(
                flag.severity
            ) >
            chatSafetySeverityRank(
                current.severity
            )
        ) {
            current.severity =
                flag.severity;
        }


        map.set(
            key,
            current
        );
    }


    return map;
}


app.post(
    "/admin/chat-safety",
    async (req, res) => {

        const admin =
            req.adminAuth ||
            await requireAdmin(
                req.body.initData
            );


        if (
            !admin.ok ||
            normalizedAdminRole(
                admin.user
            ) !==
            "owner"
        ) {
            return res
                .status(403)
                .json({
                    ok:false,
                    error:
                        "admin_role_forbidden"
                });
        }


        await scanRecentChatMessagesForSafety();


        const query =
            String(
                req.body.query ||
                ""
            )
                .trim()
                .toLowerCase()
                .slice(0,120);


        const riskOnly =
            Boolean(
                req.body.risk_only
            );


        try {

            const [
                listingChatsResult,
                wantedChatsResult
            ] =
                await Promise.all(
                    [
                        supabase
                            .from(
                                "listing_chats"
                            )
                            .select(
                                "id,listing_id,buyer_telegram_id,seller_telegram_id,created_at,updated_at"
                            )
                            .order(
                                "updated_at",
                                {
                                    ascending:false
                                }
                            )
                            .limit(150),

                        supabase
                            .from(
                                "wanted_chats"
                            )
                            .select(
                                "id,wanted_id,buyer_telegram_id,seller_telegram_id,created_at,updated_at"
                            )
                            .order(
                                "updated_at",
                                {
                                    ascending:false
                                }
                            )
                            .limit(150)
                    ]
                );


            if (
                listingChatsResult.error ||
                wantedChatsResult.error
            ) {
                return res
                    .status(500)
                    .json({
                        ok:false,
                        error:
                            "chat_safety_load_failed"
                    });
            }


            const listingChats =
                listingChatsResult.data || [];

            const wantedChats =
                wantedChatsResult.data || [];


            const listingChatIds =
                listingChats.map(
                    row => row.id
                );

            const wantedChatIds =
                wantedChats.map(
                    row => row.id
                );


            const [
                listingMessagesResult,
                wantedMessagesResult,
                flagsResult
            ] =
                await Promise.all(
                    [
                        listingChatIds.length
                            ? supabase
                                .from(
                                    "chat_messages"
                                )
                                .select(
                                    "id,chat_id,sender_telegram_id,message,created_at"
                                )
                                .in(
                                    "chat_id",
                                    listingChatIds
                                )
                                .order(
                                    "created_at",
                                    {
                                        ascending:false
                                    }
                                )
                                .limit(1200)
                            : Promise.resolve(
                                {
                                    data:[],
                                    error:null
                                }
                            ),

                        wantedChatIds.length
                            ? supabase
                                .from(
                                    "wanted_chat_messages"
                                )
                                .select(
                                    "id,chat_id,sender_telegram_id,message,created_at"
                                )
                                .in(
                                    "chat_id",
                                    wantedChatIds
                                )
                                .order(
                                    "created_at",
                                    {
                                        ascending:false
                                    }
                                )
                                .limit(1200)
                            : Promise.resolve(
                                {
                                    data:[],
                                    error:null
                                }
                            ),

                        supabase
                            .from(
                                "chat_safety_flags"
                            )
                            .select(
                                "id,chat_type,chat_id,message_id,sender_telegram_id,risk_type,severity,status,created_at"
                            )
                            .in(
                                "status",
                                [
                                    "open",
                                    "resolved",
                                    "dismissed"
                                ]
                            )
                            .order(
                                "created_at",
                                {
                                    ascending:false
                                }
                            )
                            .limit(2500)
                    ]
                );


            if (
                listingMessagesResult.error ||
                wantedMessagesResult.error ||
                flagsResult.error
            ) {
                return res
                    .status(500)
                    .json({
                        ok:false,
                        error:
                            "chat_safety_load_failed"
                    });
            }


            const listingLastMap =
                new Map();

            for (
                const message of
                listingMessagesResult.data || []
            ) {
                const key =
                    String(
                        message.chat_id
                    );

                if (
                    !listingLastMap.has(
                        key
                    )
                ) {
                    listingLastMap.set(
                        key,
                        message
                    );
                }
            }


            const wantedLastMap =
                new Map();

            for (
                const message of
                wantedMessagesResult.data || []
            ) {
                const key =
                    String(
                        message.chat_id
                    );

                if (
                    !wantedLastMap.has(
                        key
                    )
                ) {
                    wantedLastMap.set(
                        key,
                        message
                    );
                }
            }


            const riskMap =
                chatSafetyAggregateMap(
                    flagsResult.data || []
                );


            const userIds =
                [
                    ...listingChats,
                    ...wantedChats
                ]
                    .flatMap(
                        row => [
                            Number(
                                row.buyer_telegram_id
                            ),
                            Number(
                                row.seller_telegram_id
                            )
                        ]
                    )
                    .filter(
                        value =>
                            Number.isFinite(
                                value
                            )
                    );


            const listingIds =
                listingChats.map(
                    row =>
                        row.listing_id
                );

            const wantedIds =
                wantedChats.map(
                    row =>
                        row.wanted_id
                );


            const [
                usersResult,
                listingsResult,
                wantedResult
            ] =
                await Promise.all(
                    [
                        userIds.length
                            ? supabase
                                .from(
                                    "users"
                                )
                                .select(
                                    "telegram_id,first_name,last_name,telegram_username,is_blocked"
                                )
                                .in(
                                    "telegram_id",
                                    [
                                        ...new Set(
                                            userIds
                                        )
                                    ]
                                )
                            : Promise.resolve(
                                {
                                    data:[]
                                }
                            ),

                        listingIds.length
                            ? supabase
                                .from(
                                    "listings"
                                )
                                .select(
                                    "id,listing_number,whatsapp_username,status"
                                )
                                .in(
                                    "id",
                                    listingIds
                                )
                            : Promise.resolve(
                                {
                                    data:[]
                                }
                            ),

                        wantedIds.length
                            ? supabase
                                .from(
                                    "wanted_requests"
                                )
                                .select(
                                    "id,desired_username,status"
                                )
                                .in(
                                    "id",
                                    wantedIds
                                )
                            : Promise.resolve(
                                {
                                    data:[]
                                }
                            )
                    ]
                );


            const userMap =
                new Map(
                    (usersResult.data || [])
                        .map(
                            user => [
                                Number(
                                    user.telegram_id
                                ),
                                user
                            ]
                        )
                );


            const listingMap =
                new Map(
                    (listingsResult.data || [])
                        .map(
                            row => [
                                String(
                                    row.id
                                ),
                                row
                            ]
                        )
                );


            const wantedMap =
                new Map(
                    (wantedResult.data || [])
                        .map(
                            row => [
                                String(
                                    row.id
                                ),
                                row
                            ]
                        )
                );


            const chats = [];


            for (
                const chat of
                listingChats
            ) {

                const risk =
                    riskMap.get(
                        `listing:${chat.id}`
                    ) ||
                    {
                        count:0,
                        severity:null
                    };

                const listing =
                    listingMap.get(
                        String(
                            chat.listing_id
                        )
                    ) ||
                    null;

                chats.push(
                    {
                        ...chat,
                        chat_type:
                            "listing",
                        target_username:
                            listing?.whatsapp_username ||
                            "username",
                        target_number:
                            listing?.listing_number ||
                            null,
                        target_status:
                            listing?.status ||
                            null,
                        buyer:
                            userMap.get(
                                Number(
                                    chat.buyer_telegram_id
                                )
                            ) ||
                            null,
                        seller:
                            userMap.get(
                                Number(
                                    chat.seller_telegram_id
                                )
                            ) ||
                            null,
                        last_message:
                            listingLastMap.get(
                                String(
                                    chat.id
                                )
                            ) ||
                            null,
                        open_flags:
                            risk.count,
                        risk_severity:
                            risk.severity
                    }
                );
            }


            for (
                const chat of
                wantedChats
            ) {

                const risk =
                    riskMap.get(
                        `wanted:${chat.id}`
                    ) ||
                    {
                        count:0,
                        severity:null
                    };

                const wanted =
                    wantedMap.get(
                        String(
                            chat.wanted_id
                        )
                    ) ||
                    null;

                chats.push(
                    {
                        ...chat,
                        chat_type:
                            "wanted",
                        target_username:
                            wanted?.desired_username ||
                            "username",
                        target_number:
                            null,
                        target_status:
                            wanted?.status ||
                            null,
                        buyer:
                            userMap.get(
                                Number(
                                    chat.buyer_telegram_id
                                )
                            ) ||
                            null,
                        seller:
                            userMap.get(
                                Number(
                                    chat.seller_telegram_id
                                )
                            ) ||
                            null,
                        last_message:
                            wantedLastMap.get(
                                String(
                                    chat.id
                                )
                            ) ||
                            null,
                        open_flags:
                            risk.count,
                        risk_severity:
                            risk.severity
                    }
                );
            }


            let filtered =
                chats.sort(
                    (a,b) =>
                        new Date(
                            b.updated_at || 0
                        ).getTime() -
                        new Date(
                            a.updated_at || 0
                        ).getTime()
                );


            if (riskOnly) {
                filtered =
                    filtered.filter(
                        chat =>
                            Number(
                                chat.open_flags ||
                                0
                            ) > 0
                    );
            }


            if (query) {
                filtered =
                    filtered.filter(
                        chat => {

                            const text =
                                [
                                    chat.target_username,
                                    chat.target_number,
                                    chat.buyer_telegram_id,
                                    chat.seller_telegram_id,
                                    chat.buyer?.first_name,
                                    chat.buyer?.last_name,
                                    chat.buyer?.telegram_username,
                                    chat.seller?.first_name,
                                    chat.seller?.last_name,
                                    chat.seller?.telegram_username,
                                    chat.last_message?.message
                                ]
                                    .filter(
                                        value =>
                                            value !== null &&
                                            value !== undefined
                                    )
                                    .join(
                                        " "
                                    )
                                    .toLowerCase();


                            return text.includes(
                                query
                            );
                        }
                    );
            }


            return res.json(
                {
                    ok:true,
                    chats:
                        filtered.slice(
                            0,
                            200
                        )
                }
            );

        } catch (error) {

            console.error(
                "Admin chat safety:",
                error
            );


            return res
                .status(500)
                .json({
                    ok:false,
                    error:
                        "chat_safety_load_failed"
                });
        }
    }
);


app.post(
    "/admin/chat-safety/messages",
    async (req, res) => {

        const admin =
            req.adminAuth ||
            await requireAdmin(
                req.body.initData
            );


        if (
            !admin.ok ||
            normalizedAdminRole(
                admin.user
            ) !==
            "owner"
        ) {
            return res
                .status(403)
                .json({
                    ok:false,
                    error:
                        "admin_role_forbidden"
                });
        }


        const chatType =
            req.body.chat_type ===
            "wanted"
                ? "wanted"
                : "listing";

        const chatId =
            String(
                req.body.chat_id ||
                ""
            ).trim();


        if (!chatId) {
            return res
                .status(400)
                .json({
                    ok:false,
                    error:
                        "chat_id_required"
                });
        }


        try {

            const chatTable =
                chatType ===
                "wanted"
                    ? "wanted_chats"
                    : "listing_chats";

            const messageTable =
                chatType ===
                "wanted"
                    ? "wanted_chat_messages"
                    : "chat_messages";

            const chatSelect =
                chatType ===
                "wanted"
                    ? "id,wanted_id,buyer_telegram_id,seller_telegram_id,created_at,updated_at"
                    : "id,listing_id,buyer_telegram_id,seller_telegram_id,created_at,updated_at";


            const {
                data:chat,
                error:chatError
            } =
                await supabase
                    .from(
                        chatTable
                    )
                    .select(
                        chatSelect
                    )
                    .eq(
                        "id",
                        chatId
                    )
                    .maybeSingle();


            if (
                chatError ||
                !chat
            ) {
                return res
                    .status(404)
                    .json({
                        ok:false,
                        error:
                            "chat_not_found"
                    });
            }


            const {
                data:messages,
                error:messagesError
            } =
                await supabase
                    .from(
                        messageTable
                    )
                    .select(
                        "id,chat_id,sender_telegram_id,message,read_at,created_at"
                    )
                    .eq(
                        "chat_id",
                        chatId
                    )
                    .order(
                        "created_at",
                        {
                            ascending:false
                        }
                    )
                    .limit(250);


            if (messagesError) {
                return res
                    .status(500)
                    .json({
                        ok:false,
                        error:
                            "chat_messages_load_failed"
                    });
            }


            const orderedMessages =
                (messages || [])
                    .reverse();


            const messageIds =
                orderedMessages.map(
                    message =>
                        message.id
                );


            const {
                data:flags
            } =
                messageIds.length
                    ? await supabase
                        .from(
                            "chat_safety_flags"
                        )
                        .select(
                            "id,chat_type,chat_id,message_id,sender_telegram_id,risk_type,severity,status,details,created_at,reviewed_at,reviewed_by"
                        )
                        .eq(
                            "chat_type",
                            chatType
                        )
                        .eq(
                            "chat_id",
                            chatId
                        )
                        .in(
                            "message_id",
                            messageIds
                        )
                        .order(
                            "created_at",
                            {
                                ascending:true
                            }
                        )
                    : {
                        data:[]
                    };


            const flagsByMessage =
                new Map();


            for (
                const flag of
                flags || []
            ) {
                const key =
                    String(
                        flag.message_id
                    );

                const list =
                    flagsByMessage.get(
                        key
                    ) || [];

                list.push(
                    flag
                );

                flagsByMessage.set(
                    key,
                    list
                );
            }


            const userIds =
                [
                    Number(
                        chat.buyer_telegram_id
                    ),
                    Number(
                        chat.seller_telegram_id
                    )
                ];


            const {
                data:users
            } =
                await supabase
                    .from(
                        "users"
                    )
                    .select(
                        "telegram_id,first_name,last_name,telegram_username,is_blocked"
                    )
                    .in(
                        "telegram_id",
                        userIds
                    );


            const userMap =
                new Map(
                    (users || [])
                        .map(
                            user => [
                                Number(
                                    user.telegram_id
                                ),
                                user
                            ]
                        )
                );


            let targetUsername =
                "username";

            let targetNumber =
                null;


            if (
                chatType ===
                "wanted"
            ) {

                const {
                    data:wanted
                } =
                    await supabase
                        .from(
                            "wanted_requests"
                        )
                        .select(
                            "desired_username"
                        )
                        .eq(
                            "id",
                            chat.wanted_id
                        )
                        .maybeSingle();

                targetUsername =
                    wanted?.desired_username ||
                    "username";

            } else {

                const {
                    data:listing
                } =
                    await supabase
                        .from(
                            "listings"
                        )
                        .select(
                            "listing_number,whatsapp_username"
                        )
                        .eq(
                            "id",
                            chat.listing_id
                        )
                        .maybeSingle();

                targetUsername =
                    listing?.whatsapp_username ||
                    "username";

                targetNumber =
                    listing?.listing_number ||
                    null;
            }


            const openFlags =
                (flags || [])
                    .filter(
                        flag =>
                            flag.status ===
                            "open"
                    );

            let highestSeverity =
                null;


            for (
                const flag of
                openFlags
            ) {
                if (
                    chatSafetySeverityRank(
                        flag.severity
                    ) >
                    chatSafetySeverityRank(
                        highestSeverity
                    )
                ) {
                    highestSeverity =
                        flag.severity;
                }
            }


            await logAdminActivity(
                admin.user.telegram_id,
                "chat_safety_view",
                chatType ===
                    "wanted"
                        ? "wanted_chat"
                        : "listing_chat",
                chatId,
                {
                    chat_type:
                        chatType,
                    buyer_telegram_id:
                        Number(
                            chat.buyer_telegram_id
                        ),
                    seller_telegram_id:
                        Number(
                            chat.seller_telegram_id
                        )
                }
            );


            return res.json(
                {
                    ok:true,
                    chat:{
                        ...chat,
                        chat_type:
                            chatType,
                        target_username:
                            targetUsername,
                        target_number:
                            targetNumber,
                        buyer:
                            userMap.get(
                                Number(
                                    chat.buyer_telegram_id
                                )
                            ) ||
                            null,
                        seller:
                            userMap.get(
                                Number(
                                    chat.seller_telegram_id
                                )
                            ) ||
                            null,
                        open_flags:
                            openFlags.length,
                        risk_severity:
                            highestSeverity
                    },
                    messages:
                        orderedMessages.map(
                            message => ({
                                ...message,
                                safety_flags:
                                    flagsByMessage.get(
                                        String(
                                            message.id
                                        )
                                    ) || []
                            })
                        )
                }
            );

        } catch (error) {

            console.error(
                "Admin chat review:",
                error
            );


            return res
                .status(500)
                .json({
                    ok:false,
                    error:
                        "chat_safety_review_failed"
                });
        }
    }
);


app.post(
    "/admin/chat-safety/action",
    async (req, res) => {

        const admin =
            req.adminAuth ||
            await requireAdmin(
                req.body.initData
            );


        if (
            !admin.ok ||
            normalizedAdminRole(
                admin.user
            ) !==
            "owner"
        ) {
            return res
                .status(403)
                .json({
                    ok:false,
                    error:
                        "admin_role_forbidden"
                });
        }


        const flagId =
            String(
                req.body.flag_id ||
                ""
            ).trim();

        const status =
            String(
                req.body.status ||
                ""
            ).trim();


        if (
            !flagId ||
            ![
                "resolved",
                "dismissed"
            ].includes(
                status
            )
        ) {
            return res
                .status(400)
                .json({
                    ok:false,
                    error:
                        "invalid_chat_safety_action"
                });
        }


        const {
            data:flag,
            error:loadError
        } =
            await supabase
                .from(
                    "chat_safety_flags"
                )
                .select(
                    "id,chat_type,chat_id,message_id,risk_type,severity,status"
                )
                .eq(
                    "id",
                    flagId
                )
                .maybeSingle();


        if (
            loadError ||
            !flag
        ) {
            return res
                .status(404)
                .json({
                    ok:false,
                    error:
                        "chat_safety_flag_not_found"
                });
        }


        const {
            data:updated,
            error:updateError
        } =
            await supabase
                .from(
                    "chat_safety_flags"
                )
                .update(
                    {
                        status,
                        reviewed_at:
                            nowIso(),
                        reviewed_by:
                            Number(
                                admin.user.telegram_id
                            )
                    }
                )
                .eq(
                    "id",
                    flagId
                )
                .select(
                    "id,chat_type,chat_id,message_id,risk_type,severity,status,reviewed_at,reviewed_by"
                )
                .single();


        if (updateError) {
            return res
                .status(500)
                .json({
                    ok:false,
                    error:
                        "chat_safety_action_failed"
                });
        }


        await logAdminActivity(
            admin.user.telegram_id,
            `chat_safety_${status}`,
            "chat_safety_flag",
            flagId,
            {
                chat_type:
                    flag.chat_type,
                chat_id:
                    flag.chat_id,
                risk_type:
                    flag.risk_type,
                severity:
                    flag.severity
            }
        );


        return res.json(
            {
                ok:true,
                flag:
                    updated
            }
        );
    }
);


/* =========================================================
   ERROR HANDLER
   ========================================================= */

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            error
        );


        logSystemError(
            "express_error",
            error,
            {
                method:
                    req.method,
                path:
                    String(
                        req.originalUrl ||
                        ""
                    ).split("?")[0]
            }
        ).catch(() => {});


        res
            .status(400)
            .json(
                {
                    ok: false,
                    error:
                        "bad_request"
                }
            );
    }
);


/* =========================================================
   START
   ========================================================= */

const PORT =
    process.env.PORT ||
    3000;


app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `Handle Market API running on port ${PORT}`
        );


        setupTelegramWebhook()
            .catch(
                error =>
                    console.error(
                        error
                    )
            );


        setTimeout(
            () => {

                processListingExpiryNotifications()
                    .catch(
                        error => {
                            console.error(error);
                            logSystemError(
                                "listing_expiry_scheduler",
                                error
                            ).catch(() => {});
                        }
                    );


                processSavedSearchNotifications()
                    .catch(
                        error => {
                            console.error(error);
                            logSystemError(
                                "saved_search_scheduler",
                                error
                            ).catch(() => {});
                        }
                    );

            },
            5000
        );


        setInterval(
            () => {

                processListingExpiryNotifications()
                    .catch(
                        error => {
                            console.error(error);
                            logSystemError(
                                "listing_expiry_scheduler",
                                error
                            ).catch(() => {});
                        }
                    );


                processSavedSearchNotifications()
                    .catch(
                        error => {
                            console.error(error);
                            logSystemError(
                                "saved_search_scheduler",
                                error
                            ).catch(() => {});
                        }
                    );

            },
            60 * 1000
        );
    }
);
