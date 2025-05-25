const express = require("express");
const cors = require("cors");
const path = require("path");
const pool = require("./db");
const bcrypt = require("bcrypt");
const saltRounds = 10;
const jwt = require('jsonwebtoken');
const { authenticateToken, checkRole } = require('./middlewares/auth');
require('dotenv').config({ path: path.join(__dirname, '.env') });
process.env.JWT_SECRET = '5ddf4a564f24e49de2ee20c9b55964a967c4bdaeeb43359cd6857e83e9fadfe7';
const axios = require('axios');

const app = express();

// إعداد CORS
app.use(cors({
  origin: ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, "front")));


// استيراد المسارات
const roomRoutes = require("./routes/rooms");
const patientRoutes = require("./routes/patients");
const entryRoutes = require("./routes/entries");
const valveRoutes = require("./routes/valves");
const userRoutes = require("./routes/users");
const sessionRoutes = require("./routes/sessions");
const reviewRoutes = require("./routes/reviews");
const helpRoutes = require("./routes/help");
const feedbackRoutes = require("./routes/feedback");

// استخدام المسارات
app.use("/api/rooms", roomRoutes);
app.use("/api/patients", patientRoutes);
app.use("/api/entries", entryRoutes);
app.use("/api/valve_status", valveRoutes);
app.use("/api/users", userRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/help", helpRoutes);
app.use("/api/feedback", feedbackRoutes);

// تسجيل الدخول
app.post("/api/login", async (req, res) => {
  try {
      if (!req.body?.email || !req.body?.password) {
          return res.status(400).json({ 
              success: false,
              message: "البريد الإلكتروني وكلمة المرور مطلوبان"
          });
      }

      const { email, password } = req.body;

      // التحقق من أن الإيميل يحتوي على أحرف وليس أرقام فقط قبل @
const usernamePart = email.split('@')[0];
if (/^\d+$/.test(usernamePart)) {
  return res.status(400).json({
    success: false,
    message: "البريد الإلكتروني يجب أن يحتوي على أحرف وليس أرقام فقط"
  });
}
      const user = await pool.query(
        "SELECT id, name, email, password, role FROM users WHERE email = $1", 
        [email]
      );

      if (user.rows.length === 0) {
          return res.status(401).json({
              success: false,
              message: "بيانات الدخول غير صحيحة"
          });
      }

      const validPassword = await bcrypt.compare(password, user.rows[0].password);
      if (!validPassword) {
          return res.status(401).json({
              success: false,
              message: "بيانات الدخول غير صحيحة"
          });
      }

      const token = jwt.sign(
        { 
          user_id: user.rows[0].id,
          email: user.rows[0].email,
          role: user.rows[0].role || 'doctor' // إضافة دور افتراضي إذا لم يكن موجوداً
        },
        process.env.JWT_SECRET,
        { 
          expiresIn: '24h',
          algorithm: 'HS256'
        }
      );

     return res.json({
        success: true,
        token,
        user: {
            id: user.rows[0].id,
            name: user.rows[0].name,
            email: user.rows[0].email,
            role: user.rows[0].role
        },
        redirectTo: '/home.html'
     });

  } catch (err) {
      console.error("🔥 خطأ في تسجيل الدخول:", err);
      return res.status(500).json({
          success: false,
          message: "حدث خطأ تقني",
          error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
  }
});

// تسجيل مستخدم جديد
app.post("/api/register", async (req, res) => {
  try {
    let { name, email, password , role} = req.body;

    // تعديل الإيميل إذا كان @example.com ليصير @gmail.com
    if (email.endsWith('@example.com')) {
      email = email.replace('@example.com', '@gmail.com');
    }

    // التحقق من أن الإيميل هو فقط @gmail.com
    if (!email.endsWith('@gmail.com')) {
      return res.status(400).json({
        message: "فقط إيميلات Gmail مسموح بها (@gmail.com)"
      });
    }

    // التحقق من أن الإيميل يحتوي على أحرف وليس أرقام فقط قبل @
const usernamePart = email.split('@')[0];
if (/^\d+$/.test(usernamePart)) {
  return res.status(400).json({
    message: "البريد الإلكتروني يجب أن يحتوي على أحرف وليس أرقام فقط"
  });
}
// التحقق من أن كلمة المرور تحتوي على 8 خانات على الأقل (أحرف أو أرقام أو رموز)
if (!/^.{8,}$/.test(password)) {
  return res.status(400).json({
    message: "كلمة المرور يجب أن تكون 8 خانات على الأقل (أحرف أو أرقام أو رموز)"
  });
}
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const newUser = await pool.query(
      "INSERT INTO users (name, email, password, role, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING id, name, email, role",
      [name, email, hashedPassword, role]
    );

    res.status(201).json({
      message: "تم إنشاء المستخدم بنجاح",
      user: newUser.rows[0]
    });
  } catch (err) {
    console.error("🚨 خطأ أثناء التسجيل:", err);
    res.status(500).json({ message: "خطأ في السيرفر" });
  }
});

// تغيير كلمة المرور باستخدام الإيميل
app.post("/api/reset-password", async (req, res) => {
  try {
    const { email, newPassword } = req.body;

    // التحقق من إدخال البريد الإلكتروني وكلمة المرور الجديدة
    if (!email || !newPassword) {
      return res.status(400).json({ message: "يرجى إدخال البريد الإلكتروني وكلمة المرور الجديدة" });
    }

    // التحقق من وجود المستخدم
    const user = await pool.query(
      "SELECT * FROM users WHERE email = $1", 
      [email]
    );

    if (user.rows.length === 0) {
      return res.status(404).json({ message: "لم يتم العثور على مستخدم بهذا البريد الإلكتروني" });
    }

    // التحقق من قوة كلمة المرور (يمكنك إضافة تحقق من قواعد خاصة لكلمة المرور)
    if (newPassword.length < 6) {
      return res.status(400).json({ message: "كلمة المرور يجب أن تكون على الأقل 6 أحرف" });
    }

    // تشفير كلمة المرور الجديدة
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // تحديث كلمة المرور في قاعدة البيانات
    const result = await pool.query(
      "UPDATE users SET password = $1 WHERE email = $2 RETURNING id",
      [hashedPassword, email]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "لم يتم العثور على مستخدم بهذا البريد الإلكتروني" });
    }

    // إعادة الاستجابة الناجحة
    res.json({ message: "تم تحديث كلمة المرور بنجاح" });
  } catch (err) {
    console.error("خطأ في reset-password:", err);
    res.status(500).json({ message: "حدث خطأ أثناء تحديث كلمة المرور" });
  }
});
app.post("/api/notifications/warning", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message required" });

    await pool.query(
      "INSERT INTO notifications (message, created_at) VALUES ($1, NOW())",
      [message]
    );

    console.log("🔔 إشعار مسجل:", message);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("❌ خطأ تسجيل الإشعار:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});
app.get("/api/notifications", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "فشل في تحميل الإشعارات" });
  }
});  
  // إعادة توجيه أي طلب غير موجود
  app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "front", "login.html"));
  });
  
  // التعامل مع الأخطاء
  app.use((err, req, res, next) => {
      console.error("❌ Internal Server Error:", err.message);
      res.status(500).json({ error: err.message });
  });
  
  // تشغيل السيرفر
  if (process.env.NODE_ENV !== "test") {
      const PORT = process.env.PORT || 3000;
      app.listen(PORT, () => {
          console.log(`🚀 Server running on port: http://localhost:${PORT}`);
      });
  }
  
  setInterval(async () => {
  try {
    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 5); // "HH:MM"
    console.log(`🕒 الوقت الحالي: ${currentTime}`);

    console.log("📋 جاري تحميل الجدولة من قاعدة البيانات...");
    const result = await pool.query(`
      SELECT room_id, start_time, end_time, drip_count, drip_interval_seconds
      FROM valve_schedules
      WHERE is_active = true
    `);

    for (const row of result.rows) {
      const start = row.start_time.substring(0, 5);
      const end = row.end_time.substring(0, 5);
      const roomId = row.room_id;

      // فتح الصمام إذا الوقت داخل المدى
      if (currentTime >= start && currentTime < end) {
        console.log(`💡 الجدولة نشطة الآن للغرفة ${roomId} - سيتم إرسال أمر الفتح إلى ESP32`);

        try {
          const espResponse = await axios.get(
            `http://192.168.14.109/api/open-valve?drips=${row.drip_count}&interval=${row.drip_interval_seconds}`
          );
          console.log(`✅ تم إرسال الأمر إلى ESP32 بنجاح: ${espResponse.status}`);
        } catch (espError) {
          console.error(`❌ فشل إرسال الأمر إلى ESP32: ${espError.message}`);
        }

        await pool.query(
          `UPDATE valve_status SET status = 'open', updated_at = CURRENT_TIMESTAMP WHERE room_id = $1`,
          [roomId]
        );

        await pool.query(
          `INSERT INTO valve_control_logs (room_id, action, performed_by) VALUES ($1, 'opened', 'Scheduler')`,
          [roomId]
        );
      }

      // إغلاق عند انتهاء الفترة
      if (currentTime === end) {
        console.log(`🔒 إغلاق الصمام للغرفة ${roomId}`);
        try {
          await axios.get('http://192.168.14.109/api/close-valve');
          console.log(`✅ تم إرسال أمر الإغلاق إلى ESP32`);
        } catch (err) {
          console.error(`❌ فشل إرسال أمر الإغلاق إلى ESP32: ${err.message}`);
        }

        await pool.query(
          `UPDATE valve_status SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE room_id = $1`,
          [roomId]
        );

        await pool.query(
          `INSERT INTO valve_control_logs (room_id, action, performed_by) VALUES ($1, 'closed', 'Scheduler')`,
          [roomId]
        );
      }
    }
  } catch (err) {
    console.error("❌ Scheduler Error:", err.message);
  }
}, 60000); // كل دقيقة
  
module.exports = app;
