const express = require("express");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(
    express.json({
        limit: "50kb"
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
// ENV
// ======================================================

const BOT_TOKEN = process.env.BOT_TOKEN;

const SUPABASE_URL =
    process.env.SUPABASE_URL;

const SUPABASE_SECRET_KEY =
    process.env.SUPABASE_SECRET_KEY;


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
// TELEGRAM INIT DATA VALIDATION
// ======================================================

function validateInitData(initData) {

    if (!BOT_TOKEN) {

        return {
            valid: false,
            error: "server_not_configured"
        };

    }


    if (
        !initData ||
        typeof initData !== "string"
    ) {

        return {
            valid: false,
            error: "initData_missing"
        };

    }


    const params =
        new URLSearchParams(initData);


    const receivedHash =
        params.get("hash");


    if (!receivedHash) {

        return {
            valid: false,
            error: "hash_missing"
        };

    }


    params.delete("hash");


    const dataCheckString =
        [...params.entries()]
            .sort(([a], [b]) =>
                a.localeCompare(b)
            )
            .map(([key, value]) =>
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
                error: "invalid_signature"
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
                error: "invalid_signature"
            };

        }

    }

    catch {

        return {
            valid: false,
            error: "invalid_hash"
        };

    }


    // ==================================================
    // CHECK AUTH_DATE
    // ==================================================

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
        now - authDate > MAX_AGE_SECONDS ||
        authDate > now + 30
    ) {

        return {
            valid: false,
            error: "initData_expired"
        };

    }


    // ==================================================
    // TELEGRAM USER
    // ==================================================

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
            error: "invalid_user"
        };

    }


    if (
        !user ||
        !user.id
    ) {

        return {
            valid: false,
            error: "user_missing"
        };

    }


    return {
        valid: true,
        user
    };

}


// ======================================================
// CREATE / UPDATE USER
// ======================================================

async function getDatabaseUser(initData) {

    const result =
        validateInitData(initData);


    if (!result.valid) {

        return {
            ok: false,
            status: 401,
            error: result.error
        };

    }


    if (!supabase) {

        return {
            ok: false,
            status: 500,
            error: "database_not_configured"
        };

    }


    const telegramUser =
        result.user;


    const userRecord = {

        telegram_id:
            telegramUser.id,

        first_name:
            telegramUser.first_name || "",

        last_name:
            telegramUser.last_name || "",

        telegram_username:
            telegramUser.username || null,

        language_code:
            telegramUser.language_code || null,

        photo_url:
            telegramUser.photo_url || null,

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
            "User database error:",
            error
        );


        return {
            ok: false,
            status: 500,
            error: "database_error"
        };

    }


    if (data.is_blocked) {

        return {
            ok: false,
            status: 403,
            error: "account_blocked"
        };

    }


    return {
        ok: true,
        user: data
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


// ======================================================
// DATABASE HEALTH
// ======================================================

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


        try {

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


            return res.json({
                ok: true,
                database:
                    "connected"
            });

        }

        catch (error) {

            console.error(error);


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
                    user.photo_url

            }

        });

    }
);


// ======================================================
// CREATE LISTING
// ======================================================

app.post(
    "/listings",

    async (req, res) => {

        const {

            initData,
            whatsapp_username,
            asking_price,
            category,
            description,
            contact_type,
            contact_value

        } = req.body;


        // ----------------------------------------------
        // Authenticate Telegram user
        // ----------------------------------------------

        const auth =
            await getDatabaseUser(
                initData
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


        const seller =
            auth.user;


        // ----------------------------------------------
        // Username
        // ----------------------------------------------

        let username =
            String(
                whatsapp_username || ""
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
            username.length > 64
        ) {

            return res
                .status(400)
                .json({
                    ok: false,
                    error:
                        "invalid_username"
                });

        }


        if (
            !/^[a-zA-Z0-9._]+$/
                .test(username)
        ) {

            return res
                .status(400)
                .json({
                    ok: false,
                    error:
                        "invalid_username_characters"
                });

        }


        // ----------------------------------------------
        // Price
        // ----------------------------------------------

        const price =
            Number(asking_price);


        if (
            !Number.isFinite(price) ||
            price <= 0 ||
            price > 100000000
        ) {

            return res
                .status(400)
                .json({
                    ok: false,
                    error:
                        "invalid_price"
                });

        }


        // ----------------------------------------------
        // Category
        // ----------------------------------------------

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


        const safeCategory =
            allowedCategories.includes(
                category
            )
                ? category
                : "Other";


        // ----------------------------------------------
        // Description
        // ----------------------------------------------

        const safeDescription =
            String(
                description || ""
            )
            .trim()
            .slice(0, 500);


        // ----------------------------------------------
        // Contact
        // ----------------------------------------------

        const allowedContactTypes = [
            "telegram",
            "email",
            "other"
        ];


        if (
            !allowedContactTypes.includes(
                contact_type
            )
        ) {

            return res
                .status(400)
                .json({
                    ok: false,
                    error:
                        "invalid_contact_type"
                });

        }


        const safeContactValue =
            String(
                contact_value || ""
            )
            .trim()
            .slice(0, 200);


        if (!safeContactValue) {

            return res
                .status(400)
                .json({
                    ok: false,
                    error:
                        "contact_required"
                });

        }


        // ----------------------------------------------
        // Check duplicate active/pending listing
        // ----------------------------------------------

        const {
            data: existingListing,
            error: existingError
        } =
            await supabase
                .from("listings")
                .select(
                    "id,status"
                )
                .eq(
                    "seller_telegram_id",
                    seller.telegram_id
                )
                .ilike(
                    "whatsapp_username",
                    username
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

            console.error(
                "Duplicate check error:",
                existingError
            );

        }


        if (
            existingListing &&
            existingListing.length > 0
        ) {

            return res
                .status(409)
                .json({
                    ok: false,
                    error:
                        "listing_already_exists"
                });

        }


        // ----------------------------------------------
        // Create listing
        // ----------------------------------------------

        const {
            data: listing,
            error: listingError
        } =
            await supabase
                .from("listings")
                .insert({

                    seller_telegram_id:
                        seller.telegram_id,

                    whatsapp_username:
                        username,

                    asking_price:
                        price,

                    currency:
                        "USD",

                    category:
                        safeCategory,

                    description:
                        safeDescription,

                    status:
                        "pending",

                    verification_status:
                        "unverified",

                    is_featured:
                        false

                })
                .select()
                .single();


        if (listingError) {

            console.error(
                "Listing create error:",
                listingError
            );


            return res
                .status(500)
                .json({
                    ok: false,
                    error:
                        "listing_create_failed"
                });

        }


        // ----------------------------------------------
        // Store seller contact separately
        // ----------------------------------------------

        const {
            error: contactError
        } =
            await supabase
                .from("listing_contacts")
                .insert({

                    listing_id:
                        listing.id,

                    contact_type:
                        contact_type,

                    contact_value:
                        safeContactValue

                });


        if (contactError) {

            console.error(
                "Contact create error:",
                contactError
            );


            // Remove incomplete listing
            await supabase
                .from("listings")
                .delete()
                .eq(
                    "id",
                    listing.id
                );


            return res
                .status(500)
                .json({
                    ok: false,
                    error:
                        "contact_create_failed"
                });

        }


        return res.json({

            ok: true,

            listing: {

                id:
                    listing.id,

                whatsapp_username:
                    listing.whatsapp_username,

                asking_price:
                    listing.asking_price,

                category:
                    listing.category,

                status:
                    listing.status,

                verification_status:
                    listing.verification_status

            }

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
                .select(
                    `
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
                    `
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
// CONTACT INFORMATION IS NEVER RETURNED HERE
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
                .select(
                    `
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
                    `
                )
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

            console.error(
                "Marketplace load error:",
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

    }
);