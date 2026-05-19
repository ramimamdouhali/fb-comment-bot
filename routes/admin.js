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

async function handleAdminPage(
    req,
    res,
    pageId,
    MASTER_PASSWORD,
    url
) {

    const config =
        getPageConfig(pageId);

    if (!config) {

        res.writeHead(404);

        res.end('Page not configured');

        return;
    }

    if (
        !checkAuth(
            req,
            config.password,
            MASTER_PASSWORD
        )
    ) {

        res.writeHead(
            401,
            {
                'WWW-Authenticate':
                    'Basic realm="Admin Panel"'
            }
        );

        res.end('Unauthorized');

        return;
    }

    const pageData =
        await getPageData(pageId);

    const prices =
        pageData?.prices || {};

    const rows =
        Object.entries(prices)
        .map(
            ([code, price]) => `

            <tr>

                <td>${code}</td>

                <td>$${price}</td>

            </tr>
            `
        )
        .join('');

    renderPage(
        res,
        './pages/admin.html',
        {
            ROWS: rows,
            PAGE_ID: pageId,
            FLASH_MESSAGE: '',
            SUBSCRIPTION_INFO: '',
            PUBLIC_REPLIES: ''
        }
    );
}

module.exports = {
    handleAdminPage
};
