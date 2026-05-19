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

        //const adminMatch = url.pathname.match(/^\/admin\/(\d+)$/);  
        if (req.method === 'GET' && adminMatch) {    
            //const pageId = adminMatch[1];    
            const config = getPageConfig(pageId);    
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
                res.writeHead(401, {
                    'WWW-Authenticate': 'Basic realm="Admin Panel"'
                });    
                res.end('Unauthorized');    
                return;
            }    
            const pageData = await getPageData(pageId);    
            const prices = pageData?.prices || {}; 
            const publicReplies =
                (
                    pageData?.publicReplies
                    || []
                ).join('\n');
    
            const expiryDate =
                new Date(
                    pageData?.subscriptionExpiry
                    );
            
            const now = new Date();
            
            const diffMs =
                expiryDate - now;
            
            const daysRemaining =
                Math.ceil(
                    diffMs / (
                        1000 * 60 * 60 * 24
                    )
                );
            
            let subscriptionClass =
                'subscription-safe';
            
            let subscriptionText =
                `${daysRemaining} days remaining`;
            
            if (daysRemaining <= 7) {
            
                subscriptionClass =
                    'subscription-warning';
            }
            
            if (daysRemaining <= 0) {
            
                subscriptionClass =
                    'subscription-expired';
            
                subscriptionText =
                    'Expired';
            }
            
            const subscriptionInfo = `
            <div class="subscription-box ${subscriptionClass}">
            
                <strong>
                    Subscription Expiry:
                </strong>
            
                ${new Date(
                    pageData?.subscriptionExpiry
                ).toLocaleDateString(
                    'en-GB',
                    {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',                    
                        hour12: false
                    }
                )}
            
                <br>
            
                ${subscriptionText}
            
            </div>
            `;
    
            
    
            const success = url.searchParams.get('success');        
            const error = url.searchParams.get('error');        
            let flashMessage = '';
            
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
            
    
            if (success === 'added') {
                flashMessage = `
                <div class="flash success">
                    ✅ Product added successfully
                </div>
                `;
            }
    
            if (success === 'edited') {
                flashMessage = `
                <div class="flash success">
                    ✏️ Product updated successfully
                </div>
                `;
            }
            
            if (success === 'deleted') {        
                flashMessage = `
                <div class="flash success">
                    🗑️ Product deleted successfully
                </div>
                `;
            }
    
            if (success === 'replies') {
                flashMessage = `
                    <div class="flash success">
                        💬 Replies updated successfully
                    </div>
                `;
            }
            
            if (error === 'invalid') {        
                flashMessage = `
                <div class="flash error">
                    ❌ Invalid data
                </div>
                `;
            }
            if (error === 'duplicate') {        
                flashMessage = `
                <div class="flash error">
                    ⚠️ Product code already exists
                </div>
                `;
            }
            
    
            renderPage(
                res,
                './pages/admin.html',
                {
                    FLASH_MESSAGE: flashMessage,
                    ROWS: rows,
                    PAGE_ID: pageId,
                    SUBSCRIPTION_INFO: subscriptionInfo,
                    PUBLIC_REPLIES: publicReplies,
                }
            );
               
            return;
        }   

}

module.exports = {
    handleAdminPanel
};
