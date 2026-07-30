import { z } from 'zod'

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = 'llama-3.3-70b-versatile'

const PlanSchema = z.object({
  proof_spec: z.object({
    type: z.enum(['photo', 'form']),
    instructions: z.string(),
    minPhotos: z.number().int().min(1).max(5).optional(),
    formFields: z.array(z.string()).optional(),
  }),
  estimated_minutes: z.number().int().min(1).max(60),
})

export type Plan = z.infer<typeof PlanSchema>

const SYSTEM_PROMPT = `You are a task planner for GroundTruth, a platform where AI agents hire human oracles.
Given a task intent, output a JSON plan with:
- proof_spec.type: "photo" if physical observation needed, "form" for information gathering
- proof_spec.instructions: clear human-readable instructions (1-3 sentences)
- proof_spec.minPhotos: (if photo) how many photos required (1-3)
- proof_spec.formFields: (if form) list of field names to fill
- estimated_minutes: realistic estimate for a human to complete

Respond with ONLY valid JSON matching the schema. No markdown, no explanation.`

export async function planTask(intent: string): Promise<Plan> {
  const groqKey = process.env.GROQ_API_KEY
  if (!groqKey) return keywordFallback(intent)

  try {
    const res = await fetch(GROQ_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Task intent: ${intent}` },
        ],
        temperature: 0.2,
        max_tokens: 300,
        response_format: { type: 'json_object' },
      }),
      // Bound the LLM call so a slow Groq response can't hang task creation;
      // the catch below degrades gracefully to keywordFallback.
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) return keywordFallback(intent)
    const json = await res.json()
    const content = json.choices?.[0]?.message?.content
    if (!content) return keywordFallback(intent)

    const parsed = PlanSchema.safeParse(JSON.parse(content))
    if (!parsed.success) return keywordFallback(intent)
    return parsed.data
  } catch {
    return keywordFallback(intent)
  }
}

function keywordFallback(intent: string): Plan {
  const lower = intent.toLowerCase()
  const isForm =
    lower.includes('price') ||
    lower.includes('hours') ||
    lower.includes('info') ||
    lower.includes('check') ||
    lower.includes('confirm') ||
    lower.includes('available')

  if (isForm) {
    return {
      proof_spec: {
        type: 'form',
        instructions: `Please gather the following information: ${intent}`,
        formFields: ['answer', 'source', 'notes'],
      },
      estimated_minutes: 5,
    }
  }

  return {
    proof_spec: {
      type: 'photo',
      instructions: `Take a clear photo showing: ${intent}`,
      minPhotos: 1,
    },
    estimated_minutes: 10,
  }
}
