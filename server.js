const express = require("express");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(
    express.json({
        limit: "100kb"
    })
);


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
// ENVIRONMENT VARIABLES
// ======================================================

const BOT_TOKEN =
    process.env.BOT_TOKEN;


const SUPABASE_URL =
    process.env.SUPABASE_URL;


const SUPABASE_SECRET_KEY =
    process.env.SUPABASE_SECRET_KEY;


const LISTING_PRICE_STARS =
    Number(
        process.env.LISTING_PRICE_STARS ||
        "1"
    );


const PUBLIC_BASE_URL =
    String(
        process.env.PUBLIC_BASE_URL ||
        ""
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
// SLEEP
// ======================================================

function sleep(ms) {

    return new Promise(
        resolve => {

            setTimeout(
                resolve,
                ms
            );

        }
    );
}


// ======================================================
// TELEGRAM BOT API
// ======================================================

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

        response =
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


    let data;


    try {

        data =
            await response.json();

    }

    catch {

        throw new Error(
            `Telegram returned invalid response (${response.status})`
        );
    }


    if (
        !response.ok ||
        !data.ok
    ) {

        console.error(
            `Telegram API ${method} error:`,
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


// ======================================================
// SET TELEGRAM WEBHOOK WITH RETRIES
// ======================================================

async function setupTelegramWebhook() {

    if (!PUBLIC_BASE_URL) {

        console.log(
            "Webhook not configured: PUBLIC_BASE_URL missing"
        );

        return;
    }


    if (!TELEGRAM_WEBHOOK_SECRET) {

        console.log(
            "Webhook not configured: TELEGRAM_WEBHOOK_SECRET missing"
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


                await sleep(
                    delay
                );
            }
        }
    }


    console.error(
        "Telegram webhook setup failed after all retries"
    );
}


// ======================================================
// TELEGRAM MINI APP INIT DATA VALIDATION
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
        new URLSearchParams(
            initData
        );


    const receivedHash =
        params.get(
            "hash"
        );


    if (!receivedHash) {

        return {

            valid: false,

            error:
                "hash_missing"

        };
    }


    params.delete(
        "hash"
    );


    const dataCheckString =
        [...params.entries()]
            .sort(
                ([a], [b]) =>
                    a.localeCompare(
                        b
                    )
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
            .digest(
                "hex"
            );


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


    // ==================================================
    // AUTH DATE
    // ==================================================

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


    const MAX_AGE_SECONDS =
        3600;


    if (
        !Number.isFinite(
            authDate
        ) ||
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


    // ==================================================
    // TELEGRAM USER
    // ==================================================

    let user = null;


    try {

        const rawUser =
            params.get(
                "user"
            );


        if (rawUser) {

            user =
                JSON.parse(
                    rawUser
                );
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
// CREATE / UPDATE DATABASE USER
// ======================================================

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


    const telegramUser =
        result.user;


    const userRecord = {

        telegram_id:
            telegramUser.id,

        first_name:
            telegramUser.first_name ||
            "",

        last_name:
            telegramUser.last_name ||
            "",

        telegram_username:
            telegramUser.username ||
            null,

        language_code:
            telegramUser.language_code ||
            null,

        photo_url:
            telegramUser.photo_url ||
            null,

        last_seen_at:
            new Date()
                .toISOString()

    };


    const {
        data,
        error
    } =
        await supabase
            .from(
                "users"
            )
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


    return {

        ok: true,

        user:
            data

    };
}


// ======================================================
// ADMIN CHECK
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
// LISTING INPUT VALIDATION
// ======================================================

function validateListingInput(
    body
) {

    let username =
        String(
            body.whatsapp_username ||
            ""
        )
            .trim();


    if (
        username.startsWith(
            "@"
        )
    ) {

        username =
            username.substring(
                1
            );
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
        !Number.isFinite(
            price
        ) ||
        price <= 0 ||
        price > 100000000
    ) {

        return {

            ok: false,

            error:
                "invalid_price"

        };
    }


    const allowedCategories = [

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
        allowedCategories.includes(
            body.category
        )
            ? body.category
            : "Other";


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


    const allowedContactTypes = [

        "telegram",
        "email",
        "other"

    ];


    if (
        !allowedContactTypes.includes(
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


    if (
        !contactValue
    ) {

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

        res
            .status(200)
            .json({

                ok: true,

                service:
                    "Handle Market API"

            });
    }
);


// ======================================================
// DATABASE HEALTH
// ======================================================

app.get(
    "/db-health",

    async (
        req,
        res
    ) => {

        if (!supabase) {

            return res
                .status(500)
                .json({

                    ok: false,

                    database:
                        "not_configured"

                });
        }


        try {

            const {
                error
            } =
                await supabase
                    .from(
                        "users"
                    )
                    .select(
                        "telegram_id",
                        {
                            head: true,

                            count:
                                "exact"
                        }
                    );


            if (error) {

                console.error(
                    "DB health error:",
                    error
                );


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


            return res.json({

                ok: true,

                database:
                    "connected"

            });

        }

        catch (error) {

            console.error(
                "DB connection error:",
                error
            );


            return res
                .status(500)
                .json({

                    ok: false,

                    database:
                        "connection_failed"

                });
        }
    }
);


// ======================================================
// AUTH
// ======================================================

app.post(
    "/auth",

    async (
        req,
        res
    ) => {

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

                    ok: false,

                    error:
                        auth.error

                });
        }


        const user =
            auth.user;


        return res.json({

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
                LISTING_PRICE_STARS

        });
    }
);


// ======================================================
// CREATE LISTING PAYMENT ORDER
//
// DOES NOT CREATE LISTING YET.
// ======================================================

app.post(
    "/listing-payment/create",

    async (
        req,
        res
    ) => {

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


        // ==================================================
        // CHECK EXISTING LISTING
        // ==================================================

        const {
            data: existing,
            error: existingError
        } =
            await supabase
                .from(
                    "listings"
                )
                .select(
                    "id,status"
                )
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
                .limit(
                    1
                );


        if (existingError) {

            console.error(
                "Existing listing check error:",
                existingError
            );


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
            existing.length > 0
        ) {

            return res
                .status(409)
                .json({

                    ok: false,

                    error:
                        "listing_already_exists"

                });
        }


        // ==================================================
        // CREATE PAYMENT ORDER
        // ==================================================

        const orderId =
            crypto.randomUUID();


        const invoicePayload =
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
                        invoicePayload,

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
                "Payment order error:",
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


        // ==================================================
        // CREATE TELEGRAM STARS INVOICE
        // ==================================================

        try {

            const invoiceLink =
                await telegramApi(
                    "createInvoiceLink",
                    {

                        title:
                            "Handle Market Listing",

                        description:
                            `Submit @${input.username} for Handle Market moderation`,

                        payload:
                            invoicePayload,

                        currency:
                            "XTR",

                        prices: [

                            {

                                label:
                                    "Listing fee",

                                amount:
                                    LISTING_PRICE_STARS

                            }

                        ]

                    }
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


            console.error(
                "Invoice creation error:",
                error.message
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
// PAYMENT ORDER STATUS
// ======================================================

app.post(
    "/listing-payment/status",

    async (
        req,
        res
    ) => {

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

                    ok: false,

                    error:
                        auth.error

                });
        }


        const orderId =
            String(
                req.body.order_id ||
                ""
            )
                .trim();


        if (!orderId) {

            return res
                .status(400)
                .json({

                    ok: false,

                    error:
                        "order_id_required"

                });
        }


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
                    listing_id,
                    created_at,
                    paid_at,
                    completed_at
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


        if (error) {

            console.error(
                "Payment status error:",
                error
            );


            return res
                .status(500)
                .json({

                    ok: false,

                    error:
                        "payment_status_failed"

                });
        }


        if (!order) {

            return res
                .status(404)
                .json({

                    ok: false,

                    error:
                        "payment_order_not_found"

                });
        }


        return res.json({

            ok: true,

            order

        });
    }
);


// ======================================================
// TELEGRAM WEBHOOK
// ======================================================

app.post(
    "/telegram-webhook",

    async (
        req,
        res
    ) => {

        const secret =
            req.get(
                "X-Telegram-Bot-Api-Secret-Token"
            );


        if (
            !TELEGRAM_WEBHOOK_SECRET ||
            secret !==
                TELEGRAM_WEBHOOK_SECRET
        ) {

            console.warn(
                "Rejected Telegram webhook: invalid secret"
            );


            return res
                .sendStatus(
                    403
                );
        }


        const update =
            req.body;


        // Telegram should get 200 quickly.
        res.sendStatus(
            200
        );


        try {

            // ==================================================
            // PRE-CHECKOUT QUERY
            // ==================================================

            if (
                update.pre_checkout_query
            ) {

                const query =
                    update
                        .pre_checkout_query;


                const {
                    data: order,
                    error: orderError
                } =
                    await supabase
                        .from(
                            "listing_payment_orders"
                        )
                        .select("*")
                        .eq(
                            "invoice_payload",
                            query.invoice_payload
                        )
                        .maybeSingle();


                let valid =
                    !orderError &&
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
                            order
                                .seller_telegram_id
                        )
                ) {

                    valid =
                        false;
                }


                if (
                    valid &&
                    query.currency !==
                        "XTR"
                ) {

                    valid =
                        false;
                }


                if (
                    valid &&
                    Number(
                        query.total_amount
                    ) !==
                        Number(
                            order.amount_stars
                        )
                ) {

                    valid =
                        false;
                }


                // Duplicate protection
                if (valid) {

                    const {
                        data: duplicate,
                        error:
                            duplicateError
                    } =
                        await supabase
                            .from(
                                "listings"
                            )
                            .select(
                                "id"
                            )
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
                            .limit(
                                1
                            );


                    if (
                        duplicateError ||
                        (
                            duplicate &&
                            duplicate.length > 0
                        )
                    ) {

                        valid =
                            false;
                    }
                }


                if (valid) {

                    await telegramApi(
                        "answerPreCheckoutQuery",
                        {

                            pre_checkout_query_id:
                                query.id,

                            ok:
                                true

                        }
                    );

                } else {

                    await telegramApi(
                        "answerPreCheckoutQuery",
                        {

                            pre_checkout_query_id:
                                query.id,

                            ok:
                                false,

                            error_message:
                                "This listing order is no longer valid. Return to Handle Market and create a new order."

                        }
                    );
                }


                return;
            }


            // ==================================================
            // SUCCESSFUL PAYMENT
            // ==================================================

            const message =
                update.message;


            const payment =
                message
                    ?.successful_payment;


            if (!payment) {

                return;
            }


            const payload =
                payment
                    .invoice_payload;


            const {
                data: order,
                error: orderError
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
                orderError ||
                !order
            ) {

                console.error(
                    "Successful payment order not found:",
                    payload
                );


                return;
            }


            // Idempotency
            if (
                order.status ===
                    "completed"
            ) {

                console.log(
                    "Duplicate successful payment ignored:",
                    order.id
                );


                return;
            }


            const payerId =
                Number(
                    message
                        .from
                        ?.id
                );


            const correctPayment =

                payerId ===
                    Number(
                        order
                            .seller_telegram_id
                    )

                &&

                payment.currency ===
                    "XTR"

                &&

                Number(
                    payment
                        .total_amount
                ) ===
                    Number(
                        order
                            .amount_stars
                    );


            if (
                !correctPayment
            ) {

                console.error(
                    "Successful payment validation failed:",
                    order.id
                );


                return;
            }


            const chargeId =
                payment
                    .telegram_payment_charge_id;


            // ==================================================
            // RECORD SUCCESSFUL PAYMENT
            // ==================================================

            const {
                error: paidUpdateError
            } =
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


            if (
                paidUpdateError
            ) {

                console.error(
                    "Failed to record payment:",
                    paidUpdateError
                );


                return;
            }


            try {

                // ==================================================
                // CREATE LISTING
                //
                // payment order ID == listing ID
                // ==================================================

                const {
                    data:
                        existingListing,
                    error:
                        existingListingError
                } =
                    await supabase
                        .from(
                            "listings"
                        )
                        .select(
                            "id"
                        )
                        .eq(
                            "id",
                            order.id
                        )
                        .maybeSingle();


                if (
                    existingListingError
                ) {

                    throw existingListingError;
                }


                if (
                    !existingListing
                ) {

                    const {
                        error:
                            listingError
                    } =
                        await supabase
                            .from(
                                "listings"
                            )
                            .insert({

                                id:
                                    order.id,

                                seller_telegram_id:
                                    order
                                        .seller_telegram_id,

                                whatsapp_username:
                                    order
                                        .whatsapp_username,

                                asking_price:
                                    order
                                        .asking_price,

                                currency:
                                    "USD",

                                category:
                                    order
                                        .category,

                                description:
                                    order
                                        .description,

                                status:
                                    "pending",

                                verification_status:
                                    "unverified",

                                is_featured:
                                    false

                            });


                    if (
                        listingError
                    ) {

                        throw listingError;
                    }
                }


                // ==================================================
                // PRIVATE SELLER CONTACT
                // ==================================================

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
                                    order
                                        .contact_type,

                                contact_value:
                                    order
                                        .contact_value

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


                // ==================================================
                // COMPLETE ORDER
                // ==================================================

                const {
                    error:
                        completeError
                } =
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


                if (
                    completeError
                ) {

                    throw completeError;
                }


                console.log(
                    `Listing payment completed: ${order.id}`
                );


                // Confirmation message
                try {

                    await telegramApi(
                        "sendMessage",
                        {

                            chat_id:
                                payerId,

                            text:
                                `✅ Payment received.\n\n@${order.whatsapp_username} was submitted for Handle Market moderation.`

                        }
                    );

                }

                catch (messageError) {

                    console.error(
                        "Confirmation message failed:",
                        messageError.message
                    );
                }

            }

            catch (
                fulfillmentError
            ) {

                console.error(
                    "Paid listing fulfillment failed:",
                    fulfillmentError
                );


                // ==================================================
                // AUTOMATIC REFUND
                // ==================================================

                try {

                    await telegramApi(
                        "refundStarPayment",
                        {

                            user_id:
                                payerId,

                            telegram_payment_charge_id:
                                chargeId

                        }
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


                    console.log(
                        `Stars refunded for order ${order.id}`
                    );

                }

                catch (
                    refundError
                ) {

                    console.error(
                        "Automatic Stars refund failed:",
                        refundError.message
                    );
                }
            }

        }

        catch (error) {

            console.error(
                "Telegram webhook processing error:",
                error
            );
        }
    }
);


// ======================================================
// MY LISTINGS
// ======================================================

app.post(
    "/my-listings",

    async (
        req,
        res
    ) => {

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
                .from(
                    "listings"
                )
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
                        ascending:
                            false
                    }
                );


        if (error) {

            console.error(
                "My listings error:",
                error
            );


            return res
                .status(500)
                .json({

                    ok: false,

                    error:
                        "listings_load_failed"

                });
        }


        return res.json({

            ok: true,

            listings:
                data || []

        });
    }
);


// ======================================================
// PUBLIC MARKETPLACE
// ======================================================

app.get(
    "/listings",

    async (
        req,
        res
    ) => {

        if (!supabase) {

            return res
                .status(500)
                .json({

                    ok: false,

                    error:
                        "database_not_configured"

                });
        }


        const {
            data,
            error
        } =
            await supabase
                .from(
                    "listings"
                )
                .select(`
                    id,
                    whatsapp_username,
                    asking_price,
                    currency,
                    category,
                    description,
                    verification_status,
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
                        ascending:
                            false
                    }
                )
                .order(
                    "created_at",
                    {
                        ascending:
                            false
                    }
                )
                .limit(
                    100
                );


        if (error) {

            console.error(
                "Marketplace error:",
                error
            );


            return res
                .status(500)
                .json({

                    ok: false,

                    error:
                        "marketplace_load_failed"

                });
        }


        return res.json({

            ok: true,

            listings:
                data || []

        });
    }
);


// ======================================================
// ADMIN — PENDING LISTINGS
// ======================================================

app.post(
    "/admin/pending-listings",

    async (
        req,
        res
    ) => {

        const admin =
            await requireAdmin(
                req.body.initData
            );


        if (!admin.ok) {

            return res
                .status(
                    admin.status
                )
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
                .from(
                    "listings"
                )
                .select(`
                    id,
                    seller_telegram_id,
                    whatsapp_username,
                    asking_price,
                    currency,
                    category,
                    description,
                    status,
                    verification_status,
                    created_at
                `)
                .eq(
                    "status",
                    "pending"
                )
                .order(
                    "created_at",
                    {
                        ascending:
                            true
                    }
                );


        if (error) {

            console.error(
                "Admin pending error:",
                error
            );


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
                            listing =>
                                listing
                                    .seller_telegram_id
                        )
                )
            ];


        let users = [];


        if (
            sellerIds.length > 0
        ) {

            const {
                data: sellerUsers,
                error: usersError
            } =
                await supabase
                    .from(
                        "users"
                    )
                    .select(`
                        telegram_id,
                        first_name,
                        last_name,
                        telegram_username
                    `)
                    .in(
                        "telegram_id",
                        sellerIds
                    );


            if (usersError) {

                console.error(
                    "Admin seller load error:",
                    usersError
                );

            } else {

                users =
                    sellerUsers || [];

            }
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


        const result =
            (listings || [])
                .map(
                    listing => ({

                        ...listing,

                        seller:
                            userMap.get(
                                String(
                                    listing
                                        .seller_telegram_id
                                )
                            ) ||
                            null

                    })
                );


        return res.json({

            ok: true,

            listings:
                result

        });
    }
);


// ======================================================
// ADMIN — APPROVE / REJECT
// ======================================================

app.post(
    "/admin/listing-status",

    async (
        req,
        res
    ) => {

        const admin =
            await requireAdmin(
                req.body.initData
            );


        if (!admin.ok) {

            return res
                .status(
                    admin.status
                )
                .json({

                    ok: false,

                    error:
                        admin.error

                });
        }


        const listingId =
            String(
                req.body.listing_id ||
                ""
            )
                .trim();


        const newStatus =
            req.body.status;


        if (
            !listingId ||
            ![
                "active",
                "rejected"
            ].includes(
                newStatus
            )
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
                .from(
                    "listings"
                )
                .update({

                    status:
                        newStatus,

                    updated_at:
                        new Date()
                            .toISOString()

                })
                .eq(
                    "id",
                    listingId
                )
                .eq(
                    "status",
                    "pending"
                )
                .select(`
                    id,
                    whatsapp_username,
                    status
                `)
                .maybeSingle();


        if (error) {

            console.error(
                "Admin status update error:",
                error
            );


            return res
                .status(500)
                .json({

                    ok: false,

                    error:
                        "admin_update_failed"

                });
        }


        if (!data) {

            return res
                .status(404)
                .json({

                    ok: false,

                    error:
                        "pending_listing_not_found"

                });
        }


        return res.json({

            ok: true,

            listing:
                data

        });
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

        console.error(
            "Unhandled server error:",
            error
        );


        return res
            .status(400)
            .json({

                ok: false,

                error:
                    "bad_request"

            });
    }
);


// ======================================================
// START SERVER
// ======================================================

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


        // We do not await this.
        // Server remains available even if Telegram
        // temporarily cannot be reached.
        setupTelegramWebhook()
            .catch(
                error => {

                    console.error(
                        "Unexpected webhook setup error:",
                        error
                    );

                }
            );
    }
);