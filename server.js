const http = require('http');
const https = require('https');
const { MongoClient } = require('mongodb');

// ---------- Environment Variables ----------
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const MASTER_PASSWORD = process.env.MASTER_PW;       // Only you know this
const MONGODB_URI = process.env.MONGODB_URI;         // Your MongoDB Atlas connection string

if (!VERIFY_TOKEN || !MASTER_PASSWORD || !MONGODB_URI) {
    console.error("Missing required env vars: VERIFY_TOKEN, MASTER_PW, MONGODB_URI");
    process.exit(1);
}

// ---------- MongoDB Connection ----------
let db;
async function connectDB() {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(); // default database from connection string
    console.log("Connected to MongoDB");
}
connectDB().catch(err => { console.error("DB connection failed:", err); process.exit(1); });

// Helper to get a page's config from environment (tokens and admin passwords)
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
        res.on('end', () => console.log(`Public reply sent: ${message}`));
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
        res.on('end', () => console.log(`Private reply sent: ${text}`));
    });
    req.on('error', (err) => console.error('Private reply error:', err));
    req.write(payload);
    req.end();
}

// ---------- HTTP Basic Auth for admin panels ----------
function checkAuth(req, expectedPassword) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return false;
    const [scheme, encoded] = authHeader.split(' ');
    if (scheme !== 'Basic' || !encoded) return false;
    const decoded = Buffer.from(encoded, 'base64').toString();
    const [, password] = decoded.split(':');
    return password === expectedPassword;
}

// ---------- MongoDB operations for prices and subscription ----------
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
    if (!db) return false; // if DB down, don't reply
    const doc = await db.collection('pages').findOne({ pageId });
    if (!doc || !doc.subscriptionExpiry) return true; // no expiry set = active
    return new Date() < new Date(doc.subscriptionExpiry);
}

// ---------- HTTP Server ----------
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // ----- Webhook verification (GET) -----
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

    // ----- Admin panel for price editing (GET) -----
    const adminMatch = url.pathname.match(/^\/admin\/(\d+)$/);
    if (req.method === 'GET' && adminMatch) {
        const pageId = adminMatch[1];
        const config = getPageConfig(pageId);
        if (!config) {
            res.writeHead(404);
            res.end('Page not configured');
            return;
        }
        if (!checkAuth(req, config.password)) {
            res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Admin Panel"' });
            res.end('Unauthorized');
            return;
        }
        const pageData = await getPageData(pageId);
        const prices = pageData?.prices || {};
        const html = `<!DOCTYPE html>
        <html>
        <head><title>Edit Prices - Page ${pageId}</title></head>
        <body>
            <h2>Edit Prices for Page ${pageId}</h2>
            <form method="POST" action="/admin/${pageId}">
                <textarea name="prices" rows="15" cols="60">${JSON.stringify(prices, null, 2)}</textarea><br><br>
                <button type="submit">Save</button>
            </form>
            <p>Format: { "item_code": price, "another_code": 29.99 }</p>
            <p>Use exactly: <code>Code: item_code</code> in your Facebook post.</p>
        </body>
        </html>`;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
        return;
    }

    // ----- Admin panel (POST) -----
    if (req.method === 'POST' && adminMatch) {
        const pageId = adminMatch[1];
        const config = getPageConfig(pageId);
        if (!config) {
            res.writeHead(404);
            res.end('Page not configured');
            return;
        }
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

    // ----- Secret endpoint for you to extend subscription (POST) -----
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

    // ----- Receive comment events (POST) -----
    if (req.method === 'POST' && url.pathname === '/webhook') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            console.log('Received webhook body:', body);
            try {
                const data = JSON.parse(body);
                if (data.object === 'page') {
                    for (const entry of data.entry) {
                        const pageId = entry.id;
                        const config = getPageConfig(pageId);
                        if (!config) {
                            console.error(`Unknown page ${pageId}, ignoring`);
                            continue;
                        }
                        // Check subscription expiry
                        const active = await isSubscriptionActive(pageId);
                        if (!active) {
                            console.log(`Page ${pageId} subscription expired. Skipping replies.`);
                            continue;
                        }
                        for (const change of entry.changes || []) {
                            if (change.field === 'feed') {
                                const comment = change.value;
                                const commentId = comment.comment_id || comment.id;
                                const postId = comment.post_id;
                                if (postId && commentId) {
                                    // Send public random reply immediately
                                    sendPublicReply(commentId, config.token);
                                    // Then handle price lookup and private reply
                                    fetchPostContent(postId, config.token, async (postMessage) => {
                                        console.log(`Post ${postId} content: ${postMessage}`);
                                        const code = extractCodeFromPost(postMessage);
                                        if (code) {
                                            const pageData = await getPageData(pageId);
                                            const price = pageData?.prices?.[code];
                                            if (price !== undefined) {
                                                sendPrivateReply(commentId, `The price for this item is $${price}.`, config.token);
                                            } else {
                                                sendPrivateReply(commentId, `Sorry, price for code "${code}" not found. Please contact the page owner.`, config.token);
                                            }
                                        } else {
                                            sendPrivateReply(commentId, 'Please include an item code in the post, e.g., "Code: item_blue_widget"', config.token);
                                        }
                                    });
                                }
                            }
                        }
                    }
                }
            } catch (err) {
                console.error('Error parsing webhook:', err);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
        });
        return;
    }

    // ----- Anything else -----
    res.writeHead(404);
    res.end('Not found');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Verify token: ${VERIFY_TOKEN ? '✓ set' : '✗ missing'}`);
    console.log('Waiting for comments...');
});