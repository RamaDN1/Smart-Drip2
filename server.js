const express = require("express");
const cors = require("cors");
const path = require("path");
const pool = require("./db");
const bcrypt = require("bcrypt");
const saltRounds = 10;
const jwt = require("jsonwebtoken");
const { authenticateToken, checkRole } = require("./middlewares/auth");
const axios = require("axios");
require("dotenv").config({ path: path.join(__dirname, ".env") });
process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  "5ddf4a564f24e49de2ee20c9b55964a967c4bdaeeb43359cd6857e83e9fadfe7";

const app = express();

app.get("/api/users/doctors", authenticateToken, checkRole(['admin']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name 
      FROM users 
      WHERE role = 'doctor'
    `);
    res.json({ success: true, doctors: result.rows });
  } catch (err) {
    console.error("Error fetching doctors:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// CORS setup
app.use(
  cors({
    origin: ["http://localhost:3000"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

app.use(express.json());
app.use(express.static(path.join(__dirname, "front")));

// Routes
const roomRoutes = require("./routes/rooms");
const patientRoutes = require("./routes/patients");
const valveRoutes = require("./routes/valves");
const reportRoutes = require("./routes/medical_report");
const feedbackRoutes = require("./routes/feedback");

app.use("/api/rooms", roomRoutes);
app.use("/api/patients", patientRoutes);
app.use("/api/valve_status", valveRoutes);
app.use("/api/medical_report", reportRoutes);
app.use("/api/feedback", feedbackRoutes);

// Common Email Validation
function validateEmailFormat(email) {
  if (!email.endsWith("@gmail.com")) {
    return "فقط إيميلات Gmail مسموح بها (@gmail.com)";
  }
  const usernamePart = email.split("@")[0];
  if (/^\d+$/.test(usernamePart)) {
    return "البريد الإلكتروني يجب أن يحتوي على أحرف وليس أرقام فقط";
  }
  return null;
}

// Login
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "البريد الإلكتروني وكلمة المرور مطلوبان",
      });
    }

    const emailError = validateEmailFormat(email);
    if (emailError) {
      return res.status(400).json({ success: false, message: emailError });
    }

    const user = await pool.query(
      "SELECT id, name, email, password, role FROM users WHERE email = $1",
      [email]
    );

    if (user.rows.length === 0) {
      return res.status(401).json({ success: false, message: "بيانات الدخول غير صحيحة" });
    }

    const validPassword = await bcrypt.compare(password, user.rows[0].password);
    if (!validPassword) {
      return res.status(401).json({ success: false, message: "بيانات الدخول غير صحيحة" });
    }

    const token = jwt.sign(
      {
        user_id: user.rows[0].id,
        email: user.rows[0].email,
        role: user.rows[0].role || "doctor",
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h", algorithm: "HS256" }
    );

    return res.json({
      success: true,
      token,
      user: {
        id: user.rows[0].id,
        name: user.rows[0].name,
        email: user.rows[0].email,
        role: user.rows[0].role,
      },
      redirectTo: "/home.html",
    });
  } catch (err) {
    console.error("🔥 خطأ في تسجيل الدخول:", err);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ تقني",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

// Register
app.post("/api/register", async (req, res) => {
  try {
    let { name, email, password, role } = req.body;

    const emailError = validateEmailFormat(email);
    if (emailError) {
      return res.status(400).json({ message: emailError });
    }

    if (!/^.{8,}$/.test(password)) {
      return res.status(400).json({
        message: "كلمة المرور يجب أن تكون 8 خانات على الأقل (أحرف أو أرقام أو رموز)",
      });
    }

    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const newUser = await pool.query(
      "INSERT INTO users (name, email, password, role, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING id, name, email, role",
      [name, email, hashedPassword, role]
    );

    res.status(201).json({
      message: "تم إنشاء المستخدم بنجاح",
      user: newUser.rows[0],
    });
  } catch (err) {
    console.error("🚨 خطأ أثناء التسجيل:", err);
    res.status(500).json({ message: "خطأ في السيرفر" });
  }
});

// Reset Password
app.post("/api/reset-password", async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    if (!email || !newPassword) {
      return res.status(400).json({ message: "يرجى إدخال البريد الإلكتروني وكلمة المرور الجديدة" });
    }

    const user = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (user.rows.length === 0) {
      return res.status(404).json({ message: "لم يتم العثور على مستخدم بهذا البريد الإلكتروني" });
    }

    if (!/^.{8,}$/.test(newPassword)) {
      return res.status(400).json({
        message: "كلمة المرور يجب أن تكون 8 خانات على الأقل (أحرف أو أرقام أو رموز)",
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    const result = await pool.query(
      "UPDATE users SET password = $1 WHERE email = $2 RETURNING id",
      [hashedPassword, email]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "لم يتم العثور على مستخدم بهذا البريد الإلكتروني" });
    }

    res.json({ message: "تم تحديث كلمة المرور بنجاح" });
  } catch (err) {
    console.error("خطأ في reset-password:", err);
    res.status(500).json({ message: "حدث خطأ أثناء تحديث كلمة المرور" });
  }
});

// Notifications
app.post("/api/notifications/warning", authenticateToken, async (req, res) => {
  try {
    const { message, room_id } = req.body;
    const user_id = req.user?.user_id;

    if (!message) return res.status(400).json({ error: "Message required" });

    await pool.query(
      "INSERT INTO notifications (message, room_id, user_id, created_at) VALUES ($1, $2, $3, NOW())",
      [message, room_id || null, user_id || null]
    );

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

app.get("/api/users", authenticateToken, checkRole(['admin']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT name, email, role
      FROM users
    `);

    const users = result.rows.map(u => ({
      username: u.name,
      email: u.email,
      role: u.role
    }));

    res.json({ users });
  } catch (err) {
    console.error("Error fetching users:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});
// Catch-all route
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "front", "login.html"));
});

// Error handler
app.use((err, req, res, next) => {
  console.error("❌ Internal Server Error:", err.message);
  res.status(500).json({ error: err.message });
});

// Scheduler
setInterval(async () => {
  try {
    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 5);
    const result = await pool.query(
      `SELECT room_id, start_time, end_time, drip_count, drip_interval_seconds FROM valve_schedules WHERE is_active = true`
    );

    for (const row of result.rows) {
      const start = row.start_time.substring(0, 5);
      const end = row.end_time.substring(0, 5);
      const roomId = row.room_id;

      if (currentTime >= start && currentTime < end) {
        try {
          await axios.get(`http://10.103.1.83/api/open-valve?drips=${row.drip_count}&interval=${row.drip_interval_seconds}`);
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

      if (currentTime === end) {
        try {
          await axios.get("http://10.103.1.83/api/close-valve");
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
}, 60000);

// Start server
if (process.env.NODE_ENV !== "test") {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port: http://localhost:${PORT}`);
  });
}

module.exports = app;
