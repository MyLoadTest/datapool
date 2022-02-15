const router = require('express').Router();
const { body, param, validationResult } = require('express-validator');
const sqlite3 = require('sqlite3').verbose();


/*
Example queries with ```sqlite3 ./counters.sqlite```:
-   .tables
-   .schema counters
-   SELECT * FROM counters;
-   INSERT INTO counters (name) VALUES ('foo'); -- expect: foo=0
-   INSERT INTO counters (name, value) VALUES ('bar', 10); -- expect: bar=10
-   INSERT INTO counters (name) VALUES (NULL); -- expect: "Error: NOT NULL constraint failed: counters.name"
-   INSERT INTO counters (name) VALUES (''); -- expect: "Error: CHECK constraint failed: counters"
-   INSERT INTO counters (name) VALUES ('foo'); -- expect: "Error: UNIQUE constraint failed: counters.name"
*/
const DB_FILE = 'counters.sqlite';
const db = new sqlite3.Database(DB_FILE, (err) => { 
    if (err) {
        console.error(err.message); // cannot open database
        throw err;
    } else {
        const query = `CREATE TABLE IF NOT EXISTS counters (
            name TEXT NOT NULL PRIMARY KEY CHECK(name <> ''),
            value INTEGER DEFAULT 0
        )`; // Note: could add a check so that the value is >=0, but this is handled by input validation
        db.run(query, (err) => {
            if (err) {
                console.error(err); // cannot create table
                throw err;
            } else {
                console.log('Counter database is ready.');
            }
        });
    }
});


// Get a list of all counters
router.get('/', (req, res, next) => {
    const query = `SELECT name FROM counters ORDER by name`;
    db.all(query, (err, rows) => {
        if (err) {
            next(err);
        } else {
            const payload = rows.map(r => r.name);
            return res.json(payload);
        }
    });
});


// Initialise a counter
router.post('/:counter', param('counter').isAlphanumeric().withMessage('counter name is invalid'), body().isInt({min: 1, max: Number.MAX_SAFE_INTEGER}).withMessage('counter value must be a positive integer'), (req, res, next) => {
    /*
    There were three options for the POST body with the counter value:
    1.  {"name":"orderCount", "value":99}
        This would be the most conventional way of doing it, but is a bit verbose and ugly. It
        also requires extra work on the client side to extract the counter value.
    2.  {"orderCount":99}
        This is much less ugly, but the validation middleware wants to check a specific key but we
        don't know the counter/key name ahead of time. This forces us to use ugly imperative-style
        validation in the route code rather than doing validation with middleware.
    3.  Just a number.
        This is the simplest for the client to handle, and is supported by express-validator, but
        it means that strict mode must be disabled for the express.json middleware.
    */
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const counterName = req.params.counter;
    const counterValue = req.body;

    // In SQL, UPDATE only works if a row has already been INSERTed. This means that there are two
    // ways to write the required query in SQLite:
    // -   INSERT INTO counters(name, value) VALUES('foo', 99) ON CONFLICT(name) DO UPDATE SET name='foo', value=99;
    // -   INSERT OR REPLACE INTO counters (name, value) VALUES ('foo', 99)
    const query = `INSERT OR REPLACE INTO counters (name, value) VALUES (?, ?)`;
    db.run(query, [counterName, counterValue], (err) => {
        if (err) {
            next(err);
        } else {
            // In the future, this may be changed to:
            // -   HTTP 200 if the counter is being reset
            // -   HTTP 201 if the counter is being created.
            return res.status(201).end();
        }
    });
});


// Get the value of a counter
router.get('/:counter', param('counter').isAlphanumeric().withMessage('counter name is invalid'), (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const counterName = req.params.counter;

    /*
    We want to avoid a race condition here. If the counter is updated and then the value is
    read, it may have been updated again by another request before it is read.
    SQLite version 3.35.0 (2021-03-12) has the RETURNING clause which is a solution to this
    but the node-sqlite3 module does not ship with that version yet. Instead, the read+update
    should be wrapped in a transaction. This means that the HTTP request will return an error
    rather than an incorrect counter value. This is not ideal.
    */
    //const query = `UPDATE counters SET value = value + 1 WHERE name = ? RETURNING value`;
    db.serialize(() => {
        db.run('BEGIN EXCLUSIVE TRANSACTION');

        const query1 = `INSERT OR REPLACE INTO counters (name, value) VALUES (
            ?,
            COALESCE((SELECT value FROM counters WHERE name = ?) + 1, 1)
        )`;
        db.run(query1, [counterName, counterName], (err) => {
            if (err) {
                next(err);
            }
        });

        let payload;
        const query2 = `SELECT value FROM counters WHERE name = ?`;
        db.get(query2, [counterName], (err, row) => {
            if (err) {
                next(err);
            } else {
                payload = row.value;
            }
        }); 

        db.run('COMMIT TRANSACTION', (err) => {
            if (err) {
                next(err);
            } else {
                // In the future, this may be changed to:
                // -   HTTP 200 if the counter is being read
                // -   HTTP 201 if the counter is being created.
                return res.json(payload);
            }
        });
    });
});


// Remove or reset a counter
router.delete('/:counter', param('counter').isAlphanumeric().withMessage('counter name is invalid'), (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const counterName = req.params.counter;

    const query = `DELETE FROM counters WHERE name = ?`;
    db.run(query, [counterName], (err) => {
        if (err) {
            next(err);
        } else {
            return res.status(200).end();
        }
    });
});

module.exports = router;
