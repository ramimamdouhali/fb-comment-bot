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

    const rows = Object.entries(prices)
    .map(([code, price]) => `
    
    <tr data-code="${code.toLowerCase()}">
    
        <td class="code-text">
            ${code}
        </td>
    
        <td class="price-text">
            $${price}
        </td>
    
        <td>
    
            <button
                class="edit-btn"
                onclick="enableEdit(this)"
            >
                Edit
            </button>
    
            <form
                method="POST"
                action="/admin/${pageId}/edit"
                class="edit-form"
                style="display:none;"
            >
    
                <input
                    type="hidden"
                    name="oldCode"
                    value="${code}"
                >
    
                <input
                    type="text"
                    name="code"
                    value="${code}"
                    required
                >
    
                <input
                    type="number"
                    step="0.01"
                    min="0"
                    name="price"
                    value="${price}"
                    required
                >
    
                <button
                    class="save-btn"
                    type="submit"
                >
                    Save
                </button>
    
                <button
                    type="button"
                    class="cancel-btn"
                    onclick="cancelEdit(this)"
                >
                    Cancel
                </button>
    
            </form>
    
            <form
                method="POST"
                action="/admin/${pageId}/delete"
                style="display:inline;"
                onsubmit="
                    return confirm(
                        'Delete product ${code}?'
                    );
                "
            >
    
                <input
                    type="hidden"
                    name="code"
                    value="${code}"
                >
    
                <button
                    class="delete-btn"
                    type="submit"
                >
                    Delete
                </button>
    
            </form>
    
        </td>
    
    </tr>
    
    `).join('');

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
