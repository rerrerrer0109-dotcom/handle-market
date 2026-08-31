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
    Number(process.env.LISTING_PRICE_STARS || "1");

const PUBLIC_BASE_URL =
    String(process.env.PUBLIC_BASE_URL || "")
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

    const response = await fetch(
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


    const data =
        await response.json();


    if (!response.ok || !data.ok) {

        console.error(
            `Telegram API ${method} error:`,
            data.description || data
        );

        throw new Error(
            data.description ||
            "telegram_api_error"
        );
    }


    return data.result;
}


// ======================================================
// SET WEBHOOK
// ======================================================

async function setupTelegramWebhook() {

    if (
        !PUBLIC_BASE_URL ||
        !TELEGRAM_WEBHOOK_SECRET
    ) {

        console.log(
            "Telegram webhook not configured: missing env variables"
        );

        return;
    }


    try {

        const webhookUrl =
            PUBLIC_BASE_URL +
            "/telegram-webhook";


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
            "Telegram webhook configured"
        );

    }

    catch (error) {

        console.error(
            "Webhook setup failed:",
            error.message
        );
    }
}


// ======================================================
// TELEGRAM MINI APP AUTH
// ======================================================

function validateInitData(initData) {

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


    if (!auth.user.is_admin) {

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

function validateListingInput(body) {

    let username =
        String(
            body.whatsapp_username ||
            ""
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
            body.description || ""
        )
            .trim()
            .slice(0, 500);


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
                LISTING_PRICE_STARS
        });
    }
);


// ======================================================
// CREATE PAID LISTING ORDER
//
// NOTE: This DOES NOT create the listing.
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


        // Check existing listing
        const {
            data: existing
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


        try {

            // For Telegram Stars:
            // currency = XTR
            // provider_token is omitted.
            const invoiceLink =
                await telegramApi(
                    "createInvoiceLink",
                    {
                        title:
                            "Handle Market Listing",

                        description:
                            `Publish @${input.username} on Handle Market`,

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
                "Invoice error:",
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
                req.body.order_id ||
                ""
            ).trim();


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
    async (req, res) => {

        // Telegram sends this secret header
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


        // Always answer Telegram HTTP request quickly.
        res.sendStatus(200);


        try {

            // ==========================================
            // PRE-CHECKOUT
            // ==========================================

            if (
                update.pre_checkout_query
            ) {

                const query =
                    update
                        .pre_checkout_query;


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
                            query.invoice_payload
                        )
                        .maybeSingle();


                let valid =
                    Boolean(order);


                if (
                    valid &&
                    order.status !==
                        "created"
                ) {
                    valid = false;
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
                    valid = false;
                }


                if (
                    valid &&
                    query.currency !==
                        "XTR"
                ) {
                    valid = false;
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
                    valid = false;
                }


                // Check once more that listing
                // does not already exist.
                if (valid) {

                    const {
                        data: duplicate
                    } =
                        await supabase
                            .from(
                                "listings"
                            )
                            .select("id")
                            .eq(
                                "seller_telegram_id",
                                order
                                    .seller_telegram_id
                            )
                            .ilike(
                                "whatsapp_username",
                                order
                                    .whatsapp_username
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
                        duplicate &&
                        duplicate.length >
                            0
                    ) {

                        valid = false;
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
                                "This listing order can no longer be processed. Please return to Handle Market and create a new order."
                        }
                );


                return;
            }


            // ==========================================
            // SUCCESSFUL PAYMENT
            // ==========================================

            const message =
                update.message;


            const payment =
                message
                    ?.successful_payment;


            if (!payment) {
                return;
            }


            const payload =
                payment.invoice_payload;


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
                    "Paid order not found:",
                    payload
                );

                return;
            }


            // Idempotency:
            // Telegram may deliver an update again.
            if (
                order.status ===
                    "completed"
            ) {

                return;
            }


            const payerId =
                Number(
                    message.from?.id
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
                    payment.total_amount
                ) ===
                    Number(
                        order.amount_stars
                    );


            if (!correctPayment) {

                console.error(
                    "Payment validation failed:",
                    order.id
                );

                return;
            }


            const chargeId =
                payment
                    .telegram_payment_charge_id;


            // Mark payment as received first.
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

                // --------------------------------------
                // Deterministic listing ID:
                // order ID == listing ID.
                // This helps prevent duplicates
                // if Telegram retries the webhook.
                // --------------------------------------

                const {
                    data:
                        existingListing
                } =
                    await supabase
                        .from(
                            "listings"
                        )
                        .select("id")
                        .eq(
                            "id",
                            order.id
                        )
                        .maybeSingle();


                if (!existingListing) {

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


                    if (listingError) {
                        throw listingError;
                    }
                }


                // Private seller contact
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


                if (contactError) {
                    throw contactError;
                }


                // Order completed
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


                // Optional confirmation message
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
                        "Payment confirmation message failed:",
                        messageError.message
                    );
                }


                console.log(
                    `Listing payment completed: ${order.id}`
                );

            }

            catch (fulfillmentError) {

                console.error(
                    "Paid listing fulfillment failed:",
                    fulfillmentError
                );


                // If we took Stars but could not create
                // the listing, try to refund automatically.
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

                catch (refundError) {

                    console.error(
                        "Automatic Stars refund failed:",
                        refundError.message
                    );
                }
            }

        }

        catch (error) {

            console.error(
                "Telegram webhook error:",
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
                        ascending:
                            false
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
// PUBLIC MARKETPLACE
// ======================================================

app.get(
    "/listings",
    async (req, res) => {

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
                .from("listings")
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
// ADMIN — PENDING
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
                                item
                                    .seller_telegram_id
                        )
                )
            ];


        let users = [];


        if (
            sellerIds.length > 0
        ) {

            const {
                data
            } =
                await supabase
                    .from("users")
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


            users =
                data || [];
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


        res.json({

            ok: true,

            listings:
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
                                ) || null
                        })
                    )
        });
    }
);


// ======================================================
// ADMIN — APPROVE / REJECT
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
                req.body.listing_id ||
                ""
            ).trim();


        const status =
            req.body.status;


        if (
            !listingId ||
            ![
                "active",
                "rejected"
            ].includes(status)
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
                    status,
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


        res.json({
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
    process.env.PORT ||
    3000;


app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `Handle Market API running on port ${PORT}`
        );


        // Configure securely using BOT_TOKEN
        // stored only on Render.
        setupTelegramWebhook();
    }
);