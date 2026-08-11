const express = require('express');
const cors = require('cors');
const axios = require('axios');
const KJUR = require('jsrsasign'); // مكتبة لتوليد Signature لـ Zoom SDK
require('dotenv').config();

const app = express();

const corsOptions = {
    origin: ['https://read-and-rise-two.vercel.app', 'http://localhost:5173'],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());

app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// دالة لجلب رمز المصادقة من Zoom
async function getZoomAccessToken() {
    try {
        const credentials = Buffer.from(
            `${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`
        ).toString('base64');

        const response = await axios.post(
            `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${process.env.ZOOM_ACCOUNT_ID}`,
            {},
            {
                headers: {
                    Authorization: `Basic ${credentials}`
                }
            }
        );
        return response.data.access_token;
    } catch (error) {
        console.error('Error getting Zoom access token:', error.response?.data || error.message);
        throw new Error('Failed to authenticate with Zoom');
    }
}

// 1. مسار توليد التوقيع الرقمي (Zoom SDK Signature)
app.post('/api/generate-signature', (req, res) => {
    try {
        const { meetingNumber, role } = req.body; // role: 0 للطالب، 1 للمعلم

        const iat = Math.floor(Date.now() / 1000) - 30;
        const exp = iat + 60 * 60 * 2; // صلاحية التوقيع ساعتان

        const oHeader = { alg: 'HS256', typ: 'JWT' };
        const oPayload = {
            sdkKey: process.env.ZOOM_SDK_KEY,
            mn: meetingNumber,
            role: role || 0,
            iat: iat,
            exp: exp,
            appKey: process.env.ZOOM_SDK_KEY,
            tokenExp: exp
        };

        const sHeader = JSON.stringify(oHeader);
        const sPayload = JSON.stringify(oPayload);
        const signature = KJUR.jws.JWS.sign("HS256", sHeader, sPayload, process.env.ZOOM_SDK_SECRET);

        res.status(200).json({
            signature: signature,
            sdkKey: process.env.ZOOM_SDK_KEY
        });
    } catch (error) {
        console.error('Error generating signature:', error);
        res.status(500).json({ error: 'Failed to generate signature' });
    }
});

// 2. مسار إنشاء الاجتماع
app.post('/api/create-meeting', async (req, res) => {
    try {
        const { topic, start_time, duration } = req.body;
        const accessToken = await getZoomAccessToken();

        const response = await axios.post(
            'https://api.zoom.us/v2/users/me/meetings',
            {
                topic: topic || 'Read and Rise Meeting',
                type: 2,
                start_time: start_time,
                duration: duration || 30,
                settings: {
                    host_video: true,
                    participant_video: true,
                    waiting_room: false
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        res.status(200).json(response.data);
    } catch (error) {
        console.error('Error creating meeting:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to create meeting' });
    }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
