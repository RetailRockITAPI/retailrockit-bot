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
// 2. CALCULATOR (SPLIT 6-MONTH REQUESTS)
// ==========================================
async function calculateQuote(rawInput) {
    try {
        // SAFE CLEANER: Only remove "Key" at start, trim spaces
        let apiKey = rawInput.replace(/^Key\s*/i, "").trim();

        // Helper function to fetch a specific chunk of time
        async function fetchChunk(startDateObj, endDateObj) {
            let chunkTotal = 0;
            let keepFetching = true;
            let pageNumber = 1;
            
            const startStr = startDateObj.toISOString().split('T')[0];
            const endStr = endDateObj.toISOString().split('T')[0];
            
            console.log(`[Calc] Fetching Chunk: ${startStr} to ${endStr}`);

            while (keepFetching) {
                // Construct URL for this specific chunk and page
                const filterString = `start_date:${startStr},end_date:${endStr}`;
                const url = `https://seller-api.takealot.com/v2/sales?filters=${filterString}&page_number=${pageNumber}&page_size=100`;

                try {
                    const response = await axios.get(url, {
                        headers: {
                            'Authorization': `Key ${apiKey}`, 
                            'Content-Type': 'application/json',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                        }
                    });

                    if (response.status === 200 && response.data.sales && response.data.sales.length > 0) {
                        const sales = response.data.sales;
                        sales.forEach(sale => {
                            if (sale.selling_price) {
                                chunkTotal += parseFloat(sale.selling_price);
                            }
                        });
                        pageNumber++;
                        // Safety limit per chunk
                        if (pageNumber > 100) keepFetching = false; 
                    } else {
                        keepFetching = false;
                    }
                } catch (err) {
                    console.error(`[Calc Chunk Error] ${err.message}`);
                    keepFetching = false; // Stop this chunk on error
                }
            }
            return chunkTotal;
        }

        // --- MAIN LOGIC: SPLIT INTO 2 CHUNKS ---
        const today = new Date();
        
        // Chunk 1: Last 6 Months (0 to 180 days ago)
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setDate(today.getDate() - 180);

        // Chunk 2: Previous 6 Months (180 to 365 days ago)
        const oneYearAgo = new Date();
        oneYearAgo.setDate(today.getDate() - 365);

        console.log("--- STARTING CALCULATION ---");
        
        // Run fetch for Chunk 1
        const totalPart1 = await fetchChunk(sixMonthsAgo, today);
        console.log(`[Calc] Part 1 Total: R${totalPart1}`);

        // Run fetch for Chunk 2
        const totalPart2 = await fetchChunk(oneYearAgo, sixMonthsAgo);
        console.log(`[Calc] Part 2 Total: R${totalPart2}`);

        const grandTotal = totalPart1 + totalPart2;
        console.log(`[Calc] GRAND TOTAL: R${grandTotal}`);

        return Math.floor(grandTotal * 0.80); 

    } catch (error) {
        console.error("[Calc Critical Error]", error.message);
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
