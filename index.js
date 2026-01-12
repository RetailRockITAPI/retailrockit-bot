const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// ============================================================
// ⚠️ PASTE YOUR KEY HERE FOR THE TEST
// ============================================================
const TEST_API_KEY = "9356fec97974fb65f2ec3f7de5c54751609ff44a334b2b3ab2fa89b06bc2b941d82974b22b4931c03f573008405f29583656874487994f74dca421dc0a60b5f5"; 
// ^^^ Keep the quotes! e.g. "f4a5c9..."

// ==========================================
// 2. AUTOMATIC STARTUP TEST
// ==========================================
async function runStartupTest() {
    console.log("------------------------------------------------");
    console.log("⚡ STARTUP TEST: Testing API Key directly...");
    console.log("------------------------------------------------");

    // Clean the key just in case
    const apiKey = TEST_API_KEY.replace(/Key/gi, "").replace(/[\s\n\r]/g, "").trim();

    try {
        // Simple test: Just fetch 1 day of sales
        const today = new Date().toISOString().split('T')[0];
        const url = `https://seller-api.takealot.com/v2/sales?filters=start_date:${today},end_date:${today}&page_size=1`;

        console.log(`[Test] Connecting to Takealot with Key ending in: ...${apiKey.slice(-5)}`);

        const response = await axios.get(url, {
            headers: {
                'Authorization': `Key ${apiKey}`,
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
        });

        if (response.status === 200) {
            console.log("✅ SUCCESS! The Key works perfectly.");
            console.log("✅ Takealot accepted the connection.");
            console.log("👉 CONCLUSION: The Key is good. WhatsApp was the problem.");
        } 

    } catch (error) {
        console.log("❌ FAILED: Takealot rejected the connection.");
        if (error.response) {
            console.log(`❌ ERROR CODE: ${error.response.status}`); // 401 means Bad Key
            console.log(`❌ REASON: ${JSON.stringify(error.response.data)}`);
        } else {
            console.log(`❌ NETWORK ERROR: ${error.message}`);
        }
    }
    console.log("------------------------------------------------");
}

// Run the test 5 seconds after the server starts
setTimeout(runStartupTest, 5000);

// ==========================================
// 3. STANDARD BOT SETUP (Keep this running)
// ==========================================
app.get("/webhook", (req, res) => {
    if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
        res.status(200).send(req.query["hub.challenge"]);
    } else {
        res.sendStatus(403);
    }
});

app.post("/webhook", async (req, res) => {
    res.sendStatus(200);
    // (Bot logic is paused for this test to keep logs clean)
});

app.listen(PORT, () => {
    console.log(`Bot is running on port ${PORT}`);
});
