const express = require('express');
const router = express.Router();
const pool = require('../db');
const { body, validationResult } = require('express-validator');
const {authenticateToken , checkRole }= require('../middlewares/auth');

// POST /api/feedback - Submit user feedback
router.post('/',
    authenticateToken,
    [
        body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
        body('review').trim().notEmpty().withMessage('Review text is required')
    ],checkRole(['Patient' ]),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { rating, review } = req.body;
        const user_id = req.user.id;

        try {
            const result = await pool.query(
                `INSERT INTO feedbacks (user_id, rating, review, created_at)
                 VALUES ($1, $2, $3, NOW()) RETURNING *`,
                [user_id, rating, review]
            );

            res.status(201).json({
                success: true,
                message: 'Feedback submitted successfully',
                data: result.rows[0]
            });
        } catch (err) {
            console.error('Error submitting feedback:', err);
            res.status(500).json({
                success: false,
                error: 'Internal server error while submitting feedback'
            });
        }
    });

    // API لجلب الفيدباك من قاعدة البيانات
    router.get('/', authenticateToken, async (req, res) => {
        try {
          const result = await pool.query(
            `SELECT f.*, u.name as user_name
             FROM feedbacks f
             JOIN users u ON f.user_id = u.id
             ORDER BY f.created_at DESC`
          );
      
          res.json({
            success: true,
            feedback: result.rows
          });
        } catch (err) {
          console.error('Error fetching feedback:', err);
          res.status(500).json({
            success: false,
            error: 'فشل في جلب بيانات الفيدباك',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
          });
        }
      });

module.exports = router;
