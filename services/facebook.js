const https = require('https');

function fetchPostContent(
    postId,
    accessToken,
    callback
) {

    const url =
        `https://graph.facebook.com/v20.0/${postId}?fields=message&access_token=${accessToken}`;

    https.get(url, (res) => {

        let data = '';

        res.on(
            'data',
            chunk => data += chunk
        );

        res.on(
            'end',
            () => {

                try {

                    const json =
                        JSON.parse(data);

                    callback(
                        json.message || ''
                    );

                } catch {

                    callback('');
                }
            }
        );

    }).on(
        'error',
        () => callback('')
    );
}

function extractCodeFromPost(
    message
) {

    const match =
        message.match(
            /Code:\s*(\S+)/i
        );

    return match
        ? match[1]
        : null;
}

function sendPublicReply(
    commentId,
    accessToken,
    publicReplies = []
) {

    const fallbackReplies = [
        "Thanks for your comment! 👍"
    ];

    const replies =
        publicReplies.length
            ? publicReplies
            : fallbackReplies;

    const randomIndex =
        Math.floor(
            Math.random()
            * replies.length
        );

    const message =
        replies[randomIndex];

    const payload =
        JSON.stringify({
            message
        });

    const options = {

        hostname:
            'graph.facebook.com',

        path:
            `/v20.0/${commentId}/comments?access_token=${accessToken}`,

        method:
            'POST',

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
                    chunk => data += chunk
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
        err => console.error(
            'Public reply error:',
            err
        )
    );

    req.write(payload);

    req.end();
}

function sendPrivateReply(
    commentId,
    text,
    accessToken
) {

    const payload =
        JSON.stringify({
            message: text
        });

    const options = {

        hostname:
            'graph.facebook.com',

        path:
            `/v20.0/${commentId}/private_replies?access_token=${accessToken}`,

        method:
            'POST',

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
                    chunk => data += chunk
                );

                res.on(
                    'end',
                    () => {

                        console.log(
                            'Private reply API response:',
                            data
                        );
                    }
                );
            }
        );

    req.on(
        'error',
        err => console.error(
            'Private reply error:',
            err
        )
    );

    req.write(payload);

    req.end();
}

function notifyPageOwner(
    pageId,
    message
) {

    console.log(
        `[${pageId}] ${message}`
    );
}

module.exports = {
    fetchPostContent,
    extractCodeFromPost,
    sendPublicReply,
    sendPrivateReply,
    notifyPageOwner
};
