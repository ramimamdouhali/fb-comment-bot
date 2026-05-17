const http = require('http');
const https = require('https');
const { MongoClient } = require('mongodb');

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

// ---------- Random public replies ----------
const PUBLIC_REPLIES = [
    "Thanks for your comment! 👍",
    "We appreciate your feedback! 😊",
    "Great to hear from you!",
    "Thanks for stopping by!",
    "We'll get back to you soon!",
    "Have a great day! 🌟",
    "Thanks for engaging with us!",
    "We love hearing from our community! 💬",
    "Thanks! Check your private messages.",
    "Appreciate you! 🙌"
];

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

function sendPublicReply(commentId, accessToken) {
    const randomIndex = Math.floor(Math.random() * PUBLIC_REPLIES.length);
    const message = PUBLIC_REPLIES[randomIndex];
    const payload = JSON.stringify({ message });
    const options = {
        hostname: 'graph.facebook.com',
        path: `/v20.0/${commentId}/comments?access_token=${accessToken}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    };
    const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
    console.log('Public reply API response:', data);
});
        
    });
    req.on('error', (err) => console.error('Public reply error:', err));
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
    console.log(`[OWNER NOTICE] [${pageId}] ${message}`);
}


// ---------- HTTP Basic Auth ----------
function checkAuth(req, expectedPassword) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return false;
    const [scheme, encoded] = authHeader.split(' ');
    if (scheme !== 'Basic' || !encoded) return false;
    const decoded = Buffer.from(encoded, 'base64').toString();
    const [, password] = decoded.split(':');
    return password === expectedPassword;
}

// ---------- MongoDB operations ----------
async function getPageData(pageId) {
    if (!db) return null;
    return await db.collection('pages').findOne({ pageId });
}

async function savePrices(pageId, prices) {
    if (!db) return false;
    await db.collection('pages').updateOne(
        { pageId },
        { $set: { prices } },
        { upsert: true }
    );
    return true;
}

async function extendSubscription(pageId, months) {
    if (!db) return false;
    const newExpiry = new Date();
    newExpiry.setMonth(newExpiry.getMonth() + months);
    await db.collection('pages').updateOne(
        { pageId },
        { $set: { subscriptionExpiry: newExpiry } },
        { upsert: true }
    );
    return newExpiry;
}

async function isSubscriptionActive(pageId) {
    if (!db) return false;
    const doc = await db.collection('pages').findOne({ pageId });
    if (!doc || !doc.subscriptionExpiry) return true;
    return new Date() < new Date(doc.subscriptionExpiry);
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
        if (!config) { res.writeHead(404); res.end('Page not configured'); return; }
        if (!checkAuth(req, config.password)) {
            res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Admin Panel"' });
            res.end('Unauthorized');
            return;
        }
        const pageData = await getPageData(pageId);
        const prices = pageData?.prices || {};
        const html = `<!DOCTYPE html>
        <html><head><title>Edit Prices - Page ${pageId}</title></head>
        <body>
            <h2>Edit Prices for Page ${pageId}</h2>
            <form method="POST" action="/admin/${pageId}">
                <textarea name="prices" rows="15" cols="60">${JSON.stringify(prices, null, 2)}</textarea><br><br>
                <button type="submit">Save</button>
            </form>
            <p>Format: { "item_code": price, ... }</p>
            <p>Use: <code>Code: item_code</code> in your Facebook post.</p>
        </body></html>`;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
        return;
    }

    // Admin panel (POST)
    if (req.method === 'POST' && adminMatch) {
        const pageId = adminMatch[1];
        const config = getPageConfig(pageId);
        if (!config) { res.writeHead(404); res.end('Page not configured'); return; }
        if (!checkAuth(req, config.password)) {
            res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Admin Panel"' });
            res.end('Unauthorized');
            return;
        }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const params = new URLSearchParams(body);
            const pricesText = params.get('prices');
            try {
                const newPrices = JSON.parse(pricesText);
                await savePrices(pageId, newPrices);
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`<h2>Prices saved! <a href="/admin/${pageId}">Go back</a></h2>`);
            } catch (err) {
                res.writeHead(400);
                res.end('Invalid JSON');
            }
        });
        return;
    }

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
                const { pageId, months } = JSON.parse(body);
                if (!pageId || typeof months !== 'number' || months <= 0) {
                    res.writeHead(400);
                    res.end('Invalid request: need { pageId, months }');
                    return;
                }
                const newExpiry = await extendSubscription(pageId, months);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok', newExpiry }));
            } catch (err) {
                console.error(err);
                res.writeHead(500);
                res.end('Internal error');
            }
        });
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
        let pageIdsFromDB = [];
        if (db) {
            const docs = await db.collection('pages').find({}, { projection: { pageId: 1 } }).toArray();
            pageIdsFromDB = [...new Set(docs.map(d => d.pageId))];
        }
        const extraPageIds = process.env.PAGE_IDS_LIST ? process.env.PAGE_IDS_LIST.split(',') : [];
        const allPageIds = [...new Set([...pageIdsFromDB, ...extraPageIds])];
        const pagesData = [];
        for (const pageId of allPageIds) {
            const doc = await db.collection('pages').findOne({ pageId });
            pagesData.push({
                pageId,
                expiry: doc?.subscriptionExpiry ? new Date(doc.subscriptionExpiry).toISOString().slice(0,10) : 'No expiry (active)'
            });
        }
        const html = `<!DOCTYPE html>
        <html>
        <head><title>Bot Admin Dashboard</title>
        <style>
            body { font-family: Arial; margin: 2rem; }
            table { border-collapse: collapse; width: 100%; max-width: 800px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f2f2f2; }
            button { padding: 6px 12px; margin: 2px; cursor: pointer; }
            .expired { color: red; font-weight: bold; }
            .active { color: green; }
            #newPageForm { margin-top: 2rem; padding: 1rem; background: #f9f9f9; border: 1px solid #ccc; }
        </style>
        </head>
        <body>
            <h1>📊 Bot Dashboard</h1>
            <table><thead><tr><th>Page ID</th><th>Subscription Expiry</th><th>Action</th></tr></thead>
            <tbody>
                ${pagesData.map(p => `
                    <tr>
                        <td>${p.pageId}</td>
                        <td class="${p.expiry === 'No expiry (active)' ? 'active' : (new Date(p.expiry) < new Date() ? 'expired' : '')}">${p.expiry}</td>
                        <td>
                            <button onclick="extend('${p.pageId}',1)">+1 Month</button>
                            <button onclick="extend('${p.pageId}',3)">+3 Months</button>
                            <button onclick="extend('${p.pageId}',12)">+12 Months</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody></table>
            <div id="newPageForm">
                <h3>➕ Add / Initialize a New Page</h3>
                <input type="text" id="newPageId" placeholder="Page ID" />
                <input type="number" id="initMonths" placeholder="Initial months (e.g., 1)" />
                <button onclick="initPage()">Create & Extend</button>
                <span id="newPageResult"></span>
            </div>
            <script>
                async function extend(pageId, months) {
                    const res = await fetch('/extend-expiry', {
                        method: 'POST',
                        headers: { 'Authorization': 'Bearer ${MASTER_PASSWORD}', 'Content-Type': 'application/json' },
                        body: JSON.stringify({ pageId, months })
                    });
                    if (res.ok) { alert(\`Extended \${pageId} by \${months} month(s)\`); location.reload(); }
                    else alert('Failed');
                }
                async function initPage() {
                    const pageId = document.getElementById('newPageId').value.trim();
                    const months = parseInt(document.getElementById('initMonths').value);
                    if (!pageId || isNaN(months) || months <= 0) { alert('Invalid'); return; }
                    const res = await fetch('/extend-expiry', {
                        method: 'POST',
                        headers: { 'Authorization': 'Bearer ${MASTER_PASSWORD}', 'Content-Type': 'application/json' },
                        body: JSON.stringify({ pageId, months })
                    });
                    if (res.ok) { alert(\`Page \${pageId} created.\`); location.reload(); }
                    else alert('Failed');
                }
            </script>
        </body>
        </html>`;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
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
                                console.log(`🆔 commentId: ${commentId}, postId: ${postId}`);
                                if (postId && commentId) {
                                    sendPublicReply(commentId, config.token);
                                    fetchPostContent(postId, config.token, async (postMessage) => {
                                        console.log(`📝 Post content: ${postMessage}`);
                                        const code = extractCodeFromPost(postMessage);
                                        if (code) {
                                            const pageData = await getPageData(pageId);
                                            const price = pageData?.prices?.[code];
                                            if (price !== undefined) {
                                                // sendPrivateReply(commentId, `The price for this item is $${price}.`, config.token);
                                                sendPrivateReply(commentId, `سعر هذا المنتج هو:${price}.`, config.token);
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
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
        <html>
        <head><title>Privacy Policy</title></head>
        <body>
            <h1>Privacy Policy</h1>
            <p>This bot read comments on your Facebook Page and replies with prices based on item codes. It does not store personal data beyond what is necessary for the bot to function. No data is shared with third parties.</p>
            <p>For any questions, contact: ramimamdouhali@gmail.com</p>
        </body>
        </html>`);
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
