const base = process.env.ENOS_URL || 'http://127.0.0.1:8787';
const body = {
  provider: process.env.SEARCH_PROVIDER || 'deepseek',
  apiKey: process.env.SEARCH_KEY || '',
  baseUrl: process.env.SEARCH_BASE || '',
  model: process.env.SEARCH_MODEL || '',
  query: process.argv[2] || 'urban gardening benefits',
  count: 3,
  summarize: true,
};
const response = await fetch(`${base}/api/search`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const text = await response.text();
console.log('status', response.status);
console.log(text.slice(0, 4000));
