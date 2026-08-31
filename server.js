const express = require("express");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(express.json({ limit: "100kb" }));


// ======================================================
// CORS
// ======================================================

app.use((req, res, next) => {

    res.setHeader(
        "Access-Control-Allow-Origin",
        "https://rerrerrer0109-dotcom.github.io"
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


// ======================================================
// ENV
// ======================================================

const BOT_TOKEN =
    process.env.BOT_TOKEN;

const SUPABASE_URL =
    process.env.SUPABASE_URL;

const SUPABASE_SECRET_KEY =
    process.env.SUPABASE_SECRET_KEY;

const LISTING_PRICE_STARS =
    Number(
        process.env.LISTING_PRICE_STARS || "1"
    );

const CONTACT_UNLOCK_PRICE_STARS =
    Number(
        process.env.CONTACT_UNLOCK_PRICE_STARS || "1"
    );

const PUBLIC_BASE_URL =
    String(
        process.env.PUBLIC_BASE_URL || ""
    )
        .trim()
        .replace(/\/+$/, "");

const TELEGRAM_WEBHOOK_SECRET =
    process.env.TELEGRAM_WEBHOOK_SECRET;


// ======================================================
// SUPABASE
// ======================================================

let supabase = null;

if (
    SUPABASE_URL &&
    SUPABASE_SECRET_KEY
) {

    supabase = createClient(
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


// ======================================================
// HELPERS
// ======================================================

function sleep(ms) {

    return new Promise(
        resolve =>
            setTimeout(resolve, ms)
    );
}


async function telegramApi(
    method,
    payload = {}
) {

    if (!BOT_TOKEN) {

        throw new Error(
            "BOT_TOKEN not configured"
        );
    }


    let response;


    try {

        response = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(payload)
            }
        );

    }

    catch (error) {

        console.error(
            `Telegram network error (${method}):`,
            error.cause?.code ||
            error.cause?.message ||
            error.message
        );

        throw error;
    }


    const data =
        await response.json();


    if (
        !response.ok ||
        !data.ok
    ) {

        console.error(
            `Telegram API ${method}:`,
            data.description || data
        );

        throw new Error(
            data.description ||
            "telegram_api_error"
        );
    }


    return data.result;
}


async function createStarsInvoice(
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

            currency:
                "XTR",

            prices: [
                {
                    label:
                        title,

                    amount:
                        amount
                }
            ]
        }
    );
}


async function refundStars(
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


// ======================================================
// WEBHOOK SETUP
// ======================================================

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


    const MAX_ATTEMPTS =
        6;


    for (
        let attempt = 1;
        attempt <= MAX_ATTEMPTS;
        attempt++
    ) {

        try {

            console.log(
                `Setting Telegram webhook — attempt ${attempt}/${MAX_ATTEMPTS}`
            );


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

        }

        catch (error) {

            console.error(
                `Webhook attempt ${attempt} failed:`,
                error.cause?.code ||
                error.message
            );


            if (
                attempt <
                MAX_ATTEMPTS
            ) {

                const delay =
                    attempt * 5000;


                console.log(
                    `Retrying webhook in ${delay / 1000}s...`
                );


                await sleep(delay);
            }
        }
    }


    console.error(
        "Telegram webhook setup failed after all retries"
    );
}


// ======================================================
// TELEGRAM MINI APP AUTH
// ======================================================

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
        typeof initData !== "string"
    ) {

        return {
            valid: false,
            error:
                "initData_missing"
        };
    }


    const params =
        new URLSearchParams(initData);


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
            .update(BOT_TOKEN)
            .digest();


    const calculatedHash =
        crypto
            .createHmac(
                "sha256",
                secretKey
            )
            .update(dataCheckString)
            .digest("hex");


    try {

        const receivedBuffer =
            Buffer.from(
                receivedHash,
                "hex"
            );

        const calculatedBuffer =
            Buffer.from(
                calculatedHash,
                "hex"
            );


        if (
            receivedBuffer.length !==
            calculatedBuffer.length
        ) {

            return {
                valid: false,
                error:
                    "invalid_signature"
            };
        }


        if (
            !crypto.timingSafeEqual(
                receivedBuffer,
                calculatedBuffer
            )
        ) {

            return {
                valid: false,
                error:
                    "invalid_signature"
            };
        }

    }

    catch {

        return {
            valid: false,
            error:
                "invalid_hash"
        };
    }


    // freshness
    const authDate =
        Number(
            params.get("auth_date")
        );


    const now =
        Math.floor(
            Date.now() / 1000
        );


    const MAX_AGE_SECONDS =
        3600;


    if (
        !Number.isFinite(authDate) ||
        authDate <= 0 ||
        now - authDate >
            MAX_AGE_SECONDS ||
        authDate > now + 30
    ) {

        return {
            valid: false,
            error:
                "initData_expired"
        };
    }


    let user = null;


    try {

        const rawUser =
            params.get("user");


        if (rawUser) {

            user =
                JSON.parse(rawUser);
        }

    }

    catch {

        return {
            valid: false,
            error:
                "invalid_user"
        };
    }


    if (
        !user ||
        !user.id
    ) {

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


// ======================================================
// DATABASE USER
// ======================================================

async function getDatabaseUser(
    initData
) {

    const result =
        validateInitData(initData);


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
            tgUser.id,

        first_name:
            tgUser.first_name || "",

        last_name:
            tgUser.last_name || "",

        telegram_username:
            tgUser.username || null,

        language_code:
            tgUser.language_code || null,

        photo_url:
            tgUser.photo_url || null,

        last_seen_at:
            new Date().toISOString()
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


    if (data.is_blocked) {

        return {
            ok: false,
            status: 403,
            error:
                "account_blocked"
        };
    }


    return {
        ok: true,
        user: data
    };
}


// ======================================================
// ADMIN
// ======================================================

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


// ======================================================
// LISTING VALIDATION
// ======================================================

function validateListingInput(
    body
) {

    let username =
        String(
            body.whatsapp_username || ""
        )
            .trim();


    if (
        username.startsWith("@")
    ) {

        username =
            username.substring(1);
    }


    if (
        username.length < 2 ||
        username.length > 64 ||
        !/^[a-zA-Z0-9._]+$/
            .test(username)
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
        price > 100000000
    ) {

        return {
            ok: false,
            error:
                "invalid_price"
        };
    }


    const categories = [
        "Premium",
        "Business",
        "AI",
        "Short",
        "Travel",
        "Finance",
        "Gaming",
        "Crypto",
        "Media",
        "Other"
    ];


    const category =
        categories.includes(
            body.category
        )
            ? body.category
            : "Other";


    const description =
        String(
            body.description || ""
        )
            .trim()
            .slice(0, 500);


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
            body.contact_value || ""
        )
            .trim()
            .slice(0, 200);


    if (!contactValue) {

        return {
            ok: false,
            error:
                "contact_required"
        };
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


// ======================================================
// HEALTH
// ======================================================

app.get(
    "/health",
    (req, res) => {

        res.json({
            ok: true,
            service:
                "Handle Market API"
        });
    }
);


app.get(
    "/db-health",
    async (req, res) => {

        if (!supabase) {

            return res
                .status(500)
                .json({
                    ok: false,
                    database:
                        "not_configured"
                });
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
                .json({
                    ok: false,
                    database:
                        "error",
                    message:
                        error.message
                });
        }


        res.json({
            ok: true,
            database:
                "connected"
        });
    }
);


// ======================================================
// AUTH
// ======================================================

app.post(
    "/auth",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(auth.status)
                .json({
                    ok: false,
                    error:
                        auth.error
                });
        }


        const user =
            auth.user;


        res.json({

            ok: true,

            user: {

                id:
                    user.telegram_id,

                first_name:
                    user.first_name,

                last_name:
                    user.last_name,

                username:
                    user.telegram_username,

                language_code:
                    user.language_code,

                photo_url:
                    user.photo_url,

                is_admin:
                    Boolean(
                        user.is_admin
                    )
            },

            listing_price_stars:
                LISTING_PRICE_STARS,

            contact_unlock_price_stars:
                CONTACT_UNLOCK_PRICE_STARS
        });
    }
);


// ======================================================
// CREATE LISTING PAYMENT
// ======================================================

app.post(
    "/listing-payment/create",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(auth.status)
                .json({
                    ok: false,
                    error:
                        auth.error
                });
        }


        const validation =
            validateListingInput(
                req.body
            );


        if (!validation.ok) {

            return res
                .status(400)
                .json({
                    ok: false,
                    error:
                        validation.error
                });
        }


        const seller =
            auth.user;

        const input =
            validation.data;


        const {
            data: existing,
            error: existingError
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


        if (existingError) {

            return res
                .status(500)
                .json({
                    ok: false,
                    error:
                        "listing_check_failed"
                });
        }


        if (
            existing &&
            existing.length
        ) {

            return res
                .status(409)
                .json({
                    ok: false,
                    error:
                        "listing_already_exists"
                });
        }


        const orderId =
            crypto.randomUUID();


        const payload =
            `listing:${orderId}`;


        const {
            error: orderError
        } =
            await supabase
                .from(
                    "listing_payment_orders"
                )
                .insert({

                    id:
                        orderId,

                    seller_telegram_id:
                        seller.telegram_id,

                    invoice_payload:
                        payload,

                    amount_stars:
                        LISTING_PRICE_STARS,

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
                });


        if (orderError) {

            console.error(
                "Listing payment order:",
                orderError
            );


            return res
                .status(500)
                .json({
                    ok: false,
                    error:
                        "payment_order_failed"
                });
        }


        try {

            const invoiceLink =
                await createStarsInvoice(

                    "Handle Market Listing",

                    `Submit @${input.username} for marketplace moderation`,

                    payload,

                    LISTING_PRICE_STARS
                );


            return res.json({

                ok: true,

                order_id:
                    orderId,

                amount_stars:
                    LISTING_PRICE_STARS,

                invoice_link:
                    invoiceLink
            });

        }

        catch (error) {

            await supabase
                .from(
                    "listing_payment_orders"
                )
                .update({
                    status:
                        "failed"
                })
                .eq(
                    "id",
                    orderId
                );


            return res
                .status(500)
                .json({
                    ok: false,
                    error:
                        "invoice_create_failed"
                });
        }
    }
);


// ======================================================
// LISTING PAYMENT STATUS
// ======================================================

app.post(
    "/listing-payment/status",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(auth.status)
                .json({
                    ok: false,
                    error:
                        auth.error
                });
        }


        const orderId =
            String(
                req.body.order_id || ""
            ).trim();


        const {
            data: order,
            error
        } =
            await supabase
                .from(
                    "listing_payment_orders"
                )
                .select(`
                    id,
                    amount_stars,
                    status,
                    listing_id
                `)
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
                .json({
                    ok: false,
                    error:
                        "payment_order_not_found"
                });
        }


        res.json({
            ok: true,
            order
        });
    }
);


// ======================================================
// CONTACT — READ
// ======================================================

app.post(
    "/listing-contact",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(auth.status)
                .json({
                    ok: false,
                    error:
                        auth.error
                });
        }


        const listingId =
            String(
                req.body.listing_id || ""
            ).trim();


        const {
            data: listing,
            error: listingError
        } =
            await supabase
                .from("listings")
                .select(`
                    id,
                    seller_telegram_id,
                    status
                `)
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
                .json({
                    ok: false,
                    error:
                        "listing_not_found"
                });
        }


        const buyerId =
            Number(
                auth.user.telegram_id
            );


        const sellerId =
            Number(
                listing.seller_telegram_id
            );


        let unlocked =
            buyerId === sellerId;


        if (
            !unlocked &&
            listing.status !== "active"
        ) {

            return res
                .status(404)
                .json({
                    ok: false,
                    error:
                        "listing_not_available"
                });
        }


        if (!unlocked) {

            const {
                data: access
            } =
                await supabase
                    .from(
                        "contact_unlocks"
                    )
                    .select("status")
                    .eq(
                        "buyer_telegram_id",
                        buyerId
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


            unlocked =
                Boolean(access);
        }


        if (!unlocked) {

            return res.json({

                ok: true,

                unlocked:
                    false,

                price_stars:
                    CONTACT_UNLOCK_PRICE_STARS
            });
        }


        const {
            data: contact,
            error: contactError
        } =
            await supabase
                .from(
                    "listing_contacts"
                )
                .select(`
                    contact_type,
                    contact_value
                `)
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
                .json({
                    ok: false,
                    error:
                        "seller_contact_not_found"
                });
        }


        return res.json({

            ok: true,

            unlocked:
                true,

            owner:
                buyerId === sellerId,

            contact: {

                type:
                    contact.contact_type,

                value:
                    contact.contact_value
            }
        });
    }
);


// ======================================================
// CONTACT — CREATE UNLOCK PAYMENT
// ======================================================

app.post(
    "/contact-unlock/create",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(auth.status)
                .json({
                    ok: false,
                    error:
                        auth.error
                });
        }


        const buyerId =
            Number(
                auth.user.telegram_id
            );


        const listingId =
            String(
                req.body.listing_id || ""
            ).trim();


        const {
            data: listing,
            error: listingError
        } =
            await supabase
                .from("listings")
                .select(`
                    id,
                    seller_telegram_id,
                    whatsapp_username,
                    status
                `)
                .eq(
                    "id",
                    listingId
                )
                .maybeSingle();


        if (
            listingError ||
            !listing ||
            listing.status !== "active"
        ) {

            return res
                .status(404)
                .json({
                    ok: false,
                    error:
                        "listing_not_available"
                });
        }


        if (
            Number(
                listing.seller_telegram_id
            ) === buyerId
        ) {

            return res.json({
                ok: true,
                already_unlocked:
                    true
            });
        }


        const {
            data: contact
        } =
            await supabase
                .from(
                    "listing_contacts"
                )
                .select("listing_id")
                .eq(
                    "listing_id",
                    listingId
                )
                .maybeSingle();


        if (!contact) {

            return res
                .status(404)
                .json({
                    ok: false,
                    error:
                        "seller_contact_not_found"
                });
        }


        const {
            data: existingUnlock
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


        if (
            existingUnlock?.status ===
            "paid"
        ) {

            return res.json({
                ok: true,
                already_unlocked:
                    true
            });
        }


        const orderId =
            existingUnlock?.id ||
            crypto.randomUUID();


        const randomPart =
            crypto
                .randomBytes(8)
                .toString("hex");


        const payload =
            `contact:${orderId}:${randomPart}`;


        let databaseError;


        if (existingUnlock) {

            const {
                error
            } =
                await supabase
                    .from(
                        "contact_unlocks"
                    )
                    .update({

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
                    })
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
                    .insert({

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
                    });


            databaseError =
                error;
        }


        if (databaseError) {

            console.error(
                "Contact unlock order:",
                databaseError
            );


            return res
                .status(500)
                .json({
                    ok: false,
                    error:
                        "contact_payment_order_failed"
                });
        }


        try {

            const invoiceLink =
                await createStarsInvoice(

                    "Unlock Seller Contact",

                    `Unlock contact for @${listing.whatsapp_username}`,

                    payload,

                    CONTACT_UNLOCK_PRICE_STARS
                );


            return res.json({

                ok: true,

                order_id:
                    orderId,

                amount_stars:
                    CONTACT_UNLOCK_PRICE_STARS,

                invoice_link:
                    invoiceLink
            });

        }

        catch (error) {

            await supabase
                .from(
                    "contact_unlocks"
                )
                .update({
                    status:
                        "failed"
                })
                .eq(
                    "id",
                    orderId
                );


            return res
                .status(500)
                .json({
                    ok: false,
                    error:
                        "invoice_create_failed"
                });
        }
    }
);


// ======================================================
// CONTACT — PAYMENT STATUS
// ======================================================

app.post(
    "/contact-unlock/status",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(auth.status)
                .json({
                    ok: false,
                    error:
                        auth.error
                });
        }


        const orderId =
            String(
                req.body.order_id || ""
            ).trim();


        const {
            data: order,
            error
        } =
            await supabase
                .from(
                    "contact_unlocks"
                )
                .select(`
                    id,
                    listing_id,
                    amount_stars,
                    status,
                    paid_at
                `)
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
                .json({
                    ok: false,
                    error:
                        "contact_order_not_found"
                });
        }


        res.json({
            ok: true,
            order
        });
    }
);


// ======================================================
// MY LISTINGS
// ======================================================

app.post(
    "/my-listings",
    async (req, res) => {

        const auth =
            await getDatabaseUser(
                req.body.initData
            );


        if (!auth.ok) {

            return res
                .status(auth.status)
                .json({
                    ok: false,
                    error:
                        auth.error
                });
        }


        const {
            data,
            error
        } =
            await supabase
                .from("listings")
                .select(`
                    id,
                    whatsapp_username,
                    asking_price,
                    currency,
                    category,
                    description,
                    status,
                    verification_status,
                    is_featured,
                    created_at
                `)
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
                .json({
                    ok: false,
                    error:
                        "listings_load_failed"
                });
        }


        res.json({
            ok: true,
            listings:
                data || []
        });
    }
);


// ======================================================
// PUBLIC LISTINGS
// ======================================================

app.get(
    "/listings",
    async (req, res) => {

        const {
            data,
            error
        } =
            await supabase
                .from("listings")
                .select(`
                    id,
                    whatsapp_username,
                    asking_price,
                    currency,
                    category,
                    description,
                    is_featured,
                    views_count,
                    created_at
                `)
                .eq(
                    "status",
                    "active"
                )
                .order(
                    "is_featured",
                    {
                        ascending: false
                    }
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
                .json({
                    ok: false,
                    error:
                        "marketplace_load_failed"
                });
        }


        res.json({
            ok: true,
            listings:
                data || []
        });
    }
);


// ======================================================
// ADMIN PENDING
// ======================================================

app.post(
    "/admin/pending-listings",
    async (req, res) => {

        const admin =
            await requireAdmin(
                req.body.initData
            );


        if (!admin.ok) {

            return res
                .status(admin.status)
                .json({
                    ok: false,
                    error:
                        admin.error
                });
        }


        const {
            data: listings,
            error
        } =
            await supabase
                .from("listings")
                .select(`
                    id,
                    seller_telegram_id,
                    whatsapp_username,
                    asking_price,
                    currency,
                    category,
                    description,
                    status,
                    created_at
                `)
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
                .json({
                    ok: false,
                    error:
                        "admin_load_failed"
                });
        }


        const sellerIds =
            [
                ...new Set(
                    (listings || [])
                        .map(
                            item =>
                                item.seller_telegram_id
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
                    .select(`
                        telegram_id,
                        first_name,
                        telegram_username
                    `)
                    .in(
                        "telegram_id",
                        sellerIds
                    );


            users =
                data || [];
        }


        const map =
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


        res.json({

            ok: true,

            listings:
                (listings || [])
                    .map(
                        listing => ({

                            ...listing,

                            seller:
                                map.get(
                                    String(
                                        listing.seller_telegram_id
                                    )
                                ) || null
                        })
                    )
        });
    }
);


// ======================================================
// ADMIN STATUS
// ======================================================

app.post(
    "/admin/listing-status",
    async (req, res) => {

        const admin =
            await requireAdmin(
                req.body.initData
            );


        if (!admin.ok) {

            return res
                .status(admin.status)
                .json({
                    ok: false,
                    error:
                        admin.error
                });
        }


        const listingId =
            String(
                req.body.listing_id || ""
            ).trim();


        const newStatus =
            req.body.status;


        if (
            ![
                "active",
                "rejected"
            ].includes(newStatus)
        ) {

            return res
                .status(400)
                .json({
                    ok: false,
                    error:
                        "invalid_admin_action"
                });
        }


        const {
            data,
            error
        } =
            await supabase
                .from("listings")
                .update({

                    status:
                        newStatus,

                    updated_at:
                        new Date().toISOString()
                })
                .eq(
                    "id",
                    listingId
                )
                .eq(
                    "status",
                    "pending"
                )
                .select()
                .maybeSingle();


        if (
            error ||
            !data
        ) {

            return res
                .status(404)
                .json({
                    ok: false,
                    error:
                        "pending_listing_not_found"
                });
        }


        res.json({
            ok: true,
            listing:
                data
        });
    }
);


// ======================================================
// TELEGRAM WEBHOOK
// ======================================================

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

            return res.sendStatus(403);
        }


        const update =
            req.body;


        // Telegram gets HTTP 200 immediately.
        res.sendStatus(200);


        try {

            // ==================================================
            // PRE-CHECKOUT
            // ==================================================

            if (
                update.pre_checkout_query
            ) {

                const query =
                    update.pre_checkout_query;


                const payload =
                    String(
                        query.invoice_payload || ""
                    );


                // ----------------------------------------------
                // LISTING
                // ----------------------------------------------

                if (
                    payload.startsWith(
                        "listing:"
                    )
                ) {

                    const {
                        data: order
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


                // ----------------------------------------------
                // CONTACT UNLOCK
                // ----------------------------------------------

                if (
                    payload.startsWith(
                        "contact:"
                    )
                ) {

                    const {
                        data: order
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


                    if (valid) {

                        const {
                            data: listing
                        } =
                            await supabase
                                .from(
                                    "listings"
                                )
                                .select("status")
                                .eq(
                                    "id",
                                    order.listing_id
                                )
                                .maybeSingle();


                        if (
                            !listing ||
                            listing.status !==
                                "active"
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
                                    "This contact unlock is no longer available."
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


            // ==================================================
            // SUCCESSFUL PAYMENT
            // ==================================================

            const message =
                update.message;


            const payment =
                message?.successful_payment;


            if (!payment) {
                return;
            }


            const payload =
                String(
                    payment.invoice_payload || ""
                );


            const payerId =
                Number(
                    message.from?.id
                );


            // ==================================================
            // SUCCESSFUL LISTING PAYMENT
            // ==================================================

            if (
                payload.startsWith(
                    "listing:"
                )
            ) {

                const {
                    data: order
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


                if (!order) {
                    return;
                }


                if (
                    order.status ===
                        "completed" ||
                    order.status ===
                        "refunded"
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


                const chargeId =
                    payment
                        .telegram_payment_charge_id;


                await supabase
                    .from(
                        "listing_payment_orders"
                    )
                    .update({

                        status:
                            "paid",

                        telegram_payment_charge_id:
                            chargeId,

                        paid_at:
                            new Date()
                                .toISOString()
                    })
                    .eq(
                        "id",
                        order.id
                    );


                try {

                    const {
                        data: alreadyCreated
                    } =
                        await supabase
                            .from("listings")
                            .select("id")
                            .eq(
                                "id",
                                order.id
                            )
                            .maybeSingle();


                    if (!alreadyCreated) {

                        const {
                            error
                        } =
                            await supabase
                                .from("listings")
                                .insert({

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
                                        order.category,

                                    description:
                                        order.description,

                                    status:
                                        "pending",

                                    verification_status:
                                        "unverified",

                                    is_featured:
                                        false
                                });


                        if (error) {
                            throw error;
                        }
                    }


                    const {
                        error: contactError
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


                    if (contactError) {
                        throw contactError;
                    }


                    await supabase
                        .from(
                            "listing_payment_orders"
                        )
                        .update({

                            status:
                                "completed",

                            listing_id:
                                order.id,

                            completed_at:
                                new Date()
                                    .toISOString()
                        })
                        .eq(
                            "id",
                            order.id
                        );


                    console.log(
                        `Listing payment completed: ${order.id}`
                    );

                }

                catch (error) {

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
                            .update({
                                status:
                                    "refunded"
                            })
                            .eq(
                                "id",
                                order.id
                            );

                    }

                    catch (refundError) {

                        console.error(
                            "Listing refund failed:",
                            refundError.message
                        );
                    }
                }


                return;
            }


            // ==================================================
            // SUCCESSFUL CONTACT PAYMENT
            // ==================================================

            if (
                payload.startsWith(
                    "contact:"
                )
            ) {

                const {
                    data: order
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


                if (
                    order.status === "paid" ||
                    order.status ===
                        "refunded"
                ) {

                    return;
                }


                const valid =

                    payerId ===
                        Number(
                            order.buyer_telegram_id
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


                const chargeId =
                    payment
                        .telegram_payment_charge_id;


                if (!valid) {

                    return;
                }


                // Confirm listing still active
                const {
                    data: listing
                } =
                    await supabase
                        .from("listings")
                        .select("status")
                        .eq(
                            "id",
                            order.listing_id
                        )
                        .maybeSingle();


                const {
                    data: sellerContact
                } =
                    await supabase
                        .from(
                            "listing_contacts"
                        )
                        .select("listing_id")
                        .eq(
                            "listing_id",
                            order.listing_id
                        )
                        .maybeSingle();


                if (
                    !listing ||
                    listing.status !==
                        "active" ||
                    !sellerContact
                ) {

                    try {

                        await refundStars(
                            payerId,
                            chargeId
                        );


                        await supabase
                            .from(
                                "contact_unlocks"
                            )
                            .update({
                                status:
                                    "refunded"
                            })
                            .eq(
                                "id",
                                order.id
                            );

                    }

                    catch (error) {

                        console.error(
                            "Contact refund failed:",
                            error.message
                        );
                    }


                    return;
                }


                const {
                    error: unlockError
                } =
                    await supabase
                        .from(
                            "contact_unlocks"
                        )
                        .update({

                            status:
                                "paid",

                            telegram_payment_charge_id:
                                chargeId,

                            paid_at:
                                new Date()
                                    .toISOString()
                        })
                        .eq(
                            "id",
                            order.id
                        );


                if (unlockError) {

                    console.error(
                        "Contact unlock fulfillment:",
                        unlockError
                    );


                    try {

                        await refundStars(
                            payerId,
                            chargeId
                        );

                    }

                    catch (error) {

                        console.error(
                            "Contact unlock refund:",
                            error.message
                        );
                    }


                    return;
                }


                console.log(
                    `Seller contact unlocked: ${order.id}`
                );


                return;
            }

        }

        catch (error) {

            console.error(
                "Webhook processing error:",
                error
            );
        }
    }
);


// ======================================================
// ERROR HANDLER
// ======================================================

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(error);


        res
            .status(400)
            .json({
                ok: false,
                error:
                    "bad_request"
            });
    }
);


// ======================================================
// START
// ======================================================

const PORT =
    process.env.PORT || 3000;


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
    }
);