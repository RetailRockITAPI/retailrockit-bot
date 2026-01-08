const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// In-memory storage for user state (Who is talking to us?)
// format: { "phone_number": { step: 1, answers: [] } }
const userState = {};

// ==========================================
// 1. THE CALCULATOR LOGIC (Internal)
// ==========================================
async function calculateQuote(apiKey) {
    try {
        const baseUrl = 'https://seller-api.takealot.com/v2/sales';
        let totalSales = 0;
        let keepFetching = true;
        let pageNumber = 1;

        // We will look back approx 360 days (matching your Python logic)
        // Simplified: Just fetch all sales in the date range
        const today = new Date();
        const oneYearAgo = new Date();
        oneYearAgo.setDate(today.getDate() - 360);

        const startDate = oneYearAgo.toISOString().split('T')[0];
        const endDate = today.toISOString().split('T')[0];
        
        console.log(`Fetching sales from ${startDate} to ${endDate}...`);

        while (keepFetching) {
            const response = await axios.get(baseUrl, {
                headers: {
                    'Authorization': `Key ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                params: {
                    filters: `start_date:${startDate},end_date:${endDate}`,
                    page_number: pageNumber,
                    page_size: 100 
                }
            });

            if (response.status === 200 && response.data.sales && response.data.sales.length > 0) {
                const sales = response.data.sales;
                
                sales.forEach(sale => {
                    // Sum up the selling_price (Gross Sales)
                    if (sale.selling_price) {
                        totalSales += parseFloat(sale.selling_price);
                    }
                });

                console.log(`Page ${pageNumber}: Found ${sales.length} sales. Running Total: ${totalSales}`);
                pageNumber++;
                
                // Safety break to prevent infinite loops if API is weird
                if (pageNumber > 50) keepFetching = false; 

            } else {
                keepFetching = false; // No more sales or empty page
            }
        }

        // Calculate the Offer (80% of Gross Sales)
        const offerAmount = totalSales * 0.80;
        return Math.floor(offerAmount); // Return rounded number

    } catch (error) {
        console.error("Calculator Error:", error.message);
        return null; // Signal that it failed
    }
}

// ==========================================
// 2. WHATSAPP CONNECTION
// ==========================================
app.get("/webhook", (req, res) => {
    if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
        res.status(200).send(req.query["hub.challenge"]);
    } else {
        res.sendStatus(403);
    }
});

app.post("/webhook", async (req, res) => {
    const body = req.body;

    if (body.object) {
        if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
            const messageData = body.entry[0].changes[0].value.messages[0];
            const from = messageData.from;
            const text = messageData.text ? messageData.text.body : "";

            // Initialize user state if new
            if (!userState[from]) {
                userState[from] = { step: 0 };
            }

            const step = userState[from].step;

            // --- CONVERSATION FLOW ---
            
            // RESET command
            if (text.toLowerCase() === "reset") {
                userState[from].step = 0;
                await sendWhatsAppMessage(from, "Conversation reset. Say 'Hi' to start over!");
                res.sendStatus(200);
                return;
            }

            // STEP 0: Welcome
            if (step === 0) {
                await sendWhatsAppMessage(from, "Welcome to RetailRockIT! 🚀\n\nWe help Takealot sellers calculate their funding potential.\n\nDo you want to see how much funding you qualify for? (Yes/No)");
                userState[from].step = 1;
            } 
            
            // STEP 1: Confirm Interest
            else if (step === 1) {
                if (text.toLowerCase().includes("yes")) {
                    await sendWhatsAppMessage(from, "Great! To give you an accurate quote, we need to analyze your sales history.\n\nPlease paste your **Takealot Seller API Key** below.\n\n_(Don't worry, we only use this once to calculate the number!)_");
                    userState[from].step = 2;
                } else {
                    await sendWhatsAppMessage(from, "No problem! Type 'Hi' anytime you are ready to grow.");
                    userState[from].step = 0;
                }
            }

            // STEP 2: Handle API Key & Calculate
            else if (step === 2) {
                const apiKey = text.trim(); // The user's input is the key

                // Validate Key length (Basic check)
                if (apiKey.length < 10) {
                    await sendWhatsAppMessage(from, "That API key looks a bit short. Please check it and paste it again.");
                    return; 
                }

                await sendWhatsAppMessage(from, "🔍 Crunching the numbers... This takes about 10 seconds.");

                // CALL THE INTERNAL CALCULATOR
                const quote = await calculateQuote(apiKey);

                if (quote !== null) {
                    // Format as Currency (ZAR)
                    const formattedQuote = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(quote);
                    
                    await sendWhatsAppMessage(from, `🎉 **Good News!**\n\nBased on your sales history, you qualify for up to:\n\n💰 **${formattedQuote}**\n\nWould you like to speak to an agent to secure this funding? (Yes/No)`);
                    userState[from].step = 3;
                } else {
                    await sendWhatsAppMessage(from, "⚠️ We couldn't access your sales data. Please make sure the API Key is correct and try again.\n\n(Type 'reset' to start over)");
                }
            }

            // STEP 3: Closing
            else if (step === 3) {
                 await sendWhatsAppMessage(from, "Perfect. An agent will contact you shortly on this number. 🚀\n\nHave a great day!");
                 userState[from].step = 0; // Reset
            }
        }
        res.sendStatus(200);
    } else {
        res.sendStatus(404);
    }
});

// Helper function to send messages
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
        console.error("Error sending message:", error.response ? error.response.data : error.message);
    }
}

app.listen(PORT, () => {
    console.log(`Bot is running on port ${PORT}`);
});
