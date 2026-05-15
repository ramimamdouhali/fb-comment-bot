const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ---------- Random public replies (customize as you like) ----------
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

// ---------- Helper: Get environment variables for a page ----------
function getPageConfig(pageId) {
    const token = process.env[`PAGE_TOKEN_${pageId}`];
    const password = process.env[`ADMIN_PW_${pageId}`];
    if (!token || !password) {
        console.error(`Missing config for page ${pageId}`);
        return null;
    }
    return { token, password };
}

// ---------- Price file management (separate per page) ----------
const PRICES_DIR = path.join(__dirname, 'prices');
if (!fs.existsSync(PRICES_DIR)) fs.mkdirSync(PRICES_DIR);

function getPricesFilePath(pageId) {
    return path.join(PRICES_DIR, `${pageId}.json`);
}

function loadPrices(pageId) {
    const filePath = getPricesFilePath(pageId);
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        // Return empty object if file doesn't exist or is invalid
        return {};
    }
}

function savePrices(pageId, prices) {
    const filePath = getPricesFilePath(pageId);
    fs.writeFileSync(filePath, JSON.stringify(prices, null, 2));
}

// ---------- Fetch post content from Facebook ----------
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

// ---------- Extract item code from post message ----------
function extractCodeFromPost(message) {
    // Look for "Code: something" (case-insensitive)
    const match = message.match(/Code:\s*(\S+)/i);
    return match ? match[1] : null;
}

// ---------- Send public reply to the comment (random message) ----------
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
            console.log(`Public reply sent to comment ${commentId}: ${message}`);
        });
    });
    req.on('error', (err) => console.error('Error sending public reply:', err));
    req.write(payload);
    req.end();
}

// ---------- Send private message to comment author ----------
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
            console.log(`Private reply sent: ${text}`);
        });
    });
    req.on('error', (err) => console.error('Error sending private reply:', err));
    req.write(payload);
    req.end();
}

// ---------- HTTP Basic Auth helper ----------
function checkAuth(req, expectedPassword) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return false;
    const [scheme, encoded] = authHeader.split(' ');
    if (scheme !== 'Basic' || !encoded) return false;
    const decoded = Buffer.from(encoded, 'base64').toString();
    const [, password] = decoded.split(':'); // username ignored
    return password === expectedPassword;
}

// ---------- Create HTTP server ----------
const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    
    // ----- Webhook verification (GET) -----
    if (req.method === 'GET' && url.pathname === '/webhook') {
        const mode = url.searchParams.get('hub.mode');
        const token = url.searchParams.get('hub.verify_token');
        const challenge = url.searchParams.get('hub.challenge');
        const expectedToken = process.env.VERIFY_TOKEN;
        if (mode === 'subscribe' && token === expectedToken) {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end(challenge);
            console.log('Webhook verified!');
        } else {
            res.writeHead(403);
            res.end('Verification failed');
        }
        return;
    }
    
    // ----- Admin panel (GET) -----
    const adminMatch = url.pathname.match(/^\/admin\/(\d+)$/);
    if (req.method === 'GET' && adminMatch) {
        const pageId = adminMatch[1];
        const config = getPageConfig(pageId);
        if (!config) {
            res.writeHead(404);
            res.end('Page not configured');
            return;
        }
        // Check password
        if (!checkAuth(req, config.password)) {
            res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Admin Panel"' });
            res.end('Unauthorized');
            return;
        }
        const prices = loadPrices(pageId);
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
        req.on('end', () => {
            const params = new URLSearchParams(body);
            const pricesText = params.get('prices');
            try {
                const newPrices = JSON.parse(pricesText);
                savePrices(pageId, newPrices);
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`<h2>Prices saved! <a href="/admin/${pageId}">Go back</a></h2>`);
            } catch (err) {
                res.writeHead(400);
                res.end('Invalid JSON');
            }
        });
        return;
    }
    
    // ----- Receive comment events (POST) -----
    if (req.method === 'POST' && url.pathname === '/webhook') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            console.log('Received webhook body:', body);
            try {
                const data = JSON.parse(body);
                if (data.object === 'page') {
                    for (const entry of data.entry) {
                        const pageId = entry.id; // The Facebook Page ID
                        const config = getPageConfig(pageId);
                        if (!config) {
                            console.error(`Unknown page ${pageId}, ignoring`);
                            continue;
                        }
                        // Process changes (comments, etc.)
                        for (const change of entry.changes || []) {
                            if (change.field === 'feed') {
                                const comment = change.value;
                                const commentId = comment.comment_id || comment.id;
                                const postId = comment.post_id;
                                if (postId && commentId) {
                                    // 1. Send public random reply immediately
                                    sendPublicReply(commentId, config.token);
                                    
                                    // 2. Then handle price lookup and private reply
                                    fetchPostContent(postId, config.token, (postMessage) => {
                                        console.log(`Post ${postId} content: ${postMessage}`);
                                        const code = extractCodeFromPost(postMessage);
                                        if (code) {
                                            const prices = loadPrices(pageId);
                                            const price = prices[code];
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
            // Always acknowledge receipt to Facebook
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
        });
        return;
    }
    
    // ----- Any other route -----
    res.writeHead(404);
    res.end('Not found');
});

// ---------- Start server ----------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Verify token: ${process.env.VERIFY_TOKEN ? '✓ set' : '✗ missing'}`);
    console.log('Waiting for comments...');
});