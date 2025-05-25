const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, checkRole } = require('../middlewares/auth');
const { body, validationResult } = require('express-validator');

// ✅ التحقق من صحة البيانات
const validateReviewData = [
  body('patient_id').isInt().withMessage('معرف المريض يجب أن يكون رقماً صحيحاً'),
  body('review_date').isDate().withMessage('تاريخ غير صحيح'),
  body('review_time').matches(/^([01]\d|2[0-3]):([0-5]\d)$/).withMessage('توقيت غير صحيح (HH:MM)')
];

// ✅ إنشاء موعد مراجعة جديد
router.post('/', authenticateToken,  checkRole(['doctor', 'admin']),validateReviewData, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      success: false,
      errors: errors.array() 
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { patient_id, review_date, review_time, admission_reason } = req.body;
    const user_id = req.user.user_id;

    // التأكد من أن المريض يخص المستخدم
    const patientExists = await client.query(
      'SELECT id, admission_reason FROM patients WHERE id = $1 AND user_id = $2',
      [patient_id, user_id]
    );

    if (patientExists.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: 'المريض غير موجود أو غير مسموح بالوصول'
      });
    }

    // استخدام سبب الدخول من المريض إذا لم يتم تحديده
    const finalAdmissionReason = admission_reason || patientExists.rows[0].admission_reason || 'Not specified';

    // منع الموعد المكرر
    const existingReview = await client.query(
      `SELECT id FROM reviews 
       WHERE patient_id = $1 AND review_date = $2 AND review_time = $3`,
      [patient_id, review_date, review_time]
    );

    if (existingReview.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        error: 'هذا الموعد مسجل مسبقاً'
      });
    }

    // إدخال الموعد مع سبب الدخول
    const result = await client.query(
      `INSERT INTO reviews 
       (patient_id, review_date, review_time, user_id, admission_reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [patient_id, review_date, review_time, user_id, finalAdmissionReason]
    );

    // تحديث سجل المريض مع تاريخ ووقت المراجعة بنفس القيم المدخلة
  await client.query(
    `UPDATE patients
     SET review_date = $1,
         review_time = $2,
         review = $3
     WHERE id = $4`,
    [review_date, review_time, `${review_date} ${review_time}`, patient_id]
  );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'تم إنشاء الموعد بنجاح',
      data: result.rows[0]
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('فشل في إنشاء الموعد:', err);

    let statusCode = 500;
    let errorMessage = 'حدث خطأ أثناء إنشاء الموعد';

    if (err.code === '23503') {
      statusCode = 400;
      errorMessage = 'المريض غير موجود في النظام';
    } else if (err.code === '22007') {
      statusCode = 400;
      errorMessage = 'تنسيق التاريخ أو الوقت غير صحيح';
    }

    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });

  } finally {
    client.release();
  }
});

// ✅ الحصول على جميع المواعيد مع سبب الدخول
 // للحصول على جميع المواعيد (بدون فلترة)
router.get('/all', authenticateToken, checkRole(['admin']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.*, p.name as patient_name, u.name as doctor_name
      FROM reviews r
      JOIN patients p ON r.patient_id = p.id
      JOIN users u ON r.user_id = u.id
      ORDER BY r.review_date DESC, r.review_time DESC
    `);
    
    res.json({ 
      success: true,
      appointments: result.rows 
    });
  } catch (err) {
    console.error('Error fetching all appointments:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch appointments' 
    });
  }
});

// للحصول على المواعيد الحديثة (آخر 7)
router.get('/recent', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.*, p.name as patient_name, u.name as doctor_name
      FROM reviews r
      JOIN patients p ON r.patient_id = p.id
      JOIN users u ON r.user_id = u.id
      ORDER BY r.review_date DESC, r.review_time DESC
      LIMIT 7
    `);
    
    res.json({ 
      success: true,
      reviews: result.rows 
    });
  } catch (err) {
    console.error('Error fetching recent appointments:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch recent appointments' 
    });
  }
});

// ✅ الحصول على مراجعات مريض معين مع تاريخ ووقت المراجعة
router.get('/patient/:patient_id', authenticateToken, async (req, res) => {
  const { patient_id } = req.params;
  
  try {
    const result = await pool.query(
      `SELECT 
          r.id,
          r.review_date, 
          r.review_time, 
          r.doctor_notes, 
          r.admission_reason,
          TO_CHAR(r.review_date, 'YYYY-MM-DD') as formatted_date,
          TO_CHAR(r.review_time, 'HH12:MI AM') as formatted_time
       FROM reviews r
       WHERE r.patient_id = $1
       ORDER BY r.review_date DESC, r.review_time DESC`,
      [patient_id]
    );

    res.json({
      success: true,
      history: result.rows
    });

  } catch (err) {
    console.error('Error fetching review history:', err);
    res.status(500).json({ 
      success: false, 
      error: 'فشل في جلب سجل المراجعات',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// ✅ تحديث موعد المراجعة
router.put('/:id/update-time', authenticateToken, checkRole(['doctor', 'admin']), async (req, res) => {
    const { id } = req.params;
    const { review_date, review_time } = req.body;
  
    if (!id || !review_date || !review_time) {
      return res.status(400).json({
        success: false,
        error: 'معرّف المراجعة وتاريخ ووقت المراجعة مطلوبة'
      });
    }
  
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
  
      // التحقق من أن المراجعة موجودة وتخص المستخدم
      const reviewCheck = await client.query(
        'SELECT patient_id FROM reviews WHERE id = $1 AND user_id = $2',
        [id, req.user.user_id]
      );
  
      if (reviewCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          error: 'المراجعة غير موجودة أو غير مسموح بالتعديل'
        });
      }
  
      const patient_id = reviewCheck.rows[0].patient_id;
  
      // تحديث تاريخ ووقت المراجعة
      const result = await client.query(
        `UPDATE reviews
         SET review_date = $1,
             review_time = $2,
             updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [review_date, review_time, id]
      );
  
      // تحديث سجل المريض بنفس القيم الجديدة
      await client.query(
        `UPDATE patients
         SET review_date = $1,
             review_time = $2,
             review = $3
         WHERE id = $4`,
        [review_date, review_time, `${review_date} ${review_time}`, patient_id]
      );
  
      await client.query('COMMIT');
      
      res.json({
        success: true,
        message: 'تم تحديث موعد المراجعة بنجاح',
        data: result.rows[0]
      });
  
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('فشل في تحديث موعد المراجعة:', err);
      res.status(500).json({
        success: false,
        error: 'فشل في تحديث موعد المراجعة',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    } finally {
      client.release();
    }
  });

  // 🔢 جلب عدد مراجعات اليوم فقط
router.get('/today', authenticateToken, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const result = await pool.query(
      `SELECT r.*, p.name as patient_name, u.name as doctor_name
       FROM reviews r
       JOIN patients p ON r.patient_id = p.id
       JOIN users u ON r.user_id = u.id
       WHERE r.review_date = $1`,
      [today]
    );

    res.json({ 
      success: true,
      reviews: result.rows 
    });
  } catch (err) {
    console.error('Error fetching today reviews:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch today reviews' 
    });
  }
});

module.exports = router;