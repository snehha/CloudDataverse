'use strict';

module.exports = function (app) {
    // Root routing
    var core = require('../controllers/core.server.controller');

    // Define error pages
    app.route('/server-error').get(core.renderServerError);

    app.post('/api/auth', core.openStackAuth);
    app.get('/api/list/servers', core.listServers);
    app.get('/api/list/quotas', core.listQuotas);

    app.route('/compute').get(core.renderCompute);

    // Return a 404 for all undefined api, module or lib routes
    app.route('/:url(api|modules|lib)/*').get(core.renderNotFound);

    // Define application route
    app.route('/*').get(core.renderIndex);
};
