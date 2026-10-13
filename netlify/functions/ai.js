const ALLOWED_ORIGINS = [
  "https://crimzonai.netlify.app"
];

const ALLOWED_MODELS = new Set([
  "openai/gpt-4o-mini",
  "anthropic/claude-haiku-4-5",
  "meta-llama/llama-4-scout",
  "meta-llama/llama-4-maverick"
]);

function reply(statusCode, data, origin) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization",
      "Access-Control-Allow-Methods":
        "POST, OPTIONS",
      "Vary": "Origin"
    },
    body: JSON.stringify(data)
  };
}

exports.handler = async (event) => {
  const origin =
    event.headers.origin || event.headers.Origin || "";

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin":
          ALLOWED_ORIGINS.includes(origin) ? origin : "null",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: ""
    };
  }

  if (event.httpMethod !== "POST") {
    return reply(405, { error: "Method not allowed." }, "null");
  }

  if (!ALLOWED_ORIGINS.includes(origin)) {
    return reply(403, { error: "Origin not allowed." }, "null");
  }

  if (!process.env.OPENROUTER_KEY) {
    return reply(500, { error: "Server API key is not configured." }, origin);
  }

  const authorization =
    event.headers.authorization ||
    event.headers.Authorization || "";

  const idToken = authorization.replace(/^Bearer\s+/i, "");

  const userId = await verifyFirebaseToken(idToken);

  if (!userId) {
    return reply(401, { error: "Please sign in again." }, origin);
  }

  let data;

  try {
    if (Buffer.byteLength(event.body || "", "utf8") > 1000000) {
      return reply(413, { error: "Request is too large." }, origin);
    }

    data = JSON.parse(event.body || "{}");
  } catch {
    return reply(400, { error: "Invalid JSON." }, origin);
  }

  if (!ALLOWED_MODELS.has(data.model)) {
    return reply(400, { error: "Model is not allowed." }, origin);
  }

  if (
    !Array.isArray(data.messages) ||
    data.messages.length === 0 ||
    data.messages.length > 100
  ) {
    return reply(400, { error: "Invalid messages." }, origin);
  }

  try {
    const upstream = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization":
            `Bearer ${process.env.OPENROUTER_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": origin,
          "X-Title": "SCHOL AI"
        },
        body: JSON.stringify({
          model: data.model,
          messages: data.messages,
          stream: false,
          temperature: 0.7,
          max_tokens: 2048
        })
      }
    );

    const text = await upstream.text();

    return {
      statusCode: upstream.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": origin,
        "Vary": "Origin"
      },
      body: text
    };
  } catch {
    return reply(502, { error: "AI service is temporarily unavailable." }, origin);
  }
};

async function verifyFirebaseToken(idToken) {
  if (!idToken || !process.env.FIREBASE_API_KEY) {
    return null;
  }

  try {
    const response = await fetch(
      "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" +
        encodeURIComponent(process.env.FIREBASE_API_KEY),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ idToken })
      }
    );

    if (!response.ok) return null;

    const result = await response.json();

    return result.users?.[0]?.localId || null;
  } catch {
    return null;
  }
}
