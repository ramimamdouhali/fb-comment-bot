const {
    renderPage
} = require('../helpers/render');

const {
    getPageConfig,
    checkAuth
} = require('../helpers/auth');

const {
    getPageData,
    savePrices,
    getDB
} = require('../services/database');

async function handleAdminPanel(
    req,
    res,
    pageId,
    MASTER_PASSWORD,
    url
) {

}

module.exports = {
    handleAdminPanel
};
