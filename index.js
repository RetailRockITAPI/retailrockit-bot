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
// 1. CALCULATOR (12 MONTHS / 365 DAYS)
// ==========================================
async function calculateQuote(apiKey) {
    try {
        const baseUrl = 'https://seller-api.takealot.com/v2/sales';
        let totalSales = 0;
        let keepFetching = true;
        let pageNumber = 1;

        // UPDATED: Look back 365 days (12 Months)
        const today = new Date();
        const pastDate = new Date();
        pastDate.setDate(today.getDate() - 365); 

        const startDate = pastDate.toISOString().split('T')[0];
        const endDate = today.toISOString().split('T')[0];
        
        console.log(`[Calc] Starting fetch: ${startDate} to ${endDate}`);

        while (keepFetching) {
            const finalUrl = `${baseUrl}?filters=start_date:${startDate},end_date:${endDate}&page_number=${pageNumber}&page_size=100`;

            const response = await axios.get(finalUrl, {
                headers: {
                    'Authorization': `Key ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.status === 200 && response.data.sales && response.data.sales.length > 0) {
                const sales = response.data.sales;
                
                sales.forEach(sale => {
                    if (sale.selling_price) {
                        totalSales += parseFloat(sale.selling_price);
                    }
                });

                console.log(`[Calc] Page ${pageNumber} Processed. Rows: ${sales.length} | Current Total: ${totalSales}`);
                pageNumber++;
                
                // UPDATED SAFETY LIMIT:
                // Allow up to 150 pages (15,000 sales) to accommodate a full year of data
                if (pageNumber > 150) keepFetching = false; 

            } else {
                keepFetching = false;
            }
        }

        console.log(`[Calc] Final Total Sales: ${totalSales}`);
        
        // Quote Logic: 80% of Gross Sales
        return Math.floor(totalSales * 0.80);

    } catch (error) {
        if (error.response) {
            console.error("[Calc Error] API Status:", error.response.status);
            console.error("[Calc Error] Data:", error.response.data);
        } else {
            console.error("[Calc Error] Network:", error.message);
        }
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
    // Prevent Timeout: Reply to Facebook immediately
    res.sendStatus(200);

    const body = req.body;

    if (body.object && body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
        const messageData = body.entry[0].changes[0].value.messages[0];
        const from = messageData.from;
        const text = messageData.text ? messageData.text.body : "";

        if (!userState[from]) userState[from] = { step: 0 };
        const step = userState[from].step;

        // RESET COMMAND
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

            if (apiKey.length < 10) {
                await sendWhatsAppMessage(from, "That key looks invalid. Please paste the full key.");
                return;
            }

            // Updated message to warn user it might take a moment
            await sendWhatsAppMessage(from, "🔍 Crunching the numbers... (Analyzing last 12 months)\n\nThis might take about 30 seconds.");

            const quote = await calculateQuote(apiKey);

            if (quote !== null) {
                const formattedQuote = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(quote);
                
                await sendWhatsAppMessage(from, `🎉 **Good News!**\n\nBased on your sales history, you qualify for:\n\n💰 **${formattedQuote}**\n\nWould you like an agent to contact you? (Yes/No)`);
                userState[from].step = 3;
            } else {
                await sendWhatsAppMessage(from, "⚠️ We couldn't access your sales data.\n\nPlease check:\n1. Is the API Key correct?\n2. Does this account have sales in the last 12 months?");
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
            {
                messaging_product: "whatsapp",
                to: to,
                text: { body: bodyText }
            },
            {
                headers: {
                    Authorization: `Bearer ${WHATSAPP_TOKEN}`,
                    "Content-Type": "application/json"
                }
            }
        );
    } catch (error) {
        console.error("Msg Error:", error.response ? error.response.data : error.message);
    }
}

app.listen(PORT, () => {
    console.log(`Bot is running on port ${PORT}`);
});
