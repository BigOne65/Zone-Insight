
export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  // 1. Identify placeholders and map them to server-side Environment Variables
  const KEY_MAP = {
    "CONFIDENTIAL_DATA_API_KEY": process.env.VITE_DATA_API_KEY,
    "CONFIDENTIAL_VWORLD_KEY": process.env.VITE_VWORLD_KEY,
    "CONFIDENTIAL_SGIS_ID": process.env.VITE_SGIS_SERVICE_ID,
    "CONFIDENTIAL_SGIS_SECRET": process.env.VITE_SGIS_SECRET_KEY,
    "CONFIDENTIAL_SEOUL_KEY": process.env.VITE_SEOUL_DATA_KEY,
  };

  let targetUrl = url;

  // 2. Inject real keys into the URL
  // We iterate through the map and replace the placeholder in the target URL
  // with the actual key from the environment.
  Object.keys(KEY_MAP).forEach((placeholder) => {
    if (targetUrl.includes(placeholder)) {
      const realKey = KEY_MAP[placeholder] || "";
      // If the API requires the key to be URL encoded, the replacement handles it implicitly
      // because we replace the string literal. 
      // Note: Data.go.kr often needs the *decoded* key in the URL string construction 
      // which then gets encoded, or specifically encoded. 
      // We assume the Env Var contains the correct key format (usually Decoded for these services).
      targetUrl = targetUrl.replace(placeholder, encodeURIComponent(realKey));
    }
  });

  try {
    // 3. Fetch from the actual API
    const response = await fetch(targetUrl);
    const contentType = response.headers.get("content-type");
    const data = await response.text();

    // 4. Return the response to the frontend with appropriate headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", contentType || "application/json");
    res.status(response.status).send(data);
  } catch (error) {
    console.error("Proxy Error:", error);
    res.status(500).json({ error: "Failed to fetch data from external API" });
  }
}
