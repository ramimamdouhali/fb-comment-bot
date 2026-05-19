const fs = require('fs');
const http = require('http');
const https = require('https');
const { MongoClient } = require('mongodb');
const processedComments = new Set();
// ---------- Environment Variables ----------
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const MASTER_PASSWORD = process.env.MASTER_PW;
const MONGODB_URI = process.env.MONGODB_URI;

if (!VERIFY_TOKEN || !MASTER_PASSWORD || !MONGODB_URI) {
    console.error("Missing required env vars: VERIFY_TOKEN, MASTER_PW, MONGODB_URI");
    process.exit(1);
}

// ---------- MongoDB Connection ----------
let db;
async function connectDB() {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db();
    console.log("Connected to MongoDB");
}
connectDB().catch(err => { console.error("DB connection failed:", err); process.exit(1); });

function getPageConfig(pageId) {
    const token = process.env[`PAGE_TOKEN_${pageId}`];
    const password = process.env[`ADMIN_PW_${pageId}`];
    if (!token || !password) return null;
    return { token, password };
}



// ---------- Facebook API helpers ----------
function fetchPostContent(postId, accessToken, callback) {
    const url = `https://graph.facebook.com/v20.0/${postId}?fields=message&access_token=${accessToken}`;
    https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            try {
                const json = JSON.parse(data);
                callback(json.message || '');
            } catch (err) {
                callback('');
            }
        });
    }).on('error', () => callback(''));
}

function extractCodeFromPost(message) {
    const match = message.match(/Code:\s*(\S+)/i);
    return match ? match[1] : null;
}




async function sendPublicReply(
    commentId,
    accessToken,
    pageId
) {

    const pageData =
        await getPageData(pageId);

    const publicReplies =
        pageData?.publicReplies
        || [
            'Thanks for your comment!'
        ];

    const randomIndex =
        Math.floor(
            Math.random()
            *
            publicReplies.length
        );

    const message =
        publicReplies[randomIndex];

    const payload =
        JSON.stringify({
            message
        });

    const options = {
        hostname:
            'graph.facebook.com',

        path:
            `/v20.0/${commentId}/comments?access_token=${accessToken}`,

        method: 'POST',

        headers: {
            'Content-Type':
                'application/json'
        }
    };

    const req =
        https.request(
            options,
            (res) => {

                let data = '';

                res.on(
                    'data',
                    chunk =>
                        data += chunk
                );

                res.on(
                    'end',
                    () => {

                        console.log(
                            'Public reply API response:',
                            data
                        );
                    }
                );
            }
        );

    req.on(
        'error',
        (err) =>
            console.error(
                'Public reply error:',
                err
            )
    );

    req.write(payload);

    req.end();
}









function sendPrivateReply(commentId, text, accessToken) {
    const payload = JSON.stringify({
        recipient: { comment_id: commentId },
        message: { text: text }
    });
    const options = {
        hostname: 'graph.facebook.com',
        path: `/v20.0/me/messages?access_token=${accessToken}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    };
    const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
    console.log('Private reply API response:', data);
});
        
    });
    req.on('error', (err) => console.error('Private reply error:', err));
    req.write(payload);
    req.end();
}

function notifyPageOwner(pageId, message) {
    console.log(`[${pageId}] ${message}`);
}


// ---------- HTTP Basic Auth ----------
function checkAuth(req, ...validPasswords) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) {
        return false;
    }
    const credentials = Buffer
        .from(auth.split(' ')[1], 'base64')
        .toString();
    const [, password] = credentials.split(':');
    return validPasswords.includes(password);
}

function renderPage(
    res,
    filePath,
    replacements = {}
) {

    let html = fs.readFileSync(
        filePath,
        'utf8'
    );

    for (const key in replacements) {

        html = html.replaceAll(
            `{{${key}}}`,
            replacements[key]
        );
    }

    res.writeHead(200, {
        'Content-Type': 'text/html'
    });

    res.end(html);
}


// ---------- MongoDB operations ----------
async function getPageData(pageId) {
    if (!db) return null;
    return await db.collection('pages').findOne({ pageId });
}

async function savePrices(
    pageId,
    prices
) {

    if (!db) return false;

    await db
        .collection('pages')
        .updateOne(
            { pageId },

            {
                $set: {
                    prices
                },

                $setOnInsert: {

                    publicReplies: [
                        'Thanks for your comment!'
                    ],

                    subscriptionExpiry:
                        new Date()
                }
            },

            { upsert: true }
        );

    return true;
}

async function extendSubscription(
    pageId,
    months
) {

    if (!db) return false;

    const page =
        await db
            .collection('pages')
            .findOne({ pageId });

    const now =
        new Date();

    let baseDate = now;

    if (
        page
        &&
        page.subscriptionExpiry
    ) {

        const currentExpiry =
            new Date(
                page.subscriptionExpiry
            );

        if (
            currentExpiry > now
        ) {

            baseDate =
                currentExpiry;
        }
    }

    const newExpiry =
        new Date(baseDate);

    newExpiry.setMonth(
        newExpiry.getMonth() + months
    );

    await db
        .collection('pages')
        .updateOne(
            { pageId },
            {
                $set: {
                    subscriptionExpiry:
                        newExpiry
                },
                
                $setOnInsert: {
                    publicReplies: [
                        'Thanks for your comment!'
                    ],
                    prices: {}
                }
            },
            { upsert: true }
        );

    return newExpiry;
}

async function isSubscriptionActive(pageId) {
    if (!db) return false;
    const doc = await db.collection('pages').findOne({ pageId });
    if (!doc || !doc.subscriptionExpiry) return false;
    return new Date() < new Date(doc.subscriptionExpiry);
}

function renderExtendButtons(
    pageId
) {

    return `

        <form
            method="POST"
            action="/extend-expiry"
            style="display:inline;"
        >

            <input
                type="hidden"
                name="pageId"
                value="${pageId}"
            >

            <input
                type="hidden"
                name="months"
                value="1"
            >

            <button type="submit">
                +1 Month
            </button>

        </form>

        <form
            method="POST"
            action="/extend-expiry"
            style="display:inline;"
        >

            <input
                type="hidden"
                name="pageId"
                value="${pageId}"
            >

            <input
                type="hidden"
                name="months"
                value="3"
            >

            <button type="submit">
                +3 Months
            </button>

        </form>

        <form
            method="POST"
            action="/extend-expiry"
            style="display:inline;"
        >

            <input
                type="hidden"
                name="pageId"
                value="${pageId}"
            >

            <input
                type="hidden"
                name="months"
                value="12"
            >

            <button type="submit">
                +12 Months
            </button>

        </form>

    `;
}


function renderFlashMessage(
    type,
    message
) {

    if (!message) return '';

    return `

        <div class="flash ${type}">
            ${message}
        </div>

    `;
}



// ---------- HTTP Server ----------
const server = http.createServer(async (req, res) => {
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
    const adminMatch = url.pathname.match(/^\/admin\/(\d+)$/);    
    if (req.method === 'GET' && adminMatch) {    
        const pageId = adminMatch[1];    
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
            }
        );
           
        return;
    }


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
            !checkAuth(req, config.password)
            && !checkAuth(req, MASTER_PASSWORD)
        ) {
    
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

    
    // Admin panel (POST)
    // Secret endpoint for extension (POST)
    if (req.method === 'POST' && url.pathname === '/extend-expiry') {
        const authHeader = req.headers.authorization;
        if (!authHeader || authHeader !== `Bearer ${MASTER_PASSWORD}`) {
            res.writeHead(401);
            res.end('Unauthorized');
            return;
        }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                //const { pageId, months } = JSON.parse(body);

                const params =
                    new URLSearchParams(body);
                
                const pageId =
                    params.get('pageId');
                
                const months =
                    parseInt(
                        params.get('months')
                    );
                
                if (!pageId || typeof months !== 'number' || months <= 0) {
                    res.writeHead(400);
                    res.end('Invalid request: need { pageId, months }');
                    return;
                }
                const newExpiry = await extendSubscription(pageId, months);
                //res.writeHead(200, { 'Content-Type': 'application/json' });
                //res.end(JSON.stringify({ status: 'ok', newExpiry }));
                
                res.writeHead(
                    302,
                    {
                        Location:
                            '/dashboard'
                    }
                );                
                res.end();
                
            } catch (err) {
                console.error(err);
                res.writeHead(500);
                res.end('Internal error');
            }
        });
        return;
    }




        // Update expiry date (POST)
    if (
        req.method === 'POST'
        &&
        url.pathname === '/update-expiry'
    ) {

        const authHeader =
            req.headers.authorization;

        if (
            !authHeader
            ||
            authHeader !==
            `Bearer ${MASTER_PASSWORD}`
        ) {

            res.writeHead(401);

            res.end('Unauthorized');

            return;
        }

        let body = '';

        req.on(
            'data',
            chunk => body += chunk
        );

        req.on(
            'end',
            async () => {

                const params =
                    new URLSearchParams(body);

                const pageId =
                    params.get('pageId');

                const expiry =
                    params.get('expiry');

                await db
                    .collection('pages')
                    .updateOne(
                        { pageId },
                        {
                            $set: {
                                subscriptionExpiry:
                                    new Date(expiry)
                            }
                        }
                    );

                res.writeHead(
                    302,
                    {
                        Location:
                        '/dashboard'
                    }
                );

                res.end();
            }
        );

        return;
    }
    

    // Dashboard (GET)
    if (req.method === 'GET' && url.pathname === '/dashboard') {
        const authHeader = req.headers.authorization;
        if (!authHeader || authHeader !== `Bearer ${MASTER_PASSWORD}`) {
            res.writeHead(401, { 'WWW-Authenticate': 'Bearer realm="Dashboard"' });
            res.end('Unauthorized');
            return;
        }
        const docs = await db
            .collection('pages')
            .find()
            .toArray();
                
        const rows = docs.map(doc => {
        
            const expiryDate =
                new Date(
                    doc.subscriptionExpiry
                )
                .toISOString()
                .split('T')[0];
        
            return `
        
        <tr>
        
            <td>
                ${doc.pageId}
            </td>
        
            <td>
        
                <input
                    type="date"
        
                    class="expiry-input"
        
                    value="${expiryDate}"
        
                    data-original="${expiryDate}"
        
                    onchange="toggleSaveButton(this)"
                >
        
            </td>
        
            <td>
        
                <form
                    method="POST"
                    action="/update-expiry"
                >
        
                    <input
                        type="hidden"
                        name="pageId"
                        value="${doc.pageId}"
                    >
        
                    <input
                        type="hidden"
                        name="expiry"
                        class="expiry-hidden"
                        value="${expiryDate}"
                    >
        
                    <button
                        type="submit"
                        class="save-date-btn"
                        disabled
                    >
                        Save Date
                    </button>
        
                </form>
        
            </td>
        
            <td>    
                ${renderExtendButtons(doc.pageId)}        
            </td>
        
        </tr>
        
        `;
        
        }).join('');     


        renderPage(
            res,
            './pages/dashboard.html',
            {
                ROWS: rows
            }
        );

        
        return;
    }

    
        // ----- Receive comment events (POST) -----   
    if (req.method === 'POST' && url.pathname === '/webhook') {
        console.log('📨 POST /webhook received');  // <-- debug
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            console.log(`📦 chunk length: ${chunk.length}`); // <-- debug
        });
        req.on('end', async () => {
            console.log('✅ Webhook body length:', body.length);
            console.log('📄 Body preview:', body.substring(0, 500));
            try {
                const data = JSON.parse(body);
                console.log('🔍 Parsed data object:', Object.keys(data));
                if (data.object === 'page') {
                    console.log('📑 Processing page object');
                    for (const entry of data.entry) {
                        const pageId = entry.id;
                        console.log(`🆔 Page ID: ${pageId}`);
                        const config = getPageConfig(pageId);
                        if (!config) {
                            console.error(`❌ Unknown page ${pageId}, ignoring`);
                            continue;
                        }
                        const active = await isSubscriptionActive(pageId);
                        if (!active) {
                            console.log(`⏸️ Page ${pageId} subscription expired – skipping`);
                            continue;
                        }
                        for (const change of entry.changes || []) {
                            if (change.field === 'feed') {
                                console.log('💬 Feed change detected');
                                const comment = change.value;
                                const commentId = comment.comment_id || comment.id;
                                const postId = comment.post_id;
                                // Ignore self-comments and duplicate comments

                                const commenterId = comment.from?.id;
                                if (commenterId === pageId) {
                                    console.log(`Ignoring page self-comment: ${commentId}`);
                                    continue;
                                    }                                
                                if (processedComments.has(commentId)) {
                                    console.log(`Duplicate comment ignored: ${commentId}`);
                                    continue;
                                    }
                                
                                // Process valid comments                               
                                console.log(`🆔 commentId: ${commentId}, postId: ${postId}`);
                                if (postId && commentId) {
                                    //sendPublicReply(commentId, config.token);
                                    await sendPublicReply(
                                        commentId,
                                        config.token,
                                        pageId
                                    );
                                    fetchPostContent(postId, config.token, async (postMessage) => {
                                        console.log(`📝 Post content: ${postMessage}`);
                                        const code = extractCodeFromPost(postMessage);
                                        if (code) {
                                            const pageData = await getPageData(pageId);
                                            const price = pageData?.prices?.[code];
                                            if (price !== undefined) {
                                                // sendPrivateReply(commentId, `The price for this item is $${price}.`, config.token);
                                                sendPrivateReply(commentId, `سعر هذا المنتج هو:${price}.`, config.token);
                                                processedComments.add(commentId);
                                            } else {
                                                //sendPrivateReply(commentId, `Sorry, price for code "${code}" not found.`, config.token);
                                                sendPrivateReply(commentId, `عذرا، لم أعثر على سعر هذا المنتج: "${code}" لمعرفة السعر علق هنا بنقطة.`, config.token);
                                                // Owner alert
                                                try {
                                                    notifyPageOwner(pageId,`Missing price for code "${code}" in post ${postId}`);
                                                    } catch (err) {
                                                    console.error('notifyPageOwner failed:', err);
                                                    }
                                            }
                                        } else {
                                            //sendPrivateReply(commentId, 'Please include an item code in the post, e.g., "Code: item_blue_widget"', config.token);
                                            sendPrivateReply(commentId, 'عذرا، لايحتوي المنشور على معرف للمنتج المرغوب. لمعرفة السعر علق هنا بنقطة.', config.token);
                                            // Owner alert
                                            try {
                                                    notifyPageOwner(pageId,`No product code found in post ${postId}`);
                                                    } catch (err) {
                                                    console.error('notifyPageOwner failed:', err);
                                                    }
                                        }
                                    });
                                } else {
                                    console.log('⚠️ Missing commentId or postId');
                                }
                            }
                        }
                    }
                } else {
                    console.log('❌ Not a page object');
                }
            } catch (err) {
                console.error('💥 Error parsing webhook:', err);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
        });
        return;
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
