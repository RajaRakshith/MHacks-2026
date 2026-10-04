// Maincloud SQL returns positional SATS-JSON sums: option some=[0, v], none=[1, []],
// status Active=[0, []], Ended=[1, []]. Named { some } / { Active } is only the reducer-arg form.
import http from 'node:http';
import { check } from './mocks.mjs';
import { startCallSession } from '../src/spacetime.js';

const callSid = 'CA0e2054fe948eb32283747e88ea707f69';
const schema = {
  elements: [
    'id', 'userId', 'startedAt', 'endedAt', 'riskScore', 'status', 'callerNumber', 'twilioCallSid',
  ].map((n) => ({ name: { some: n } })),
};

const server = http.createServer((req, res) => {
  const body = [];
  req.on('data', (c) => body.push(c));
  req.on('end', () => {
    if (req.url.endsWith('/sql')) {
      res.end(JSON.stringify([{
        schema,
        rows: [
          [1, 'demo-user', [1], [0, [2]], 0, [1, []], [1, []], [0, 'CA-OLD']],
          [7, 'demo-user', [3], [1, []], 0, [0, []], [0, '+12486020781'], [0, callSid]],
        ],
      }]));
      return;
    }
    res.end();
  });
}).listen(9701);

Object.assign(process.env, {
  SPACETIME_URI: 'http://localhost:9701',
  SPACETIME_DATABASE: 'scamshield',
});

try {
  const id = await startCallSession({ userId: 'demo-user', callerNumber: '+12486020781', callSid });
  check('finds active session from positional SATS-JSON SQL rows', id === 7, id);
} catch (e) {
  check('finds active session from positional SATS-JSON SQL rows', false, e.message);
}

const named = http.createServer((req, res) => {
  const body = [];
  req.on('data', (c) => body.push(c));
  req.on('end', () => {
    if (req.url.endsWith('/sql')) {
      res.end(JSON.stringify([{
        schema,
        rows: [[9, 'u1', 0, { none: [] }, 0, { Active: [] }, { some: '+1' }, { some: 'CA-NAMED' }]],
      }]));
      return;
    }
    res.end();
  });
}).listen(9702);

process.env.SPACETIME_URI = 'http://localhost:9702';
try {
  const id = await startCallSession({ userId: 'u1', callSid: 'CA-NAMED' });
  check('still finds named SATS-JSON { some } / { Active } rows', id === 9, id);
} catch (e) {
  check('still finds named SATS-JSON { some } / { Active } rows', false, e.message);
}

server.close();
named.close();
