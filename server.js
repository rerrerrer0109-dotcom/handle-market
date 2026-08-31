const express = require("express");
const crypto = require("crypto");

const {
    createClient
} = require("@supabase/supabase-js");


const app =
    express();


app.use(
    express.json({
        limit: "100kb"
    })
);


const ALLOWED_ORIGIN =
    "https://rerrerrer0109-dotcom.github.io";


app.use(
    (
        req,
        res,
        next
    ) => {

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


        if (
            req.method ===
            "OPTIONS"
        ) {

            return res
                .sendStatus(204);
        }


        next();
    }
);


const BOT_TOKEN =
    process.env.BOT_TOKEN;


const SUPABASE_URL =
    process.env.SUPABASE_URL;


const SUPABASE_SECRET_KEY =
    process.env.SUPABASE_SECRET_KEY;


const LISTING_PRICE_STARS =
    Number(
        process.env
            .LISTING_PRICE_STARS ||
        "1"
    );


const CONTACT_UNLOCK_PRICE_STARS =
    Number(
        process.env
            .CONTACT_UNLOCK_PRICE_STARS ||
        "1"
    );


const WANTED_PRICE_STARS =
    Number(
        process.env
            .WANTED_PRICE_STARS ||
        "1"
    );


const PUBLIC_BASE_URL =
    String(
        process.env
            .PUBLIC_BASE_URL ||
        ""
    )
        .trim()
        .replace(
            /\/+$/,
            ""
        );


const TELEGRAM_WEBHOOK_SECRET =
    process.env
        .TELEGRAM_WEBHOOK_SECRET;


const supabase =
    SUPABASE_URL &&
    SUPABASE_SECRET_KEY

        ? createClient(
            SUPABASE_URL,
            SUPABASE_SECRET_KEY,
            {
                auth: {
                    persistSession:
                        false,

                    autoRefreshToken:
                        false,

                    detectSessionInUrl:
                        false
                }
            }
        )

        : null;


// ======================================================
// HELPERS
// ======================================================

function sleep(
    ms
) {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );
}


async function telegramApi(
    method,
    payload = {}
) {

    if (
        !BOT_TOKEN
    ) {

        throw new Error(
            "BOT_TOKEN not configured"
        );
    }


    const response =
        await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
            {
                method:
                    "POST",

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
                    Number(
                        chatId
                    ),

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

            currency:
                "XTR",

            prices: [
                {
                    label:
                        title,

                    amount
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
                Number(
                    userId
                ),

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


    for (
        let attempt = 1;
        attempt <= 6;
        attempt++
    ) {

        try {

            console.log(
                `Setting Telegram webhook — attempt ${attempt}/6`
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


// ======================================================
// TELEGRAM AUTH
// ======================================================

function validateInitData(
    initData
) {

    if (
        !BOT_TOKEN
    ) {

        return {
            valid:
                false,

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
            valid:
                false,

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


    if (
        !receivedHash
    ) {

        return {
            valid:
                false,

            error:
                "hash_missing"
        };
    }


    params.delete(
        "hash"
    );


    const dataCheckString =
        [
            ...params.entries()
        ]
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
            .join(
                "\n"
            );


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
                valid:
                    false,

                error:
                    "invalid_signature"
            };
        }


        if (
            !crypto
                .timingSafeEqual(
                    receivedBuffer,
                    calculatedBuffer
                )
        ) {

            return {
                valid:
                    false,

                error:
                    "invalid_signature"
            };
        }

    } catch {

        return {
            valid:
                false,

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
            valid:
                false,

            error:
                "initData_expired"
        };
    }


    let user;


    try {

        user =
            JSON.parse(
                params.get(
                    "user"
                )
            );

    } catch {

        return {
            valid:
                false,

            error:
                "invalid_user"
        };
    }


    if (
        !user?.id
    ) {

        return {
            valid:
                false,

            error:
                "user_missing"
        };
    }


    return {
        valid:
            true,

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
        validateInitData(
            initData
        );


    if (
        !result.valid
    ) {

        return {
            ok:
                false,

            status:
                401,

            error:
                result.error
        };
    }


    if (
        !supabase
    ) {

        return {
            ok:
                false,

            status:
                500,

            error:
                "database_not_configured"
        };
    }


    const tgUser =
        result.user;


    const record = {

        telegram_id:
            tgUser.id,

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
            null
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
                record,
                {
                    onConflict:
                        "telegram_id"
                }
            )
            .select()
            .single();


    if (
        error
    ) {

        console.error(
            "User DB error:",
            error
        );


        return {
            ok:
                false,

            status:
                500,

            error:
                "database_error"
        };
    }


    if (
        data.is_blocked
    ) {

        return {
            ok:
                false,

            status:
                403,

            error:
                "account_blocked"
        };
    }


    return {
        ok:
            true,

        user:
            data
    };
}


async function requireAdmin(
    initData
) {

    const auth =
        await getDatabaseUser(
            initData
        );


    if (
        !auth.ok
    ) {

        return auth;
    }


    if (
        !auth.user
            .is_admin
    ) {

        return {
            ok:
                false,

            status:
                403,

            error:
                "admin_required"
        };
    }


    return auth;
}


// ======================================================
// VALIDATE LISTING
// ======================================================

function validateListingInput(
    body
) {

    let username =
        String(
            body
                .whatsapp_username ||
            ""
        ).trim();


    if (
        username
            .startsWith(
                "@"
            )
    ) {

        username =
            username.slice(
                1
            );
    }


    if (
        username.length <
            2 ||
        username.length >
            64 ||
        !/^[a-zA-Z0-9._]+$/
            .test(
                username
            )
    ) {

        return {
            ok:
                false,

            error:
                "invalid_username"
        };
    }


    const price =
        Number(
            body
                .asking_price
        );


    if (
        !Number.isFinite(
            price
        ) ||
        price <= 0 ||
        price >
            100000000
    ) {

        return {
            ok:
                false,

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
        !contactTypes
            .includes(
                body
                    .contact_type
            )
    ) {

        return {
            ok:
                false,

            error:
                "invalid_contact_type"
        };
    }


    const contactValue =
        String(
            body
                .contact_value ||
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
            ok:
                false,

            error:
                "contact_required"
        };
    }


    return {

        ok:
            true,

        data: {

            username,

            price,

            category,

            description,

            contactType:
                body
                    .contact_type,

            contactValue
        }
    };
}


// ======================================================
// VALIDATE WANTED
// ======================================================

function validateWantedInput(
    body
) {

    let username =
        String(
            body
                .desired_username ||
            ""
        ).trim();


    if (
        username
            .startsWith(
                "@"
            )
    ) {

        username =
            username.slice(
                1
            );
    }


    username =
        username
            .toLowerCase();


    if (
        username.length <
            2 ||
        username.length >
            64 ||
        !/^[a-zA-Z0-9._]+$/
            .test(
                username
            )
    ) {

        return {
            ok:
                false,

            error:
                "invalid_wanted_username"
        };
    }


    const budget =
        Number(
            body.budget
        );


    if (
        !Number.isFinite(
            budget
        ) ||
        budget <= 0 ||
        budget >
            100000000
    ) {

        return {
            ok:
                false,

            error:
                "invalid_budget"
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
            body.description ||
            ""
        )
            .trim()
            .slice(
                0,
                500
            );


    return {

        ok:
            true,

        data: {

            username,

            budget,

            category,

            description
        }
    };
}


// ======================================================
// CONTACT ACCESS
// ======================================================

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
            .select(
                "id"
            )
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


    if (
        error
    ) {

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


// ======================================================
// HEALTH
// ======================================================

app.get(
    "/health",
    (
        req,
        res
    ) => {

        res.json({
            ok:
                true,

            service:
                "Handle Market API"
        });
    }
);


app.get(
    "/db-health",
    async (
        req,
        res
    ) => {

        if (
            !supabase
        ) {

            return res
                .status(
                    500
                )
                .json({
                    ok:
                        false,

                    database:
                        "not_configured"
                });
        }


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
                        head:
                            true
                    }
                );


        if (
            error
        ) {

            return res
                .status(
                    500
                )
                .json({
                    ok:
                        false,

                    database:
                        "error"
                });
        }


        res.json({
            ok:
                true,

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
    async (
        req,
        res
    ) => {

        const auth =
            await getDatabaseUser(
                req.body
                    .initData
            );


        if (
            !auth.ok
        ) {

            return res
                .status(
                    auth.status
                )
                .json({
                    ok:
                        false,

                    error:
                        auth.error
                });
        }


        const user =
            auth.user;


        res.json({

            ok:
                true,

            user: {

                id:
                    user
                        .telegram_id,

                first_name:
                    user
                        .first_name,

                last_name:
                    user
                        .last_name,

                username:
                    user
                        .telegram_username,

                language_code:
                    user
                        .language_code,

                photo_url:
                    user
                        .photo_url,

                is_admin:
                    Boolean(
                        user
                            .is_admin
                    )
            },


            listing_price_stars:
                LISTING_PRICE_STARS,


            contact_unlock_price_stars:
                CONTACT_UNLOCK_PRICE_STARS,


            wanted_price_stars:
                WANTED_PRICE_STARS
        });
    }
);


// ======================================================
// PUBLIC LISTINGS
// ======================================================

app.get(
    "/listings",
    async (
        req,
        res
    ) => {

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


        if (
            error
        ) {

            return res
                .status(
                    500
                )
                .json({
                    ok:
                        false,

                    error:
                        "marketplace_load_failed"
                });
        }


        res.json({
            ok:
                true,

            listings:
                data ||
                []
        });
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
                req.body
                    .initData
            );


        if (
            !auth.ok
        ) {

            return res
                .status(
                    auth.status
                )
                .json({
                    ok:
                        false,

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
                    auth.user
                        .telegram_id
                )
                .order(
                    "created_at",
                    {
                        ascending:
                            false
                    }
                );


        if (
            error
        ) {

            return res
                .status(
                    500
                )
                .json({
                    ok:
                        false,

                    error:
                        "listings_load_failed"
                });
        }


        res.json({
            ok:
                true,

            listings:
                data ||
                []
        });
    }
);


// ======================================================
// WATCHLIST TOGGLE
// ======================================================

app.post(
    "/watchlist/toggle",
    async (
        req,
        res
    ) => {

        const auth =
            await getDatabaseUser(
                req.body
                    .initData
            );


        if (
            !auth.ok
        ) {

            return res
                .status(
                    auth.status
                )
                .json({
                    ok:
                        false,

                    error:
                        auth.error
                });
        }


        const telegramId =
            Number(
                auth.user
                    .telegram_id
            );


        const listingId =
            String(
                req.body
                    .listing_id ||
                ""
            ).trim();


        if (
            !listingId
        ) {

            return res
                .status(
                    400
                )
                .json({
                    ok:
                        false,

                    error:
                        "listing_id_required"
                });
        }


        const {
            data:
                listing
        } =
            await supabase
                .from(
                    "listings"
                )
                .select(
                    "id,status"
                )
                .eq(
                    "id",
                    listingId
                )
                .maybeSingle();


        if (
            !listing ||
            listing.status !==
                "active"
        ) {

            return res
                .status(
                    404
                )
                .json({
                    ok:
                        false,

                    error:
                        "listing_not_available"
                });
        }


        const {
            data:
                existing,
            error:
                checkError
        } =
            await supabase
                .from(
                    "watchlist"
                )
                .select(
                    "telegram_id,listing_id"
                )
                .eq(
                    "telegram_id",
                    telegramId
                )
                .eq(
                    "listing_id",
                    listingId
                )
                .maybeSingle();


        if (
            checkError
        ) {

            return res
                .status(
                    500
                )
                .json({
                    ok:
                        false,

                    error:
                        "watchlist_check_failed"
                });
        }


        if (
            existing
        ) {

            const {
                error
            } =
                await supabase
                    .from(
                        "watchlist"
                    )
                    .delete()
                    .eq(
                        "telegram_id",
                        telegramId
                    )
                    .eq(
                        "listing_id",
                        listingId
                    );


            if (
                error
            ) {

                return res
                    .status(
                        500
                    )
                    .json({
                        ok:
                            false,

                        error:
                            "watchlist_update_failed"
                    });
            }


            return res.json({
                ok:
                    true,

                watched:
                    false,

                listing_id:
                    listingId
            });
        }


        const {
            error
        } =
            await supabase
                .from(
                    "watchlist"
                )
                .insert({
                    telegram_id:
                        telegramId,

                    listing_id:
                        listingId
                });


        if (
            error
        ) {

            return res
                .status(
                    500
                )
                .json({
                    ok:
                        false,

                    error:
                        "watchlist_update_failed"
                });
        }


        res.json({
            ok:
                true,

            watched:
                true,

            listing_id:
                listingId
        });
    }
);


// ======================================================
// WATCHLIST LIST
// ======================================================

app.post(
    "/watchlist/list",
    async (
        req,
        res
    ) => {

        const auth =
            await getDatabaseUser(
                req.body
                    .initData
            );


        if (
            !auth.ok
        ) {

            return res
                .status(
                    auth.status
                )
                .json({
                    ok:
                        false,

                    error:
                        auth.error
                });
        }


        const telegramId =
            Number(
                auth.user
                    .telegram_id
            );


        const {
            data:
                rows,
            error
        } =
            await supabase
                .from(
                    "watchlist"
                )
                .select(
                    "listing_id"
                )
                .eq(
                    "telegram_id",
                    telegramId
                );


        if (
            error
        ) {

            return res
                .status(
                    500
                )
                .json({
                    ok:
                        false,

                    error:
                        "watchlist_load_failed"
                });
        }


        const ids =
            (
                rows ||
                []
            )
                .map(
                    row =>
                        row
                            .listing_id
                );


        if (
            !ids.length
        ) {

            return res.json({
                ok:
                    true,

                listing_ids:
                    [],

                listings:
                    []
            });
        }


        const {
            data:
                listings,
            error:
                listingError
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
                    is_featured,
                    views_count,
                    created_at
                `)
                .in(
                    "id",
                    ids
                )
                .eq(
                    "status",
                    "active"
                )
                .order(
                    "created_at",
                    {
                        ascending:
                            false
                    }
                );


        if (
            listingError
        ) {

            return res
                .status(
                    500
                )
                .json({
                    ok:
                        false,

                    error:
                        "watchlist_load_failed"
                });
        }


        const active =
            listings ||
            [];


        res.json({
            ok:
                true,

            listing_ids:
                active
                    .map(
                        item =>
                            item.id
                    ),

            listings:
                active
        });
    }
);


// ======================================================
// PUBLIC WANTED
// ======================================================

app.get(
    "/wanted",
    async (
        req,
        res
    ) => {

        const {
            data:
                posts,
            error
        } =
            await supabase
                .from(
                    "wanted_requests"
                )
                .select(`
                    id,
                    buyer_telegram_id,
                    desired_username,
                    budget,
                    currency,
                    category,
                    description,
                    status,
                    created_at
                `)
                .eq(
                    "status",
                    "active"
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


        if (
            error
        ) {

            console.error(
                "Wanted load:",
                error
            );


            return res
                .status(
                    500
                )
                .json({
                    ok:
                        false,

                    error:
                        "wanted_load_failed"
                });
        }


        const buyerIds =
            [
                ...new Set(
                    (
                        posts ||
                        []
                    )
                        .map(
                            item =>
                                item
                                    .buyer_telegram_id
                        )
                )
            ];


        let buyers =
            [];


        if (
            buyerIds.length
        ) {

            const {
                data
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
                        buyerIds
                    );


            buyers =
                data ||
                [];
        }


        const buyerMap =
            new Map(
                buyers.map(
                    buyer => [
                        String(
                            buyer
                                .telegram_id
                        ),

                        buyer
                    ]
                )
            );


        res.json({

            ok:
                true,

            posts:
                (
                    posts ||
                    []
                )
                    .map(
                        post => ({

                            ...post,

                            buyer:
                                buyerMap
                                    .get(
                                        String(
                                            post
                                                .buyer_telegram_id
                                        )
                                    ) ||
                                null
                        })
                    )
        });
    }
);


// ======================================================
// MY WANTED
// ======================================================

app.post(
    "/my-wanted",
    async (
        req,
        res
    ) => {

        const auth =
            await getDatabaseUser(
                req.body
                    .initData
            );


        if (
            !auth.ok
        ) {

            return res
                .status(
                    auth.status
                )
                .json({
                    ok:
                        false,

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
                    "wanted_requests"
                )
                .select(`
                    id,
                    desired_username,
                    budget,
                    currency,
                    category,
                    description,
                    status,
                    created_at,
                    updated_at
                `)
                .eq(
                    "buyer_telegram_id",
                    auth.user
                        .telegram_id
                )
                .order(
                    "created_at",
                    {
                        ascending:
                            false
                    }
                );


        if (
            error
        ) {

            return res
                .status(
                    500
                )
                .json({
                    ok:
                        false,

                    error:
                        "wanted_load_failed"
                });
        }


        res.json({
            ok:
                true,

            posts:
                data ||
                []
        });
    }
);


// ======================================================
// CLOSE WANTED
// ======================================================

app.post(
    "/wanted/close",
    async (
        req,
        res
    ) => {

        const auth =
            await getDatabaseUser(
                req.body
                    .initData
            );


        if (
            !auth.ok
        ) {

            return res
                .status(
                    auth.status
                )
                .json({
                    ok:
                        false,

                    error:
                        auth.error
                });
        }


        const wantedId =
            String(
                req.body
                    .wanted_id ||
                ""
            ).trim();


        if (
            !wantedId
        ) {

            return res
                .status(
                    400
                )
                .json({
                    ok:
                        false,

                    error:
                        "wanted_id_required"
                });
        }


        const {
            data,
            error
        } =
            await supabase
                .from(
                    "wanted_requests"
                )
                .update({
                    status:
                        "closed",

                    updated_at:
                        new Date()
                            .toISOString()
                })
                .eq(
                    "id",
                    wantedId
                )
                .eq(
                    "buyer_telegram_id",
                    auth.user
                        .telegram_id
                )
                .eq(
                    "status",
                    "active"
                )
                .select()
                .maybeSingle();


        if (
            error
        ) {

            return res
                .status(
                    500
                )
                .json({
                    ok:
                        false,

                    error:
                        "wanted_close_failed"
                });
        }


        if (
            !data
        ) {

            return res
                .status(
                    404
                )
                .json({
                    ok:
                        false,

                    error:
                        "active_wanted_not_found"
                });
        }


        res.json({
            ok:
                true,

            post:
                data
        });
    }
);


// ======================================================
// CREATE WANTED PAYMENT
// ======================================================

app.post(
    "/wanted-payment/create",
    async (
        req,
        res
    ) => {

        const auth =
            await getDatabaseUser(
                req.body
                    .initData
            );


        if (
            !auth.ok
        ) {

            return res
                .status(
                    auth.status
                )
                .json({
                    ok:
                        false,

                    error:
                        auth.error
                });
        }


        if (
            !auth.user
                .telegram_username
        ) {

            return res
                .status(
                    400
                )
                .json({
                    ok:
                        false,

                    error:
                        "telegram_username_required"
                });
        }


        const validation =
            validateWantedInput(
                req.body
            );


        if (
            !validation.ok
        ) {

            return res
                .status(
                    400
                )
                .json({
                    ok:
                        false,

                    error:
                        validation.error
                });
        }


        const input =
            validation.data;


        const {
            data:
                existing
        } =
            await supabase
                .from(
                    "wanted_requests"
                )
                .select(
                    "id"
                )
                .eq(
                    "buyer_telegram_id",
                    auth.user
                        .telegram_id
                )
                .eq(
                    "desired_username",
                    input.username
                )
                .eq(
                    "status",
                    "active"
                )
                .limit(
                    1
                );


        if (
            existing
                ?.length
        ) {

            return res
                .status(
                    409
                )
                .json({
                    ok:
                        false,

                    error:
                        "wanted_already_exists"
                });
        }


        const orderId =
            crypto
                .randomUUID();


        const payload =
            `wanted:${orderId}`;


        const {
            error
        } =
            await supabase
                .from(
                    "wanted_payment_orders"
                )
                .insert({

                    id:
                        orderId,

                    buyer_telegram_id:
                        auth.user
                            .telegram_id,

                    invoice_payload:
                        payload,

                    amount_stars:
                        WANTED_PRICE_STARS,

                    desired_username:
                        input.username,

                    budget:
                        input.budget,

                    category:
                        input.category,

                    description:
                        input.description,

                    status:
                        "created"
                });


        if (
            error
        ) {

            console.error(
                "Wanted payment order:",
                error
            );


            return res
                .status(
                    500
                )
                .json({
                    ok:
                        false,

                    error:
                        "wanted_payment_order_failed"
                });
        }


        try {

            const invoiceLink =
                await createStarsInvoice(

                    "Handle Market Wanted",

                    `Publish a request for @${input.username}`,

                    payload,

                    WANTED_PRICE_STARS
                );


            res.json({

                ok:
                    true,

                order_id:
                    orderId,

                amount_stars:
                    WANTED_PRICE_STARS,

                invoice_link:
                    invoiceLink
            });

        } catch {

            await supabase
                .from(
                    "wanted_payment_orders"
                )
                .update({
                    status:
                        "failed"
                })
                .eq(
                    "id",
                    orderId
                );


            res
                .status(
                    500
                )
                .json({
                    ok:
                        false,

                    error:
                        "invoice_create_failed"
                });
        }
    }
);


// ======================================================
// WANTED PAYMENT STATUS
// ======================================================

app.post(
    "/wanted-payment/status",
    async (
        req,
        res
    ) => {

        const auth =
            await getDatabaseUser(
                req.body
                    .initData
            );


        if (
            !auth.ok
        ) {

            return res
                .status(
                    auth.status
                )
                .json({
                    ok:
                        false,

                    error:
                        auth.error
                });
        }


        const orderId =
            String(
                req.body
                    .order_id ||
                ""
            ).trim();


        const {
            data:
                order
        } =
            await supabase
                .from(
                    "wanted_payment_orders"
                )
                .select(`
                    id,
                    amount_stars,
                    status,
                    wanted_post_id
                `)
                .eq(
                    "id",
                    orderId
                )
                .eq(
                    "buyer_telegram_id",
                    auth.user
                        .telegram_id
                )
                .maybeSingle();


        if (
            !order
        ) {

            return res
                .status(
                    404
                )
                .json({
                    ok:
                        false,

                    error:
                        "wanted_order_not_found"
                });
        }


        res.json({
            ok:
                true,

            order
        });
    }
);


// ======================================================
// CREATE LISTING PAYMENT
// ======================================================

app.post(
    "/listing-payment/create",
    async (
        req,
        res
    ) => {

        const auth =
            await getDatabaseUser(
                req.body
                    .initData
            );


        if (
            !auth.ok
        ) {

            return res
                .status(
                    auth.status
                )
                .json({
                    ok:
                        false,

                    error:
                        auth.error
                });
        }


        const validation =
            validateListingInput(
                req.body
            );


        if (
            !validation.ok
        ) {

            return res
                .status(
                    400
                )
                .json({
                    ok:
                        false,

                    error:
                        validation.error
                });
        }


        const seller =
            auth.user;


        const input =
            validation.data;


        const {
            data:
                existing
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
                    seller
                        .telegram_id
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


        if (
            existing
                ?.length
        ) {

            return res
                .status(
                    409
                )
                .json({
                    ok:
                        false,

                    error:
                        "listing_already_exists"
                });
        }


        const orderId =
            crypto
                .randomUUID();


        const payload =
            `listing:${orderId}`;


        const {
            error
        } =
            await supabase
                .from(
                    "listing_payment_orders"
                )
                .insert({

                    id:
                        orderId,

                    seller_telegram_id:
                        seller
                            .telegram_id,

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


        if (
            error
        ) {

            return res
                .status(
                    500
                )
                .json({
                    ok:
                        false,

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


            res.json({

                ok:
                    true,

                order_id:
                    orderId,

                amount_stars:
                    LISTING_PRICE_STARS,

                invoice_link:
                    invoiceLink
            });

        } catch {

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


            res
                .status(
                    500
                )
                .json({
                    ok:
                        false,

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
    async (
        req,
        res
    ) => {

        const auth =
            await getDatabaseUser(
                req.body
                    .initData
            );


        if (
            !auth.ok
        ) {

            return res
                .status(
                    auth.status
                )
                .json({
                    ok:
                        false,

                    error:
                        auth.error
                });
        }


        const {
            data:
                order
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
                    req.body
                        .order_id
                )
                .eq(
                    "seller_telegram_id",
                    auth.user
                        .telegram_id
                )
                .maybeSingle();


        if (
            !order
        ) {

            return res
                .status(
                    404
                )
                .json({
                    ok:
                        false,

                    error:
                        "payment_order_not_found"
                });
        }


        res.json({
            ok:
                true,

            order
        });
    }
);


// ======================================================
// LISTING CONTACT
// ======================================================

app.post(
    "/listing-contact",
    async (
        req,
        res
    ) => {

        const auth =
            await getDatabaseUser(
                req.body
                    .initData
            );


        if (
            !auth.ok
        ) {

            return res
                .status(
                    auth.status
                )
                .json({
                    ok:
                        false,

                    error:
                        auth.error
                });
        }


        const listingId =
            String(
                req.body
                    .listing_id ||
                ""
            ).trim();


        const {
            data:
                listing
        } =
            await supabase
                .from(
                    "listings"
                )
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
            !listing
        ) {

            return res
                .status(
                    404
                )
                .json({
                    ok:
                        false,

                    error:
                        "listing_not_found"
                });
        }


        const buyerId =
            Number(
                auth.user
                    .telegram_id
            );


        const sellerId =
            Number(
                listing
                    .seller_telegram_id
            );


        let unlocked =
            buyerId ===
            sellerId;


        if (
            !unlocked &&
            listing.status !==
                "active"
        ) {

            return res
                .status(
                    404
                )
                .json({
                    ok:
                        false,

                    error:
                        "listing_not_available"
                });
        }


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
            !unlocked
        ) {

            return res.json({

                ok:
                    true,

                unlocked:
                    false,

                owner:
                    false,

                price_stars:
                    CONTACT_UNLOCK_PRICE_STARS
            });
        }


        const {
            data:
                contact
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
            !contact
        ) {

            return res
                .status(
                    404
                )
                .json({
                    ok:
                        false,

                    error:
                        "seller_contact_not_found"
                });
        }


        res.json({

            ok:
                true,

            unlocked:
                true,

            owner:
                buyerId ===
                sellerId,

            contact: {

                type:
                    contact
                        .contact_type,

                value:
                    contact
                        .contact_value
            }
        });
    }
);


// ======================================================
// CONTACT UNLOCK CREATE
// ======================================================

app.post(
    "/contact-unlock/create",
    async (
        req,
        res
    ) => {

        const auth =
            await getDatabaseUser(
                req.body
                    .initData
            );


        if (
            !auth.ok
        ) {

            return res
                .status(
                    auth.status
                )
                .json({
                    ok:
                        false,

                    error:
                        auth.error
                });
        }


        const buyerId =
            Number(
                auth.user
                    .telegram_id
            );


        const listingId =
            String(
                req.body
                    .listing_id ||
                ""
            ).trim();


        const {
            data:
                listing
        } =
            await supabase
                .from(
                    "listings"
                )
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
            !listing ||
            listing.status !==
                "active"
        ) {

            return res
                .status(
                    404
                )
                .json({
                    ok:
                        false,

                    error:
                        "listing_not_available"
                });
        }


        if (
            Number(
                listing
                    .seller_telegram_id
            ) ===
            buyerId
        ) {

            return res.json({
                ok:
                    true,

                already_unlocked:
                    true
            });
        }


        if (
            await buyerHasContactAccess(
                buyerId,
                listingId
            )
        ) {

            return res.json({
                ok:
                    true,

                already_unlocked:
                    true
            });
        }


        const {
            data:
                existing
        } =
            await supabase
                .from(
                    "contact_unlocks"
                )
                .select(
                    "*"
                )
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
            existing?.id ||
            crypto
                .randomUUID();


        const payload =
            `contact:${orderId}:${crypto
                .randomBytes(
                    8
                )
                .toString(
                    "hex"
                )}`;


        let dbError;


        if (
            existing
        ) {

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

                        status:
                            "pending",

                        telegram_payment_charge_id:
                            null,

                        paid_at:
                            null
                    })
                    .eq(
                        "id",
                        orderId
                    );


            dbError =
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


            dbError =
                error;
        }


        if (
            dbError
        ) {

            return res
                .status(
                    500
                )
                .json({
                    ok:
                        false,

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


            res.json({

                ok:
                    true,

                order_id:
                    orderId,

                amount_stars:
                    CONTACT_UNLOCK_PRICE_STARS,

                invoice_link:
                    invoiceLink
            });

        } catch {

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


            res
                .status(
                    500
                )
                .json({
                    ok:
                        false,

                    error:
                        "invoice_create_failed"
                });
        }
    }
);


// ======================================================
// CONTACT UNLOCK STATUS
// ======================================================

app.post(
    "/contact-unlock/status",
    async (
        req,
        res
    ) => {

        const auth =
            await getDatabaseUser(
                req.body
                    .initData
            );


        if (
            !auth.ok
        ) {

            return res
                .status(
                    auth.status
                )
                .json({
                    ok:
                        false,

                    error:
                        auth.error
                });
        }


        const {
            data:
                order
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
                    req.body
                        .order_id
                )
                .eq(
                    "buyer_telegram_id",
                    auth.user
                        .telegram_id
                )
                .maybeSingle();


        if (
            !order
        ) {

            return res
                .status(
                    404
                )
                .json({
                    ok:
                        false,

                    error:
                        "contact_order_not_found"
                });
        }


        res.json({
            ok:
                true,

            order
        });
    }
);


// ======================================================
// OFFERS CREATE
// ======================================================

app.post(
    "/offers/create",
    async (
        req,
        res
    ) => {

        const auth =
            await getDatabaseUser(
                req.body
                    .initData
            );


        if (
            !auth.ok
        ) {

            return res
                .status(
                    auth.status
                )
                .json({
                    ok:
                        false,

                    error:
                        auth.error
                });
        }


        const buyerId =
            Number(
                auth.user
                    .telegram_id
            );


        const listingId =
            String(
                req.body
                    .listing_id ||
                ""
            ).trim();


        const amount =
            Number(
                req.body
                    .amount
            );


        const message =
            String(
                req.body
                    .message ||
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
                .status(
                    400
                )
                .json({
                    ok:
                        false,

                    error:
                        "invalid_offer"
                });
        }


        const {
            data:
                listing
        } =
            await supabase
                .from(
                    "listings"
                )
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
            !listing ||
            listing.status !==
                "active"
        ) {

            return res
                .status(
                    404
                )
                .json({
                    ok:
                        false,

                    error:
                        "listing_not_available"
                });
        }


        if (
            Number(
                listing
                    .seller_telegram_id
            ) ===
            buyerId
        ) {

            return res
                .status(
                    400
                )
                .json({
                    ok:
                        false,

                    error:
                        "cannot_offer_own_listing"
                });
        }


        if (
            !await buyerHasContactAccess(
                buyerId,
                listingId
            )
        ) {

            return res
                .status(
                    403
                )
                .json({
                    ok:
                        false,

                    error:
                        "contact_unlock_required"
                });
        }


        const {
            data:
                accepted
        } =
            await supabase
                .from(
                    "offers"
                )
                .select(
                    "id"
                )
                .eq(
                    "listing_id",
                    listingId
                )
                .eq(
                    "status",
                    "accepted"
                )
                .limit(
                    1
                );


        if (
            accepted
                ?.length
        ) {

            return res
                .status(
                    409
                )
                .json({
                    ok:
                        false,

                    error:
                        "listing_has_agreement"
                });
        }


        const {
            data:
                existing
        } =
            await supabase
                .from(
                    "offers"
                )
                .select(
                    "id"
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
                .limit(
                    1
                );


        if (
            existing
                ?.length
        ) {

            return res
                .status(
                    409
                )
                .json({
                    ok:
                        false,

                    error:
                        "open_offer_already_exists"
                });
        }


        const {
            data:
                offer,
            error
        } =
            await supabase
                .from(
                    "offers"
                )
                .insert({

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
                })
                .select()
                .single();


        if (
            error
        ) {

            return res
                .status(
                    500
                )
                .json({
                    ok:
                        false,

                    error:
                        "offer_create_failed"
                });
        }


        safeSendMessage(

            listing
                .seller_telegram_id,

            `💬 New offer for @${listing.whatsapp_username}\n\nOffer: $${amount.toLocaleString("en-US")}${message ? `\n\nMessage: ${message}` : ""}\n\nOpen Handle Market → Profile → My Offers.`
        );


        res.json({
            ok:
                true,

            offer
        });
    }
);


// ======================================================
// OFFERS SENT
// ======================================================

app.post(
    "/offers/sent",
    async (
        req,
        res
    ) => {

        const auth =
            await getDatabaseUser(
                req.body
                    .initData
            );


        if (
            !auth.ok
        ) {

            return res
                .status(
                    auth.status
                )
                .json({
                    ok:
                        false,

                    error:
                        auth.error
                });
        }


        const {
            data:
                offers,
            error
        } =
            await supabase
                .from(
                    "offers"
                )
                .select(
                    "*"
                )
                .eq(
                    "buyer_telegram_id",
                    auth.user
                        .telegram_id
                )
                .order(
                    "created_at",
                    {
                        ascending:
                            false
                    }
                );


        if (
            error
        ) {

            return res
                .status(
                    500
                )
                .json({
                    ok:
                        false,

                    error:
                        "offers_load_failed"
                });
        }


        const ids =
            [
                ...new Set(
                    (
                        offers ||
                        []
                    )
                        .map(
                            item =>
                                item
                                    .listing_id
                        )
                )
            ];


        let listings =
            [];


        if (
            ids.length
        ) {

            const {
                data
            } =
                await supabase
                    .from(
                        "listings"
                    )
                    .select(`
                        id,
                        whatsapp_username,
                        asking_price,
                        category
                    `)
                    .in(
                        "id",
                        ids
                    );


            listings =
                data ||
                [];
        }


        const map =
            new Map(
                listings.map(
                    listing => [
                        String(
                            listing.id
                        ),

                        listing
                    ]
                )
            );


        res.json({

            ok:
                true,

            offers:
                (
                    offers ||
                    []
                )
                    .map(
                        offer => ({

                            ...offer,

                            listing:
                                map.get(
                                    String(
                                        offer
                                            .listing_id
                                    )
                                ) ||
                                null
                        })
                    )
        });
    }
);


// ======================================================
// OFFERS RECEIVED
// ======================================================

app.post(
    "/offers/received",
    async (
        req,
        res
    ) => {

        const auth =
            await getDatabaseUser(
                req.body
                    .initData
            );


        if (
            !auth.ok
        ) {

            return res
                .status(
                    auth.status
                )
                .json({
                    ok:
                        false,

                    error:
                        auth.error
                });
        }


        const sellerId =
            Number(
                auth.user
                    .telegram_id
            );


        const {
            data:
                sellerListings
        } =
            await supabase
                .from(
                    "listings"
                )
                .select(`
                    id,
                    whatsapp_username,
                    asking_price,
                    category
                `)
                .eq(
                    "seller_telegram_id",
                    sellerId
                );


        const listingIds =
            (
                sellerListings ||
                []
            )
                .map(
                    item =>
                        item.id
                );


        if (
            !listingIds.length
        ) {

            return res.json({
                ok:
                    true,

                offers:
                    []
            });
        }


        const {
            data:
                offers,
            error
        } =
            await supabase
                .from(
                    "offers"
                )
                .select(
                    "*"
                )
                .in(
                    "listing_id",
                    listingIds
                )
                .order(
                    "created_at",
                    {
                        ascending:
                            false
                    }
                );


        if (
            error
        ) {

            return res
                .status(
                    500
                )
                .json({
                    ok:
                        false,

                    error:
                        "offers_load_failed"
                });
        }


        const buyerIds =
            [
                ...new Set(
                    (
                        offers ||
                        []
                    )
                        .map(
                            item =>
                                item
                                    .buyer_telegram_id
                        )
                )
            ];


        let buyers =
            [];


        if (
            buyerIds.length
        ) {

            const {
                data
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
                )
                    .map(
                        listing => [
                            String(
                                listing.id
                            ),

                            listing
                        ]
                    )
            );


        const buyerMap =
            new Map(
                buyers.map(
                    buyer => [
                        String(
                            buyer
                                .telegram_id
                        ),

                        buyer
                    ]
                )
            );


        res.json({

            ok:
                true,

            offers:
                (
                    offers ||
                    []
                )
                    .map(
                        offer => ({

                            ...offer,

                            listing:
                                listingMap
                                    .get(
                                        String(
                                            offer
                                                .listing_id
                                        )
                                    ) ||
                                null,

                            buyer:
                                buyerMap
                                    .get(
                                        String(
                                            offer
                                                .buyer_telegram_id
                                        )
                                    ) ||
                                null
                        })
                    )
        });
    }
);


// ======================================================
// SELLER OFFER ACTION
// ======================================================

app.post(
    "/offers/seller-action",
    async (
        req,
        res
    ) => {

        const auth =
            await getDatabaseUser(
                req.body
                    .initData
            );


        if (
            !auth.ok
        ) {

            return res
                .status(
                    auth.status
                )
                .json({
                    ok:
                        false,

                    error:
                        auth.error
                });
        }


        const sellerId =
            Number(
                auth.user
                    .telegram_id
            );


        const offerId =
            String(
                req.body
                    .offer_id ||
                ""
            ).trim();


        const action =
            String(
                req.body
                    .action ||
                ""
            ).trim();


        if (
            ![
                "accept",
                "decline",
                "counter"
            ]
                .includes(
                    action
                )
        ) {

            return res
                .status(
                    400
                )
                .json({
                    ok:
                        false,

                    error:
                        "invalid_offer_action"
                });
        }


        const {
            data:
                offer
        } =
            await supabase
                .from(
                    "offers"
                )
                .select(
                    "*"
                )
                .eq(
                    "id",
                    offerId
                )
                .maybeSingle();


        if (
            !offer
        ) {

            return res
                .status(
                    404
                )
                .json({
                    ok:
                        false,

                    error:
                        "offer_not_found"
                });
        }


        const {
            data:
                listing
        } =
            await supabase
                .from(
                    "listings"
                )
                .select(`
                    id,
                    seller_telegram_id,
                    whatsapp_username
                `)
                .eq(
                    "id",
                    offer
                        .listing_id
                )
                .maybeSingle();


        if (
            !listing ||
            Number(
                listing
                    .seller_telegram_id
            ) !==
            sellerId
        ) {

            return res
                .status(
                    403
                )
                .json({
                    ok:
                        false,

                    error:
                        "not_listing_owner"
                });
        }


        if (
            ![
                "pending",
                "countered"
            ]
                .includes(
                    offer.status
                )
        ) {

            return res
                .status(
                    409
                )
                .json({
                    ok:
                        false,

                    error:
                        "offer_not_open"
                });
        }


        const update = {
            updated_at:
                new Date()
                    .toISOString()
        };


        if (
            action ===
            "accept"
        ) {

            update.status =
                "accepted";
        }


        if (
            action ===
            "decline"
        ) {

            update.status =
                "declined";
        }


        if (
            action ===
            "counter"
        ) {

            const counterAmount =
                Number(
                    req.body
                        .counter_amount
                );


            if (
                !Number.isFinite(
                    counterAmount
                ) ||
                counterAmount <=
                    0 ||
                counterAmount >
                    100000000
            ) {

                return res
                    .status(
                        400
                    )
                    .json({
                        ok:
                            false,

                        error:
                            "invalid_counter_amount"
                    });
            }


            update.status =
                "countered";


            update
                .seller_counter_amount =
                counterAmount;
        }


        const {
            data:
                updatedOffer,
            error
        } =
            await supabase
                .from(
                    "offers"
                )
                .update(
                    update
                )
                .eq(
                    "id",
                    offer.id
                )
                .select()
                .single();


        if (
            error
        ) {

            return res
                .status(
                    500
                )
                .json({
                    ok:
                        false,

                    error:
                        "offer_update_failed"
                });
        }


        if (
            action ===
            "accept"
        ) {

            await supabase
                .from(
                    "offers"
                )
                .update({
                    status:
                        "declined",

                    updated_at:
                        new Date()
                            .toISOString()
                })
                .eq(
                    "listing_id",
                    offer
                        .listing_id
                )
                .neq(
                    "id",
                    offer.id
                )
                .in(
                    "status",
                    [
                        "pending",
                        "countered"
                    ]
                );
        }


        let notification =
            `Update for @${listing.whatsapp_username}\n\n`;


        if (
            action ===
            "accept"
        ) {

            notification +=
                `✅ Seller accepted your offer of $${Number(
                    offer.amount
                ).toLocaleString(
                    "en-US"
                )}.`;
        }


        if (
            action ===
            "decline"
        ) {

            notification +=
                "❌ Seller declined your offer.";
        }


        if (
            action ===
            "counter"
        ) {

            notification +=
                `💬 Seller countered with $${Number(
                    update
                        .seller_counter_amount
                ).toLocaleString(
                    "en-US"
                )}.`;
        }


        notification +=
            "\n\nOpen Handle Market → Profile → My Offers.";


        safeSendMessage(
            offer
                .buyer_telegram_id,
            notification
        );


        res.json({
            ok:
                true,

            offer:
                updatedOffer
        });
    }
);


// ======================================================
// BUYER OFFER ACTION
// ======================================================

app.post(
    "/offers/buyer-action",
    async (
        req,
        res
    ) => {

        const auth =
            await getDatabaseUser(
                req.body
                    .initData
            );


        if (
            !auth.ok
        ) {

            return res
                .status(
                    auth.status
                )
                .json({
                    ok:
                        false,

                    error:
                        auth.error
                });
        }


        const buyerId =
            Number(
                auth.user
                    .telegram_id
            );


        const offerId =
            String(
                req.body
                    .offer_id ||
                ""
            ).trim();


        const action =
            String(
                req.body
                    .action ||
                ""
            ).trim();


        const {
            data:
                offer
        } =
            await supabase
                .from(
                    "offers"
                )
                .select(
                    "*"
                )
                .eq(
                    "id",
                    offerId
                )
                .eq(
                    "buyer_telegram_id",
                    buyerId
                )
                .maybeSingle();


        if (
            !offer
        ) {

            return res
                .status(
                    404
                )
                .json({
                    ok:
                        false,

                    error:
                        "offer_not_found"
                });
        }


        const {
            data:
                listing
        } =
            await supabase
                .from(
                    "listings"
                )
                .select(`
                    seller_telegram_id,
                    whatsapp_username
                `)
                .eq(
                    "id",
                    offer
                        .listing_id
                )
                .maybeSingle();


        if (
            action ===
            "cancel"
        ) {

            if (
                ![
                    "pending",
                    "countered"
                ]
                    .includes(
                        offer.status
                    )
            ) {

                return res
                    .status(
                        409
                    )
                    .json({
                        ok:
                            false,

                        error:
                            "offer_not_open"
                    });
            }


            await supabase
                .from(
                    "offers"
                )
                .update({
                    status:
                        "cancelled",

                    updated_at:
                        new Date()
                            .toISOString()
                })
                .eq(
                    "id",
                    offer.id
                );


            if (
                listing
            ) {

                safeSendMessage(

                    listing
                        .seller_telegram_id,

                    `↩️ Buyer cancelled their offer for @${listing.whatsapp_username}.`
                );
            }


            return res.json({
                ok:
                    true
            });
        }


        if (
            action ===
            "accept_counter"
        ) {

            if (
                offer.status !==
                    "countered" ||
                !offer
                    .seller_counter_amount
            ) {

                return res
                    .status(
                        409
                    )
                    .json({
                        ok:
                            false,

                        error:
                            "counter_not_available"
                    });
            }


            const {
                data:
                    updated,
                error
            } =
                await supabase
                    .from(
                        "offers"
                    )
                    .update({
                        status:
                            "accepted",

                        updated_at:
                            new Date()
                                .toISOString()
                    })
                    .eq(
                        "id",
                        offer.id
                    )
                    .select()
                    .single();


            if (
                error
            ) {

                return res
                    .status(
                        500
                    )
                    .json({
                        ok:
                            false,

                        error:
                            "offer_update_failed"
                    });
            }


            await supabase
                .from(
                    "offers"
                )
                .update({
                    status:
                        "declined",

                    updated_at:
                        new Date()
                            .toISOString()
                })
                .eq(
                    "listing_id",
                    offer
                        .listing_id
                )
                .neq(
                    "id",
                    offer.id
                )
                .in(
                    "status",
                    [
                        "pending",
                        "countered"
                    ]
                );


            if (
                listing
            ) {

                safeSendMessage(

                    listing
                        .seller_telegram_id,

                    `✅ Buyer accepted your counter offer for @${listing.whatsapp_username}: $${Number(
                        offer
                            .seller_counter_amount
                    ).toLocaleString(
                        "en-US"
                    )}.`
                );
            }


            return res.json({
                ok:
                    true,

                offer:
                    updated
            });
        }


        res
            .status(
                400
            )
            .json({
                ok:
                    false,

                error:
                    "invalid_offer_action"
            });
    }
);


// ======================================================
// ADMIN
// ======================================================

app.post(
    "/admin/pending-listings",
    async (
        req,
        res
    ) => {

        const admin =
            await requireAdmin(
                req.body
                    .initData
            );


        if (
            !admin.ok
        ) {

            return res
                .status(
                    admin.status
                )
                .json({
                    ok:
                        false,

                    error:
                        admin.error
                });
        }


        const {
            data
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


        res.json({
            ok:
                true,

            listings:
                data ||
                []
        });
    }
);


app.post(
    "/admin/listing-status",
    async (
        req,
        res
    ) => {

        const admin =
            await requireAdmin(
                req.body
                    .initData
            );


        if (
            !admin.ok
        ) {

            return res
                .status(
                    admin.status
                )
                .json({
                    ok:
                        false,

                    error:
                        admin.error
                });
        }


        const status =
            req.body
                .status;


        if (
            ![
                "active",
                "rejected"
            ]
                .includes(
                    status
                )
        ) {

            return res
                .status(
                    400
                )
                .json({
                    ok:
                        false,

                    error:
                        "invalid_admin_action"
                });
        }


        const {
            data
        } =
            await supabase
                .from(
                    "listings"
                )
                .update({
                    status,

                    updated_at:
                        new Date()
                            .toISOString()
                })
                .eq(
                    "id",
                    req.body
                        .listing_id
                )
                .eq(
                    "status",
                    "pending"
                )
                .select()
                .maybeSingle();


        if (
            !data
        ) {

            return res
                .status(
                    404
                )
                .json({
                    ok:
                        false,

                    error:
                        "pending_listing_not_found"
                });
        }


        res.json({
            ok:
                true,

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

            return res
                .sendStatus(
                    403
                );
        }


        const update =
            req.body;


        res.sendStatus(
            200
        );


        try {

            // ==================================================
            // PRE CHECKOUT
            // ==================================================

            if (
                update
                    .pre_checkout_query
            ) {

                const query =
                    update
                        .pre_checkout_query;


                const payload =
                    String(
                        query
                            .invoice_payload ||
                        ""
                    );


                // LISTING

                if (
                    payload
                        .startsWith(
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
                            .select(
                                "*"
                            )
                            .eq(
                                "invoice_payload",
                                payload
                            )
                            .maybeSingle();


                    const valid =
                        Boolean(
                            order
                        ) &&
                        order.status ===
                            "created" &&
                        Number(
                            query
                                .from.id
                        ) ===
                            Number(
                                order
                                    .seller_telegram_id
                            ) &&
                        query.currency ===
                            "XTR" &&
                        Number(
                            query
                                .total_amount
                        ) ===
                            Number(
                                order
                                    .amount_stars
                            );


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


                // CONTACT

                if (
                    payload
                        .startsWith(
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
                            .select(
                                "*"
                            )
                            .eq(
                                "invoice_payload",
                                payload
                            )
                            .maybeSingle();


                    let valid =
                        Boolean(
                            order
                        ) &&
                        order.status ===
                            "pending" &&
                        Number(
                            query
                                .from.id
                        ) ===
                            Number(
                                order
                                    .buyer_telegram_id
                            ) &&
                        query.currency ===
                            "XTR" &&
                        Number(
                            query
                                .total_amount
                        ) ===
                            Number(
                                order
                                    .amount_stars
                            );


                    if (
                        valid
                    ) {

                        const {
                            data:
                                listing
                        } =
                            await supabase
                                .from(
                                    "listings"
                                )
                                .select(
                                    "status"
                                )
                                .eq(
                                    "id",
                                    order
                                        .listing_id
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


                // WANTED

                if (
                    payload
                        .startsWith(
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
                            .select(
                                "*"
                            )
                            .eq(
                                "invoice_payload",
                                payload
                            )
                            .maybeSingle();


                    let valid =
                        Boolean(
                            order
                        ) &&
                        order.status ===
                            "created" &&
                        Number(
                            query
                                .from.id
                        ) ===
                            Number(
                                order
                                    .buyer_telegram_id
                            ) &&
                        query.currency ===
                            "XTR" &&
                        Number(
                            query
                                .total_amount
                        ) ===
                            Number(
                                order
                                    .amount_stars
                            );


                    if (
                        valid
                    ) {

                        const {
                            data:
                                duplicate
                        } =
                            await supabase
                                .from(
                                    "wanted_requests"
                                )
                                .select(
                                    "id"
                                )
                                .eq(
                                    "buyer_telegram_id",
                                    order
                                        .buyer_telegram_id
                                )
                                .eq(
                                    "desired_username",
                                    order
                                        .desired_username
                                )
                                .eq(
                                    "status",
                                    "active"
                                )
                                .limit(
                                    1
                                );


                        if (
                            duplicate
                                ?.length
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
                                    "This Wanted payment is no longer valid."
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
                message
                    ?.successful_payment;


            if (
                !payment
            ) {

                return;
            }


            const payload =
                String(
                    payment
                        .invoice_payload ||
                    ""
                );


            const payerId =
                Number(
                    message
                        .from?.id
                );


            const chargeId =
                payment
                    .telegram_payment_charge_id;


            // ==================================================
            // LISTING PAYMENT
            // ==================================================

            if (
                payload
                    .startsWith(
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
                        .select(
                            "*"
                        )
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
                    ]
                        .includes(
                            order.status
                        )
                ) {

                    return;
                }


                const valid =
                    payerId ===
                        Number(
                            order
                                .seller_telegram_id
                        ) &&
                    payment.currency ===
                        "XTR" &&
                    Number(
                        payment
                            .total_amount
                    ) ===
                        Number(
                            order
                                .amount_stars
                        );


                if (
                    !valid
                ) {

                    return;
                }


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
                        data:
                            existingListing
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
                        !existingListing
                    ) {

                        const {
                            error
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
                            error
                        ) {

                            throw error;
                        }
                    }


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

                } catch (error) {

                    console.error(
                        "Listing fulfillment failed:",
                        error
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

                    } catch (
                        refundError
                    ) {

                        console.error(
                            refundError
                        );
                    }
                }


                return;
            }


            // ==================================================
            // CONTACT PAYMENT
            // ==================================================

            if (
                payload
                    .startsWith(
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
                        .select(
                            "*"
                        )
                        .eq(
                            "invoice_payload",
                            payload
                        )
                        .maybeSingle();


                if (
                    !order ||
                    [
                        "paid",
                        "refunded"
                    ]
                        .includes(
                            order.status
                        )
                ) {

                    return;
                }


                const valid =
                    payerId ===
                        Number(
                            order
                                .buyer_telegram_id
                        ) &&
                    payment.currency ===
                        "XTR" &&
                    Number(
                        payment
                            .total_amount
                    ) ===
                        Number(
                            order
                                .amount_stars
                        );


                if (
                    !valid
                ) {

                    return;
                }


                const {
                    data:
                        listing
                } =
                    await supabase
                        .from(
                            "listings"
                        )
                        .select(
                            "status"
                        )
                        .eq(
                            "id",
                            order
                                .listing_id
                        )
                        .maybeSingle();


                if (
                    !listing ||
                    listing.status !==
                        "active"
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

                    } catch {}


                    return;
                }


                const {
                    error
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


                if (
                    error
                ) {

                    console.error(
                        "Unlock error:",
                        error
                    );
                }


                return;
            }


            // ==================================================
            // WANTED PAYMENT
            // ==================================================

            if (
                payload
                    .startsWith(
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
                        .select(
                            "*"
                        )
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
                    ]
                        .includes(
                            order.status
                        )
                ) {

                    return;
                }


                const valid =
                    payerId ===
                        Number(
                            order
                                .buyer_telegram_id
                        ) &&
                    payment.currency ===
                        "XTR" &&
                    Number(
                        payment
                            .total_amount
                    ) ===
                        Number(
                            order
                                .amount_stars
                        );


                if (
                    !valid
                ) {

                    return;
                }


                await supabase
                    .from(
                        "wanted_payment_orders"
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
                        data:
                            duplicate
                    } =
                        await supabase
                            .from(
                                "wanted_requests"
                            )
                            .select(
                                "id"
                            )
                            .eq(
                                "buyer_telegram_id",
                                order
                                    .buyer_telegram_id
                            )
                            .eq(
                                "desired_username",
                                order
                                    .desired_username
                            )
                            .eq(
                                "status",
                                "active"
                            )
                            .limit(
                                1
                            );


                    if (
                        duplicate
                            ?.length
                    ) {

                        throw new Error(
                            "wanted_duplicate_after_payment"
                        );
                    }


                    const {
                        error
                    } =
                        await supabase
                            .from(
                                "wanted_requests"
                            )
                            .insert({

                                id:
                                    order.id,

                                buyer_telegram_id:
                                    order
                                        .buyer_telegram_id,

                                desired_username:
                                    order
                                        .desired_username,

                                budget:
                                    order
                                        .budget,

                                currency:
                                    "USD",

                                category:
                                    order
                                        .category,

                                description:
                                    order
                                        .description,

                                status:
                                    "active"
                            });


                    if (
                        error
                    ) {

                        throw error;
                    }


                    await supabase
                        .from(
                            "wanted_payment_orders"
                        )
                        .update({

                            status:
                                "completed",

                            wanted_post_id:
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
                        "Wanted published:",
                        order.id
                    );

                } catch (error) {

                    console.error(
                        "Wanted fulfillment failed:",
                        error
                    );


                    await supabase
                        .from(
                            "wanted_requests"
                        )
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
                                "wanted_payment_orders"
                            )
                            .update({
                                status:
                                    "refunded"
                            })
                            .eq(
                                "id",
                                order.id
                            );

                    } catch (
                        refundError
                    ) {

                        console.error(
                            "Wanted refund failed:",
                            refundError.message
                        );
                    }
                }


                return;
            }

        } catch (error) {

            console.error(
                "Webhook error:",
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

        console.error(
            error
        );


        res
            .status(
                400
            )
            .json({
                ok:
                    false,

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


        setupTelegramWebhook()
            .catch(
                console.error
            );
    }
);