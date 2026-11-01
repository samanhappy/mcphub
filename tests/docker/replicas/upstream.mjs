import http from 'node:http';

let executions = 0;
let refreshes = 0;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const schema = {
  openapi: '3.0.3',
  info: { title: 'Replica fixture', version: '1' },
  servers: [{ url: 'http://upstream:4000' }],
  paths: {
    '/echo': { post: { operationId: 'echo', responses: { 200: { description: 'ok' } } } },
    '/slow': { post: { operationId: 'slow', responses: { 200: { description: 'ok' } } } },
    '/drop': { post: { operationId: 'drop', responses: { 200: { description: 'ok' } } } },
  },
};
http
  .createServer(async (req, res) => {
    if (req.url === '/schema') return res.end(JSON.stringify(schema));
  if (req.url === '/count') return res.end(JSON.stringify({ executions, refreshes }));
  if (req.url === '/oauth/token') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(body);
    res.setHeader('Content-Type', 'application/json');
    refreshes++;
    if (refreshes !== 1 || form.get('refresh_token') !== 'refresh-0') {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'invalid_grant' }));
    }
    await wait(100);
    return res.end(JSON.stringify({ access_token: 'access-1', refresh_token: 'refresh-1', token_type: 'Bearer', expires_in: 3600 }));
  }
    executions++;
    if (req.url === '/slow') await wait(1500);
    if (req.url === '/drop') return req.socket.destroy();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, executions }));
  })
  .listen(4000, '0.0.0.0');
