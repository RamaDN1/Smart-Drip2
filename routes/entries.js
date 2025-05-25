// ✅ ملف entries.js بعد تفعيل صلاحية nurse لتعبئة التنقيط
const express = require("express");
const router = express.Router();
const pool = require("../db");
const { authenticateToken, checkRole } = require('../middlewares/auth');

// 🔹 nurse و admin يمكنهم تعبئة التنقيط وإدخال المريض
router.post(
  "/",
  authenticateToken,
  checkRole(['admin']), 
  async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { 
        name, age, phone, emergency_phone, 
        medical_history, doctor_name, insurance, blood_group, room_id, admission_reason
      } = req.body;

      const roomCheck = await client.query(
        'SELECT id FROM rooms WHERE id = $1 AND occupied = false FOR UPDATE',
        [room_id]
      );

      if (roomCheck.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: "Room is not available or already occupied" });
      }

      const patientRes = await client.query(
        `INSERT INTO patients 
        (name, age, phone, emergency_phone, medical_history, doctor_name, insurance,
         blood_group, user_id, admission_reason)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id`,
        [
          name, 
          age, 
          phone || null, 
          emergency_phone || null,
          medical_history || 'None',
          doctor_name,
          insurance || 'No',
          blood_group ,
          req.user.user_id,
          admission_reason || 'Not specified'
        ]
      );

      const patientId = patientRes.rows[0].id;

      await client.query(
        'UPDATE rooms SET occupied = true WHERE id = $1',
        [room_id]
      );

      await client.query(
        `INSERT INTO entries 
        (patient_id, room_id, entry_date)
        VALUES ($1, $2, NOW())`,
        [patientId, room_id]
      );

      await client.query('COMMIT');

      res.status(201).json({
        success: true,
        message: "تم حفظ بيانات المريض وحجز الغرفة بنجاح",
        patient: {
          id: patientId,
          name,
          age,
          phone,
          emergency_phone,
          medical_history,
          doctor_name,
          insurance,
          blood_group
        }
      });

    } catch (err) {
      await client.query('ROLLBACK');
      console.error("Error saving patient:", err);
      res.status(500).json({
        success: false,
        error: "فشل في حفظ بيانات المريض",
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    } finally {
      client.release();
    }
  }
);

module.exports = router;


