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
            "1"
        )
    );


const LISTING_RENEWAL_PRICE_STARS =
    Math.max(
        1,
        Number(
            process.env.LISTING_RENEWAL_PRICE_STARS ||
            OLD_LISTING_PRICE_STARS ||
            "1"
        )
    );


const PAID_LISTING_PRICE_STARS =
    LISTING_RENEWAL_PRICE_STARS;


const CONTACT_UNLOCK_PRICE_STARS =
    Math.max(
        1,
        Number(
            process.env.CONTACT_UNLOCK_PRICE_STARS ||
            "1"
        )
    );


const WANTED_PRICE_STARS =
    Math.max(
        1,
        Number(
            process.env.WANTED_PRICE_STARS ||
            "1"
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


/* =========================================================
   PROMOTIONS
   ========================================================= */

const PROMOTION_TEST_MODE =
    String(
        process.env.PROMOTION_TEST_MODE ||
        "false"
    ).toLowerCase() === "true";


const PROMOTION_TEST_PRICE_STARS =
    Math.max(
        1,
        Number(
            process.env.PROMOTION_TEST_PRICE_STARS ||
            "1"
        )
    );


const PROMOTION_PRICES = {

    bump: {

        24: Math.max(
            1,
            Number(
                process.env.BUMP_24H_STARS ||
                "1"
            )
        ),

        72: Math.max(
            1,
            Number(
                process.env.BUMP_72H_STARS ||
                "1"
            )
        ),

        168: Math.max(
            1,
            Number(
                process.env.BUMP_168H_STARS ||
                "1"
            )
        )
    },


    hot: {

        24: Math.max(
            1,
            Number(
                process.env.HOT_24H_STARS ||
                "1"
            )
        ),

        72: Math.max(
            1,
            Number(
                process.env.HOT_72H_STARS ||
                "1"
            )
        ),

        168: Math.max(
            1,
            Number(
                process.env.HOT_168H_STARS ||
                "1"
            )
        )
    },


    vip: {

        24: Math.max(
            1,
            Number(
                process.env.VIP_24H_STARS ||
                "1"
            )
        ),

        72: Math.max(
            1,
            Number(
                process.env.VIP_72H_STARS ||
                "1"
            )
        ),

        168: Math.max(
            1,
            Number(
                process.env.VIP_168H_STARS ||
                "1"
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


    const contactTypes = [
        "telegram",
        "email",
        "other"
    ];


    if (
        !contactTypes.includes(
            body.contact_type
        )
    ) {

        return {
            ok: false,
            error:
                "invalid_contact_type"
        };
    }


    const contactValue =
        String(
            body.contact_value ||
            ""
        )
            .trim()
            .slice(
                0,
                200
            );


    if (!contactValue) {

        return {
            ok: false,
            error:
                "contact_required"
        };
    }


    /*
       Extra validation for Email.
    */

    if (
        body.contact_type ===
        "email"
    ) {

        const emailOk =
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/
                .test(
                    contactValue
                );


        if (!emailOk) {

            return {
                ok: false,
                error:
                    "invalid_email"
            };
        }
    }


    return {

        ok: true,

        data: {

            username,
            price,
            category,
            description,

            contactType:
                body.contact_type,

            contactValue
        }
    };
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

        safeSendMessage(
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


    return PROMOTION_TEST_MODE

        ? PROMOTION_TEST_PRICE_STARS

        : PROMOTION_PRICES[
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
        plan === "paid" &&
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


    if (
        sellerIds.length
    ) {

        const {
            data
        } =
            await supabase
                .from(
                    "seller_profiles"
                )
                .select(
                    "id,telegram_id,is_public"
                )
                .in(
                    "telegram_id",
                    sellerIds
                );


        profiles =
            data ||
            [];
    }


    const profileMap =
        new Map(

            profiles
                .filter(
                    profile =>
                        profile.is_public
                )
                .map(
                    profile => [
                        String(
                            profile.telegram_id
                        ),
                        profile.id
                    ]
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


            delete copy
                .seller_telegram_id;


            copy.seller_profile_id =
                profileMap.get(
                    String(
                        sellerId
                    )
                ) ||
                null;


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
                "telegram_id,first_name,last_name"
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


    const {
        data:
            activeListings
    } =
        await supabase
            .from("listings")
            .select(
                "id,seller_telegram_id,listing_number,whatsapp_username,asking_price,currency,category,description,is_premium_name,is_featured,views_count,likes_count,created_at,bump_until,hot_until,vip_until,bump_promoted_at,hot_promoted_at,vip_promoted_at,listing_plan,listing_period_started_at,listing_expires_at"
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
            .limit(200);


    const visible =
        (
            activeListings ||
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


    const payload = {

        id:
            profile.id,

        display_name:
            safeSellerDisplayName(
                user
            ),

        bio:
            profile.bio ||
            "",

        seller_since:
            profile.created_at,

        telegram_authenticated:
            true,

        stats: {

            active_listings:
                sorted.length,

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
                    "v34-support-center"
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
                    promotionPricesForClient()
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
                "paid"
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
                    "id,listing_number,whatsapp_username,asking_price,currency,category,description,status,verification_status,is_premium_name,is_featured,views_count,likes_count,is_paused,is_frozen,frozen_reason,frozen_at,created_at,bump_until,hot_until,vip_until,bump_promoted_at,hot_promoted_at,vip_promoted_at,listing_plan,listing_period_started_at,listing_expires_at,last_renewed_at,renewal_count"
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
                    listingsWithStats
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

        const {
            data,
            error
        } =
            await supabase
                .from("listings")
                .select(
                    "id,seller_telegram_id,listing_number,whatsapp_username,asking_price,currency,category,description,is_premium_name,is_featured,views_count,likes_count,created_at,bump_until,hot_until,vip_until,bump_promoted_at,hot_promoted_at,vip_promoted_at,listing_plan,listing_period_started_at,listing_expires_at"
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
   LISTING EDIT
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
                .slice(
                    0,
                    500
                );


        if (
            !listingId ||
            !Number.isFinite(price) ||
            price <= 0 ||
            price >
            100000000
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "invalid_price"
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
                    "id,seller_telegram_id,status,is_frozen"
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
                        ok: false,
                        error:
                            "listing_not_editable"
                    }
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
                        asking_price:
                            price,

                        description,

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
                    "id,seller_telegram_id,status,is_frozen,listing_plan,listing_expires_at"
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


        res.json(
            {
                ok: true,
                unlocked: true,
                owner,

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
                    "id,seller_telegram_id,listing_number,whatsapp_username,asking_price,currency,category,description,is_premium_name,is_featured,views_count,likes_count,created_at,bump_until,hot_until,vip_until,bump_promoted_at,hot_promoted_at,vip_promoted_at,status,is_paused,is_frozen,listing_plan,listing_period_started_at,listing_expires_at"
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
                                null
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


        res.json(
            {
                ok: true,
                posts:
                    data ||
                    []
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


        if (
            !auth.user
                .telegram_username
        ) {

            return res
                .status(400)
                .json(
                    {
                        ok: false,
                        error:
                            "public_telegram_username_required"
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
                            "id,chat_id,sender_telegram_id,message,created_at"
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
                    "id,chat_id,sender_telegram_id,message,created_at"
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
                    "id,chat_id,sender_telegram_id,message,created_at"
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


        await safeSendMessage(
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
                            "id,ticket_id,sender_telegram_id,sender_role,message,created_at"
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
                    "id,ticket_id,sender_telegram_id,sender_role,message,created_at"
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
                    "id,ticket_id,sender_telegram_id,sender_role,message,created_at"
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

            await safeSendMessage(
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
                            "id,ticket_id,sender_telegram_id,sender_role,message,created_at"
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


        await safeSendMessage(
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


        if (
            !listingId ||
            !Number.isFinite(
                amount
            ) ||
            amount <= 0 ||
            amount >
            100000000
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


        safeSendMessage(

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


        const {
            data:
                offers,
            error
        } =
            await supabase
                .from("offers")
                .select(
                    "id,listing_id,amount,currency,message,seller_counter_amount,status,created_at,updated_at"
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
                        "id,listing_number,whatsapp_username,asking_price,category,is_frozen,is_paused,status,listing_plan,listing_expires_at"
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


        res.json(
            {
                ok: true,

                offers:
                    (
                        offers ||
                        []
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


        const {
            data:
                sellerListings,
            error:
                listingsError
        } =
            await supabase
                .from("listings")
                .select(
                    "id,listing_number,whatsapp_username,asking_price,category,is_frozen,is_paused,status,listing_plan,listing_expires_at"
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
                    "id,listing_id,buyer_telegram_id,amount,currency,message,seller_counter_amount,status,created_at,updated_at"
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


        res.json(
            {
                ok: true,

                offers:
                    (
                        offers ||
                        []
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
                    "id,seller_telegram_id,listing_number,whatsapp_username,is_frozen,listing_plan,listing_expires_at"
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
                nowIso()
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

                safeSendMessage(

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


        safeSendMessage(
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

                safeSendMessage(

                    other.buyer_telegram_id,

                    `❌ Another offer for @${listing.whatsapp_username} was accepted. Your open offer was closed.`
                );
            }


            safeSendMessage(

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


        safeSendMessage(

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
                        "id,seller_telegram_id,whatsapp_username,asking_price,currency,category,description,status,is_premium_name,is_featured,views_count,likes_count,is_paused,is_frozen,created_at,listing_plan,listing_period_started_at,listing_expires_at"
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
                    "id,seller_telegram_id,listing_number,whatsapp_username,asking_price,currency,category,description,status,is_premium_name,created_at,listing_plan"
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
                                null
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
                    "id,seller_telegram_id,listing_number,whatsapp_username,status,is_premium_name,listing_plan,listing_period_started_at,listing_expires_at"
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


            if (
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
                    "id,seller_telegram_id,whatsapp_username,status,is_premium_name,listing_plan,listing_period_started_at,listing_expires_at"
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


        safeSendMessage(
            data.seller_telegram_id,
            message
        );


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
                        "id,seller_telegram_id,listing_number,whatsapp_username,asking_price,category,status,is_premium_name,is_paused,is_frozen,frozen_reason,listing_plan,listing_expires_at"
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
                    "id,seller_telegram_id,listing_number,whatsapp_username,asking_price,currency,category,description,status,is_premium_name,is_paused,is_frozen,frozen_reason,frozen_at,frozen_by,created_at,listing_plan,listing_expires_at"
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

                } catch (error) {

                    console.error(
                        "Listing fulfillment failed:",
                        error
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
        }
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
                        error =>
                            console.error(
                                error
                            )
                    );

            },
            5000
        );


        setInterval(
            () => {

                processListingExpiryNotifications()
                    .catch(
                        error =>
                            console.error(
                                error
                            )
                    );

            },
            60 * 1000
        );
    }
);
