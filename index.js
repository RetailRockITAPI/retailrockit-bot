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
// 1. CONFIGURATION: CONSULTANT LIST
// ============================================================
const consultants = [
    { name: "RockIT Consultant Nadine", number: "27820786946" },
    { name: "RockIT Consultant Junika", number: "27675473171" },
    { name: "RockIT Consultant Nadia", number: "27725425093" }
];

const userState = {};

// ==========================================
// 2. CALCULATOR (SMART CLEANING + USER AGENT)
// ==========================================
async function calculateQuote(rawApiKey) {
    try {
        // SMART CLEANING:
        // 1. Remove the word "Key" if the user pasted it
        // 2. Remove invisible spaces/newlines
        let apiKey = rawApiKey.replace(/Key/gi, "").replace(/[\s\n\r]/g, "").trim();

        console.log(`[Debug] Cleaned Key: ${apiKey.substring(0, 5)}...`); 

        const baseUrl = 'https://seller-api.takealot.com/v2/sales';
        let totalSales = 0;
        let keepFetching = true;
        let pageNumber = 1;

        // Look back 365 days
        const today = new Date();
        const pastDate = new Date();
        pastDate.setDate(today.getDate() - 365); 

        const startDate = pastDate.toISOString().split('T')[0];
        const endDate = today.toISOString().split('T')[0];
        
        console.log(`[Calc] Fetching: ${startDate} to ${endDate}`);

        while (keepFetching) {
            const filterString = `start_date:${startDate},end_date:${endDate}`;
            const url = `${baseUrl}?filters=${filterString}&page_number=${pageNumber}&page_size=100`;

            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Key ${apiKey}`, 
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' // Trick to look like a browser
                }
            });

            if (response.status === 200 && response.data.sales && response.data.sales.length > 0) {
                const sales = response.data.sales;
                
                sales.forEach(sale => {
                    if (sale.selling_price) {
                        totalSales += parseFloat(sale.selling_price);
                    }
                });

                console.log(`[Calc] Page ${pageNumber} OK. Rows: ${sales.length}`);
                pageNumber++;
                
                if (pageNumber > 150) keepFetching = false; 

            } else {
                keepFetching = false;
            }
        }

        console.log(`[Calc] Total: ${totalSales}`);
        return Math.floor(totalSales * 0.80); 

    } catch (error) {
        if (error.response) {
            console.error(`[Calc Error] Status: ${error.response.status}`);
            console.error(`[Calc Error] Data: ${JSON.stringify(error.response.data)}`);
        } else {
            console.error("[Calc Error] Network:", error.message);
        }
        return null; 
    }
}

// ==========================================
// 3. WHATSAPP HANDLER
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

    const body = req.body;

    if (body.object && body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
        const messageData = body.entry[0].changes[0].value.messages[0];
        const from = messageData.from;
        const text = messageData.text ? messageData.text.body : "";

        if (!userState[from]) userState[from] = { step: 0, quote: 0 };
        const step = userState[from].step;

        // RESET
        if (text.toLowerCase() === "reset") {
            userState[from] = { step: 0, quote: 0 };
            await sendWhatsAppMessage(from, "Conversation reset. Say 'Hi' to start over!");
            return;
        }

        // STEP 0
        if (step === 0) {
            await sendWhatsAppMessage(from, "Welcome to RetailRockIT! 🚀\n\nDo you want to see how much funding you qualify for? (Yes/No)");
            userState[from].step = 1;
        } 
        
        // STEP 1
        else if (step === 1) {
            if (text.toLowerCase().includes("yes")) {
                await sendWhatsAppMessage(from, "Great! Please paste your **Takealot Seller API Key** below.");
                userState[from].step = 2;
            } else {
                await sendWhatsAppMessage(from, "No problem! Type 'Hi' anytime.");
                userState[from].step = 0;
            }
        }

        // STEP 2
        else if (step === 2) {
            await sendWhatsAppMessage(from, "🔍 Crunching the numbers... (Analyzing last 12 months)\n\nThis might take about 30 seconds.");

            const quote = await calculateQuote(text);

            if (quote !== null) {
                userState[from].quote = quote;
                const formattedQuote = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(quote);
                
                await sendWhatsAppMessage(from, `🎉 **Good News!**\n\nBased on your sales history, you qualify for:\n\n💰 **${formattedQuote}**\n\nWould you like an agent to contact you to secure this funding? (Yes/No)`);
                userState[from].step = 3;
            } else {
                await sendWhatsAppMessage(from, "⚠️ We couldn't access your sales data.\n\nThe API Key was rejected (Error 401). Please try generating a **New API Key** on Takealot.");
            }
        }

        // STEP 3
        else if (step === 3) {
             if (text.toLowerCase().includes("yes")) {
                 const randomAgent = consultants[Math.floor(Math.random() * consultants.length)];
                 const finalQuote = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(userState[from].quote);

                 await sendWhatsAppMessage(from, `Perfect! We have assigned **${randomAgent.name}** to your case.\n\nThey have been notified and will message you shortly! 🚀`);
                 
                 const agentMessage = `🔔 *NEW LEAD ALERT*\n\n**Client Number:** +${from}\n**Qualified Amount:** ${finalQuote}\n**Status:** Customer accepted quote.\n\nPlease contact them immediately.`;
                 
                 await sendWhatsAppMessage(randomAgent.number, agentMessage);

                 userState[from].step = 0;
             } else {
                 await sendWhatsAppMessage(from, "No problem. Type 'Hi' if you change your mind.");
                 userState[from].step = 0;
             }
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
