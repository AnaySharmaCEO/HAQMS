-- Baseline migration for HAQMS (full schema create).
-- This repository previously shipped without an initial Prisma migration.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Enums
DO $$ BEGIN
  CREATE TYPE "Role" AS ENUM ('ADMIN', 'DOCTOR', 'RECEPTIONIST');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "QueueStatus" AS ENUM ('WAITING', 'CALLING', 'COMPLETED', 'SKIPPED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Tables
CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "email" TEXT NOT NULL,
  "password" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "role" "Role" NOT NULL DEFAULT 'RECEPTIONIST',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");

CREATE TABLE IF NOT EXISTS "Doctor" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "userId" TEXT,
  "name" TEXT NOT NULL,
  "specialization" TEXT NOT NULL,
  "department" TEXT NOT NULL,
  "consultationFee" DOUBLE PRECISION NOT NULL,
  "experience" INTEGER NOT NULL,
  "availableFrom" TEXT NOT NULL DEFAULT '09:00',
  "availableTo" TEXT NOT NULL DEFAULT '17:00',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Doctor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Doctor_userId_key" ON "Doctor"("userId");

ALTER TABLE "Doctor"
  ADD CONSTRAINT "Doctor_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Doctor_department_idx" ON "Doctor"("department");
CREATE INDEX IF NOT EXISTS "Doctor_specialization_idx" ON "Doctor"("specialization");

CREATE TABLE IF NOT EXISTS "Patient" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "phoneNumber" TEXT NOT NULL,
  "age" INTEGER NOT NULL,
  "gender" TEXT NOT NULL,
  "medicalHistory" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Appointment" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "patientId" TEXT NOT NULL,
  "doctorId" TEXT NOT NULL,
  "appointmentDate" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL DEFAULT '',
  "status" "AppointmentStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_doctorId_fkey"
  FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "Appointment_doctorId_appointmentDate_key"
  ON "Appointment"("doctorId", "appointmentDate");

CREATE INDEX IF NOT EXISTS "Appointment_patientId_idx" ON "Appointment"("patientId");
CREATE INDEX IF NOT EXISTS "Appointment_doctorId_status_idx" ON "Appointment"("doctorId", "status");

CREATE TABLE IF NOT EXISTS "QueueDailyCounter" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "doctorId" TEXT NOT NULL,
  "queueDate" DATE NOT NULL,
  "lastToken" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "QueueDailyCounter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "QueueDailyCounter_doctorId_queueDate_key"
  ON "QueueDailyCounter"("doctorId", "queueDate");

ALTER TABLE "QueueDailyCounter"
  ADD CONSTRAINT "QueueDailyCounter_doctorId_fkey"
  FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "QueueToken" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "tokenNumber" INTEGER NOT NULL,
  "queueDay" DATE NOT NULL,
  "patientId" TEXT NOT NULL,
  "doctorId" TEXT NOT NULL,
  "appointmentId" TEXT,
  "status" "QueueStatus" NOT NULL DEFAULT 'WAITING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QueueToken_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "QueueToken"
  ADD CONSTRAINT "QueueToken_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QueueToken"
  ADD CONSTRAINT "QueueToken_doctorId_fkey"
  FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QueueToken"
  ADD CONSTRAINT "QueueToken_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "QueueToken_doctorId_queueDay_tokenNumber_key"
  ON "QueueToken"("doctorId", "queueDay", "tokenNumber");

CREATE INDEX IF NOT EXISTS "QueueToken_patientId_idx" ON "QueueToken"("patientId");
CREATE INDEX IF NOT EXISTS "QueueToken_doctorId_status_idx" ON "QueueToken"("doctorId", "status");
CREATE INDEX IF NOT EXISTS "QueueToken_doctorId_createdAt_idx" ON "QueueToken"("doctorId", "createdAt");
