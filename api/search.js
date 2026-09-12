export default async function handler(req, res) {

  // Allow our frontend to call this API
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const query = req.query.q;
  const country = req.query.country || "RS";
  const postalCode = req.query.postalCode || "";

  if (!query) {
    return res.status(400).json({
      error: "Missing search query"
    });
  }

  /*
    For now eBay is disabled until
    our developer account is approved.
  */

  const products = [
    {
      id: "demo-1",
      title: "Backend is working",
      store: "Global Shop Finder",
      price: 0,
      shipping: null,
      totalPrice: null,
      currency: "USD",
      image: "https://placehold.co/600x600?text=API+Ready",
      rating: null,
      reviews: null,
      url: "#",
      destination: {
        country,
        postalCode
      },
      searchedFor: query
    }
  ];

  return res.status(200).json({
    query,
    destination: {
      country,
      postalCode
    },
    count: products.length,
    products
  });
}
