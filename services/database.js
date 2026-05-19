const { MongoClient } =
    require('mongodb');
const MONGODB_URI =
    process.env.MONGODB_URI;



let db;
function getDB() {
    return db;
}

async function connectDB() {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db();
    console.log("Connected to MongoDB");
}

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

module.exports = {
    connectDB,
    getDB,
    getPageData,
    savePrices
};
