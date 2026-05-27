const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorizeAdminOnly } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

const ALLOWED_GENDERS = new Set(['male', 'female', 'other']);

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeGender(value) {
  if (!value) return null;
  const g = String(value).trim().toLowerCase();
  if (g === 'all') return null;
  return g;
}

function isValidPhoneNumber(phoneNumber) {
  // Keep it usable: allow digits with optional leading +, spaces/hyphens.
  const raw = String(phoneNumber || '').trim();
  if (!raw) return false;
  const normalized = raw.replace(/[\s-]/g, '');
  return /^\+?\d{8,15}$/.test(normalized);
}

// GET /api/patients
// Get patients with DB-level filtering + pagination
router.get('/', authenticate, async (req, res) => {
  try {
    const { search } = req.query;
    const gender = normalizeGender(req.query.gender);

    const page = parsePositiveInt(req.query.page, 1);
    const limitRaw = parsePositiveInt(req.query.limit, 5);
    const limit = Math.min(limitRaw, 50);
    const offset = (page - 1) * limit;

    const where = {};

    if (search && String(search).trim()) {
      const q = String(search).trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { phoneNumber: { contains: q } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (gender) {
      where.gender = { equals: gender, mode: 'insensitive' };
    }

    const [totalPatients, patients] = await prisma.$transaction([
      prisma.patient.count({ where }),
      prisma.patient.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
    ]);

    const totalPages = Math.ceil(totalPatients / limit);

    // Inconsistent Response style
    res.json({
      success: true,
      patients,
      pagination: {
        page,
        limit,
        totalPatients,
        totalPages,
      },
    });
  } catch (error) {
    console.error('Patients list error:', error);
    res.status(500).json({ error: 'Failed to fetch patients' });
  }
});

// GET /api/patients/:id
// Get patient details by ID. Notice N+1 issue could be placed here or in appointments,
// but let's make it fetch the patient with their appointments and tokens.
router.get('/:id', authenticate, async (req, res) => {
  try {
    const patient = await prisma.patient.findUnique({
      where: { id: req.params.id },
      include: {
        appointments: true, // Fetching relation direct
      },
    });

    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    res.json(patient);
  } catch (error) {
    console.error('Patient fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch patient' });
  }
});

// POST /api/patients (Register patient)
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, email, phoneNumber, age, gender, medicalHistory } = req.body;

    // INCONSISTENT VALIDATION:
    // Email is nullable in schema, but here we only check missing fields.
    // No regex to check telephone number formats, allowing random strings like "abc" to be stored!
    if (!name || !phoneNumber || age === undefined || age === null || !gender) {
      return res.status(400).json({ error: 'Name, phoneNumber, age, and gender are required.' });
    }

    if (!isValidPhoneNumber(phoneNumber)) {
      return res.status(400).json({ error: 'Invalid phoneNumber format.' });
    }

    const parsedAge = Number.parseInt(String(age), 10);
    if (!Number.isFinite(parsedAge) || parsedAge < 0 || parsedAge > 120) {
      return res.status(400).json({ error: 'Invalid age. Must be between 0 and 120.' });
    }

    const normalizedGender = String(gender).trim().toLowerCase();
    if (!ALLOWED_GENDERS.has(normalizedGender)) {
      return res.status(400).json({ error: 'Invalid gender. Use male, female, or other.' });
    }

    const patient = await prisma.patient.create({
      data: {
        name,
        email: email || null,
        phoneNumber,
        age: parsedAge,
        gender: normalizedGender,
        medicalHistory: medicalHistory || null, // Can be null, will crash UI without optional chaining
      },
    });

    res.status(201).json(patient);
  } catch (error) {
    console.error('Patient create error:', error);
    res.status(500).json({ error: 'Failed to register patient' });
  }
});

// DELETE /api/patients/:id — admin only
router.delete('/:id', authenticate, authorizeAdminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    const patient = await prisma.patient.findUnique({ where: { id } });
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    await prisma.patient.delete({ where: { id } });

    res.json({ message: `Successfully deleted patient ${patient.name}` });
  } catch (error) {
    console.error('Patient delete error:', error);
    res.status(500).json({ error: 'Failed to delete patient' });
  }
});

module.exports = router;
