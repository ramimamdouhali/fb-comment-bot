const http = require('http');
const processedComments = new Set();

const {
    renderPage,
    renderExtendButtons,
    renderFlashMessage
} = require('./helpers/render');

const {
    getPageConfig,
    checkAuth
} = require('./helpers/auth');

const {
    extendSubscription,
    isSubscriptionActive
} = require(
    './helpers/subscription'
);

const {
    fetchPostContent,
    extractCodeFromPost,
    sendPublicReply,
    sendPrivateReply,
    notifyPageOwner
} = require(
    './services/facebook'
);

const {
    connectDB,
    getDB,
    getPageData,
    savePrices
} = require(
    './services/database'
);
const {
    handleWebhook
} = require('./routes/webhook');

const {
    handleDashboard,
    handleExtendExpiry,
    handleUpdateExpiry
} = require('./routes/dashboard');

const {
    handleAdminPanel,
    handleAddProduct,
    handleEditProduct,
    handleDeleteProduct,
    handleRepliesUpdate
} = require('./routes/admin');






// ---------- Environment Variables ----------
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const MASTER_PASSWORD = process.env.MASTER_PW;
const MONGODB_URI = process.env.MONGODB_URI;

if (!VERIFY_TOKEN || !MASTER_PASSWORD || !MONGODB_URI) {
    console.error("Missing required env vars: VERIFY_TOKEN, MASTER_PW, MONGODB_URI");
    process.exit(1);
}

// ---------- MongoDB Connection ----------

connectDB().catch(err => { console.error("DB connection failed:", err); process.exit(1); });






// ---------- HTTP Server ----------
const server = http.createServer(async (req, res) => {
    const db = getDB();
    const url = new URL(req.url, `http://${req.headers.host}`);

    // Webhook verification (GET)
    if (req.method === 'GET' && url.pathname === '/webhook') {
        const mode = url.searchParams.get('hub.mode');
        const token = url.searchParams.get('hub.verify_token');
        const challenge = url.searchParams.get('hub.challenge');
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end(challenge);
            console.log('Webhook verified!');
        } else {
            res.writeHead(403);
            res.end('Verification failed');
        }
        return;
    }

    
    // Admin panel for price editing (GET)
    //admin GET 

    const adminMatch =
        url.pathname.match(
            /^\/admin\/(\d+)$/
        );
    
    if (
        req.method === 'GET'
        && adminMatch
    ) {
    
        return handleAdminPanel(
            req,
            res,
            adminMatch[1],
            MASTER_PASSWORD,
            url
        );
    }
    


    


    //add route
    const addMatch =
        url.pathname.match(
            /^\/admin\/(\d+)\/add$/
        );
    
    if (
        req.method === 'POST'
        && addMatch
    ) {
    
        return handleAddProduct(
            req,
            res,
            addMatch[1],
            MASTER_PASSWORD
        );
    }

    




    // EDIT ROUTE
    const editMatch =
        url.pathname.match(
            /^\/admin\/(\d+)\/edit$/
        );
    
    if (
        req.method === 'POST'
        && editMatch
    ) {
    
        return handleEditProduct(
            req,
            res,
            editMatch[1],
            MASTER_PASSWORD
        );
    }
    
    //delet route
    const deleteMatch =
        url.pathname.match(
            /^\/admin\/(\d+)\/delete$/
        );
    
    if (
        req.method === 'POST'
        && deleteMatch
    ) {
    
        return handleDeleteProduct(
            req,
            res,
            deleteMatch[1],
            MASTER_PASSWORD
        );
    }



 // ----- replies -----   

    const repliesMatch =
        url.pathname.match(
            /^\/admin\/(\d+)\/replies$/
        );
    
    if (
        req.method === 'POST'
        && repliesMatch
    ) {
    
        return handleRepliesUpdate(
            req,
            res,
            repliesMatch[1],
            MASTER_PASSWORD
        );
    }

  

    
        // ----- Receive comment events (POST) -----   
    if (
        req.method === 'POST'
        &&
        url.pathname === '/webhook'
    ) {
    
        return handleWebhook(
            req,
            res,
            db
        );
    }




















































        // Dashboard routes
    if (
        req.method === 'GET'
        &&
        url.pathname === '/dashboard'
    ) {
    
        return handleDashboard(
            req,
            res,
            MASTER_PASSWORD
        );
    }
    
    if (
        req.method === 'POST'
        &&
        url.pathname === '/extend-expiry'
    ) {
    
        return handleExtendExpiry(
            req,
            res,
            MASTER_PASSWORD
        );
    }
    
    if (
        req.method === 'POST'
        &&
        url.pathname === '/update-expiry'
    ) {
    
        return handleUpdateExpiry(
            req,
            res,
            MASTER_PASSWORD
        );
    }






























    
   
    // ----- Privacy policy page -----
    if (req.method === 'GET' && url.pathname === '/privacy') {    
        renderPage(
            res,
            './pages/privacy.html'
        );    
        return;
    }
    res.writeHead(404);
    res.end('Not found');
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Dashboard: /dashboard (Bearer token with MASTER_PW)`);
});
