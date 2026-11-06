const catalogs = require('./transportCatalogs');
module.exports = { list: (tx, query = {}) => catalogs.list(tx, 'costs', { limit: 200, ...query }), save: (tx, user, id, body) => catalogs.save(tx, user, 'costs', id, body) };
