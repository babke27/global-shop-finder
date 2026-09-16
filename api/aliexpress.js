import crypto from "crypto";

function getAliTimestamp() {
  // AliExpress/TOP timestamp uses GMT+8
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);

  const pad = (n) => String(n).padStart(2, "0");

  return (
    `${now.getUTCFullYear()}-` +
    `${pad(now.getUTCMonth() + 1)}-` +
    `${pad(now.getUTCDate())} ` +
    `${pad(now.getUTCHours())}:` +
    `${pad(now.getUTCMinutes())}:` +
    `${pad(now.getUTCSeconds())}`
  );
}

function createSign(params, secret) {
  const sortedKeys = Object.keys(params).sort();

  let signString = "";

  for (const key of sortedKeys) {
    const value = params[key];

    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      signString += key + value;
    }
  }

  return crypto
    .createHmac("md5", secret)
    .update(signString, "utf8")
    .digest("hex")
    .toUpperCase();
}

function toNumber(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

export default async function handler(req, res) {
  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const query = String(
    req.query.q || ""
  ).trim();

  const country = String(
    req.query.country || "RS"
  ).toUpperCase();

  if (!query) {
    return res.status(400).json({
      error: "Missing search query"
    });
  }

  const appKey =
    process.env.ALIEXPRESS_APP_KEY;

  const appSecret =
    process.env.ALIEXPRESS_APP_SECRET;

  if (!appKey || !appSecret) {
    return res.status(500).json({
      error:
        "AliExpress API credentials are missing"
    });
  }

  try {
    const params = {
      method:
        "aliexpress.affiliate.product.query",

      app_key: appKey,

      sign_method: "hmac",

      timestamp: getAliTimestamp(),

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

    params.sign = createSign(
      params,
      appSecret
    );

    const body =
      new URLSearchParams();

    for (
      const [key, value]
      of Object.entries(params)
    ) {
      body.append(
        key,
        String(value)
      );
    }

    const response = await fetch(
      "https://eco.taobao.com/router/rest",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded;charset=UTF-8"
        },

        body
      }
    );

    const responseText =
      await response.text();

    let data;

    try {
      data =
        JSON.parse(responseText);
    } catch {
      return res.status(500).json({
        error:
          "AliExpress returned invalid JSON",

        status:
          response.status,

        response:
          responseText.slice(0, 1000)
      });
    }

    if (data.error_response) {
      console.error(
        "AliExpress API error:",
        data.error_response
      );

      return res.status(400).json({
        error:
          "AliExpress API error",

        details:
          data.error_response
      });
    }

    const result =
      data
        .aliexpress_affiliate_product_query_response
        ?.resp_result
        ?.result;

    let rawProducts =
      result?.products?.product ??
      result?.products ??
      [];

    if (!Array.isArray(rawProducts)) {
      rawProducts =
        rawProducts
          ? [rawProducts]
          : [];
    }

    const products =
      rawProducts.map((item) => {

        const price =
          toNumber(
            item.target_sale_price
          ) ??
          toNumber(
            item.sale_price
          );

        const originalPrice =
          toNumber(
            item.target_original_price
          ) ??
          toNumber(
            item.original_price
          );

        // Affiliate product query does not
        // guarantee an exact shipping price.
        const shipping = null;

        return {
          id:
            String(
              item.product_id || ""
            ),

          title:
            item.product_title ||
            "AliExpress product",

          store:
            "AliExpress",

          price,

          shipping,

          totalPrice: null,

          currency:
            item
              .target_sale_price_currency ||
            "USD",

          image:
            item
              .product_main_image_url ||
            null,

          url:
            item.promotion_link ||
            item.product_detail_url ||
            null,

          condition:
            "New",

          seller:
            null,

          sellerFeedback:
            null,

          deliveryStart:
            null,

          deliveryEnd:
            null,

          originalPrice,

          commissionRate:
            item.commission_rate ||
            null
        };
      });

    products.sort(
      (a, b) => {

        if (
          a.price === null &&
          b.price === null
        ) {
          return 0;
        }

        if (a.price === null) {
          return 1;
        }

        if (b.price === null) {
          return -1;
        }

        return a.price - b.price;
      }
    );

    return res.status(200).json({
      source:
        "AliExpress",

      query,

      destination: {
        country
      },

      count:
        products.length,

      products
    });

  } catch (error) {
    console.error(
      "AliExpress error:",
      error
    );

    return res.status(500).json({
      error:
        "Internal server error",

      details:
        error.message
    });
  }
}
