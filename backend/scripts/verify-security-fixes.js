/**
 * Smoke tests for Phase 1 security / integrity fixes.
 * Run: node scripts/verify-security-fixes.js
 * Requires: DB migrated + seeded, server on PORT (default 5000).
 */
const http = require('http');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

const BASE = `http://127.0.0.1:${process.env.PORT || 5000}`;
const JWT_SECRET = process.env.JWT_SECRET;

function request(method, path, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch {
            json = data;
          }
          resolve({ status: res.statusCode, body: json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function login(email) {
  const res = await request('POST', '/api/auth/login', {
    body: { email, password: 'password123' },
  });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(res.body)}`);
  }
  return res.body.data.token;
}

async function main() {
  const results = [];

  const assert = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? `: ${detail}` : ''}`);
  };

  // Login
  const adminToken = await login('admin@haqms.com');
  const receptionToken = await login('reception1@haqms.com');
  assert('Admin login', !!adminToken);
  assert('Receptionist login', !!receptionToken);

  // Expired JWT rejected
  const expired = jwt.sign(
    { id: 'x', email: 'a@b.com', role: 'ADMIN', name: 'X' },
    JWT_SECRET,
    { expiresIn: '-1s' }
  );
  const expiredRes = await request('GET', '/api/auth/me', { token: expired });
  assert('Expired JWT returns 401', expiredRes.status === 401, String(expiredRes.status));

  // Admin-only delete
  const patientsRes = await request('GET', '/api/patients?limit=1', { token: adminToken });
  const patientId = patientsRes.body?.patients?.[0]?.id;
  if (patientId) {
    const forbidden = await request('DELETE', `/api/patients/${patientId}`, {
      token: receptionToken,
    });
    assert('Non-admin delete returns 403', forbidden.status === 403, String(forbidden.status));
  } else {
    assert('Non-admin delete returns 403', false, 'no patient in seed');
  }

  // Doctor search (parameterized path — no SQL error on quote payload)
  const inj = await request('GET', "/api/doctors?search=test'%20OR%201=1--", {
    token: adminToken,
  });
  assert('Doctor search handles injection payload', inj.status === 200, String(inj.status));

  // Double booking
  const doctors = await request('GET', '/api/doctors', { token: adminToken });
  const doctorId = Array.isArray(doctors.body) ? doctors.body[0]?.id : null;
  const pList = await request('GET', '/api/patients', { token: adminToken });
  const patientId2 = pList.body?.patients?.[0]?.id;

  if (doctorId && patientId2) {
    const slot = new Date(Date.now() + 86400000 * 30).toISOString();
    const book1 = await request('POST', '/api/appointments', {
      token: adminToken,
      body: { patientId: patientId2, doctorId, appointmentDate: slot, reason: 'test-dup' },
    });
    const book2 = await request('POST', '/api/appointments', {
      token: adminToken,
      body: { patientId: patientId2, doctorId, appointmentDate: slot, reason: 'test-dup-2' },
    });
    assert(
      'Duplicate appointment blocked',
      book1.status === 201 && book2.status === 409,
      `first=${book1.status} second=${book2.status}`
    );
  } else {
    assert('Duplicate appointment blocked', false, 'missing doctor/patient');
  }

  // Concurrent queue check-ins
  if (doctorId && patientId2) {
    const checkins = await Promise.all(
      Array.from({ length: 8 }, () =>
        request('POST', '/api/queue/checkin', {
          token: adminToken,
          body: { patientId: patientId2, doctorId },
        })
      )
    );
    const numbers = checkins
      .filter((r) => r.status === 201)
      .map((r) => r.body?.token?.tokenNumber)
      .filter((n) => typeof n === 'number');
    const unique = new Set(numbers);
    assert(
      'Concurrent check-ins yield unique token numbers',
      numbers.length === 8 && unique.size === 8,
      `tokens=${numbers.join(',')}`
    );
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    process.exit(1);
  }
  console.log('\nAll security smoke tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
