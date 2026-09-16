import crypto from "crypto";

function aliTimestamp() {
  const date = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, "0");

  return (
    `${date.getUTCFullYear()}-` +
    `${pad(date.getUTCMonth() + 1)}-` +
    `${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:` +
    `${pad(date.getUTCMinutes())}:` +
    `${pad(date.getUTCSeconds())}`
  );
}

function signRequest(params, secret) {
  const keys = Object.keys(params).sort();

  let text = "";

  for (const key of keys) {
    if (
      params[key] !== undefined &&
      params[key] !== null &&
      params[key] !== ""
    ) {
      text += key + params[key];
    }
  }

  return crypto
    .createHmac("md5", secret)
    .update(text, "utf8")
    .digest("hex")
    .toUpperCase();
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const query = String(req.query.q || "").trim();
  const country = String(req.query.country || "RS").toUpperCase();

  if (!query) {
    return res.status(400).json({
      error: "Missing search query"
    });
  }

  const appKey = process.env.ALIEXPRESS_APP_KEY;
  const appSecret = process.env.ALIEXPRESS_APP_SECRET;

  if (!appKey || !appSecret) {
    return res.status(500).json({
      error: "AliExpress credentials are missing"
    });
  }

  try {
    const params = {
      method: "aliexpress.affiliate.product.query",
      app_key: appKey,
      sign_method: "hmac",
      timestamp: aliTimestamp(),
      format: "json",
      v: "2.0",

      keywords: query,
      page_no: "1",
      page_size: "30",

      ship_to_country: country,
      target_currency: "USD",
      target_language: "EN",

      fields: [
        "product_id",
        "product_title",
        "product_main_image_url",
        "product_detail_url",
        "promotion_link",
        "sale_price",
        "original_price",
        "target_sale_price",
        "target_original_price",
        "target_sale_price_currency",
        "commission_rate"
      ].join(",")
    };

    params.sign = signRequest(params, appSecret);

    const body = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
      body.append(key, String(value));
    }

    /*
      AliExpress / TOP overseas gateway.
    */
    const response = await fetch(
      "https://api.taobao.com/router/rest",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded;charset=UTF-8"
        },
        body
      }
    );

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      return res.status(500).json({
        error: "AliExpress returned non-JSON response",
        status: response.status,
        response: text.slice(0, 1000)
      });
    }

    if (data.error_response) {
      return res.status(400).json({
        error: "AliExpress API error",
        details: data.error_response
      });
    }

    const responseObject =
      data.aliexpress_affiliate_product_query_response;

    const result =
      responseObject?.resp_result?.result;

    let rawProducts =
      result?.products?.product ??
      result?.products ??
      [];

    if (!Array.isArray(rawProducts)) {
      rawProducts = rawProducts ? [rawProducts] : [];
    }

    const products = rawProducts.map(item => {
      const price =
        numberOrNull(item.target_sale_price) ??
        numberOrNull(item.sale_price);

      const originalPrice =
        numberOrNull(item.target_original_price) ??
        numberOrNull(item.original_price);

      /*
        Do NOT assume missing shipping means free shipping.
      */
      const shipping = null;

      return {
        id: String(item.product_id || ""),

        title:
          item.product_title ||
          "AliExpress product",

        store: "AliExpress",

        price,
        shipping,

        totalPrice:
          price !== null && shipping !== null
            ? price + shipping
            : null,

        currency:
          item.target_sale_price_currency ||
          "USD",

        image:
          item.product_main_image_url ||
          null,

        url:
          item.promotion_link ||
          item.product_detail_url ||
          null,

        condition: "New",

        seller: null,
        sellerFeedback: null,

        deliveryStart: null,
        deliveryEnd: null,

        originalPrice,

        commissionRate:
          item.commission_rate ||
          null
      };
    });

    products.sort((a, b) => {
      if (a.price === null && b.price === null) return 0;
      if (a.price === null) return 1;
      if (b.price === null) return -1;

      return a.price - b.price;
    });

    return res.status(200).json({
      source: "AliExpress",
      gateway: "overseas",

      query,

      destination: {
        country
      },

      count: products.length,

      products
    });

  } catch (error) {
    console.error("AliExpress:", error);

    return res.status(500).json({
      error: "Internal server error",
      details: error.message
    });
  }
}
