export default async function handler(req, res) {

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const query = req.query.q;
  const country = (req.query.country || "RS").toUpperCase();
  const postalCode = req.query.postalCode || "";

  if (!query) {
    return res.status(400).json({
      error: "Missing search query"
    });
  }

  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).json({
      error: "eBay API credentials are missing"
    });
  }

  try {

    /*
      STEP 1:
      Get eBay Application access token
    */

    const credentials = Buffer
      .from(`${clientId}:${clientSecret}`)
      .toString("base64");

    const tokenResponse = await fetch(
      "https://api.ebay.com/identity/v1/oauth2/token",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",

          "Authorization":
            `Basic ${credentials}`
        },

        body: new URLSearchParams({
          grant_type: "client_credentials",
          scope: "https://api.ebay.com/oauth/api_scope"
        })
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {

      console.error(
        "eBay OAuth error:",
        tokenData
      );

      return res.status(500).json({
        error: "Could not authenticate with eBay",
        details:
          tokenData.error_description ||
          tokenData.error ||
          "Unknown authentication error"
      });
    }

    const accessToken =
      tokenData.access_token;


    /*
      STEP 2:
      Tell eBay where the customer is located.

      Example:
      country=RS,zip=37240
    */

    let endUserContext =
      `country=${country}`;

    if (postalCode) {
      endUserContext +=
        `,zip=${postalCode}`;
    }

    const encodedLocation =
      encodeURIComponent(endUserContext);


    /*
      STEP 3:
      Search real eBay products
    */

    const ebayURL =
      "https://api.ebay.com/buy/browse/v1/item_summary/search" +
      `?q=${encodeURIComponent(query)}` +
      "&limit=30";


    const ebayResponse = await fetch(
      ebayURL,
      {
        headers: {

          "Authorization":
            `Bearer ${accessToken}`,

          /*
            Marketplace used for the search.
            Customer shipping destination is
            separately sent below.
          */

          "X-EBAY-C-MARKETPLACE-ID":
            "EBAY_US",

          "X-EBAY-C-ENDUSERCTX":
            `contextualLocation=${encodedLocation}`,

          "Accept":
            "application/json"
        }
      }
    );


    const ebayData =
      await ebayResponse.json();


    if (!ebayResponse.ok) {

      console.error(
        "eBay Browse error:",
        ebayData
      );

      return res.status(
        ebayResponse.status
      ).json({

        error:
          "eBay search failed",

        details:
          ebayData.errors ||
          ebayData

      });
    }


    /*
      STEP 4:
      Convert eBay products into
      Global Shop Finder format
    */

    const products =
      (ebayData.itemSummaries || [])
      .map(item => {

        const price =
          item.price?.value
            ? Number(item.price.value)
            : null;


        /*
          eBay can return multiple
          shipping options.

          We take the cheapest known one.
        */

        const shippingPrices =
          (item.shippingOptions || [])

          .map(option =>
            option.shippingCost?.value
              !== undefined
              ? Number(
                  option.shippingCost.value
                )
              : null
          )

          .filter(value =>
            value !== null &&
            !Number.isNaN(value)
          );


        let shipping = null;

        if (shippingPrices.length > 0) {

          shipping =
            Math.min(
              ...shippingPrices
            );

        }


        let totalPrice = null;

        if (
          price !== null &&
          shipping !== null
        ) {

          totalPrice =
            price + shipping;

        }


        return {

          id:
            item.itemId,

          title:
            item.title ||
            "eBay product",

          store:
            "eBay",

          price,

          shipping,

          totalPrice,

          currency:
            item.price?.currency ||
            "USD",

          image:
            item.image?.imageUrl ||
            item.thumbnailImages?.[0]?.imageUrl ||
            null,

          url:
            item.itemAffiliateWebUrl ||
            item.itemWebUrl ||
            null,

          condition:
            item.condition ||
            null,

          seller:
            item.seller?.username ||
            null,

          sellerFeedback:
            item.seller?.feedbackPercentage
              ? Number(
                  item.seller.feedbackPercentage
                )
              : null,

          deliveryStart:
            item.shippingOptions?.[0]
              ?.minEstimatedDeliveryDate ||
            null,

          deliveryEnd:
            item.shippingOptions?.[0]
              ?.maxEstimatedDeliveryDate ||
            null

        };

      });


    /*
      Known total prices first,
      cheapest total first.

      Unknown shipping products go
      underneath.
    */

    products.sort((a, b) => {

      if (
        a.totalPrice === null &&
        b.totalPrice === null
      ) {

        return (
          (a.price ?? Infinity) -
          (b.price ?? Infinity)
        );

      }

      if (a.totalPrice === null)
        return 1;

      if (b.totalPrice === null)
        return -1;

      return (
        a.totalPrice -
        b.totalPrice
      );

    });


    /*
      STEP 5:
      Send products to our frontend
    */

    return res.status(200).json({

      query,

      destination: {
        country,
        postalCode
      },

      count:
        products.length,

      products

    });


  } catch (error) {

    console.error(error);

    return res.status(500).json({

      error:
        "Internal server error",

      details:
        error.message

    });

  }

}
