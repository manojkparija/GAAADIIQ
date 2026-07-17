import Anthropic from 'npm:@anthropic-ai/sdk@0.52.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
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
- Kilometers Driven: ${kmNum.toLocaleString('en-IN')} km
- Fuel Type: ${fuel}
- Transmission: ${transmission || 'Unknown'}
- Number of Owners: ${owners}
- Condition: ${condition}

Provide a JSON response with this exact structure:
{
  "low": <lowest fair market price in INR as integer>,
  "mid": <fair market price in INR as integer>,
  "high": <optimistic price in INR as integer>,
  "confidence": <confidence score 70-97 as integer>,
  "depreciation": <total depreciation percentage as integer>,
  "marketTrend": "<one emoji + short market trend observation for this specific fuel/model in India>",
  "tips": ["<tip1>", "<tip2>", "<tip3>"]
}

Rules:
- Base your valuation on actual Indian used car market prices (CarDekho, Cars24, OLX Autos data patterns)
- Account for Indian state RTO depreciation schedules
- ${fuel === 'Electric' ? 'EVs have strong demand but battery health uncertainty — factor both in' : ''}
- ${fuel === 'Diesel' ? 'Diesel has softening demand in metros due to BS6 and EV adoption' : ''}
- low should be ~10-15% below mid, high should be ~10-15% above mid
- Confidence: 90+ if variant known, 80+ if model known, 70+ otherwise
- Tips should be specific, actionable advice for the Indian market
- Return ONLY valid JSON, no markdown, no explanation`;

    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: prompt }],
    });

    // Extract JSON from response
    const textContent = message.content.find((c: any) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    const jsonText = textContent.text.trim();
    const valuation = JSON.parse(jsonText);

    return new Response(JSON.stringify(valuation), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('AI valuation error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Valuation failed' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
