'use strict';
const express = require('express');
const router = express.Router();
const ReportController = require('../controllers/report.controller');

// GET /reports/reconciliation
router.get('/reconciliation', ReportController.reconciliation);

module.exports = router;
