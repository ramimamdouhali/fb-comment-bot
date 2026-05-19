const {
    renderPage,
    renderExtendButtons
} = require('../helpers/render');

const {
    extendSubscription
} = require('../helpers/subscription');

const {
    getDB
} = require('../services/database');

async function handleDashboard(
    req,
    res,
    MASTER_PASSWORD
) {

    const authHeader =
        req.headers.authorization;

    if (
        !authHeader
        ||
        authHeader
        !==
        `Bearer ${MASTER_PASSWORD}`
    ) {

        res.writeHead(
            401,
            {
                'WWW-Authenticate':
                    'Bearer realm="Dashboard"'
            }
        );

        res.end('Unauthorized');

        return;
    }

    const db = getDB();

    const docs =
        await db
            .collection('pages')
            .find()
            .sort({
                subscriptionExpiry: 1
            })
            .toArray();

    const rows =
        docs.map(doc => {

            const expiry =
                new Date(
                    doc.subscriptionExpiry
                );

            const expiryDate =
                expiry
                    .toISOString()
                    .split('T')[0];

            const now =
                new Date();

            const diffMs =
                expiry - now;

            const daysRemaining =
                Math.ceil(
                    diffMs
                    /
                    (
                        1000
                        * 60
                        * 60
                        * 24
                    )
                );

            let statusClass =
                'status-safe';

            let statusText =
                `🟢 ${daysRemaining} days left`;

            if (
                daysRemaining <= 7
            ) {

                statusClass =
                    'status-warning';

                statusText =
                    `🟠 ${daysRemaining} days left;
            }

            if (
                daysRemaining <= 0
            ) {

                statusClass =
                    'status-expired';

                statusText =
                    '🔴 Expired';
            }

            return `

            <tr>

                <td>
                    ${doc.pageId}
                </td>

                <td class="${statusClass}">

                    <input
                        type="date"
                        class="expiry-input"
                        value="${expiryDate}"
                        data-original="${expiryDate}"
                        onchange="toggleSaveButton(this)"
                    >

                </td>

                <td>
                    ${statusText}
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

                    <br><br>

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
}

async function handleExtendExpiry(
    req,
    res,
    MASTER_PASSWORD
) {

    const authHeader =
        req.headers.authorization;

    if (
        !authHeader
        ||
        authHeader
        !==
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

            try {

                const params =
                    new URLSearchParams(body);

                const pageId =
                    params.get('pageId');

                const months =
                    parseInt(
                        params.get('months')
                    );

                const db = getDB();

                await extendSubscription(
                    db,
                    pageId,
                    months
                );

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
        }
    );
}

async function handleUpdateExpiry(
    req,
    res,
    MASTER_PASSWORD
) {

    const authHeader =
        req.headers.authorization;

    if (
        !authHeader
        ||
        authHeader
        !==
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

            const db = getDB();

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
}

module.exports = {
    handleDashboard,
    handleExtendExpiry,
    handleUpdateExpiry
};
