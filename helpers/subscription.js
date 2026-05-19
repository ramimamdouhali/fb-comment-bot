async function extendSubscription(
    db,
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

    let baseDate =
        now;

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
        newExpiry.getMonth()
        + months
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

async function isSubscriptionActive(
    db,
    pageId
) {

    if (!db) return false;

    const doc =
        await db
            .collection('pages')
            .findOne({ pageId });

    if (
        !doc
        ||
        !doc.subscriptionExpiry
    ) {

        return false;
    }

    return (
        new Date()
        <
        new Date(
            doc.subscriptionExpiry
        )
    );
}

module.exports = {
    extendSubscription,
    isSubscriptionActive
};
