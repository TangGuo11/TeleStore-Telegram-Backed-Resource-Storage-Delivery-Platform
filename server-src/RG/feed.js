const express = require('express');
const router = express.Router();
const feedController = require('../RG/feedController');

router.get('/feeds', feedController.getFeeds);

module.exports = router;
