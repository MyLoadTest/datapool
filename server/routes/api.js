const fs = require('fs');
const router = require('express').Router();
const swaggerUi = require("swagger-ui-express");
const yaml = require('yamljs');


/*
The OpenAPI Specification (previously called Swagger) defines a standard, language-agnostic interface
to RESTful APIs which allows both humans and computers to discover and understand the capabilities
of the service without access to source code, documentation, or through network traffic inspection. 

The swagger-ui-express module serves auto-generated API docs, based on a swagger.json file. The user
interface also provides the ability to make calls to the web service endpoints from the browser.
*/
const swaggerDoc = yaml.load('./swagger.yaml');

// Uncomment this if you need to save the API definition as JSON for use with other tools:
//fs.writeFileSync('./swagger.json', JSON.stringify(swaggerDoc, null, 2));

const datapoolVersion = require('../package.json').version;
swaggerDoc.info.version = datapoolVersion;

router.use('/', swaggerUi.serve);

router.get('/', (req, res, next) => {
    // Update target server dynamically on each request
    // See: https://github.com/scottie1984/swagger-ui-express#modify-swagger-file-on-the-fly-before-load
    swaggerDoc.servers[0] = {
        url: req.protocol + '://' + req.get('host'),
        description: 'Self-hosted datapool'
    };
    req.swaggerDoc = swaggerDoc;
    next();
}, swaggerUi.setup());

module.exports = router;
