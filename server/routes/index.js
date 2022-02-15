const express = require('express');
const router = express.Router();

/* GET home page. */
router.get('/', (req, res, next) => {
    res.render('index', { title: 'MyLoadTest Datapool' });
});

module.exports = router;

/*
TODO: 
-   description of what the data pool is for
-   link to the API docs
-   example code for LoadRunner (syntax highlighting?)
*/