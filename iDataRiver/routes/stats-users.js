// routes/stats.js
const express = require('express');
const router = express.Router();
const statsController = require('../controllers/statsController-users');

router.get('/users', statsController.getUserStats);

module.exports = router;
