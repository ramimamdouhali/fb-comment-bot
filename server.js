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
    handleAdminPage
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
    const adminMatch = url.pathname.match(/^\/admin\/(\d+)$/);    
    if (
        req.method === 'GET'
        &&
        adminMatch
    ) {    
        return handleAdminPage(
            req,
            res,
            adminMatch[1],
            MASTER_PASSWORD,
            url
        );
    }

    //add route
    const addMatch = url.pathname.match(/^\/admin\/(\d+)\/add$/);
    if (req.method === 'POST' && addMatch) {    
        const pageId = addMatch[1];    
        const config = getPageConfig(pageId);    
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
        let body = '';    
        req.on('data', chunk => {
            body += chunk.toString();
        });    
        req.on('end', async () => {    
            const params = new URLSearchParams(body);    
            const code = params.get('code');    
            const price = parseFloat(params.get('price'));    
            const pageData = await getPageData(pageId);    
            const prices = pageData?.prices || {};

            if (prices[code]) {
                res.writeHead(302, {
                    Location:
                        `/admin/${pageId}?error=duplicate`
                });            
                res.end();            
                return;
            }
            prices[code] = price;    
            await savePrices(pageId, prices);    
            res.writeHead(302, {
                Location: `/admin/${pageId}?success=added`
            });    
            res.end();
        });    
        return;
    }

    




    // EDIT ROUTE
    const editMatch = url.pathname.match(
        /^\/admin\/(\d+)\/edit$/
    );
    
    if (
        req.method === 'POST'
        && editMatch
    ) {
    
        const pageId = editMatch[1];
    
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
        ){
    
            res.writeHead(401, {
                'WWW-Authenticate':
                    'Basic realm="Admin Panel"'
            });
    
            res.end('Unauthorized');
    
            return;
        }
    
        let body = '';
    
        req.on('data', chunk => {
            body += chunk.toString();
        });
    
        req.on('end', async () => {
    
            const params =
                new URLSearchParams(body);
    
            const oldCode =
                params.get('oldCode');
    
            const newCode =
                params.get('code');
    
            const newPrice =
                parseFloat(params.get('price'));
    
            if (
                !oldCode
                || !newCode
                || !newCode.trim()
                || isNaN(newPrice)
                || newPrice < 0
            ) {
    
                res.writeHead(302, {
                    Location:
                        `/admin/${pageId}?error=invalid`
                });
    
                res.end();
    
                return;
            }
    
            const pageData =
                await getPageData(pageId);
    
            const prices =
                pageData?.prices || {};


            if (
                oldCode !== newCode
                && prices[newCode]
            ) {
            
                res.writeHead(302, {
                    Location:
                        `/admin/${pageId}?error=duplicate`
                });
            
                res.end();
            
                return;
            }

            
            delete prices[oldCode];
    
            prices[newCode] = newPrice;
    
            await savePrices(
                pageId,
                prices
            );
    
            res.writeHead(302, {
                Location:
                    `/admin/${pageId}?success=edited`
            });
    
            res.end();
    
        });
    
        return;
    }
    
    //delet route
    const deleteMatch = url.pathname.match(/^\/admin\/(\d+)\/delete$/);
    if (req.method === 'POST' && deleteMatch) {    
        const pageId = deleteMatch[1];    
        const config = getPageConfig(pageId);    
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
    
        let body = '';    
        req.on('data', chunk => {
            body += chunk.toString();
        });    
        req.on('end', async () => {    
            const params = new URLSearchParams(body);    
            const code = params.get('code');    
            const pageData = await getPageData(pageId);    
            const prices = pageData?.prices || {};    
            delete prices[code];    
            await savePrices(pageId, prices);    
            res.writeHead(302, {
                Location: `/admin/${pageId}?success=deleted`
            });    
            res.end();
        });    
        return;
    }


    const repliesMatch =
        url.pathname.match(
            /^\/admin\/(\d+)\/replies$/
        );
    
    if (
        req.method === 'POST'
        &&
        repliesMatch
    ) {
    
        const pageId =
            repliesMatch[1];
    
        const config =
            getPageConfig(pageId);
    
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
    
        let body = '';
    
        req.on(
            'data',
            chunk => {
                body += chunk.toString();
            }
        );
    
        req.on(
            'end',
            async () => {
    
                const params =
                    new URLSearchParams(body);
    
                const publicReplies =
                    params
                        .get('publicReplies')
    
                        .split('\n')
    
                        .map(
                            r => r.trim()
                        )
    
                        .filter(Boolean);
    
                await db
                    .collection('pages')
                    .updateOne(
                        { pageId },
    
                        {
                            $set: {
                                publicReplies
                            }
                        }
                    );
    
                res.writeHead(
                    302,
                    {
                        Location:
                            `/admin/${pageId}?success=replies`
                    }
                );
    
                res.end();
            }
        );
    
        return;
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
