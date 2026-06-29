import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'http_req_duration{endpoint:bi}': ['p(95)<200'],
  },
};

const BASE = 'http://localhost:3001';

export default function () {
  const token = __ENV.TOKEN || '';
  const res = http.get(`${BASE}/bi/dashboards`, {
    headers: { Authorization: `Bearer ${token}` },
    tags: { endpoint: 'bi' },
  });
  check(res, { 'bi 200': (r) => r.status === 200 });
}
