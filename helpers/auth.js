function getPageConfig(pageId) {

    const token =
        process.env[
            `PAGE_TOKEN_${pageId}`
        ];

    const password =
        process.env[
            `ADMIN_PW_${pageId}`
        ];

    if (
        !token
        ||
        !password
    ) {

        return null;
    }

    return {
        token,
        password
    };
}

function checkAuth(
    req,
    ...validPasswords
) {

    const auth =
        req.headers.authorization;

    if (
        !auth
        ||
        !auth.startsWith('Basic ')
    ) {

        return false;
    }

    const credentials =
        Buffer
            .from(
                auth.split(' ')[1],
                'base64'
            )
            .toString();

    const [, password] =
        credentials.split(':');

    return validPasswords.includes(
        password
    );
}

module.exports = {
    getPageConfig,
    checkAuth
};
