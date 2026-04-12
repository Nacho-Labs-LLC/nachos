/**
 * LLM prompts for end-of-session knowledge extraction.
 *
 * The extraction prompt asks the LLM to distill a conversation into permanent,
 * structured MemoryFacts (subject–predicate–object triples).
 */

/**
 * Valid MemoryFact types the extraction prompt produces.
 */
export const EXTRACTION_FACT_TYPES = [
  'attribute',
  'relationship',
  'preference',
  'skill',
  'event',
  'decision',
  'general',
] as const;

/**
 * System prompt for end-of-session knowledge extraction.
 *
 * Instructs the LLM to extract only durable, long-term facts — not transient
 * task details — and return them as a JSON array.
 */
export const EXTRACTION_SYSTEM_PROMPT = `You are a knowledge extraction assistant. Your job is to read a conversation and extract facts that are worth remembering long-term about the people, projects, preferences, decisions, and relationships involved.

RULES:
- Only extract facts with lasting value. Skip transient task details, temporary errors, or one-off debugging steps.
- Focus on: who the user is, what they care about, what they know, what they have decided, what tools/languages/frameworks they prefer, relationships between people or systems.
- Each fact must be a clear, standalone triple: subject, predicate, object.
- Be concise — objects should be short phrases, not sentences.
- Assign a confidence score (0.0–1.0) based on how clearly the fact was stated. Use 0.9+ for explicit statements, 0.6–0.8 for inferred facts.
- Use only these types: attribute, relationship, preference, skill, event, decision, general.

OUTPUT FORMAT (strict JSON array, no other text):
[
  {
    "subject": "user",
    "predicate": "prefers",
    "object": "TypeScript over JavaScript",
    "type": "preference",
    "confidence": 0.95,
    "properties": {}
  }
]

If there are no facts worth extracting, return an empty array: []

DO NOT include:
- Markdown code fences or any text outside the JSON array
- Facts about the conversation itself (e.g., "user asked about X")
- Temporary or context-specific information
- PII like passwords, API keys, or credit card numbers`;

/**
 * Build the user message for the extraction prompt.
 * Formats the conversation as a readable transcript.
 */
export function buildExtractionUserMessage(
  messages: Array<{ role: string; content: string }>
): string {
  if (messages.length === 0) {
    return 'The conversation was empty. Return: []';
  }

  const transcript = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  return `Extract durable facts from this conversation:\n\n---\n${transcript}\n---\n\nReturn a JSON array of facts (or [] if none).`;
}
