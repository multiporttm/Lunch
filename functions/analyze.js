const SYSTEM_PROMPT = `You are a nutritionist and meal-prep expert. Your job is to:
1. Identify all visible ingredients in the fridge photo
2. Assess the lunchbox size and capacity from the lunchbox photo
3. Generate practical, balanced lunch meal ideas using ONLY the available ingredients

NUTRITION REQUIREMENTS (mandatory for every meal suggestion):
- PROTEIN: Must include a clear protein source (meat, eggs, legumes, dairy, tofu, etc.)
- CARBOHYDRATES: Must include a carb source (bread, rice, pasta, vegetables, fruit, etc.)
- HEALTHY FAT: Must include healthy fat (olive oil, avocado, nuts, cheese, etc.)
- NO TRANS FAT: Absolutely no partially hydrogenated oils, margarine, or processed foods containing trans fats

PERSONAL PREFERENCES: You MUST strictly respect the user's stated allergies, dislikes, and preferences.
- ALLERGIES are hard constraints — never include an allergen even as a trace ingredient
- DISLIKES should be avoided entirely
- LIKES should be prioritised where possible

FORMAT your response as JSON with this exact structure:
{
  "fridge_ingredients": ["list", "of", "identified", "ingredients"],
  "lunchbox_capacity": "description of lunchbox size",
  "meals": [
    {
      "name": "Meal Name",
      "description": "Brief appealing description",
      "ingredients": ["ingredient 1", "ingredient 2"],
      "assembly": "Simple step-by-step instructions",
      "nutrition": {
        "protein": "what provides protein and estimated amount",
        "carbs": "what provides carbs and estimated amount",
        "fat": "what provides healthy fat and estimated amount",
        "calories": "estimated total calories"
      },
      "fits_lunchbox": true,
      "prep_time": "X minutes"
    }
  ],
  "tips": ["optional tip 1", "optional tip 2"]
}

Provide 3 meal suggestions. Return JSON only — no markdown, no explanation outside the JSON.`;

function buildPreferencesText(allergies, likes, dislikes, brands, country) {
  const lines = [];
  if (country && country.trim()) lines.push(
    `CUISINE STYLE: I am from / eating in the style of ${country.trim()}. ` +
    `Please draw inspiration from that country's traditional ingredients, spice profiles, ` +
    `and typical lunch dishes.`
  );
  if (brands && brands.trim()) lines.push(`BRANDS IN MY FRIDGE: ${brands.trim()}.`);
  if (allergies && allergies.trim()) lines.push(`ALLERGIES (MUST avoid completely): ${allergies.trim()}`);
  if (dislikes && dislikes.trim()) lines.push(`DISLIKES (please avoid): ${dislikes.trim()}`);
  if (likes && likes.trim()) lines.push(`LIKES (prioritise if possible): ${likes.trim()}`);
  return lines.length ? '\n\nMy personal preferences:\n' + lines.join('\n') : '';
}

export async function onRequestPost(context) {
  const { env, request } = context;

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json({ error: 'API key not configured on server.' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const { fridgeB64, lunchboxB64, country = '', allergies = '', likes = '', dislikes = '', brands = '' } = body;

  if (!fridgeB64 || !lunchboxB64) {
    return json({ error: 'Both fridge and lunchbox images are required.' }, 400);
  }

  const prefs = buildPreferencesText(allergies, likes, dislikes, brands, country);
  const userMessage =
    'Please analyze both images and generate 3 balanced lunch meal ideas ' +
    'that I can make with the ingredients in my fridge and that will fit ' +
    'in my lunchbox. Each meal MUST include protein, carbohydrates, and ' +
    'healthy fat (no trans fat).' + prefs + '\n\nReturn JSON only.';

  let claudeRes;
  try {
    claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Here is a photo of my fridge:' },
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fridgeB64 } },
            { type: 'text', text: 'And here is my lunchbox:' },
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: lunchboxB64 } },
            { type: 'text', text: userMessage },
          ],
        }],
      }),
    });
  } catch {
    return json({ error: 'Failed to reach Claude API. Please try again.' }, 502);
  }

  const claudeJson = await claudeRes.json();

  if (!claudeRes.ok) {
    const msg = claudeJson.error?.message || 'Claude API error.';
    if (claudeRes.status === 401) return json({ error: 'API key invalid or expired.' }, 401);
    if (claudeRes.status === 429) return json({ error: 'Rate limit reached. Please wait and try again.' }, 429);
    if (claudeRes.status === 402) return json({ error: 'Insufficient credits. Please top up at console.anthropic.com.' }, 402);
    return json({ error: msg }, claudeRes.status);
  }

  let resultText = claudeJson.content[0].text.trim();
  if (resultText.startsWith('```')) {
    const lines = resultText.split('\n');
    resultText = lines.slice(1, lines[lines.length - 1].trim() === '```' ? -1 : lines.length).join('\n');
  }

  let mealData;
  try {
    mealData = JSON.parse(resultText);
  } catch {
    return json({ error: 'Could not parse Claude response. Please try again.' }, 500);
  }

  return json({ success: true, data: mealData });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
