const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/doctors
// Retrieve list of doctors with special search filtering
// SECURITY FIX: Parameterized Prisma queries eliminate SQL injection vectors
router.get('/', authenticate, async (req, res) => {
  try {
    const { search, specialization } = req.query;

    // Build where clause safely using Prisma filters
    const where = {};

    if (search) {
      // Prisma parameterizes this query internally
      // No string interpolation means no injection possible
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (specialization && specialization !== 'All') {
      where.specialization = specialization;
    }

    const doctors = await prisma.doctor.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    res.json(doctors);
  } catch (error) {
    // Error handling: do not leak database query details
    res.status(500).json({ error: 'Failed to retrieve doctors' });
  }
});

// GET /api/doctors/stats
// Returns aggregation details about available doctors
// PERFORMANCE FIX: Parallel async calls using Promise.all()
router.get('/stats', authenticate, async (req, res) => {
  try {
    const start = Date.now();

    // Execute all independent queries in parallel, not sequentially
    const [totalDoctors, surgeonsCount, averageFee, highestExperience] = await Promise.all([
      prisma.doctor.count(),
      prisma.doctor.count({
        where: { department: 'Surgery' },
      }),
      prisma.doctor.aggregate({
        _avg: {
          consultationFee: true,
        },
      }),
      prisma.doctor.aggregate({
        _max: {
          experience: true,
        },
      }),
    ]);

    const durationMs = Date.now() - start;

    res.json({
      success: true,
      data: {
        total: totalDoctors,
        surgeons: surgeonsCount,
        averageFee: Math.round(averageFee._avg.consultationFee || 0),
        maxExperience: highestExperience._max.experience || 0,
      },
      debugInfo: {
        executionTimeMs: durationMs,
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve doctor statistics' });
  }
});

// GET /api/doctors/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const doctor = await prisma.doctor.findUnique({
      where: { id: req.params.id },
    });

    if (!doctor) {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    res.json(doctor);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve doctor' });
  }
});

module.exports = router;
