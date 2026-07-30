import Anthropic from 'npm:@anthropic-ai/sdk@0.52.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Simple in-memory anon rate limiter — max 5 requests per minute per IP
const anonBucket: Map<string, { count: number; resetAt: number }> = new Map();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = anonBucket.get(ip);
  if (!entry || now > entry.resetAt) {
    anonBucket.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 5) return false;
  entry.count++;
  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Rate limit anonymous callers (no auth header)
  const authHeader = req.headers.get('authorization') ?? '';
  const isAuthed = authHeader.startsWith('Bearer ') && authHeader.length > 20;
  if (!isAuthed) {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    if (!checkRateLimit(ip)) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded — please wait a minute.' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  try {
    const body = await req.json();
    const { make, model, variant, year, km, fuel, transmission, owners, condition } = body;

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const client = new Anthropic({ apiKey });
    const age = new Date().getFullYear() - Number(year);
    const kmNum = Number(km);

    const prompt = `You are an expert used-car valuation specialist for the Indian market. Provide a precise market valuation for this vehicle.

Car Details:
- Make: ${make}
- Model: ${model}
- Variant: ${variant || 'Unknown'}
- Year: ${year} (${age} years old)
- Kilometres Driven: ${kmNum.toLocaleString('en-IN')} km
- Fuel Type: ${fuel}
- Transmission: ${transmission || 'Unknown'}
- Number of Owners: ${owners}
- Condition: ${condition}

Provide a JSON response with this exact structure:
{
  "low": <lowest fair market price in INR as integer>,
  "mid": <fair market price in INR as integer>,
  "high": <optimistic price in INR as integer>,
  "confidence": <confidence score as integer: 90 if variant known, 82 if model known, 75 otherwise>,
  "depreciation": <total depreciation percentage as integer>,
  "marketTrend": "<one emoji + short market trend observation for this specific fuel/model in India>",
  "tips": ["<tip1>", "<tip2>", "<tip3>"]
}

Rules:
- Base your valuation on actual Indian used car market prices (CarDekho, Cars24, OLX Autos patterns)
- Account for Indian state RTO depreciation schedules
- ${fuel === 'Electric' ? 'EVs have strong demand but battery health uncertainty — factor both in' : ''}
- ${fuel === 'Diesel' ? 'Diesel has softening demand in metros due to BS6 and EV adoption' : ''}
- low should be ~10-15% below mid, high should be ~10-15% above mid
- Tips should be specific, actionable advice for the Indian market
- Return ONLY valid JSON, no markdown fences, no explanation`;

    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      // Adaptive thinking spends part of max_tokens on reasoning before any
      // visible text. At 1024 the JSON could be cut off mid-object, which
      // threw in JSON.parse and surfaced as "AI engine unavailable".
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: prompt }],
    });

    const textContent = message.content.find((c: any) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    // Strip markdown code fences if present (```json ... ```)
    const raw = textContent.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const valuation = JSON.parse(raw);

    return new Response(JSON.stringify({ ...valuation, method: 'claude' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('AI valuation error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Valuation failed' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
