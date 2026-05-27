const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');
const { startOfUtcDay } = require('../utils/queueDay');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/queue
router.get('/', authenticate, async (req, res) => {
  try {
    const { doctorId, status } = req.query;

    const where = {};
    if (doctorId) where.doctorId = doctorId;
    if (status) where.status = status;

    const tokens = await prisma.queueToken.findMany({
      where,
      include: {
        patient: true,
        doctor: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json(tokens);
  } catch (error) {
    console.error('Queue list error:', error);
    res.status(500).json({ error: 'Failed to retrieve queue' });
  }
});

// POST /api/queue/checkin
router.post('/checkin', authenticate, async (req, res) => {
  try {
    const { patientId, doctorId, appointmentId } = req.body;

    if (!patientId || !doctorId) {
      return res.status(400).json({ error: 'Patient and Doctor ID are required for check-in.' });
    }

    const queueDay = startOfUtcDay();

    const newToken = await prisma.$transaction(async (tx) => {
      const counter = await tx.queueDailyCounter.upsert({
        where: {
          doctorId_queueDate: {
            doctorId,
            queueDate: queueDay,
          },
        },
        create: {
          doctorId,
          queueDate: queueDay,
          lastToken: 1,
        },
        update: {
          lastToken: { increment: 1 },
        },
      });

      return tx.queueToken.create({
        data: {
          tokenNumber: counter.lastToken,
          queueDay,
          patientId,
          doctorId,
          appointmentId: appointmentId || null,
          status: 'WAITING',
        },
        include: {
          patient: true,
          doctor: true,
        },
      });
    });

    res.status(201).json({
      message: 'Checked in successfully. Token generated.',
      token: newToken,
    });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({
        error: 'Token assignment conflict. Please retry check-in.',
      });
    }
    console.error('Queue check-in error:', error);
    res.status(500).json({ error: 'Check-in failed' });
  }
});

// PATCH /api/queue/:id
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const updatedToken = await prisma.queueToken.update({
      where: { id: req.params.id },
      data: { status },
      include: {
        patient: true,
        doctor: true,
      },
    });

    res.json(updatedToken);
  } catch (error) {
    console.error('Queue update error:', error);
    res.status(500).json({ error: 'Failed to update queue token' });
  }
});

module.exports = router;
