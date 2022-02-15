const router = require('express').Router();
const { body, param, validationResult } = require('express-validator');
const sqlite3 = require('sqlite3').verbose();


/*
Example queries with ```sqlite3 ./maps.sqlite```:
-   .tables
-   .schema maps
-   SELECT * FROM maps;
-   INSERT INTO maps (name, value) VALUES ('foo', '{"count": 99}'); -- an object
-   INSERT INTO maps (name, value) VALUES ('bar', '1'); -- a number
-   INSERT INTO maps (name, value) VALUES ('baz', '"hello world"'); -- a string
-   INSERT INTO maps (name, value) VALUES ('qux', '{"xxx": }}'); -- an invalid object (will error on read)
*/
const DB_FILE = 'maps.sqlite';
const db = new sqlite3.Database(DB_FILE, (err) => { 
    if (err) {
        console.error(err.message); // cannot open database
        throw err;
    } else {
        const query = `CREATE TABLE IF NOT EXISTS maps (
            name TEXT NOT NULL PRIMARY KEY CHECK(name <> ''),
            value TEXT NOT NULL CHECK(value <> '')
        )`;
        db.run(query, (err) => {
            if (err) {
                console.error(err); // cannot create table
                throw err;
            } else {
                console.log('Map database is ready.');
            }
        });
    }
});


// Get a list of all keys in the map
router.get('/', (req, res, next) => {
    const query = `SELECT name FROM maps ORDER by name`;
    db.all(query, (err, rows) => {
        if (err) {
            next(err);
        } else {
            const payload = rows.map(r => r.name);
            return res.json(payload);
        }
    });
});


// Save a value to a key
router.post('/:map', param('map').isAlphanumeric().withMessage('map name is invalid'), body().notEmpty().withMessage('map value cannot be null or empty'), (req, res, next) => {
    // Note: the body validation middleware catches a POST body of null or "" or [], but does not
    // prevent {}. If this is a problem, then it will be necessary to write a custom validator.
    // e.g. ```.custom((value) => { if (typeof value === 'object') return !!Object.keys(value).length})```
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
   
    const mapKey = req.params.map;
    const mapValue = JSON.stringify(req.body);

    // In SQL, UPDATE only works if a row has already been INSERTed. This means that there are two
    // ways to write the required query in SQLite:
    // -   INSERT INTO maps(name, value) VALUES('foo', 99) ON CONFLICT(name) DO UPDATE SET name='foo', value=99;
    // -   INSERT OR REPLACE INTO maps (name, value) VALUES ('foo', 99)
    const query = `INSERT OR REPLACE INTO maps (name, value) VALUES (?, ?)`;
    db.run(query, [mapKey, mapValue], (err) => {
        if (err) {
            next(err);
        } else {
            return res.status(201).end();
        }
    });
});


// Get the value associated with a key
router.get('/:map', param('map').isAlphanumeric().withMessage('map name is invalid'), (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const mapKey = req.params.map;

    const query = `SELECT value FROM maps WHERE name = ?`;
    db.get(query, [mapKey], (err, row) => {
        /*
        Error handling gets a little weird inside the node-sqlite3 methods (which run asynchronously).
        If an error is thrown in the callback function (i.e. here!), then it won't be caught by the
        Express error-handling middleware (returning an HTTP 500). The node process will just crash.
        Instead, errors should be passed to ```next(err)```;
        */
        if (err) {
            next(err);
        } else if (!row) {
            return res.status(404).json({ key: mapKey, message: 'Map key was not found'});
        } else {
            try {
                return res.json(JSON.parse(row.value));
            } catch (err) {
                // JSON.parse() throws a SyntaxError exception if the string to parse is not valid
                // JSON. It should not be possible to store invalid JSON in the database, but more
                // detailed error handling can be added if this scenario ever comes up.
                next(err);
            }
        }
    }); 
});


// Remove a key-value pair
router.delete('/:map', param('map').isAlphanumeric().withMessage('map name is invalid'), (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const mapKey = req.params.map;

    const query = `DELETE FROM maps WHERE name = ?`;
    db.run(query, [mapKey], (err) => {
        if (err) {
            next(err);
        } else {
            return res.status(200).end();
        }
    });
});

module.exports = router;
