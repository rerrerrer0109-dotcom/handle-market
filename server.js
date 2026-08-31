const express = require("express");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json({ limit: "100kb" }));

const ALLOWED_ORIGIN = "https://rerrerrer0109-dotcom.github.io";
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const LISTING_PRICE_STARS = Number(process.env.LISTING_PRICE_STARS || "1");
const CONTACT_UNLOCK_PRICE_STARS = Number(process.env.CONTACT_UNLOCK_PRICE_STARS || "1");
const WANTED_PRICE_STARS = Number(process.env.WANTED_PRICE_STARS || "1");
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

const PROMOTION_TEST_MODE =
  String(process.env.PROMOTION_TEST_MODE || "false").toLowerCase() === "true";

const PROMOTION_TEST_PRICE_STARS = Math.max(
  1,
  Number(process.env.PROMOTION_TEST_PRICE_STARS || "1")
);

const PROMOTION_PRICES = {
  bump: {
    24: Math.max(1, Number(process.env.BUMP_24H_STARS || "1")),
    72: Math.max(1, Number(process.env.BUMP_72H_STARS || "1")),
    168: Math.max(1, Number(process.env.BUMP_168H_STARS || "1"))
  },
  hot: {
    24: Math.max(1, Number(process.env.HOT_24H_STARS || "1")),
    72: Math.max(1, Number(process.env.HOT_72H_STARS || "1")),
    168: Math.max(1, Number(process.env.HOT_168H_STARS || "1"))
  },
  vip: {
    24: Math.max(1, Number(process.env.VIP_24H_STARS || "1")),
    72: Math.max(1, Number(process.env.VIP_72H_STARS || "1")),
    168: Math.max(1, Number(process.env.VIP_168H_STARS || "1"))
  }
};

let supabase = null;

if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
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

const sleep = ms =>
  new Promise(resolve =>
    setTimeout(resolve, ms)
  );

const nowIso = () =>
  new Date().toISOString();


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

      currency:
        "XTR",

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

      if (attempt < 6) {
        await sleep(
          attempt *
          5000
        );
      }
    }
  }
}


function validateInitData(
  initData
) {
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
    new URLSearchParams(
      initData
    );

  const receivedHash =
    params.get("hash");

  if (!receivedHash) {
    return {
      valid: false,
      error: "hash_missing"
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
      .digest(
        "hex"
      );

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
      a.length !== b.length ||
      !crypto.timingSafeEqual(
        a,
        b
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
    now - authDate > 3600 ||
    authDate > now + 30
  ) {
    return {
      valid: false,
      error: "initData_expired"
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
      error: "invalid_user"
    };
  }

  if (!user?.id) {
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
      error: "database_error"
    };
  }

  if (
    data.is_blocked
  ) {
    return {
      ok: false,
      status: 403,
      error: "account_blocked"
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
      error: "seller_profile_error"
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
      error: "admin_required"
    };
  }

  return auth;
}


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
      error: "invalid_username"
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
      error: "invalid_price"
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
    !contactTypes.includes(
      body.contact_type
    )
  ) {
    return {
      ok: false,
      error: "invalid_contact_type"
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
      error: "contact_required"
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


async function closeOtherOpenOffers(
  listingId,
  acceptedOfferId
) {
  const {
    data: openOffers
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

  return openOffers || [];
}


async function closeListingOpenOffers(
  listingId,
  message
) {
  const {
    data: offers
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
    !PROMOTION_PRICES[type] ||
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
    : PROMOTION_PRICES[type][
        Number(
          durationHours
        )
      ];
}


function promotionPricesForClient() {
  const out = {};

  for (
    const type of [
      "bump",
      "hot",
      "vip"
    ]
  ) {
    out[type] = {};

    for (
      const hours of [
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


function isFuture(
  value
) {
  if (!value) {
    return false;
  }

  const time =
    new Date(
      value
    ).getTime();

  return (
    Number.isFinite(
      time
    ) &&
    time > Date.now()
  );
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
    return new Date(
      listing.vip_promoted_at ||
      listing.created_at ||
      0
    ).getTime();
  }

  if (
    meta.promotion_type ===
    "hot"
  ) {
    return new Date(
      listing.hot_promoted_at ||
      listing.created_at ||
      0
    ).getTime();
  }

  if (
    meta.promotion_type ===
    "bump"
  ) {
    return new Date(
      listing.bump_promoted_at ||
      listing.created_at ||
      0
    ).getTime();
  }

  return new Date(
    listing.created_at ||
    0
  ).getTime();
}


function sortListingsByPromotion(
  listings
) {
  return [
    ...(listings || [])
  ].sort(
    (a, b) => {
      const aRank =
        promotionMeta(
          a
        ).promotion_rank;

      const bRank =
        promotionMeta(
          b
        ).promotion_rank;

      if (
        bRank !== aRank
      ) {
        return (
          bRank -
          aRank
        );
      }

      const bTime =
        promotionSortTime(
          b
        );

      const aTime =
        promotionSortTime(
          a
        );

      if (
        bTime !== aTime
      ) {
        return (
          bTime -
          aTime
        );
      }

      return (
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

  return {
    ...listing,

    promotion_type:
      meta.promotion_type,

    promotion_until:
      meta.promotion_until
  };
}


async function attachPublicSellerProfiles(
  listings
) {
  const rows =
    listings || [];

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
      data || [];
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

      delete copy.seller_telegram_id;

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
    data: allSellerListings
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
            count: "exact",
            head: true
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
    count: activeWanted
  } =
    await supabase
      .from(
        "wanted_requests"
      )
      .select(
        "id",
        {
          count: "exact",
          head: true
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
    data: activeListings
  } =
    await supabase
      .from("listings")
      .select(
        "id,seller_telegram_id,whatsapp_username,asking_price,currency,category,description,is_featured,views_count,created_at,bump_until,hot_until,vip_until,bump_promoted_at,hot_promoted_at,vip_promoted_at"
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
      .limit(
        100
      );

  const sorted =
    sortListingsByPromotion(
      activeListings ||
      []
    ).map(
      row => {
        const copy =
          withPromotion(
            row
          );

        delete copy.seller_telegram_id;

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


async function notifyAdmins(
  text
) {
  const {
    data: admins
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

  for (
    const admin of
    admins || []
  ) {
    safeSendMessage(
      admin.telegram_id,
      text
    );
  }
}


/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/health",
  (req, res) =>
    res.json(
      {
        ok: true,
        service:
          "Handle Market API",

        version:
          "v14-promote"
      }
    )
);


app.get(
  "/db-health",
  async (
    req,
    res
  ) => {
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
        .json(
          {
            ok: false,
            error:
              auth.error
          }
        );
    }

    const user =
      auth.user;

    const profile =
      user.seller_profile;

    res.json(
      {
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
            ),

          seller_profile_id:
            profile?.id ||
            null,

          seller_profile_bio:
            profile?.bio ||
            "",

          seller_profile_is_public:
            Boolean(
              profile?.is_public
            )
        },

        listing_price_stars:
          LISTING_PRICE_STARS,

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
   LISTING PAYMENT
========================================================= */

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

    if (!validation.ok) {
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
      data: existing,
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
          `Submit @${input.username} for marketplace moderation`,
          payload,
          LISTING_PRICE_STARS
        );

      res.json(
        {
          ok: true,

          order_id:
            orderId,

          amount_stars:
            LISTING_PRICE_STARS,

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
      data: order,
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
   LISTINGS
========================================================= */

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
          "id,whatsapp_username,asking_price,currency,category,description,status,verification_status,is_featured,is_paused,is_frozen,frozen_reason,frozen_at,created_at,bump_until,hot_until,vip_until,bump_promoted_at,hot_promoted_at,vip_promoted_at"
        )
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
        .json(
          {
            ok: false,
            error:
              "listings_load_failed"
          }
        );
    }

    res.json(
      {
        ok: true,

        seller_profile_id:
          auth.user
            .seller_profile
            ?.id ||
          null,

        listings:
          (
            data ||
            []
          ).map(
            withPromotion
          )
      }
    );
  }
);


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
        .from("listings")
        .select(
          "id,seller_telegram_id,whatsapp_username,asking_price,currency,category,description,is_featured,views_count,created_at,bump_until,hot_until,vip_until,bump_promoted_at,hot_promoted_at,vip_promoted_at"
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

    const sorted =
      sortListingsByPromotion(
        data ||
        []
      );

    const publicRows =
      await attachPublicSellerProfiles(
        sorted
      );

    res.json(
      {
        ok: true,

        listings:
          publicRows.slice(
            0,
            100
          )
      }
    );
  }
);


app.post(
  "/listing/manage/edit",
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
      !Number.isFinite(
        price
      ) ||
      price <= 0 ||
      price > 100000000
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


app.post(
  "/listing/manage/pause",
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


app.post(
  "/listing/manage/remove",
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
          "id,seller_telegram_id,whatsapp_username,status,is_frozen"
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
   PROMOTION PAYMENT
========================================================= */

app.post(
  "/promotion-payment/create",
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
          "id,seller_telegram_id,whatsapp_username,status,is_paused,is_frozen"
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
      listing.status !==
      "active" ||
      listing.is_paused ||
      listing.is_frozen
    ) {
      return res
        .status(409)
        .json(
          {
            ok: false,
            error:
              "listing_not_promotable"
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

    try {
      const invoiceLink =
        await createStarsInvoice(
          `${labels[type]} Listing`,
          `${labels[type]} promotion for @${listing.whatsapp_username} · ${durationLabel}`,
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
            durationHours
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
          "id,seller_telegram_id,status,is_paused,is_frozen"
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

    if (!unlocked) {
      unlocked =
        await buyerHasContactAccess(
          buyerId,
          listingId
        );
    }

    if (
      !unlocked &&
      (
        listing.status !==
        "active" ||
        listing.is_paused ||
        listing.is_frozen
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

    if (!unlocked) {
      return res.json(
        {
          ok: true,
          unlocked:
            false,

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

        unlocked:
          true,

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


app.post(
  "/contact-unlock/create",
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
          "id,seller_telegram_id,whatsapp_username,status,is_paused,is_frozen"
        )
        .eq(
          "id",
          listingId
        )
        .maybeSingle();

    if (
      listingError ||
      !listing ||
      listing.status !==
      "active" ||
      listing.is_paused ||
      listing.is_frozen
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
        .select("id")
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
          watched:
            false
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
        watched:
          true
      }
    );
  }
);


app.post(
  "/watchlist/list",
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
          "id,seller_telegram_id,whatsapp_username,asking_price,currency,category,description,is_featured,views_count,created_at,bump_until,hot_until,vip_until,bump_promoted_at,hot_promoted_at,vip_promoted_at"
        )
        .in(
          "id",
          listingIds
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
        );

    const publicRows =
      await attachPublicSellerProfiles(
        sortListingsByPromotion(
          listings ||
          []
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
            ascending:
              false
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
        data || [];
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
            ascending:
              false
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


app.post(
  "/wanted-payment/create",
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
      budget > 100000000
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
        req.body.category
      )
        ? req.body.category
        : "Other";

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
   SELLER PROFILE
========================================================= */

app.post(
  "/seller-profile/mine",
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
      bio.length > 300
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
      typeof req.body
        .is_public !==
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
              req.body
                .is_public,

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
  async (
    req,
    res
  ) => {
    const profileId =
      String(
        req.params
          .profileId ||
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
   OFFERS
========================================================= */

app.post(
  "/offers/create",
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
      amount > 100000000
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
          "id,seller_telegram_id,whatsapp_username,status,is_paused,is_frozen"
        )
        .eq(
          "id",
          listingId
        )
        .maybeSingle();

    if (
      listingError ||
      !listing ||
      listing.status !==
      "active" ||
      listing.is_paused ||
      listing.is_frozen
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
      !(
        await buyerHasContactAccess(
          buyerId,
          listingId
        )
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


app.post(
  "/offers/sent",
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
            ascending:
              false
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
            "id,whatsapp_username,asking_price,category,is_frozen,is_paused,status"
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


app.post(
  "/offers/received",
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
          "id,whatsapp_username,asking_price,category,is_frozen,is_paused,status"
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
            ascending:
              false
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
        data || [];
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
            row
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


app.post(
  "/offers/seller-action",
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
        offer,
      error:
        offerError
    } =
      await supabase
        .from("offers")
        .select("*")
        .eq(
          "id",
          offerId
        )
        .maybeSingle();

    if (
      offerError ||
      !offer
    ) {
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
          "id,seller_telegram_id,whatsapp_username,is_frozen"
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

      updateData.seller_counter_amount =
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


app.post(
  "/offers/buyer-action",
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
        offer,
      error:
        offerError
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

    if (
      offerError ||
      !offer
    ) {
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
          "id,seller_telegram_id,whatsapp_username,is_frozen"
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
          "id,seller_telegram_id,whatsapp_username,status,is_paused,is_frozen"
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
   ADMIN
========================================================= */

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
          "id,seller_telegram_id,whatsapp_username,asking_price,currency,category,description,status,created_at"
        )
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
        data || [];
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
      data,
      error
    } =
      await supabase
        .from("listings")
        .update(
          {
            status:
              newStatus,

            updated_at:
              nowIso()
          }
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
          "id,seller_telegram_id,whatsapp_username,status"
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

    safeSendMessage(
      data.seller_telegram_id,

      newStatus ===
      "active"

        ? `✅ @${data.whatsapp_username} was approved and is now live.`

        : `❌ @${data.whatsapp_username} was rejected by moderation.`
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


app.post(
  "/admin/reports",
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
            ascending:
              true
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
            "id,seller_telegram_id,whatsapp_username,asking_price,category,status,is_paused,is_frozen,frozen_reason"
          )
          .in(
            "id",
            listingIds
          );

      listings =
        data || [];
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


app.post(
  "/admin/frozen-listings",
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
          "id,seller_telegram_id,whatsapp_username,asking_price,currency,category,description,status,is_paused,is_frozen,frozen_reason,frozen_at,frozen_by,created_at"
        )
        .eq(
          "is_frozen",
          true
        )
        .order(
          "frozen_at",
          {
            ascending:
              false
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
          data ||
          []
      }
    );
  }
);


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
        "id,seller_telegram_id,whatsapp_username,status,is_frozen"
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
        "id,seller_telegram_id,whatsapp_username"
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


app.post(
  "/admin/report-action",
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


app.post(
  "/admin/listing-freeze",
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


app.post(
  "/admin/listing-remove",
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
        .sendStatus(403);
    }

    const update =
      req.body;

    res.sendStatus(
      200
    );

    try {

      /* =====================================================
         PRE CHECKOUT
      ===================================================== */

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


        /* ---------------- LISTING ---------------- */

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


        /* ---------------- CONTACT ---------------- */

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
            Boolean(
              order
            );

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
              data:
                listing
            } =
              await supabase
                .from("listings")
                .select(
                  "status,is_paused,is_frozen"
                )
                .eq(
                  "id",
                  order.listing_id
                )
                .maybeSingle();

            if (
              !listing ||
              listing.status !==
                "active" ||
              listing.is_paused ||
              listing.is_frozen
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


        /* ---------------- WANTED ---------------- */

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
              data:
                user
            } =
              await supabase
                .from("users")
                .select(
                  "telegram_username"
                )
                .eq(
                  "telegram_id",
                  order.buyer_telegram_id
                )
                .maybeSingle();

            if (
              !user
                ?.telegram_username
            ) {
              valid =
                false;
            }

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
                  order.buyer_telegram_id
                )
                .ilike(
                  "desired_username",
                  order.desired_username
                )
                .eq(
                  "status",
                  "active"
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
                    "This Wanted payment is no longer valid."
                }
          );

          return;
        }


        /* ---------------- PROMOTION ---------------- */

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
            const expectedPrice =
              promotionPrice(
                order.promotion_type,

                Number(
                  order.duration_hours
                )
              );

            if (
              !expectedPrice ||
              Number(
                expectedPrice
              ) !==
              Number(
                order.amount_stars
              )
            ) {
              valid =
                false;
            }

            const {
              data:
                listing
            } =
              await supabase
                .from("listings")
                .select(
                  "seller_telegram_id,status,is_paused,is_frozen"
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
              listing.is_paused ||
              listing.is_frozen
            ) {
              valid =
                false;
            }

            if (valid) {
              const {
                data:
                  accepted
              } =
                await supabase
                  .from("offers")
                  .select("id")
                  .eq(
                    "listing_id",
                    order.listing_id
                  )
                  .eq(
                    "status",
                    "accepted"
                  )
                  .limit(1);

              if (
                accepted?.length
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


        /* ---------------- UNKNOWN ---------------- */

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


      /* =====================================================
         SUCCESSFUL PAYMENT
      ===================================================== */

      const message =
        update.message;

      const payment =
        message?.successful_payment;

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
        payment.telegram_payment_charge_id;


      /* ---------------- LISTING PAYMENT ---------------- */

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
            ) &&
          payment.currency ===
            "XTR" &&
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
                      order.category,

                    description:
                      order.description,

                    status:
                      "pending",

                    verification_status:
                      "unverified",

                    is_featured:
                      false,

                    is_paused:
                      false,

                    is_frozen:
                      false
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

          safeSendMessage(
            order.seller_telegram_id,

            `✅ Payment received. @${order.whatsapp_username} was submitted for moderation.`
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


      /* ---------------- CONTACT PAYMENT ---------------- */

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

        if (
          !order ||
          [
            "paid",
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
              order.buyer_telegram_id
            ) &&
          payment.currency ===
            "XTR" &&
          Number(
            payment.total_amount
          ) ===
            Number(
              order.amount_stars
            );

        if (!valid) {
          return;
        }

        const {
          data:
            listing
        } =
          await supabase
            .from("listings")
            .select(
              "status,is_paused,is_frozen"
            )
            .eq(
              "id",
              order.listing_id
            )
            .maybeSingle();

        const {
          data:
            sellerContact
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
              order.listing_id
            )
            .maybeSingle();

        if (
          !listing ||
          listing.status !==
            "active" ||
          listing.is_paused ||
          listing.is_frozen ||
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

          } catch (error) {
            console.error(
              "Contact refund failed:",
              error.message
            );
          }

          return;
        }

        const {
          error:
            unlockError
        } =
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

        if (
          unlockError
        ) {
          try {
            await refundStars(
              payerId,
              chargeId
            );
          } catch {}

          return;
        }

        return;
      }


      /* ---------------- WANTED PAYMENT ---------------- */

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

        const valid =
          payerId ===
            Number(
              order.buyer_telegram_id
            ) &&
          payment.currency ===
            "XTR" &&
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
            "wanted_payment_orders"
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
              user
          } =
            await supabase
              .from("users")
              .select(
                "telegram_username"
              )
              .eq(
                "telegram_id",
                order.buyer_telegram_id
              )
              .maybeSingle();

          if (
            !user
              ?.telegram_username
          ) {
            throw new Error(
              "public_telegram_username_required"
            );
          }

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
                order.buyer_telegram_id
              )
              .ilike(
                "desired_username",
                order.desired_username
              )
              .eq(
                "status",
                "active"
              )
              .limit(1);

          if (
            duplicate?.length
          ) {
            throw new Error(
              "wanted_already_exists"
            );
          }

          const wantedId =
            order.wanted_post_id ||
            order.id;

          const {
            data:
              existingPost
          } =
            await supabase
              .from(
                "wanted_requests"
              )
              .select("id")
              .eq(
                "id",
                wantedId
              )
              .maybeSingle();

          if (
            !existingPost
          ) {
            const {
              error
            } =
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
                      order.category,

                    description:
                      order.description,

                    status:
                      "active"
                  }
                );

            if (error) {
              throw error;
            }
          }

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

                completed_at:
                  nowIso()
              }
            )
            .eq(
              "id",
              order.id
            );

          safeSendMessage(
            order.buyer_telegram_id,

            `✅ Wanted request for @${order.desired_username} is now live.`
          );

        } catch (error) {
          console.error(
            "Wanted fulfillment failed:",
            error
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
              "Wanted refund failed:",
              refundError.message
            );
          }
        }

        return;
      }


      /* ---------------- PROMOTION PAYMENT ---------------- */

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

        const valid =
          payerId ===
            Number(
              order.seller_telegram_id
            ) &&
          payment.currency ===
            "XTR" &&
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
            "promotion_payment_orders"
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
                "id,seller_telegram_id,whatsapp_username,status,is_paused,is_frozen,bump_until,hot_until,vip_until"
              )
              .eq(
                "id",
                order.listing_id
              )
              .maybeSingle();

          const expectedPrice =
            promotionPrice(
              order.promotion_type,

              Number(
                order.duration_hours
              )
            );

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
            listing.is_paused ||
            listing.is_frozen
          ) {
            throw new Error(
              "listing_not_promotable"
            );
          }

          if (
            !expectedPrice ||
            Number(
              expectedPrice
            ) !==
            Number(
              order.amount_stars
            )
          ) {
            throw new Error(
              "promotion_price_changed"
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
                order.listing_id
              )
              .eq(
                "status",
                "accepted"
              )
              .limit(1);

          if (
            accepted?.length
          ) {
            throw new Error(
              "listing_has_agreement"
            );
          }

          const type =
            order.promotion_type;

          const untilField =
            `${type}_until`;

          const promotedAtField =
            `${type}_promoted_at`;

          const now =
            Date.now();

          const currentUntil =
            new Date(
              listing[
                untilField
              ] ||
              0
            ).getTime();

          const baseMs =
            Number.isFinite(
              currentUntil
            ) &&
            currentUntil > now

              ? currentUntil

              : now;

          const appliedUntil =
            new Date(
              baseMs +
              Number(
                order.duration_hours
              ) *
              60 *
              60 *
              1000
            ).toISOString();

          const updateData = {
            [untilField]:
              appliedUntil,

            [promotedAtField]:
              nowIso(),

            updated_at:
              nowIso()
          };

          const {
            error:
              updateError
          } =
            await supabase
              .from("listings")
              .update(
                updateData
              )
              .eq(
                "id",
                order.listing_id
              );

          if (
            updateError
          ) {
            throw updateError;
          }

          await supabase
            .from(
              "promotion_payment_orders"
            )
            .update(
              {
                status:
                  "completed",

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

          safeSendMessage(
            order.seller_telegram_id,

            `${label} promotion activated for @${listing.whatsapp_username}.\n\nActive until: ${new Date(appliedUntil).toUTCString()}`
          );

        } catch (error) {
          console.error(
            "Promotion fulfillment failed:",
            error
          );

          try {
            await refundStars(
              payerId,
              chargeId
            );

            await supabase
              .from(
                "promotion_payment_orders"
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
              "Promotion refund failed:",
              refundError.message
            );
          }
        }

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
   SERVER START
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
  }
);