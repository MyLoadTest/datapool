const path = require('path');
const express = require('express');
const createError = require('http-errors');
const logger = require('morgan');


const indexRouter = require('./routes/index');
const apiRouter = require('./routes/api');
const codeRouter = require('./routes/code');
const counterRouter = require('./routes/counter');
const mapRouter = require('./routes/map');
const personRouter = require('./routes/person');
const queueRouter = require('./routes/queue');

const app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(logger('dev'));
app.use(express.json({ strict: false})); // POST and PUT bodies with application/json will be automatically converted into objects
//app.use(express.urlencoded({ extended: false })); // parse POST and PUT bodies with "content-type: application/x-www-form-urlencoded"
app.use(express.static(path.join(__dirname, 'public')));


app.use('/', indexRouter);
app.use('/api', apiRouter);
app.use('/code', codeRouter);
app.use('/counter', counterRouter);
app.use('/map', mapRouter);
app.use('/person', personRouter);
app.use('/queue', queueRouter);


// catch 404 and forward to error handler
app.use((req, res, next) => {
    next(createError(404));
});

// error handler
app.use((err, req, res, next) => {
    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    // render the error page
    res.status(err.status || 500);
    res.render('error');
});

module.exports = app;
