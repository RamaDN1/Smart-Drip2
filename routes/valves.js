const express = require("express");
const router = express.Router();
const pool = require("../db");
const { authenticateToken, checkRole } = require('../middlewares/auth');

// ✅ جلب حالة الصمامات لجميع الغرف (مع إنشاء السجلات تلقائيًا إن لم تكن موجودة)
router.get("/", authenticateToken, checkRole(['admin', 'doctor', 'nurse']), async (req, res) => {
    try {
      const allRooms = await pool.query("SELECT id FROM rooms");

      for (const room of allRooms.rows) {
        const check = await pool.query("SELECT 1 FROM valve_status WHERE room_id = $1", [room.id]);
        if (check.rows.length === 0) {
          await pool.query(
            "INSERT INTO valve_status (room_id, status) VALUES ($1, 'closed')",
            [room.id]
          );
        }
      }

      const result = await pool.query("SELECT * FROM valve_status ORDER BY room_id;");
      res.json(result.rows);

    } catch (err) {
      console.error("❌ Error loading valve statuses:", err.message);
      res.status(500).json({ error: "Server error" });
    }
});

// ✅ البحث عن حالة الصمام حسب رقم الغرفة
router.get("/:room_id", authenticateToken, checkRole(['admin', 'doctor', 'nurse']), async (req, res) => {
    try {
        const { room_id } = req.params;
        const result = await pool.query("SELECT * FROM valve_status WHERE room_id = $1", [room_id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Valve status not found for this room" });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: "Server error" });
    }
});

// ✅ تحديث حالة الصمام (فتح/إغلاق)
router.put("/:room_id", authenticateToken, checkRole(['admin', 'doctor', 'nurse']), async (req, res) => {
    try {
        const { room_id } = req.params;
        const { status } = req.body;

        if (status !== "open" && status !== "closed") {
            return res.status(400).json({ error: "Invalid status. Use 'open' or 'closed'" });
        }

        const result = await pool.query(
            "UPDATE valve_status SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE room_id = $2 RETURNING *",
            [status, room_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Room not found" });
        }

        await pool.query(
            "INSERT INTO valve_control_logs (room_id, action, performed_by) VALUES ($1, $2, $3)",
            [room_id, status === "open" ? "opened" : "closed", "System"]
        );

        res.json({ valve_status: result.rows[0] });
    } catch (err) {
        console.error("Database error:", err);
        res.status(500).json({ error: "Server error", details: err.message });
    }
});

// ✅ إضافة حالة صمام جديدة (Admin فقط)
router.post("/", authenticateToken, checkRole(['admin', 'doctor', 'nurse']), async (req, res) => {
    try {
        const { room_id, status } = req.body;

        if (status !== "open" && status !== "closed") {
            return res.status(400).json({ error: "Invalid status. Use 'open' or 'closed'" });
        }

        const result = await pool.query(
            "INSERT INTO valve_status (room_id, status) VALUES ($1, $2) RETURNING *",
            [room_id, status]
        );

        const controlLog = await pool.query(
            "INSERT INTO valve_control_logs (room_id, action, performed_by) VALUES ($1, $2, $3) RETURNING *",
            [room_id, status === "open" ? "opened" : "closed", "System"]
        );

        res.json({ valve_status: result.rows[0], control_log: controlLog.rows[0] });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: "Server error" });
    }
});

// ✅ ضبط الجدولة (فترة واحدة فقط)
router.post("/schedule", authenticateToken, checkRole(['admin', 'doctor', 'nurse']), async (req, res) => {
    try {
        const { room_id, start, end } = req.body;

        if (!room_id || !start || !end) {
            return res.status(400).json({ error: "يجب تحديد الغرفة ووقت البداية والنهاية" });
        }

        await pool.query(
            "INSERT INTO valve_schedules (room_id, start_time, end_time, is_active) VALUES ($1, $2, $3, true)",
            [room_id, start, end]
        );

        res.json({
            success: true,
            message: "تم ضبط الجدولة بنجاح"
        });
    } catch (err) {
        console.error("Error setting schedule:", err);
        res.status(500).json({ error: "فشل في ضبط الجدولة" });
    }
});

// 🆕 ضبط الجدولة لعدة فترات دفعة واحدة
router.post("/schedule-multiple", authenticateToken, checkRole(['admin', 'doctor', 'nurse']), async (req, res) => {
  try {
    const { room_id, schedules } = req.body;

    if (!room_id || !Array.isArray(schedules)) {
      return res.status(400).json({ error: "بيانات الجدولة غير صحيحة" });
    }

    await pool.query("DELETE FROM valve_schedules WHERE room_id = $1", [room_id]);

    for (const { start, end, drip_count, drip_interval } of schedules) {
      if (!start || !end || !drip_count || !drip_interval) {
        return res.status(400).json({ error: "كل فترة يجب أن تحتوي على وقت ونقاط وسرعة" });
      }

      await pool.query(
        `INSERT INTO valve_schedules 
         (room_id, start_time, end_time, drip_count, drip_interval_seconds, is_active) 
         VALUES ($1, $2, $3, $4, $5, true)`,
        [room_id, start, end, drip_count, drip_interval]
      );
    }

    res.json({ success: true, message: "تم حفظ كل الفترات بالنقاط والسرعة" });
  } catch (err) {
    console.error("❌ schedule-multiple error:", err.message);
    res.status(500).json({ error: "خطأ في السيرفر" });
  }
});

// ✅ حذف حالة صمام (Admin فقط)
router.delete("/:room_id", authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const { room_id } = req.params;
        const result = await pool.query("DELETE FROM valve_status WHERE room_id = $1 RETURNING *", [room_id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Valve status not found" });
        }

        res.json({ message: "Valve status deleted" });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: "Server error" });
    }
});

// ✅ استقبال البيانات من ESP32 بدون توثيق
router.post("/weight", async (req, res) => {
    try {
      const { valve_status, weight } = req.body;

      console.log("📡 Received from ESP32:", valve_status, weight);

      res.status(200).json({ message: "تم الاستلام من ESP بنجاح" });
    } catch (err) {
      console.error("❌ Error in /api/weight:", err.message);
      res.status(500).json({ error: "Server error" });
    }
});

// ✅ مسار خاص للـ ESP32 يرجع له الجدولة الحالية (أحدث واحدة فعالة)
router.get("/valve-schedule", async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT room_id, start_time, end_time, drip_count, drip_interval_seconds
        FROM valve_schedules 
        WHERE is_active = true
        ORDER BY id DESC
        LIMIT 1
      `);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "لا توجد جدولة حالياً" });
      }

      res.json({
        room_id: result.rows[0].room_id,
        start_time: result.rows[0].start_time.substring(0,5),
        end_time: result.rows[0].end_time.substring(0,5),
        drip_count: result.rows[0].drip_count,
        drip_interval: result.rows[0].drip_interval_seconds
      });
    } catch (err) {
      console.error("❌ خطأ في /api/valve-schedule:", err.message);
      res.status(500).json({ error: "فشل في جلب الجدولة" });
    }
});

module.exports = router;
