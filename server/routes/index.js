const express = require('express');
const router = express.Router();

// Home page
router.get('/', (req, res, next) => {
    res.render('index', { title: 'MyLoadTest Datapool' });
});

module.exports = router;
