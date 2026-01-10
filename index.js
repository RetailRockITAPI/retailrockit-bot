const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

const userState = {};

// ==========================================
// 1. CALCULATOR (Now looks back 180 Days)
// ==========================================
async function calculateQuote(apiKey) {
    // --- DEMO BACKDOOR FOR VIDEO ---
    if (apiKey === "DEMO_MODE") {
        return 450000; // Fake quote of R450k
    }
    // -------------------------------

    try {
        const baseUrl = 'https://seller-api.takealot.com/v2/sales';
        let totalSales = 0;
        let keepFetching = true;
        let pageNumber = 1;

        // REAL MODE: Look back 180 days (6 Months)
        const today = new Date();
        const pastDate = new Date();
        pastDate.setDate(today.getDate() - 180); 

        const startDate = pastDate.toISOString().split('T')[0];
        const endDate = today.toISOString().split('T')[0];
        
        console.log(`[Calc] Starting fetch: ${startDate} to ${endDate}`);

        while (keepFetching) {
            // Manual URL construction
            const finalUrl = `${baseUrl}?filters=start_date:${startDate},end_date:${endDate}&page_number=${pageNumber}&page_size=100`;

            console.log(`[Calc] Requesting Page ${pageNumber}...`);

            const response = await axios.get(finalUrl, {
                headers: {
                    'Authorization': `Key ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.status === 200 && response.data.sales && response.data.sales.length > 0) {
                const sales = response.data.sales;
                sales.forEach(sale => {
                    // Check both 'selling_price' and 'quantity' just in case
                    if (sale.selling_price) {
                        totalSales += parseFloat(sale.selling_price);
                    }
                });
                console.log(`[Calc] Page ${pageNumber} Success. Rows: ${sales.length} | Running Total: ${totalSales}`);
                pageNumber++;
                
                // Limit to 20 pages (2000 sales) to prevent timeout during demo
                if (pageNumber > 20) keepFetching = false; 
            } else {
                keepFetching = false;
            }
        }

        console.log(`[Calc] Finished. Total Sales: ${totalSales}`);
        // Quote is 80% of sales
        return Math.floor(totalSales * 0.80);

    } catch (error) {
        console.error("[Calc Error]", error.message);
        return null; 
    }
}

// ==========================================
// 2. WHATSAPP HANDLER
// ==========================================
app.get("/webhook", (req, res) => {
    if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
        res.status(200).send(req.query["hub.challenge"]);
    } else {
        res.sendStatus(403);
    }
});

app.post("/webhook", async (req, res) => {
    // 1. Respond to Facebook IMMEDIATELY
    res.sendStatus(200);

    const body = req.body;
    if (body.object && body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
        const messageData = body.entry[0].changes[0].value.messages[0];
        const from = messageData.from;
        const text = messageData.text ? messageData.text.body : "";

        if (!userState[from]) userState[from] = { step: 0 };
        const step = userState[from].step;

        // RESET
        if (text.toLowerCase() === "reset") {
            userState[from].step = 0;
            await sendWhatsAppMessage(from, "Conversation reset. Say 'Hi' to start over!");
            return;
        }

        // STEP 0 -> 1
        if (step === 0) {
            await sendWhatsAppMessage(from, "Welcome to RetailRockIT! 🚀\n\nDo you want to see how much funding you qualify for? (Yes/No)");
            userState[from].step = 1;
        } 
        
        // STEP 1 -> 2
        else if (step === 1) {
            if (text.toLowerCase().includes("yes")) {
                await sendWhatsAppMessage(from, "Great! Please paste your **Takealot Seller API Key** below.");
                userState[from].step = 2;
            } else {
                await sendWhatsAppMessage(from, "No problem! Type 'Hi' anytime.");
                userState[from].step = 0;
            }
        }

        // STEP 2 -> CALC
        else if (step === 2) {
            const apiKey = text.trim();

            await sendWhatsAppMessage(from, "🔍 Crunching the numbers... (Analyzing 6 Months History)");

            // Run calculation
            const quote = await calculateQuote(apiKey);

            if (quote !== null) {
                const formattedQuote = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(quote);
                
                // If it's R0.00, we add a specific helpful message
                if (quote === 0) {
                     await sendWhatsAppMessage(from, `We analyzed your data successfully, but the total came to **${formattedQuote}**.\n\nThis usually means there were no completed sales found in the last 6 months.\n\nType 'reset' to try a different API key.`);
                } else {
                     await sendWhatsAppMessage(from, `🎉 **Good News!**\n\nBased on your sales history, you qualify for:\n\n💰 **${formattedQuote}**\n\nWould you like an agent to contact you? (Yes/No)`);
                     userState[from].step = 3;
                }
            } else {
                await sendWhatsAppMessage(from, "⚠️ Access Denied.\n\nTakealot rejected the key. Please check:\n1. Is the key copied correctly?\n2. Is the key still active?");
            }
        }

        // STEP 3 -> END
        else if (step === 3) {
             await sendWhatsAppMessage(from, "Perfect. An agent will contact you shortly! 🚀");
             userState[from].step = 0;
        }
    }
});

async function sendWhatsAppMessage(to, bodyText) {
    try {
        await axios.post(
            `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`,
            { messaging_product: "whatsapp", to: to, text: { body: bodyText } },
            { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
        );
    } catch (error) {
        console.error("Msg Error:", error.response ? error.response.data : error.message);
    }
}

app.listen(PORT, () => {
    console.log(`Bot is running on port ${PORT}`);
});
