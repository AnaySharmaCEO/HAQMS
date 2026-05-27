'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Navbar from '@/components/common/Navbar';
import { useAuth } from '@/context/AuthContext';
import { AlertCircle, CalendarDays, ClipboardList, User } from 'lucide-react';

export default function HistoryRecordsPage() {
  const params = useParams();
  const patientId = params?.id;
  const { token, API_BASE_URL } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [patient, setPatient] = useState(null);
  const [doctorsById, setDoctorsById] = useState(new Map());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');

      try {
        if (!token) {
          throw new Error('You must be logged in to view history records.');
        }
        if (!patientId) {
          throw new Error('Missing patient id.');
        }

        const [patientRes, doctorsRes] = await Promise.all([
          fetch(`${API_BASE_URL}/patients/${patientId}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API_BASE_URL}/doctors`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        const patientData = await patientRes.json();
        const doctorsData = await doctorsRes.json();

        if (!patientRes.ok) {
          throw new Error(patientData?.error || 'Failed to load patient record.');
        }
        if (!doctorsRes.ok) {
          throw new Error(doctorsData?.error || 'Failed to load doctors list.');
        }

        const map = new Map();
        for (const d of doctorsData || []) {
          map.set(d.id, d);
        }

        if (!cancelled) {
          setPatient(patientData);
          setDoctorsById(map);
        }
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load history records.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [API_BASE_URL, patientId, token]);

  const appointments = useMemo(() => {
    const apps = patient?.appointments || [];
    return [...apps].sort((a, b) => new Date(b.appointmentDate) - new Date(a.appointmentDate));
  }, [patient]);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-6xl w-full mx-auto p-6 sm:p-8">
        <div className="glass p-6 sm:p-8 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-800 mb-8">
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-teal-600" />
            Patient History Records
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 font-semibold">
            Appointment history and clinical background for the selected patient.
          </p>
        </div>

        {error && (
          <div className="p-4 mb-6 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-500 flex items-center gap-3 text-sm">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <div>
              <strong>Unable to load:</strong> {error}
            </div>
          </div>
        )}

        {loading ? (
          <div className="glass p-10 rounded-2xl border border-slate-200 dark:border-slate-800 text-center">
            <p className="text-slate-400 font-semibold">Loading history records…</p>
          </div>
        ) : patient ? (
          <div className="space-y-8">
            <div className="glass p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-md">
              <h2 className="text-lg font-extrabold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <User className="h-5 w-5 text-teal-600" />
                {patient.name}
              </h2>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-2">
                {patient.gender ? `Gender: ${patient.gender}` : 'Gender: —'}{' '}
                {patient.age !== undefined && patient.age !== null ? `| Age: ${patient.age}` : ''}
                {patient.phoneNumber ? ` | Contact: ${patient.phoneNumber}` : ''}
              </p>

              <div className="mt-5 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Medical History
                </h3>
                <p className="text-slate-700 dark:text-slate-300 text-sm font-semibold leading-6">
                  {patient.medicalHistory ? patient.medicalHistory : 'No medical history recorded.'}
                </p>
              </div>
            </div>

            <div className="glass p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-md">
              <h2 className="text-lg font-extrabold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-4">
                <CalendarDays className="h-5 w-5 text-teal-600" />
                Appointment History
              </h2>

              {appointments.length === 0 ? (
                <p className="text-slate-400 text-sm font-semibold">No appointments recorded for this patient.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800 text-sm text-left">
                    <thead>
                      <tr className="text-slate-400 uppercase tracking-widest text-xxs font-bold border-b border-slate-200 dark:border-slate-800">
                        <th className="pb-3">Date</th>
                        <th className="pb-3">Doctor</th>
                        <th className="pb-3">Reason</th>
                        <th className="pb-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {appointments.map((a) => {
                        const doc = doctorsById.get(a.doctorId);
                        return (
                          <tr key={a.id} className="hover:bg-slate-500/5 transition-colors">
                            <td className="py-3.5 font-mono font-bold text-slate-800 dark:text-slate-200">
                              {new Date(a.appointmentDate).toLocaleString()}
                            </td>
                            <td className="py-3.5 text-slate-700 dark:text-slate-300 font-semibold">
                              {doc ? doc.name : 'Unknown doctor'}
                              {doc?.specialization ? (
                                <span className="block text-xxs text-slate-400 mt-0.5">{doc.specialization}</span>
                              ) : null}
                            </td>
                            <td className="py-3.5 text-slate-500 dark:text-slate-400 font-semibold">
                              {a.reason || '—'}
                            </td>
                            <td className="py-3.5">
                              <span
                                className={`inline-flex px-2 py-0.5 rounded text-xxs font-extrabold tracking-wide uppercase ${
                                  a.status === 'COMPLETED'
                                    ? 'bg-teal-500/10 text-teal-600'
                                    : a.status === 'CANCELLED'
                                      ? 'bg-rose-500/10 text-rose-500'
                                      : 'bg-amber-500/10 text-amber-500'
                                }`}
                              >
                                {a.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

