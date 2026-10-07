
import crypto from "node:crypto";

const API_URL = "https://api-sg.aliexpress.com/sync";
const API_METHOD = "aliexpress.affiliate.product.query";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const query = String(req.query.q || "").trim();
  const country = String(req.query.country || "RS").toUpperCase();

  if (!query) {
    return res.status(400).json({ error: "Missing search query" });
  }

  const appKey = process.env.ALIEXPRESS_APP_KEY?.trim();
  const appSecret = process.env.ALIEXPRESS_APP_SECRET?.trim();

  if (!appKey || !appSecret) {
    return res.status(500).json({
      error: "AliExpress credentials are missing"
    });
  }

  try {
    const params = {
      app_key: appKey,
      method: API_METHOD,
      timestamp: String(Date.now()),
      sign_method: "sha256",
      keywords: query,
      page_no: "1",
      page_size: "30",
      target_currency: "USD",
      target_language: "EN",
      ship_to_country: country,
      fields: [
        "product_id",
        "product_title",
        "product_main_image_url",
        "target_sale_price",
        "target_sale_price_currency",
        "product_detail_url",
        "promotion_link",
        "evaluate_rate"
      ].join(",")
    };

    // AliExpress Business API: sort parameters,
    // concatenate key + value, then HMAC-SHA256.
    const signingString = Object.keys(params)
      .sort()
      .map(key => key + params[key])
      .join("");

    const signature = crypto
      .createHmac("sha256", appSecret)
      .update(signingString, "utf8")
      .digest("hex")
      .toUpperCase();

    const body = new URLSearchParams({
      ...params,
      sign: signature
    });

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body: body.toString()
    });

    const raw = await response.text();

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(502).json({
        error: "AliExpress returned a non-JSON response",
        httpStatus: response.status,
        details: raw.slice(0, 500)
      });
    }

    if (!response.ok || data.error_response) {
      return res.status(502).json({
        error: "AliExpress API error",
        details: data.error_response || data
      });
    }

    const result =
      data.aliexpress_affiliate_product_query_response
        ?.resp_result?.result || {};

    const rawProducts =
      result.products?.product ||
      result.products ||
      [];

    const items = Array.isArray(rawProducts)
      ? rawProducts
      : [];

    const products = items.map(item => {
      const rawPrice =
        item.target_sale_price ??
        item.sale_price ??
        null;

      const price =
        rawPrice !== null &&
        rawPrice !== "" &&
        Number.isFinite(Number(rawPrice))
          ? Number(rawPrice)
          : null;

      return {
        id: String(item.product_id || ""),
        title: item.product_title || "AliExpress product",
        store: "AliExpress",
        price,
        shipping: null,
        totalPrice: null,
        currency:
          item.target_sale_price_currency || "USD",
        image: item.product_main_image_url || null,
        url:
          item.promotion_link ||
          item.product_detail_url ||
          null,
        condition: null,
        seller: null,
        sellerFeedback: null,
        deliveryStart: null,
        deliveryEnd: null
      };
    });

    products.sort(
      (a, b) =>
        (a.price ?? Infinity) -
        (b.price ?? Infinity)
    );

    return res.status(200).json({
      query,
      destination: { country },
      count: products.length,
      products,
      source: "AliExpress"
    });

  } catch (error) {
    console.error("AliExpress API:", error.message);

    return res.status(500).json({
      error: "AliExpress request failed",
      details: error.message
    });
  }
}
