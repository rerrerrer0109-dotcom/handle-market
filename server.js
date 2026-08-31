const express = require("express");
const crypto = require("crypto");

const app = express();

app.use(express.json({
    limit: "50kb"
}));


// CORS — разрешаем только нашу Mini App
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


const BOT_TOKEN = process.env.BOT_TOKEN;


// Проверка Telegram initData
function validateInitData(initData) {

    if (!BOT_TOKEN) {
        return {
            valid: false,
            error: "server_not_configured"
        };
    }

    const params = new URLSearchParams(initData);

    const receivedHash = params.get("hash");

    if (!receivedHash) {
        return {
            valid: false,
            error: "hash_missing"
        };
    }

    params.delete("hash");


    const dataCheckString = [...params.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");


    const secretKey = crypto
        .createHmac("sha256", "WebAppData")
        .update(BOT_TOKEN)
        .digest();


    const calculatedHash = crypto
        .createHmac("sha256", secretKey)
        .update(dataCheckString)
        .digest("hex");


    try {

        const receivedBuffer =
            Buffer.from(receivedHash, "hex");

        const calculatedBuffer =
            Buffer.from(calculatedHash, "hex");


        if (
            receivedBuffer.length !== calculatedBuffer.length ||
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

    } catch {

        return {
            valid: false,
            error: "invalid_hash"
        };

    }


    // Проверяем свежесть Telegram авторизации
    const authDate =
        Number(params.get("auth_date"));

    const now =
        Math.floor(Date.now() / 1000);

    const MAX_AGE_SECONDS = 3600;


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


    let user = null;

    try {

        const rawUser =
            params.get("user");

        if (rawUser) {
            user = JSON.parse(rawUser);
        }

    } catch {

        return {
            valid: false,
            error: "invalid_user"
        };

    }


    if (!user || !user.id) {

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



// Проверка сервера
app.get("/health", (req, res) => {

    res.json({
        ok: true,
        service: "Handle Market API"
    });

});



// Telegram login
app.post("/auth", (req, res) => {

    const {
        initData
    } = req.body;


    if (!initData) {

        return res.status(400).json({
            ok: false,
            error: "initData_missing"
        });

    }


    const result =
        validateInitData(initData);


    if (!result.valid) {

        return res.status(401).json({
            ok: false,
            error: result.error
        });

    }


    const user = result.user;


    // Отдаём Mini App только необходимые данные
    res.json({

        ok: true,

        user: {
            id: user.id,
            first_name: user.first_name || "",
            last_name: user.last_name || "",
            username: user.username || null,
            language_code: user.language_code || null,
            photo_url: user.photo_url || null
        }

    });

});



// JSON-ошибка вместо HTML при плохом JSON
app.use((error, req, res, next) => {

    console.error(error);

    res.status(400).json({
        ok: false,
        error: "bad_request"
    });

});


const PORT =
    process.env.PORT || 3000;


app.listen(PORT, () => {

    console.log(
        `Handle Market API running on port ${PORT}`
    );

});