const { faker } = require('@faker-js/faker');
const router = require('express').Router();
const sqlite3 = require('sqlite3').verbose();


/*
Example queries with ```sqlite3 ./persons.sqlite```:
-   .tables
-   .schema persons
-   SELECT * FROM persons;
-   INSERT INTO persons (counter, value) VALUES ('personCount', 10);
-   INSERT OR REPLACE INTO persons (counter, value) VALUES (
            'personCount',
            COALESCE((SELECT value FROM counters WHERE name = 'personCount') + 1, 1);
*/
const DB_FILE = 'persons.sqlite';
const db = new sqlite3.Database(DB_FILE, (err) => { 
    if (err) {
        console.error(err.message); // cannot open database
        throw err;
    } else {
        const query = `CREATE TABLE IF NOT EXISTS persons (
            counter TEXT NOT NULL PRIMARY KEY CHECK(counter <> ''),
            value INTEGER DEFAULT 0
        )`; // this table will only have one row ("personCount")
        db.run(query, (err) => {
            if (err) {
                console.error(err); // cannot create table
                throw err;
            } else {
                console.log('Person database is ready.');
            }
        });
    }
});


router.get('/', (req, res, next) => {
    const gender = (Math.random() < 0.5) ? 'male': 'female';

    /*
    @faker-js/faker version "6.0.0-alpha.5" has the following names that are invalid:
    -   firstName: D'angelo (a very odd first name)
    -   lastName: D'Amore, O'Connell, O'Hara, O'Keefe, O'Kon, O'Reilly
    */
    //const firstName = faker.name.firstName(gender);
    //const lastName = faker.name.lastName();
    const retryIfNotAlpha = (fn, ...args) => {
        const value = fn.apply(null, args);
        if (/^[a-zA-Z]+$/.test(value)) {
            return value;
        } else {
            return retryIfNotAlpha(fn, ...args);
        }
    };
    const firstName = retryIfNotAlpha(faker.name.firstName, gender);
    const lastName = retryIfNotAlpha(faker.name.lastName);

    /*
    The random birthdate should make the person somewhere between 21 and 65 years old.
    Note: 
    -   It looks like Faker has fixed the problem of not supporting dates before 1970-01-01.
    -   There will be some weirdness with timezones and daylight savings time but this shouldn't be
        an issue unless you are doing something that relies a person not being being *almost* 21, or
        *just turned* 66, and you are using the datapool around January 1st or on a daylight savings
        changeover.
    */
    const currentYear = new Date().getFullYear();
    const birthdate = faker.date.between(`${currentYear-65}-01-01`, `${currentYear-21}-01-01`);

    // To ensure that the email address is unique, get a counter value from the database.
    // Note: this is almost the same code as GET /counter/{name}
    db.serialize(() => {
        db.run('BEGIN EXCLUSIVE TRANSACTION');

        const query1 = `INSERT OR REPLACE INTO persons (counter, value) VALUES (
            'personCount',
            COALESCE((SELECT value FROM persons WHERE counter = 'personCount') + 1, 1)
        )`;
        db.run(query1, (err) => {
            if (err) {
                next(err);
            }
        });

        let counter;
        const query2 = `SELECT value FROM persons WHERE counter = 'personCount'`;
        db.get(query2, (err, row) => {
            if (err) {
                next(err);
            } else {
                counter = row.value;
            }
        }); 

        db.run('COMMIT TRANSACTION', (err) => {
            if (err) {
                next(err);
            } else {
                const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${counter.toString(32)}@myloadtest.email`
                return res.json({
                    firstname: firstName,
                    lastname: lastName,
                    gender: gender,
                    birthdate: birthdate.toISOString().slice(0, 10),
                    email: email
                });
            }
        });
    });
});

module.exports = router;
