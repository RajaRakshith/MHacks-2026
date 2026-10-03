// Calls a SpacetimeDB reducer over HTTP: POST /v1/database/:db/call/:reducer with a JSON array of args.
// Docs: https://spacetimedb.com/docs/http/database

export async function callReducer(reducer, args) {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.SPACETIME_TOKEN) headers.Authorization = `Bearer ${process.env.SPACETIME_TOKEN}`;

  const res = await fetch(`${process.env.SPACETIME_HOST || 'https://maincloud.spacetimedb.com'}/v1/database/${process.env.SPACETIME_DB}/call/${reducer}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`SpacetimeDB ${reducer} ${res.status}: ${await res.text()}`);
}
