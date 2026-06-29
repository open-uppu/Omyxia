import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m', target: 100 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'http_req_duration{endpoint:login}': ['p(95)<300'],
    'http_req_duration{endpoint:me}': ['p(95)<80'],
  },
};

const BASE = 'http://localhost:3001';

export default function () {
  // 1. Login (cold)
  const loginRes = http.post(
    `${BASE}/auth/login`,
    JSON.stringify({ email: 'demo@tenant-x.test', password: 'demo123' }),
    { headers: { 'Content-Type': 'application/json' }, tags: { endpoint: 'login' } },
  );
  check(loginRes, { 'login 200': (r) => r.status === 200 });

  if (loginRes.status === 200) {
    const token = loginRes.json('accessToken');

    // 2. /auth/me (warm)
    const meRes = http.get(`${BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      tags: { endpoint: 'me' },
    });
    check(meRes, { 'me 200': (r) => r.status === 200 });
  }
}
