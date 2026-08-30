import type { Plugin } from 'vite';
import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';

/**
 * Dev-server middleware: POST /api/ai  { system, prompt, schema?, max_tokens? }
 * Keeps the API key on the server. Returns { text } or { json } (structured output).
 */
export function aiProxy(): Plugin {
  return {
    name: 'ai-proxy',
    configureServer(server) {
      server.middlewares.use('/api/ai', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
        if (!process.env.ANTHROPIC_API_KEY) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ error: 'no_api_key' })); }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          try {
            const { system, prompt, schema, max_tokens = 4000 } = JSON.parse(body);
            const client = new Anthropic();
            const response = await client.messages.create({
              model: 'claude-opus-5',
              max_tokens,
              system,
              messages: [{ role: 'user', content: prompt }],
              output_config: {
                effort: 'low',
                ...(schema ? { format: { type: 'json_schema', schema } } : {}),
              },
            } as Anthropic.MessageCreateParamsNonStreaming);
            if (response.stop_reason === 'refusal') { res.statusCode = 422; return res.end(JSON.stringify({ error: 'refusal' })); }
            const text = response.content.filter((b) => b.type === 'text').map((b) => (b as Anthropic.TextBlock).text).join('');
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(schema ? { json: JSON.parse(text) } : { text }));
          } catch (e) {
            console.error('[ai-proxy]', e);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String((e as Error).message ?? e) }));
          }
        });
      });
    },
  };
}
