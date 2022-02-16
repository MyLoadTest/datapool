const router = require('express').Router();
const { body, query, param, validationResult } = require('express-validator');
const sqlite3 = require('sqlite3').verbose();


/*
Each queue is stored in a separate database table. SQLite will lock the entire file during writes
(not just the table or row), so under heavy load there may be performance problems due to write
contention. A work-around for this would be to have separate databases (files) for each queue.

Example queries with ```sqlite3 ./queues.sqlite```:
-   .tables
-   SELECT name FROM sqlite_master WHERE type='table'; -- this is the same as .tables
-   CREATE TABLE IF NOT EXISTS orders (
        position INTEGER PRIMARY KEY,
        item TEXT NOT NULL CHECK(item <> '')
    );
-   .schema orders
-   SELECT * FROM orders ORDER BY position ASC; -- all queued items
-   SELECT item FROM orders ORDER BY position ASC LIMIT 1; -- item at the head of the queue
-   SELECT count(*) FROM orders; -- queue depth
-   INSERT INTO orders (item) VALUES ('{"total": 99, "address": "1 test street"}'); -- an object
-   INSERT INTO orders (item) VALUES ('99'); -- a number
-   INSERT INTO orders (item) VALUES ('"hello world"'); -- a string
-   INSERT INTO orders (item) VALUES ('{"xxx": }}'); -- an invalid object (will error when dequeued)
-   INSERT INTO orders (item) VALUES ('1'), ('2'), ('3'); -- multiple items
*/
const DB_FILE = 'queues.sqlite';
const db = new sqlite3.Database(DB_FILE, (err) => { 
    if (err) {
        console.error(err.message); // cannot open database
        throw err;
    } else {
        console.log('Queue database is ready.');
    }
});


/*
Having a different table name for each queue creates two new problems that are not present for Counter/Person/Map).
    
1.  Parameter binding cannot be used for table names e.g. "SELECT count(*) FROM ?".
    While building SQL queries by concatenating user input is frowned upon (due to SQL injection), the
    ```param('queue').isAlphanumeric()``` input validation should catch this.
2.  Endpoints should return an HTTP 404 error for non-existant queue names (not an HTTP 400 from
    express-validator, or an HTTP 500 from the Express error handler) *but* it is messy to just run
    a SELECT statement against a table, and try to differentiate between "Error: no such table" and
    all the other errors that may be thrown. It is easiest to run an extra query to check that a
    database table exists before performing the SELECT/INSERT. Technically this creates a race
    condition where ```DELETE /{queue}``` may occur between the check and the SELECT/INSERT, but
    the failure mode for this is that the SELECT/INSERT will fail with an HTTP 500 error (caught by
    the Express error handler), which is okay as deleting a queue is infrequent and is unlikely to
    be invoked while a load test is running.
*/  
const dbTableExists = (tableName) => {
    return new Promise((resolve, reject) => {
        const query = `SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?`;
        db.get(query, [tableName], (err, row) => {
            if (err) {
                reject(err); // rejected promise will be handled by the Express error handler
            } else {
                resolve(!!row['count(*)']); // row = { 'count(*)': 0 }
            }
        });
    });
}


// Get a list of all queue names
router.get('/', (req, res, next) => {
    const query = `SELECT name FROM sqlite_master WHERE type='table' ORDER by name`;
    db.all(query, (err, rows) => {
        if (err) {
            next(err);
        } else {
            const payload = rows.map(r => r.name);
            return res.json(payload);
        }
    });
});


// Save one or more items to a queue
router.post('/:queue', param('queue').isAlphanumeric().withMessage('queue name is invalid'), body().isArray().withMessage('queued items must be in an array').notEmpty().withMessage('array cannot be empty'), async (req, res, next) => {
    /*
    Most of the time, a single item will be added to the queue, but bulk inserts are also supported.
    This means that the JSON POST body must be an array, with each array element becoming a queued
    item (in the order they were received).

    Queues (tables) are created lazily - if items are sent to a queue that does not exist it will be
    created automatically. There is no explicit way to create a queue.
    */
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const queueName = req.params.queue;
    const tableExists = await dbTableExists(queueName);
    
    db.serialize(() => {
        if (!tableExists) {
            const query = `CREATE TABLE IF NOT EXISTS ${queueName} (
                position INTEGER PRIMARY KEY,
                item TEXT NOT NULL CHECK(item <> '')
            );`;
            db.run(query, (err) => {
                if (err) {
                    next(err);
                }
            });
        }

        /*
        As there is a requirement to add the items to the queue in their array order, we could
        either do one INSERT for each array element (lots of queries, kept in order by db.serialize),
        or a single large insert with a bind parameter for each item.
        e.g. ```INSERT INTO orders (item) VALUES (?), (?), (?)```
        */
        const items = req.body.map(i => JSON.stringify(i));
        const query = `INSERT INTO ${queueName} (item) VALUES ${items.map(() => '(?)').join(', ')}`;
        db.run(query, items, (err) => {
            if (err) {
                next(err);
            } else {
                return res.status(201).end();
            }
        });
    });
});


// Get the next item from the queue
router.get('/:queue', param('queue').isAlphanumeric().withMessage('queue name is invalid'), query('limit').optional().isInt({ min: 1 }).withMessage('limit value must be a positive integer'), async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const queueName = req.params.queue;
    if (! await dbTableExists(queueName)) {
        return res.status(404).json({ queue: queueName, message: 'Queue was not found'});
    }

    const limit = req.query.limit || 1;

    /* 
    We want to avoid a race condition here. We can't use RETURNING (see notes for ```GET /counter/{name}```),
    so we SELECT one or more items from the top of the queue, and then DELETE those items using the
    "position" primary key. Everything needs to be wrapped in a transaction, but this just means
    that the HTTP request will return an error when there is contention for the queue.
    Will have to add more robust error handling for when a transaction fails.
    */
    db.serialize(() => {
        db.run('BEGIN EXCLUSIVE TRANSACTION');

        let items;
        const query1 = `SELECT * FROM ${queueName} ORDER BY position ASC LIMIT ?`;
        db.all(query1, [limit], (err, rows) => {
            if (err) {
                next(err);
            } else if (!rows) {
                items = [];
            } else {
                items = rows.map(r => JSON.parse(r.item)); // assume that parse() will never throw an error
                //positions = rows.map(r => r.position);
                //lastPos = Math.max.apply(null, positions);
            }
        });


        /*
        Deleting the rows that were just selected is difficult because of the way that db.serialize()
        works. It ensures that the queries are run in the correct order, but this happens at the end
        of the function - after all the JavaScript has been run. This means that variables populated
        by the results of query1 cannot be used as inputs to query2.
        See: https://stackoverflow.com/questions/40174464/how-to-correctly-serialize-db-prepare-in-nodejs-sqlite3

        Things that don't work:
        1.  db.run(`DELETE FROM ${queueName} WHERE position <= ?`, [lastPos] ...
            This doesn't work because lastPos is not known when the SQL statement is evaluated, so
            has an undefined value.
        2.  db.run(`DELETE FROM ${queueName} WHERE position IN (${positions.map(() => '?').join(', ')})`, positions ...
            This does not work for the same reason as 1.
        3.  Putting the DELETE inside the callback of the SELECT.
            This ensures that the DELETE happens after the SELECT, but db.serialize can't see the
            DELETE statement, so the order is actually:
            -   BEGIN TRANSACTION
            -   SELECT
            -   COMMIT TRANSACTION
            -   DELETE

        The solution to this problem (until RETURNING is supported) is to use a sub-query in the
        DELETE statement. The transaction will ensure that other requests do not read the same queue
        items before they are deleted.
        */
        const query2 = `DELETE FROM ${queueName} WHERE position IN (SELECT position FROM ${queueName} ORDER BY position ASC LIMIT ?)`;
        db.run(query2, [limit], (err) => {
            if (err) {
                next(err);
            }
        });

        db.run('COMMIT TRANSACTION', (err) => {
            if (err) {
                next(err);
            } else {
                return res.json(items);
            }
        });
    });
});


// Remove all items from the queue
router.delete('/:queue', param('queue').isAlphanumeric().withMessage('queue name is invalid'), async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const queueName = req.params.queue;
    if (! await dbTableExists(queueName)) {
        return res.status(200).end(); // does not return an HTTP 404 if the queue does not exist
    } else {
        const query = `DROP TABLE ${queueName}`; // DROP TABLE performs an implicit DELETE before dropping the table
        db.run(query, (err) => {
            if (err) {
                next(err);
            } else {
                return res.status(200).end();
            }
        });
    }
});


// Get the number of items on the queue
router.get('/:queue/depth', param('queue').isAlphanumeric().withMessage('queue name is invalid'), async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const queueName = req.params.queue;
    if (! await dbTableExists(queueName)) {
        return res.status(404).json({ queue: queueName, message: 'Queue was not found'});
    }

    const query = `SELECT count(*) FROM ${queueName}`;
    db.get(query, (err, row) => {
        if (err) {
            next(err);
        } else {
            return res.json(row['count(*)']); // row = { 'count(*)': 0 }
        }
    }); 
});


// Read the next item from the queue without removing it
router.get('/:queue/peek', param('queue').isAlphanumeric().withMessage('queue name is invalid'), async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const queueName = req.params.queue;
    if (! await dbTableExists(queueName)) {
        return res.status(404).json({ queue: queueName, message: 'Queue was not found'});
    }

    const query = `SELECT item FROM ${queueName} ORDER BY position ASC LIMIT 1`;
    db.get(query, (err, row) => {
        if (err) {
            next(err);
        } else if (!row) {
            return res.json([]);
        } else  {
            return res.json(new Array(JSON.parse(row.item))); // assume that parse() will never throw an exception
        }
    }); 
});


// Read all items from the queue without removing them (deprecated)
router.get('/:queue/export', param('queue').isAlphanumeric().withMessage('queue name is invalid'), async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const queueName = req.params.queue;
    if (! await dbTableExists(queueName)) {
        return res.status(404).json({ queue: queueName, message: 'Queue was not found'});
    }

    const query = `SELECT item FROM ${queueName} ORDER BY position ASC`;
    db.all(query, (err, rows) => {
        if (err) {
            next(err);
        } else {
            const payload = rows.map(r => JSON.parse(r.item)); // assume that parse() will never throw an exception
            return res.json(payload); 
        }
    }); 
});

module.exports = router;
