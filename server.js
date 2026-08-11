const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();

// إعدادات الـ CORS المخصصة لربطه مع موقعك على Vercel والمحلي
const corsOptions = {
    origin: ['https://read-and-rise-two.vercel.app', 'http://localhost:5173'],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // دعم طلبات الفحص المسبق Pre-flight

app.use(express.json());

// مسار فحص صحة السيرفر للتأكد من عمله
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// دالة لجلب رمز المصادقة من Zoom عبر Server-to-Server OAuth
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

// مسار إنشاء الاجتماع
app.post('/api/create-meeting', async (req, res) => {
    try {
        const { topic, start_time, duration } = req.body;
        const accessToken = await getZoomAccessToken();

        const response = await axios.post(
            'https://api.zoom.us/v2/users/me/meetings',
            {
                topic: topic || 'Read and Rise Meeting',
                type: 2, // Scheduled meeting
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

// الاعتماد على منفذ Railway أو المنفذ 8080 افتراضياً، مع ربط بـ 0.0.0.0
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
