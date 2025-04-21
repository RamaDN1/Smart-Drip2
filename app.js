require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const app = express();

// Middlewares
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());

// Routes
const authRouter = require('./routes/auth');
const roomsRouter = require('./routes/rooms');
const patientsRouter = require('./routes/patients');
const usersRouter = require('./routes/users');

app.use('/api/auth', authRouter);
app.use('/api/rooms', roomsRouter);
app.use('/api/patients', patientsRouter);
app.use('/api/users', usersRouter);

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});