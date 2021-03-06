'use strict';

var validator = require('validator'),
  path = require('path'),
  config = require(path.resolve('./config/config'));

var request = require('request');

var conf = require(path.resolve('./config'));

/**
 * Render the main application page
 */
exports.renderIndex = function (req, res) {
    var safeUserObject = null;

    if (req.cookies['X-Subject-Token'] && req.cookies['X-Project-Token']) {
        res.redirect('/compute');
    }
    else {
        console.log('Subject or Project Token Missing')
        res.render('modules/core/server/views/index', {
        });
    }
};

/**
 * Render the compute page
 */
exports.renderCompute = function (req, res) {
    if (!req.cookies['X-Subject-Token']) {
        res.redirect('/');
    }
    else {
        res.render('modules/core/server/views/compute', {
            sharedConfig: JSON.stringify(config.shared)
        });
    }
};

/**
 * Render the server error page
 */
exports.renderServerError = function (req, res) {
    res.status(500).render('modules/core/server/views/500', {
        error: 'Oops! Something went wrong...'
    });
};

exports.listClusterTemplates = function (req, res) {
    var request = require('request');
    var listClusterTemplatesEndpoint = 'https://controller-0.kaizen.massopencloud.org:8386/v1.1/' + req.cookies['Project-Id'] + '/cluster-templates';

    var headers = {
        'Content-Type': 'application/json',
        'X-Auth-Token': req.cookies['X-Project-Token']
    };

    var options = {
        url: listClusterTemplatesEndpoint,
        headers: headers
    };

    request({
        url: listClusterTemplatesEndpoint,
        method: 'GET',
        headers: headers
    }, function (error, response, body) {
        if (error) {
            console.log(error);
            res.send('ERROR');
        } else {
            console.log(response.statusCode, body);
            res.json(body);
        }
    });
}

exports.listServers = function (req, res) {
    var OSWrap = require('openstack-wrapper');
    var keystone = new OSWrap.Keystone('https://keystone.kaizen.massopencloud.org:5000/v3');
    keystone.getProjectToken(req.cookies['X-Subject-Token'], req.cookies['Project-Id'], function (error, project_token) {
        if (error) {
            res.clearCookie("X-Subject-Token");
            console.error('an error occurred', error);
            res.redirect('/');
        } else {
            console.log('A project specific token has been retrieved', project_token);
            res.cookie('X-Project-Token', project_token.token, { maxAge: 60 * 60 * 1000, httpOnly: true });
            var nova = new OSWrap.Nova('https://nova.kaizen.massopencloud.org:8774/v2/' + project_token.project.id, project_token.token);

            nova.listServers(function (error, servers_array) {
                if (error) {
                    res.clearCookie("X-Subject-Token");
                    console.error('an error occurred', error);
                    res.redirect('/');
                } else {
                    console.log('A list of servers have been retrieved', servers_array);
                    res.json(servers_array);
                }
            });
        }
    });
};

exports.getJobStatus = function (req, res) {
    var request = require('request');
    var sahara = 'https://controller-0.kaizen.massopencloud.org:8386/v1.1/' + req.cookies['Project-Id'] + '/job-executions/' + req.params.id + '/refresh-status';
    console.log(sahara);
    var headers = {
        'Content-Type': 'application/json',
        'X-Auth-Token': req.cookies['X-Project-Token']
    };
    request({
        url: sahara,
        method: 'GET',
        headers: headers
    }, function (error, response, body) {
        if (error) {
            console.log(error);
        } else {
            console.log(body);
            res.json(body);
        }
    });
};

exports.createJob = function (req, res) {
    var request = require('request');

    var project_id = req.cookies['Project-Id'];
    var token = req.cookies['X-Project-Token'];

    // Random ID Assigned to Job Related Tasks
    var jobId = Math.floor(1000 + Math.random() * 9000).toString();

    // Create Input Data Sources
    var promises = [];
    var data_inputs = [];
    var data_outputs = [];
    var job_id = '';
    var job_binary_id = '';
    var createDataSourceEndpoint = 'https://controller-0.kaizen.massopencloud.org:8386/v1.1/' + project_id + '/data-sources';
    var headers = {
        'Content-Type': 'application/json',
        'X-Auth-Token': token
    };

    var job_template = {
        'description': 'CloudCompute UI Job for ' + req.body.container_name,
        'mains': [],
        'libs': [],
        'type': req.body.job_type,
        'name': req.body.container_name + '_' + Date.now().toString().slice(-3)
    };

    var start_job_template = {
        'cluster_id': req.body.cluster_id,
        'input_id': '',
        'output_id': ''
    };

    var input_sources = req.body.input_sources;

    for (var i = 0; i < input_sources.length; i++) {
        var input_src = input_sources[i].split('/')[1];

        var promise = new Promise(function (resolve, reject) {


            var dataSource = {
                "url": 'swift://' + input_sources[i],
                "type": "swift",
                "name": input_src + '_INPUT_' + jobId,
                'credentials': {
                    'user': req.body.swift_username,
                    'password': req.body.swift_password
                }
            };

            request({
                url: createDataSourceEndpoint,
                method: 'POST',
                headers: headers,
                json: dataSource
            }, function (error, response, body) {
                if (error) {
                    console.log(error);
                } else {
                    data_inputs.push({ 'id': body.data_source.id, 'name': body.data_source.name.split('_')[0] });
                    resolve('Input Data Source Created');
                }
            });
        });
        promises.push(promise);

        // Create Output Data Source
        promises.push(new Promise(function (resolve, reject) {
            var outputSourceUrl = 'swift://' + req.body.container_name + '/' + input_src + '_OUTPUT_' + jobId;

            var dataSource = {
                'url': outputSourceUrl,
                'type': 'swift',
                'name': input_src + '_OUTPUT_' + jobId,
                'credentials': {
                    'user': req.body.swift_username,
                    'password': req.body.swift_password
                }
            };

            request({
                url: createDataSourceEndpoint,
                method: 'POST',
                headers: headers,
                json: dataSource
            }, function (error, response, body) {
                if (error) {
                    console.log('Error occured during output source creation...');
                    console.log(error);
                } else {
                    data_outputs.push({ 'id': body.data_source.id, 'name': body.data_source.name.split('_')[0] });
                    resolve('Output Data Source Created');
                }
            });
        }));
    }

    
    // Configure Job Binary from Upload
    promises.push(new Promise(function (resolve, reject) {
        console.log('Creating job binary...');

        var jobBinaryEndpoint = 'https://controller-0.kaizen.massopencloud.org:8386/v1.1/' + project_id + '/job-binaries';

        var jobBinary = {
            'url': 'swift://' + req.body.binary_url,
            'name': req.body.container_name + '_BINARY_' + jobId,
            'extra': {
                'user': req.body.swift_username,
                'password': req.body.swift_password
            }
        };

        request({
            url: jobBinaryEndpoint,
            method: 'POST',
            headers: headers,
            json: jobBinary
        }, function (error, response, body) {
            if (error) {
                console.log(error);
            } else {
                job_template.libs.push(body.job_binary.id);
                job_binary_id = body.job_binary.id;
                resolve('Job Binary Created');
            }
        });
    }));

    // Create Job Template
    var generate_job = function () {
        var promise = new Promise(function (resolve, reject) {
            request({
                url: 'https://controller-0.kaizen.massopencloud.org:8386/v1.1/' + project_id + '/jobs',
                method: 'POST',
                headers: headers,
                json: job_template
            }, function (error, response, body) {
                if (error) {
                    console.log(error);
                } else {
                    job_id = body.job.id;
                    resolve('Job Template Created');
                }
            });
        });
        return promise;
    };

    // Execute Job
    var execute_job = function () {

        var job_promises = [];

        for (var i = 0; i < data_inputs.length; i++) {
            start_job_template.input_id = data_inputs[i].id;

            for (var j = 0; j < data_outputs.length; j++) {
                if (data_outputs[j].name == data_inputs[i].name) {
                    start_job_template.output_id = data_outputs[j].id;
                    break;
                }
            }

            var p = new Promise(function (resolve, reject) {
                request({
                    url: 'https://controller-0.kaizen.massopencloud.org:8386/v1.1/' + project_id + '/jobs/' + job_id + '/execute',
                    method: 'POST',
                    headers: headers,
                    json: start_job_template
                }, function (error, response, body) {
                    if (error) {
                        console.log(error);
                    } else {
                        resolve('Job Execution Attempted');
                    }
                });
            });
            job_promises.push(p);
        }

        Promise.all(job_promises).then(function () {
            res.json('DONE')
        })

    };

    // Execute Promises
    Promise.all(promises).then(function () {
        generate_job().then(execute_job)
    });

};

exports.listContainerObjects = function (req, res) {
    var request = require('request');
    var swift = 'http://rdgw.kaizen.massopencloud.org/swift/v1/';

    var headers = {
        'Content-Type': 'application/json',
        'X-Auth-Token': req.cookies['X-Project-Token']
    };

    var r = {
        format: 'json'
    };

    var containers = JSON.parse(req.cookies['X-Container-Array']);
    var container_promises = [];
    var datasets = [];

    for (var i = 0; i < containers.length; i++) {
        var promise = new Promise(function (resolve, reject) {
            var container_name = containers[i];
            request({
                url: swift + containers[i],
                method: 'GET',
                headers: headers,
                qs: r
            }, function (error, response, body) {
                if (error) {
                    console.log(error);
                    resolve('Failure while obtaining objects.');
                } else {
                    var resp = {};
                    resp.objects = JSON.parse(body);
                    resp.container_id = container_name;
                    datasets.push(resp);
                    resolve('Container objects fetched.')
                }
            });
        });
        container_promises.push(promise);
    };

    Promise.all(container_promises).then(function () {
        res.json(datasets);
    })


};

exports.createClusterFromTemplate = function (req, res) {
    var pluginVersion, defaultImageId;

    switch (req.body.plugin_name) {
        case 'vanilla':
            pluginVersion = '2.7.1';
            defaultImageId = '64599610-2952-4a1f-9291-2711c966905c';
            break;
        case 'spark':
            pluginVersion = '1.6.0';
            defaultImageId = '68abdc64-b0ac-48a7-bbf5-43a04ccffa7e';
            break;
        case 'storm':
            pluginVersion = '0.9.2';
            defaultImageId = 'df9982fb-aac7-48d4-ad78-93c3105a5d68';
            break;
    }
    var launchTemplate = {
        'plugin_name': req.body.plugin_name,
        'hadoop_version': pluginVersion,
        'cluster_template_id': req.body.template_id,
        'default_image_id': defaultImageId,
        'user_keypair_id': req.body.user_keypair_id,
        'name': req.body.name + 'CLUSTER',
        'neutron_management_network': req.body.network
    };

    var headers = {
        'Content-Type': 'application/json',
        'X-Auth-Token': req.cookies['X-Project-Token']
    };

    var launchCluster = function () {
        var launchClusterEndpoint = 'https://controller-0.kaizen.massopencloud.org:8386/v1.1/' + req.cookies['Project-Id'] + '/clusters';
        request({
            url: launchClusterEndpoint,
            method: 'POST',
            headers: headers,
            json: launchTemplate
        }, function (error, response, body) {
            if (error) {
                console.log(error);
                res.send('ERROR');
            } else {
                console.log(response.statusCode, body);
                res.json(body);
            }
        });
    };

    launchCluster();
}

exports.launchInstance = function (req, res) {
    var request = require('request');

    var pluginVersion = '';
    var defaultImageId = '';
    var masterNodeProcesses = [];
    var workerNodeProcesses = [];
    var zookeeperNodeProcesses = [];

    switch (req.body.plugin_name) {
        case 'vanilla':
            pluginVersion = '2.7.1';
            defaultImageId = '64599610-2952-4a1f-9291-2711c966905c';
            masterNodeProcesses = [
                'namenode',
                'resourcemanager',
                'oozie',
                'historyserver'
            ];
            workerNodeProcesses = [
                'datanode',
                'nodemanager'
            ];
            break;
        case 'spark':
            pluginVersion = '1.6.0';
            defaultImageId = '68abdc64-b0ac-48a7-bbf5-43a04ccffa7e';
            masterNodeProcesses = [
                'namenode',
                'master'
            ];
            workerNodeProcesses = [
                'datanode',
                'slave'
            ];
            break;
        case 'storm':
            pluginVersion = '0.9.2';
            defaultImageId = 'df9982fb-aac7-48d4-ad78-93c3105a5d68';
            masterNodeProcesses = [
                'nimbus'
            ];
            workerNodeProcesses = [
                'supervisor'
            ];
            zookeeperNodeProcesses = [
                'zookeeper'
            ];
            break;
    }

    var masterTemplate = {
        'plugin_name': req.body.plugin_name,
        'hadoop_version': pluginVersion,
        'node_processes': masterNodeProcesses,
        'name': req.body.name + 'MASTER',
        'flavor_id': req.body.flavor,
        'use_autoconfig': true,
        'auto_security_group': true,
        'availability_zone': 'nova'
    };

    var workerTemplate = {
        'plugin_name': req.body.plugin_name,
        'hadoop_version': pluginVersion,
        'node_processes': workerNodeProcesses,
        'name': req.body.name + 'WORKER',
        'flavor_id': req.body.flavor,
        'use_autoconfig': true,
        'auto_security_group': true,
        'availability_zone': 'nova'
    };

    var zookeeperTemplate = {
        'plugin_name': req.body.plugin_name,
        'hadoop_version': pluginVersion,
        'node_processes': zookeeperNodeProcesses,
        'name': req.body.name + 'ZOOKEEPER',
        'flavor_id': req.body.flavor,
        'use_autoconfig': true,
        'auto_security_group': true,
        'availability_zone': 'nova'
    };

    var clusterTemplate = {
        'plugin_name': req.body.plugin_name,
        'hadoop_version': pluginVersion,
        'node_groups': [{
            'name': 'master',
            'count': 1,
            'node_group_template_id': ''
        }, {
            'name': 'worker',
            'count': req.body.count,
            'node_group_template_id': ''
        }],
        'name': req.body.name
    };

    if (req.body.plugin_name == 'storm') {
        var zookeeper_node = {
            'name': 'zookeeper',
            'count': 1,
            'node_group_template_id': ''
        };
        clusterTemplate.node_groups.push(zookeeper_node);
    }

    var launchTemplate = {
        'plugin_name': req.body.plugin_name,
        'hadoop_version': pluginVersion,
        'cluster_template_id': '',
        'default_image_id': defaultImageId,
        'user_keypair_id': req.body.user_keypair_id,
        'name': req.body.name + 'CLUSTER',
        'neutron_management_network': req.body.network
    };

    /* REST ENDPOINT AND HEADER OBJECT */
    var createNodeEndpoint = 'https://controller-0.kaizen.massopencloud.org:8386/v1.1/' + req.cookies['Project-Id'] + '/node-group-templates';
    var headers = {
        'Content-Type': 'application/json',
        'X-Auth-Token': req.cookies['X-Project-Token']
    };

    var genMasterTemplate = function () {
        var promise = new Promise(function (resolve, reject) {
            request({
                url: createNodeEndpoint,
                method: 'POST',
                headers: headers,
                json: masterTemplate
            }, function (error, response, body) {
                if (error) {
                    console.log(error);
                } else {
                    console.log(body);
                    clusterTemplate.node_groups[0].node_group_template_id = body.node_group_template.id;
                    resolve('Master Template Created');
                }
            });
        });
        return promise;
    };

    var genWorkerTemplate = function () {
        var promise = new Promise(function (resolve, reject) {
            request({
                url: createNodeEndpoint,
                method: 'POST',
                headers: headers,
                json: workerTemplate
            }, function (error, response, body) {
                if (error) {
                    console.log(error);
                } else {
                    clusterTemplate.node_groups[1].node_group_template_id = body.node_group_template.id;
                    resolve('Worker Template Created');
                }
            });
        });
        return promise;
    };

    var genZookeeperTemplate = function () {
        var promise = new Promise(function (resolve, reject) {
            if (req.body.plugin_name == 'storm') {
                request({
                    url: createNodeEndpoint,
                    method: 'POST',
                    headers: headers,
                    json: zookeeperTemplate
                }, function (error, response, body) {
                    if (error) {
                        console.log(error);
                    } else {
                        clusterTemplate.node_groups[2].node_group_template_id = body.node_group_template.id;
                        resolve('Zookeeper Template Created');
                    }
                });
            }
            else {
                resolve('Plugin version is not Storm... nothing to do.');
            }
        });
        return promise;
    };

    var genClusterTemplate = function () {
        var promise = new Promise(function (resolve, reject) {

            var createClusterEndpoint = 'https://controller-0.kaizen.massopencloud.org:8386/v1.1/' + req.cookies['Project-Id'] + '/cluster-templates';

            request({
                url: createClusterEndpoint,
                method: 'POST',
                headers: headers,
                json: clusterTemplate
            }, function (error, response, body) {
                if (error) {
                    console.log(error);
                } else {
                    console.log(response.statusCode, body);
                    launchTemplate.cluster_template_id = body.cluster_template.id;
                    resolve('Cluster template created successfully.')
                }
            });
        });
        return promise;
    };

    var launchCluster = function () {
        var launchClusterEndpoint = 'https://controller-0.kaizen.massopencloud.org:8386/v1.1/' + req.cookies['Project-Id'] + '/clusters';
        request({
            url: launchClusterEndpoint,
            method: 'POST',
            headers: headers,
            json: launchTemplate
        }, function (error, response, body) {
            if (error) {
                console.log(error);
            } else {
                console.log(response.statusCode, body);
                res.json(body);
            }
        });
    };

    // Begin executing chain
    genMasterTemplate()
        .then(genZookeeperTemplate)
		.then(genWorkerTemplate)
        .then(genClusterTemplate)
        .then(launchCluster);

};

exports.listKeyPairs = function (req, res) {
    var OSWrap = require('openstack-wrapper');
    var nova = new OSWrap.Nova('https://nova.kaizen.massopencloud.org:8774/v2/' + req.cookies['Project-Id'], req.cookies['X-Project-Token']);

    nova.listKeyPairs(function (error, resp) {
        if (!error) {
            res.json(resp);
        } else {
            console.error('Could not retrieve key pairs');
        }
    });
};

exports.listNetworks = function (req, res) {
    var OSWrap = require('openstack-wrapper');
    var neutron = new OSWrap.Neutron('https://neutron.kaizen.massopencloud.org:9696/v2.0', req.cookies['X-Project-Token']);

    neutron.listNetworks(function (error, resp) {
        res.json(resp);
    });
};

exports.listPlugins = function (req, res) {
    var request = require('request');
    var sahara = 'https://controller-0.kaizen.massopencloud.org:8386/v1.1/' + req.cookies['Project-Id'] + '/plugins';
    console.log('Sahara URL: ' + sahara);
    var headers = {
        'Content-Type': 'application/json',
        'X-Auth-Token': req.cookies['X-Project-Token']
    };

    var options = {
        url: sahara,
        headers: headers
    };

    function listPlugins(error, response, body) {
        res.json(body);
    }

    request.get(options, listPlugins);
};

exports.listQuotas = function (req, res) {
    var OSWrap = require('openstack-wrapper');
    var nova = new OSWrap.Nova('https://nova.kaizen.massopencloud.org:8774/v2/' + req.cookies['Project-Id'], req.cookies['X-Project-Token']);

    var startDate = new Date();
    startDate.setHours(0);
    var endDate = new Date();
    console.log('Start Date' + startDate + '--------- End Date' + endDate);
    nova.getTenantUsage(req.cookies['Project-Id'], startDate, endDate, function (error, resp) {
        if (!error) {
            res.json(resp);
        }
    });
};

exports.listImages = function (req, res) {
    var OSWrap = require('openstack-wrapper');
    var nova = new OSWrap.Glance('https://glance.kaizen.massopencloud.org:9292/v2', req.cookies['X-Project-Token']);

    nova.listImages(function (error, images) {
        if (error) {
            res.send('Could not load images');
        } else {
            res.json(images);
        }
    });
};

exports.uploadBinary = function (req, res) {
    var path = require('path');
    var fs = require('fs');
    var multiparty = require('multiparty');
    var http = require('http');
    var util = require('util');
    var container = '';
    var form = new multiparty.Form();
    var request = require('request');

    form.on('field', function (name, value) {
        if (name === 'container_name') {
            container = value;
        }
    });
    form.on('part', function (part) {
        var swift = 'http://rdgw.kaizen.massopencloud.org/swift/v1/';
        var containerName = part.filename.split('/')[0];

        var options = {
            url: swift + containerName,
            headers: {
                'X-Auth-token': req.cookies['X-Project-Token']
            }
        };

        request.put(options, function () {
            options = {
                url: swift + part.filename,
                headers: {
                    'X-Auth-token': req.cookies['X-Project-Token']
                }
            };
            part.pipe(request.put(options));
            part.on('finish', function () {
                console.log(options.url);
            });
            res.send(options.url)
        });
    });
    form.parse(req);
};

exports.getClusterStatus = function (req, res) {
    var request = require('request');
    var sahara = 'https://controller-0.kaizen.massopencloud.org:8386/v1.1/' + req.cookies['Project-Id'] + '/clusters/' + req.params.id;
    var headers = {
        'Content-Type': 'application/json',
        'X-Auth-Token': req.cookies['X-Project-Token']
    };

    var options = {
        url: sahara,
        headers: headers
    };

    function getStatus(error, response, body) {
        res.json(body);
    }

    request.get(options, getStatus);
};

exports.listFlavors = function (req, res) {
    var OSWrap = require('openstack-wrapper');
    var nova = new OSWrap.Nova('https://nova.kaizen.massopencloud.org:8774/v2/' + req.cookies['Project-Id'], req.cookies['X-Project-Token']);

    nova.listFlavors(function (error, flavors) {
        if (error) {
            res.send('Could not load flavors');
        } else {
            res.json(flavors);
        }
    });
};

exports.listClusters = function (req, res) {
    var request = require('request');
    var listClusterEndpoint = 'https://controller-0.kaizen.massopencloud.org:8386/v1.1/' + req.cookies['Project-Id'] + '/clusters';

    var headers = {
        'Content-Type': 'application/json',
        'X-Auth-Token': req.cookies['X-Project-Token']
    };

    var options = {
        url: listClusterEndpoint,
        headers: headers
    };

    request({
        url: listClusterEndpoint,
        method: 'GET',
        headers: headers
    }, function (error, response, body) {
        if (error) {
            console.log(error);
            res.send('ERROR');
        } else {
            console.log(response.statusCode, body);
            res.json(body);
        }
    });
};

exports.listJobs = function (req, res) {
    var request = require('request');
    var listJobEndpoint = 'https://controller-0.kaizen.massopencloud.org:8386/v1.1/' + req.cookies['Project-Id'] + '/job-executions';

    var headers = {
        'Content-Type': 'application/json',
        'X-Auth-Token': req.cookies['X-Project-Token']
    };

    var options = {
        url: listJobEndpoint,
        headers: headers
    };

    request({
        url: listJobEndpoint,
        method: 'GET',
        headers: headers
    }, function (error, response, body) {
        if (error) {
            console.log(error);
            res.send('ERROR');
        } else {
            console.log(response.statusCode, body);
            res.json(body);
        }
    });

};

exports.openStackAuth = function (req, res) {
    var OSWrap = require('openstack-wrapper');
    var keystone = new OSWrap.Keystone('https://keystone.kaizen.massopencloud.org:5000/v3');

    keystone.getToken(req.body.user, req.body.password, function (error, token) {
        if (error) {
            res.send('ERROR');
            console.error('Authentication with OpenStack failed.');
        } else {
            // Creating cookie with OpenStack token and project id
            res.cookie('X-Subject-Token', token.token, { maxAge: 60 * 60 * 1000, httpOnly: true });
            res.cookie('Project-Id', token.project.id, { maxAge: 60 * 60 * 1000, httpOnly: true });
            res.send('OK');
        }
    });
};

exports.captureContainer = function (req, res) {
    res.cookie('X-Container-Id', req.params.container, { maxAge: 60 * 60 * 1000, httpOnly: true });
    res.redirect('/');
}

exports.captureContainers = function (req, res) {
    res.cookie('X-Container-Array', JSON.stringify(req.body.containerid), { maxAge: 60 * 60 * 1000, httpOnly: true });
    res.send(200);
}

/**
 * Render the server not found responses
 * Performs content-negotiation on the Accept HTTP header
 */
exports.renderNotFound = function (req, res) {
    res.status(404).format({
        'text/html': function () {
            res.render('modules/core/server/views/404', {
                url: req.originalUrl
            });
        },
        'application/json': function () {
            res.json({
                error: 'Path not found'
            });
        },
        'default': function () {
            res.send('Path not found');
        }
    });
};
