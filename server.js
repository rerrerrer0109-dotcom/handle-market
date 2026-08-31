const express = require("express");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(
    express.json({
        limit: "50kb"
    })
);


// ============================================
// CORS
// ============================================

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


// ============================================
// ENVIRONMENT
// ============================================

const BOT_TOKEN =
    process.env.BOT_TOKEN;

const SUPABASE_URL =
    process.env.SUPABASE_URL;

const SUPABASE_SECRET_KEY =
    process.env.SUPABASE_SECRET_KEY;


// ============================================
// SUPABASE
// ============================================

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


// ============================================
// TELEGRAM INIT DATA VALIDATION
// ============================================

function validateInitData(initData) {

    if (!BOT_TOKEN) {

        return {
            valid: false,
            error: "server_not_configured"
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


    // ========================================
    // AUTH DATE
    // ========================================

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
            error: "initData_expired"
        };

    }


    // ========================================
    // TELEGRAM USER
    // ========================================

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


// ============================================
// HEALTH
// ============================================

app.get(
    "/health",

    async (req, res) => {

        if (!supabase) {

            return res
                .status(500)
                .json({
                    ok: false,
                    service:
                        "Handle Market API",
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

            console.error(
                "Supabase health error:",
                error
            );


            return res
                .status(500)
                .json({
                    ok: false,
                    service:
                        "Handle Market API",
                    database:
                        "error"
                });

        }


        res.json({
            ok: true,
            service:
                "Handle Market API",
            database:
                "connected"
        });

    }
);


// ============================================
// TELEGRAM AUTH
// ============================================

app.post(
    "/auth",

    async (req, res) => {

        const {
            initData
        } = req.body;


        if (!initData) {

            return res
                .status(400)
                .json({
                    ok: false,
                    error:
                        "initData_missing"
                });

        }


        const result =
            validateInitData(initData);


        if (!result.valid) {

            return res
                .status(401)
                .json({
                    ok: false,
                    error:
                        result.error
                });

        }


        if (!supabase) {

            return res
                .status(500)
                .json({
                    ok: false,
                    error:
                        "database_not_configured"
                });

        }


        const telegramUser =
            result.user;


        // ====================================
        // CREATE OR UPDATE USER IN DATABASE
        // ====================================

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
                new Date().toISOString()

        };


        const {
            data: databaseUser,
            error: databaseError
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


        if (databaseError) {

            console.error(
                "Database error:",
                databaseError
            );


            return res
                .status(500)
                .json({
                    ok: false,
                    error:
                        "database_error"
                });

        }


        if (
            databaseUser.is_blocked
        ) {

            return res
                .status(403)
                .json({
                    ok: false,
                    error:
                        "account_blocked"
                });

        }


        // ====================================
        // RESPONSE
        // ====================================

        res.json({

            ok: true,

            user: {

                id:
                    databaseUser.telegram_id,

                first_name:
                    databaseUser.first_name,

                last_name:
                    databaseUser.last_name,

                username:
                    databaseUser.telegram_username,

                language_code:
                    databaseUser.language_code,

                photo_url:
                    databaseUser.photo_url

            }

        });

    }
);


// ============================================
// BAD JSON / OTHER ERRORS
// ============================================

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


// ============================================
// START SERVER
// ============================================

const PORT =
    process.env.PORT ||
    3000;


app.listen(
    PORT,

    () => {

        console.log(
            `Handle Market API running on port ${PORT}`
        );

    }
);

