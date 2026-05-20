// verification_system.js
// This script verifies the status and environment variables of the app.

const requiredEnv = ['TELEGRAM_BOT_TOKEN', 'GROUP_ID', 'BASE_URL', 'PORT'];

function checkEnvVars() {
    let allSet = true;
    requiredEnv.forEach((key) => {
        if (!process.env[key] || process.env[key] === '' || process.env[key] === 'NOT_SET') {
            console.error(`[ENV CHECK] Missing or invalid: ${key}`);
            allSet = false;
        } else {
            console.log(`[ENV CHECK] ${key} is set.`);
        }
    });
    return allSet;
}

function checkCodesStatus(codes) {
    if (!codes || typeof codes !== 'object') {
        console.error('[CODES CHECK] codes object is missing or invalid.');
        return false;
    }
    let valid = true;
    Object.entries(codes).forEach(([id, data]) => {
        if (!data.status || !['pending', 'valid', 'invalid'].includes(data.status)) {
            console.error(`[CODES CHECK] Invalid status for requestId ${id}: ${data.status}`);
            valid = false;
        } else {
            console.log(`[CODES CHECK] requestId ${id} status: ${data.status}`);
        }
    });
    return valid;
}

function runVerification(appVars) {
    console.log('--- Running App Verification ---');
    const envOk = checkEnvVars();
    const codesOk = checkCodesStatus(appVars.codes);
    if (envOk && codesOk) {
        console.log('All checks passed!');
        return true;
    } else {
        console.error('Some checks failed. See above for details.');
        return false;
    }
}

module.exports = {
    checkEnvVars,
    checkCodesStatus,
    runVerification
};
