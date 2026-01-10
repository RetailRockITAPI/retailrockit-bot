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
// 1. CONFIGURATION: EDIT THIS LIST OF CONSULTANTS
// ============================================================
// Format: "27821234567" (No spaces, no '+', use country code '27')
const consultants = [
    { name: "RockIT Consultant Nadine", number: "‪27820786946‬" },
    { name: "RockIT Consultant Junika", number: "‪27675473171‬" },
    { name: "RockIT Consultant Nadia", number: "‪27725425093‬" }
];

const userState = {};

// ==========================================
// 2. CALCULATOR (12 MONTHS / 365 DAYS)
// ==========================================
async function calculateQuote(apiKey) {
    try {
        const baseUrl = 'https://seller-api.takealot.com/v2/sales';
        let totalSales = 0;
        let keepFetching = true;
        let pageNumber = 1;

        // Look back 365 days (12 Months)
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
                
                // Safety limit: 150 pages
                if (pageNumber > 150) keepFetching = false; 

            } else {
                keepFetching = false;
            }
        }

        console.log(`[Calc] Final Total Sales: ${totalSales}`);
        return Math.floor(totalSales * 0.80); // 80% Quote

    } catch (error) {
        console.error("[Calc Error]", error.message);
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
        const from = messageData.from; // The User's Phone Number
        const text = messageData.text ? messageData.text.body : "";

        if (!userState[from]) userState[from] = { step: 0, quote: 0 };
        const step = userState[from].step;

        // RESET COMMAND
        if (text.toLowerCase() === "reset") {
            userState[from] = { step: 0, quote: 0 };
            await sendWhatsAppMessage(from, "Conversation reset. Say 'Hi' to start over!");
            return;
        }

        // STEP 0: Welcome
        if (step === 0) {
            await sendWhatsAppMessage(from, "Welcome to RetailRockIT! 🚀\n\nDo you want to see how much funding you qualify for? (Yes/No)");
            userState[from].step = 1;
        } 
        
        // STEP 1: Interest
        else if (step === 1) {
            if (text.toLowerCase().includes("yes")) {
                await sendWhatsAppMessage(from, "Great! Please paste your **Takealot Seller API Key** below.");
                userState[from].step = 2;
            } else {
                await sendWhatsAppMessage(from, "No problem! Type 'Hi' anytime.");
                userState[from].step = 0;
            }
        }

        // STEP 2: Calculation
        else if (step === 2) {
            const apiKey = text.trim();

            if (apiKey.length < 10) {
                await sendWhatsAppMessage(from, "That key looks invalid. Please paste the full key.");
                return;
            }

            await sendWhatsAppMessage(from, "🔍 Crunching the numbers... (Analyzing last 12 months)\n\nThis might take about 30 seconds.");

            const quote = await calculateQuote(apiKey);

            if (quote !== null) {
                // SAVE THE QUOTE TO MEMORY
                userState[from].quote = quote;

                const formattedQuote = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(quote);
                
                await sendWhatsAppMessage(from, `🎉 **Good News!**\n\nBased on your sales history, you qualify for:\n\n💰 **${formattedQuote}**\n\nWould you like an agent to contact you to secure this funding? (Yes/No)`);
                userState[from].step = 3;
            } else {
                await sendWhatsAppMessage(from, "⚠️ We couldn't access your sales data.\n\nPlease check:\n1. Is the API Key correct?\n2. Does this account have sales in the last 12 months?");
            }
        }

        // STEP 3: ASSIGN TO AGENT
        else if (step === 3) {
             if (text.toLowerCase().includes("yes")) {
                 // 1. Pick a Random Consultant
                 const randomAgent = consultants[Math.floor(Math.random() * consultants.length)];

                 // 2. Format the Quote for display
                 const finalQuote = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(userState[from].quote);

                 // 3. Notify the User
                 await sendWhatsAppMessage(from, `Perfect! We have assigned **${randomAgent.name}** to your case.\n\nThey have been notified and will message you shortly! 🚀`);

                 // 4. Notify the Agent (The Bot sends a message to the Agent)
                 const agentMessage = `🔔 *NEW LEAD ALERT*\n\n**Client Number:** +${from}\n**Qualified Amount:** ${finalQuote}\n**Status:** Customer accepted quote.\n\nPlease contact them immediately.`;
                 
                 await sendWhatsAppMessage(randomAgent.number, agentMessage);

                 // Reset User
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
