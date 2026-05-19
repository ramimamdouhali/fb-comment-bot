const fs = require('fs');

function renderPage(
    res,
    filePath,
    replacements = {}
) {

    let html =
        fs.readFileSync(
            filePath,
            'utf8'
        );

    for (const key in replacements) {

        html =
            html.replaceAll(
                `{{${key}}}`,
                replacements[key]
            );
    }

    res.writeHead(200, {
        'Content-Type': 'text/html'
    });

    res.end(html);
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

module.exports = {
    renderPage,
    renderExtendButtons,
    renderFlashMessage
};
