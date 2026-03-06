const router = require('express').Router();
const sc = require('../controllers/search.controller');

router.get('/', sc.search);

module.exports = router;
