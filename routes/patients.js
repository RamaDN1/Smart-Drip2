const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, checkRole } = require('../middlewares/auth');
const jwt = require('jsonwebtoken');
const { encrypt, decrypt } = require('../utils/encryption');

function isEncrypted(text) {
  return typeof text === 'string' && text.includes(':') && text.split(':')[0].length === 32;
}
// 🔹 تجديد التوكن تلقائياً عند انتهاء الصلاحية
const refreshTokenIfNeeded = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return next();

  try {
    const decoded = jwt.decode(token);
    if (decoded.exp * 1000 < Date.now()) {
      const user = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.user_id]);
      if (user.rows.length > 0) {
        const newToken = jwt.sign(
          { user_id: user.rows[0].id, email: user.rows[0].email },
          process.env.JWT_SECRET,
          { expiresIn: '1h' }
        );
        res.set('New-Token', newToken);
      }
    }
    next();
  } catch (err) {
    next();
  }
};

// 🔹 الحصول على جميع المرضى مع مراجعاتهم
router.get('/patients-with-medical_report', authenticateToken, checkRole(['admin', 'doctor', 'nurse']), async (req, res) => {
  try {
    const role = req.user.role;
    const userId = req.user.user_id;

    const result = await pool.query(`
      SELECT 
        p.id,
        p.name,
        p.age,
        p.phone,
        p.emergency_phone,
        p.medical_history,
        p.doctor_name,
        p.blood_group,
        p.insurance,
        p.admission_date,
        p.admission_reason,
        r.id as review_id,
        r.review_date,
        r.review_time,
        TO_CHAR(r.review_date, 'YYYY-MM-DD') as formatted_review_date,
        TO_CHAR(r.review_time, 'HH24:MI') as formatted_review_time
      FROM patients p
      LEFT JOIN medical_report r ON p.id = r.patient_id
      ${role === 'admin' ? '' : 'WHERE p.user_id = $1'}
      ORDER BY p.name
    `, role === 'admin' ? [] : [userId]);

   result.rows.forEach(p => {
      if (p.medical_history && isEncrypted(p.medical_history)) {
        try {
          p.medical_history = decrypt(p.medical_history);
        } catch (e) {
          console.error('❌ Decryption error (medical_history):', e.message);
          p.medical_history = '[غير قابل للقراءة]';
        }
      }
    });

    res.json({
      success: true,
      patients: result.rows
    });
  } catch (err) {
    console.error('Error fetching patients with reviews:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch patients with reviews',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// 🔹 الحصول على جميع المرضى (بحث + فلترة)
router.get('/', authenticateToken, checkRole(['admin', 'doctor', 'nurse']), async (req, res) => {
  try {
    const { search, room_id } = req.query;
    const role = req.user.role;
    const userId = req.user.user_id;

    let query = `
      SELECT 
        p.id,
        p.name,
        p.age,
        p.phone,
        p.emergency_phone,
        p.medical_history,
        p.doctor_name,
        p.blood_group,
        p.insurance,
        p.admission_date,
        r.room_number,
        r.floor
      FROM patients p
      LEFT JOIN rooms r ON p.room_id = r.id
    `;

    const params = [];
    let conditions = [];

    if (role !== 'admin') {
      conditions.push(`p.user_id = $${params.length + 1}`);
      params.push(userId);
    }

    if (search) {
      conditions.push(`(p.name ILIKE $${params.length + 1} OR p.doctor_name ILIKE $${params.length + 1})`);
      params.push(`%${search}%`);
    }

    if (room_id) {
      conditions.push(`p.room_id = $${params.length + 1}`);
      params.push(room_id);
    }

    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }

    query += ' ORDER BY p.name';

    const result = await pool.query(query, params);

    result.rows.forEach(p => {
      if (p.medical_history && isEncrypted(p.medical_history)) {
        try {
          p.medical_history = decrypt(p.medical_history);
        } catch (e) {
          console.error('❌ Decryption error (medical_history):', e.message);
          p.medical_history = '[غير قابل للقراءة]';
        }
      }
    });

    res.json({
      success: true,
      patients: result.rows
    });
  } catch (err) {
    console.error('Error fetching patients:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch patients'
    });
  }
});

// 🔹 الحصول على مريض محدد
router.get('/:id', authenticateToken, checkRole(['admin', 'doctor', 'nurse']), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT 
        p.*,
        r.room_number,
        r.floor,
        r.occupied,
        v.status as valve_status
      FROM patients p
      LEFT JOIN rooms r ON p.room_id = r.id
      LEFT JOIN valve_status v ON r.id = v.room_id
      WHERE p.id = $1 AND p.user_id = $2
    `, [id, req.user.user_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Patient not found',
        details: 'المريض غير موجود أو ليس لديك صلاحية الوصول'
      });
    }

    const patient = result.rows[0];
    if (patient.medical_history && isEncrypted(patient.medical_history)) {
      try {
        patient.medical_history = decrypt(patient.medical_history);
      } catch (e) {
        console.error('❌ Decryption error (medical_history):', e.message);
        patient.medical_history = '[غير قابل للقراءة]';
      }
    }

    res.json({
      success: true,
      patient
    });
  } catch (err) {
    console.error('Error fetching patient details:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch patient details',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// 🔹 إضافة مريض جديد
router.post('/', authenticateToken, checkRole(['admin']), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { 
      name, age, phone, emergency_phone, 
      medical_history, doctor_name, blood_group, 
      room_id, admission_date, insurance = 'No',
      admission_reason , user_id
    } = req.body;

    if (!name || !age || !doctor_name || !blood_group || !room_id || !admission_date || !user_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        details: 'الحقول المطلوبة: الاسم، العمر، اسم الطبيب، فصيلة الدم، رقم الغرفة، تاريخ الدخول'
      });
    }

    const roomCheck = await client.query(
      'SELECT id FROM rooms WHERE id = $1 AND occupied = false FOR UPDATE',
      [room_id]
    );

    if (roomCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false,
        error: 'Room is not available',
        details: 'الغرفة غير متاحة أو محجوزة بالفعل'
      });
    }

    const patientResult = await client.query(
      `INSERT INTO patients 
       (name, age, phone, emergency_phone, medical_history,
        doctor_name, blood_group, room_id, insurance,
        admission_date, admission_reason, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        name, 
        age, 
        phone || null, 
        emergency_phone || null,
        encrypt(medical_history || 'None'),
        doctor_name,
        blood_group,
        room_id,
        insurance,
        new Date(admission_date).toISOString(),
        admission_reason || 'Not specified',
        user_id
      ]
    );

    await client.query(
      'UPDATE rooms SET occupied = true WHERE id = $1',
      [room_id]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'تم إضافة المريض بنجاح',
      patient: patientResult.rows[0]
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error adding patient:', err);

    if (err.code === '23505') {
      return res.status(409).json({ 
        success: false,
        error: 'Patient already exists',
        details: 'المريض مسجل بالفعل في النظام'
      });
    }

    res.status(500).json({ 
      success: false,
      error: 'Failed to add patient',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  } finally {
    client.release();
  }
});

// 🔹 تحديث بيانات المريض
router.put('/:id', authenticateToken, checkRole([ 'doctor', 'nurse']), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const { 
      name, age, phone, emergency_phone,
      medical_history, doctor_name, blood_group,
      room_id, admission_date, insurance
    } = req.body;

    const patientCheck = await client.query(
      'SELECT id, room_id FROM patients WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [id, req.user.user_id]
    );

    if (patientCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ 
        success: false,
        error: 'Patient not found',
        details: 'المريض غير موجود أو ليس لديك صلاحية التعديل'
      });
    }

    const currentRoomId = patientCheck.rows[0].room_id;

    if (room_id && room_id !== currentRoomId) {
      const patientsInOldRoom = await client.query(
        'SELECT id FROM patients WHERE room_id = $1 AND id != $2',
        [currentRoomId, id]
      );

      if (patientsInOldRoom.rows.length === 0) {
        await client.query(
          'UPDATE rooms SET occupied = false WHERE id = $1',
          [currentRoomId]
        );
      }

      const newRoomCheck = await client.query(
        'SELECT id FROM rooms WHERE id = $1 AND occupied = false FOR UPDATE',
        [room_id]
      );

      if (newRoomCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          success: false,
          error: 'New room is not available',
          details: 'الغرفة الجديدة غير متاحة'
        });
      }

      await client.query(
        'UPDATE rooms SET occupied = true WHERE id = $1',
        [room_id]
      );
    }

    const result = await client.query(
      `UPDATE patients 
       SET name = $1, age = $2, phone = $3, emergency_phone = $4,
           medical_history = $5, doctor_name = $6, blood_group = $7,
           insurance = $8, room_id = $9, admission_date = $10,
           updated_at = NOW()
       WHERE id = $11
       RETURNING *`,
      [
        name, 
        age, 
        phone || null, 
        emergency_phone || null,
        encrypt(medical_history || 'None'),
        doctor_name,
        blood_group,
        insurance || 'No',
        room_id || currentRoomId,
        new Date(admission_date).toISOString(),
        id
      ]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'تم تحديث بيانات المريض بنجاح',
      patient: result.rows[0]
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error updating patient:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to update patient',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  } finally {
    client.release();
  }
});

module.exports = router;
