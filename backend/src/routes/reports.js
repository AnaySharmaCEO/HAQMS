const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');
const { startOfUtcDay } = require('../utils/queueDay');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/reports/doctor-stats
// Optimized aggregate reporting for admin/receptionists dashboard.
router.get('/doctor-stats', authenticate, async (req, res) => {
  try {
    const start = Date.now();

    const queueDay = startOfUtcDay();

    const [
      doctors,
      totalAppointmentsByDoctor,
      completedAppointmentsByDoctor,
      cancelledAppointmentsByDoctor,
      todayQueueByDoctor,
    ] = await Promise.all([
      prisma.doctor.findMany({
        select: {
          id: true,
          name: true,
          specialization: true,
          department: true,
          consultationFee: true,
        },
      }),
      prisma.appointment.groupBy({
        by: ['doctorId'],
        _count: { _all: true },
      }),
      prisma.appointment.groupBy({
        by: ['doctorId'],
        where: { status: 'COMPLETED' },
        _count: { _all: true },
      }),
      prisma.appointment.groupBy({
        by: ['doctorId'],
        where: { status: 'CANCELLED' },
        _count: { _all: true },
      }),
      prisma.queueToken.groupBy({
        by: ['doctorId'],
        where: { queueDay },
        _count: { _all: true },
      }),
    ]);

    const toCountMap = (rows) => {
      const m = new Map();
      for (const r of rows) m.set(r.doctorId, r._count._all);
      return m;
    };

    const totalMap = toCountMap(totalAppointmentsByDoctor);
    const completedMap = toCountMap(completedAppointmentsByDoctor);
    const cancelledMap = toCountMap(cancelledAppointmentsByDoctor);
    const queueMap = toCountMap(todayQueueByDoctor);

    const reportData = doctors.map((doc) => {
      const totalAppointments = totalMap.get(doc.id) || 0;
      const completedAppointments = completedMap.get(doc.id) || 0;
      const cancelledAppointments = cancelledMap.get(doc.id) || 0;
      const todayQueueSize = queueMap.get(doc.id) || 0;

      // Revenue is based on completed appointments (no need to fetch rows).
      const revenue = completedAppointments * doc.consultationFee;

      return {
        id: doc.id,
        name: doc.name,
        specialization: doc.specialization,
        department: doc.department,
        totalAppointments,
        completedAppointments,
        cancelledAppointments,
        todayQueueSize,
        revenue,
      };
    });

    const durationMs = Date.now() - start;

    res.json({
      success: true,
      timeTakenMs: durationMs,
      data: reportData,
    });
  } catch (error) {
    console.error('Doctor stats report error:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

module.exports = router;
