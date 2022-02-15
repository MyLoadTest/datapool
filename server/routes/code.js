const fs = require('fs');
const path = require('path');
const { ESLint, Linter } = require("eslint");
const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');


const MODULE_DIR = path.resolve(__dirname, '..', 'usercode');
fs.mkdir(MODULE_DIR, { recursive: true }, (err) => {
    if (err) {
        // Note: there is no error if directory already exists (due to {recursive: true} option)
        throw err; // could not create directory
    } else {
        console.log('Function directory is ready.');
    }
});


const moduleExists = async (path) => {
    try {
        await fs.promises.access(path, fs.constants.R_OK);
    } catch {
        return false;
    }
    return true;
}


// Get a list of function modules
router.get('/', async (req, res, next) => {
    const files = await fs.promises.readdir(MODULE_DIR); // ['foo.js', 'bar.js']
    const modules = files.map(f => path.parse(f).name); // ['foo', 'bar']
    return res.json(modules);
});


// Upload a function module
router.post('/:module', express.raw({ type: '*/*'}), param('module').isAlphanumeric().withMessage('module name is invalid'), async (req, res, next) => {
    /*
    Handling a file upload with Express is unnecessarily painful. Older versions of Express exposed
    a ```req.files``` variable, but now that requires third-party middleware such as
    "express-fileupload". *But* all of the middleware options involve POSTing the file as
    multipart/form-data, which is ugly and unneccessary for uploading a single file with no other
    form variables. To add to the problem, swagger-ui doesn't properly support file uploads (the
    POST body is just "{}".

    The solution to this is to use the express.raw middleware (available in Express v4.17.0 onwards),
    which saves the POST body to req.body as a Buffer. Avoid uploading the file with "content-type:
    application/json" as the express.json middleware will intervene before express.raw can handle it.

    A simple file upload with curl looks like this:
    ```curl -X POST 'http://localhost:3000/code/example' -H 'content-type: text/plain' --data-binary '@example.js'```
    */
    const moduleName = req.params.module;
    const modulePath = path.join(MODULE_DIR, `${moduleName}.js`);
    if (await moduleExists(modulePath)) {
        return res.status(409).json({ key: moduleName, message: 'Module already exists'});
    }

    await body().notEmpty().withMessage('module source code cannot be null or empty').run(req);
    await body().custom(b => Buffer.isBuffer(b)).withMessage('expecting body as Buffer').run(req); // this should never happen
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    /*
    There are some limitations with the modules that can be uploaded:
    -   function arguments will be serialised to JSON, which does not support some data types (e.g. functions)
        See: https://developpaper.com/why-not-recommended-json-stringify-make-a-deep-copy/
    -   values returned by functions will be serialised to JSON, so the same limitations apply
    -   async functions cannot be used, as the calling code does not know when to await a function
    -   there is a whitelist of native Node modules that may be loaded with ```require()``` i.e. no filesystem access
    -   some functions are banned for security reasons (eval/setTimeout/setInterval/new Function())
        See: https://snyk.io/blog/5-ways-to-prevent-code-injection-in-javascript-and-node-js/
    -   to use an NPM module, run ```npm install module_name``` on the server, and add the module
        name to the ESLint whitelist.

    A module should look like this:

    ```JavaScript
    // function with arguments
    const hello = (firstName, lastName) => { 
        return `Hello ${firstName} ${lastName}!`;
    };

    // function with no args
    const hi = () => {
        return 'hi there!';
    };

    // named exports
    module.exports = {
        a: 'asdf', // an exported variable. This will not be accessible.
        b: hi,
        hello: hello
    }
    ```

    Allowing users to upload and run code on a server is a security nightmare. Some security problems
    are blocked by ESLint rules. Ultimately, it is probably best to disable the code upload function
    (and just manually copy modules to ./usercode).

    ```curl -X POST 'http://localhost:3000/code/lint1' -H 'content-type: text/plain' --data-binary '@lint.js'```
    */
    await fs.promises.writeFile(modulePath, req.body);
    const eslint = new ESLint({
        allowInlineConfig: false,
        overrideConfigFile: path.resolve(__dirname, '..', '.eslintrc.json')
    });
    const results = await eslint.lintFiles([modulePath]); // this also checks syntax (no need to check syntax by actually loading the module with require)
    const filteredResults = ESLint.getErrorResults(results);
    if (filteredResults.length > 0) {
        await fs.promises.rm(modulePath);
        return res.status(400).json({ errors: filteredResults });
    }

    return res.status(201).end();
});


// Get a list of functions in the module
router.get('/:module', param('module').isAlphanumeric().withMessage('module name is invalid'), async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const moduleName = req.params.module;
    const modulePath = path.join(MODULE_DIR, `${moduleName}.js`);
    if (! await moduleExists(modulePath)) {
        return res.status(404).json({ key: moduleName, message: 'Module was not found'});
    }

    const module = require(modulePath); // assume that this will not throw a syntax error, as syntax is checked on upload
    const functions = Object.keys(module).filter(k => typeof module[k] === 'function');
    return res.json(functions); // just the function names, there is no way to return the arglist/signature
});


// Remove a function module
router.delete('/:module', param('module').isAlphanumeric().withMessage('module name is invalid'), async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const moduleName = req.params.module;
    const modulePath = path.join(MODULE_DIR, `${moduleName}.js`);
    if (! await moduleExists(modulePath)) {
        return res.status(404).json({ key: moduleName, message: 'Module was not found'});
    }
    
    /*
    Deleting a module means removing the module from the filesystem *and* clearing anything cached
    by require(). Even after doing this, it is probably a good idea to restart the datapool server
    before re-uploading a new version of a module.
    See: https://stackoverflow.com/questions/23800921/how-do-i-un-require-a-node-module-and-release-its-memory-in-node-js
    */
    await fs.promises.rm(modulePath);
    if (require.cache[modulePath]) {
        delete require.cache[modulePath];
    }

    return res.status(200).end();
});


// Call a function with arguments
router.post('/:module/:function', param('module').isAlphanumeric().withMessage('module name is invalid'), param('function').isAlphanumeric().withMessage('function name is invalid'), body().isArray().withMessage('function arguments must be in an array'), async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const moduleName = req.params.module;
    const modulePath = path.join(MODULE_DIR, `${moduleName}.js`);
    if (! await moduleExists(modulePath)) {
        return res.status(404).json({ key: moduleName, message: 'Module was not found'});
    }
    
    const functionName = req.params.function;

    const module = require(modulePath); // assume that this will not throw a syntax error, as syntax is checked on upload
    const functions = Object.keys(module).filter(k => typeof module[k] === 'function');
    if (!functions.includes(functionName)) {
        return res.status(404).json({ key: functionName, message: 'Function was not found'});
    }
    
    const args = req.body;
    const payload = module[functionName].apply(null, args); // runtime errors will be caught by Express error handler
    return res.json(payload);
});


// Call a function with no arguments
router.get('/:module/:function', param('module').isAlphanumeric().withMessage('module name is invalid'), param('function').isAlphanumeric().withMessage('function name is invalid'), async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const moduleName = req.params.module;
    const modulePath = path.join(MODULE_DIR, `${moduleName}.js`);
    if (! await moduleExists(modulePath)) {
        return res.status(404).json({ key: moduleName, message: 'Module was not found'});
    }
    
    const functionName = req.params.function;
    const module = require(modulePath); // assume that this will not throw a syntax error, as syntax is checked on upload
    const functions = Object.keys(module).filter(k => typeof module[k] === 'function');
    if (!functions.includes(functionName)) {
        return res.status(404).json({ key: functionName, message: 'Function was not found'});
    }

    try {
        const payload = module[functionName](); // runtime errors will be caught by Express error handler
        return res.json(payload);
    } catch (err) {
        next(err); // TODO: include stack trace in error message
    }
    
});

module.exports = router;






/*

POST /function/crypto
// POST body is a JS module
-   {"source": }
-   cannnot convert JS code to JSON, as code will be lost/corrupted.

>   The escape() function computes a new string in which certain characters have been replaced by a hexadecimal escape sequence


GET /function/crypto (the module)

POST /function/crypto/base32encode (invoke the function)
-   POST body is an array of arguments



*/

/*
Security:
-   can I request /usercode/example.js directly?



*/