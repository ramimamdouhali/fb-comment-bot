const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// --- 1. Get Settings from Environment Variables (Securely!) ---
// We no longer write the token directly in the code.
// It will come from an Environment Variable that we set on Render.
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

if (!VERIFY_TOKEN || !PAGE_ACCESS_TOKEN) {
    console.error("FATAL ERROR: VERIFY_TOKEN and PAGE_ACCESS_TOKEN must be set as environment variables.");
    process.exit(1);
}

const PRICES_FILE = path.join(__dirname, 'prices.json');

// Load prices from file
function loadPrices() { /* ... (this function stays the same as before) ... */
    try {
        const data = fs.readFileSync(PRICES_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.log('No prices file yet, using empty map');
        return {};
    }
}

// Save prices to file
function savePrices(prices) { /* ... (this function stays the same as before) ... */
    fs.writeFileSync(PRICES_FILE, JSON.stringify(prices, null, 2));
}

// Fetch post content from Facebook
function fetchPostContent(postId, callback) { /* ... (this function stays the same as before) ... */
    const url = `https://graph.facebook.com/v20.0/${postId}?fields=message&access_token=${PAGE_ACCESS_TOKEN}`;
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

// Extract item code from post message (e.g., "Code: item_blue_widget")
function extractCodeFromPost(message) { /* ... (this function stays the same as before) ... */
    const match = message.match(/Code:\s*(\S+)/i);
    return match ? match[1] : null;
}

// Send private reply
function sendPrivateReply(commentId, text) { /* ... (this function stays the same as before) ... */
    const payload = JSON.stringify({
        recipient: { comment_id: commentId },
        message: { text: text }
    });
    
    const options = {
        hostname: 'graph.facebook.com',
        path: `/v20.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    };
    
    const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => console.log('Reply sent:', data));
    });
    req.on('error', (err) => console.error('Error sending reply:', err));
    req.write(payload);
    req.end();
}

// Create HTTP server
const server = http.createServer((req, res) => {
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
    
    // Admin panel to edit prices (GET form)
    if (req.method === 'GET' && url.pathname === '/admin') {
        const prices = loadPrices();
        let html = `<html><body><h2>Edit Prices</h2>
            <form method="POST" action="/admin">
                <textarea name="prices" rows="10" cols="40">${JSON.stringify(prices, null, 2)}</textarea><br>
                <button type="submit">Save</button>
            </form>
            <p>Use format: { "item_code": price, ... }</p>
            </body></html>`;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
        return;
    }
    
    // Admin panel (POST save)
    if (req.method === 'POST' && url.pathname === '/admin') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            const params = new URLSearchParams(body);
            const pricesText = params.get('prices');
            try {
                const newPrices = JSON.parse(pricesText);
                savePrices(newPrices);
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<h2>Prices saved! <a href="/admin">Go back</a></h2>');
            } catch (err) {
                res.writeHead(400);
                res.end('Invalid JSON');
            }
        });
        return;
    }
    
    // Receive comment events (POST)
    if (req.method === 'POST' && url.pathname === '/webhook') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            console.log('Received webhook:', body);
            try {
                const data = JSON.parse(body);
                if (data.object === 'page') {
                    for (const entry of data.entry) {
                        for (const change of entry.changes || []) {
                            if (change.field === 'feed') {
                                const comment = change.value;
                                const commentId = comment.comment_id || comment.id;
                                const postId = comment.post_id;
                                
                                if (postId && commentId) {
                                    // Fetch post content to extract item code
                                    fetchPostContent(postId, (postMessage) => {
                                        console.log(`Post content: ${postMessage}`);
                                        const code = extractCodeFromPost(postMessage);
                                        if (code) {
                                            const prices = loadPrices();
                                            const price = prices[code];
                                            if (price) {
                                                sendPrivateReply(commentId, `The price for this item is $${price}.`);
                                            } else {
                                                sendPrivateReply(commentId, `Sorry, price for code "${code}" not found. Please contact the page owner.`);
                                            }
                                        } else {
                                            sendPrivateReply(commentId, 'Please include an item code in the post, e.g., "Code: item_blue_widget"');
                                        }
                                    });
                                }
                            }
                        }
                    }
                }
            } catch (err) {
                console.error('Error:', err);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
        });
        return;
    }
    
    res.writeHead(404);
    res.end('Not found');
});

// --- 2. Use the PORT provided by Render (or default to 3000 for local testing) ---
// This is the critical change. Render will tell us which port to use.
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Verify token: ${VERIFY_TOKEN.substring(0, 3)}... (redacted)`);
    console.log('Waiting for comments...');
    console.log(`Admin panel available at /admin`);
});