const {
    getPageConfig
} = require('../helpers/auth');

const {
    isSubscriptionActive
} = require('../helpers/subscription');

const {
    fetchPostContent,
    extractCodeFromPost,
    sendPublicReply,
    sendPrivateReply,
    notifyPageOwner
} = require('../services/facebook');

const {
    getPageData
} = require('../services/database');

const processedComments =
    new Set();

async function handleWebhook(
    req,
    res,
    db
) {

    let body = '';

    req.on(
        'data',
        chunk => {

            body += chunk;
        }
    );

    req.on(
        'end',
        async () => {

            try {

                const data =
                    JSON.parse(body);

                if (
                    data.object === 'page'
                ) {

                    for (
                        const entry
                        of data.entry
                    ) {

                        const pageId =
                            entry.id;

                        const config =
                            getPageConfig(pageId);

                        if (!config) {

                            continue;
                        }

                        const active =
                            await isSubscriptionActive(
                                db,
                                pageId
                            );

                        if (!active) {

                            continue;
                        }

                        for (
                            const change
                            of entry.changes || []
                        ) {

                            if (
                                change.field
                                !== 'feed'
                            ) {

                                continue;
                            }

                            const comment =
                                change.value;

                            const commentId =
                                comment.comment_id
                                || comment.id;

                            const postId =
                                comment.post_id;

                            const commenterId =
                                comment.from?.id;

                            if (
                                commenterId
                                === pageId
                            ) {

                                continue;
                            }

                            if (
                                processedComments.has(
                                    commentId
                                )
                            ) {

                                continue;
                            }

                            if (
                                !postId
                                || !commentId
                            ) {

                                continue;
                            }

                            const pageData =
                                await getPageData(
                                    pageId
                                );

                            await sendPublicReply(
                                commentId,
                                config.token,
                                pageData?.publicReplies || []
                            );

                            fetchPostContent(
                                postId,
                                config.token,
                                async (
                                    postMessage
                                ) => {

                                    const code =
                                        extractCodeFromPost(
                                            postMessage
                                        );

                                    if (code) {

                                        const pageData =
                                            await getPageData(
                                                pageId
                                            );

                                        const price =
                                            pageData?.prices?.[code];

                                        if (
                                            price
                                            !== undefined
                                        ) {

                                            sendPrivateReply(
                                                commentId,
                                                `سعر هذا المنتج هو:${price}.`,
                                                config.token
                                            );

                                            processedComments.add(
                                                commentId
                                            );

                                        } else {

                                            sendPrivateReply(
                                                commentId,
                                                `عذرا، لم أعثر على سعر هذا المنتج: "${code}" لمعرفة السعر علق هنا بنقطة.`,
                                                config.token
                                            );

                                            notifyPageOwner(
                                                pageId,
                                                `Missing price for code "${code}" in post ${postId}`
                                            );
                                        }

                                    } else {

                                        sendPrivateReply(
                                            commentId,
                                            'عذرا، لايحتوي المنشور على معرف للمنتج المرغوب. لمعرفة السعر علق هنا بنقطة.',
                                            config.token
                                        );

                                        notifyPageOwner(
                                            pageId,
                                            `No product code found in post ${postId}`
                                        );
                                    }
                                }
                            );
                        }
                    }
                }

            } catch (err) {

                console.error(
                    'Webhook error:',
                    err
                );
            }

            res.writeHead(
                200,
                {
                    'Content-Type':
                        'application/json'
                }
            );

            res.end(
                JSON.stringify({
                    status: 'ok'
                })
            );
        }
    );
}

module.exports = {
    handleWebhook
};
