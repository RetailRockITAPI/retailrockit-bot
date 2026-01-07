const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());

// --- SETTINGS (These come from your Render Environment) ---
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN; 
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID; 
const VERIFY_TOKEN = process.env.VERIFY_TOKEN; 
const CALCULATOR_URL = process.env.CALCULATOR_URL; // URL of your existing Quote App

// --- YOUR AGENTS ---
// Add or remove agents here. The bot will pick one at random.
const AGENTS = [
  { name: "Consultant Sarah", link: "https://wa.me/27821234567" },
  { name: "Consultant Mike",  link: "https://wa.me/27829876543" },
  { name: "Consultant Thabo", link: "https://wa.me/27825555555" }
];

// Memory to track where the user is in the conversation
const userState = {};

// --- HELPER: Send WhatsApp Message ---
async function sendMessage(to, text) {
  try {
    await axios({
      method: "POST",
      url: `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`,
      headers: {
        "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      data: {
        messaging_product: "whatsapp",
        to: to,
        text: { body: text },
      },
    });
  } catch (error) {
    console.error("Error sending message:", error.response ? error.response.data : error.message);
  }
}

// --- MAIN SERVER ---

// 1. Facebook Verify (Required to turn the bot on)
app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
    res.send(req.query["hub.challenge"]);
  } else {
    res.sendStatus(400);
  }
});

// 2. Incoming Messages
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object) {
    if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
      const message = body.entry[0].changes[0].value.messages[0];
      const from = message.from; 
      const msgText = message.text ? message.text.body : "";

      // Start or retrieve user session
      if (!userState[from]) userState[from] = { step: 0 };
      const step = userState[from].step;

      // --- THE CONVERSATION FLOW ---

      // Step 0: User says anything -> Bot asks Hook 1
      if (step === 0) {
        await sendMessage(from, "Welcome to RetailRockIT! 🚀\n\nDo you want your business to make more money? (Yes/No)");
        userState[from].step = 1;
      } 
      
      // Step 1: Hook 2
      else if (step === 1) {
        await sendMessage(from, "Great. Do you want to grow your business aggressively? (Yes/No)");
        userState[from].step = 2;
      }

      // Step 2: Hook 3
      else if (step === 2) {
        await sendMessage(from, "Do you want to Fuel Your FREEDOM? (Yes/No)");
        userState[from].step = 3;
      }

      // Step 3: Ask for Takealot API Key
      else if (step === 3) {
        await sendMessage(from, "Let's see what we can do for you.\n\nPlease paste your Takealot Seller API Key below so we can generate your quote:");
        userState[from].step = 4;
      }

      // Step 4: Process API Key & Call Your Calculator App
      else if (step === 4) {
        await sendMessage(from, "Crunching the numbers... this might take a few seconds.");

        try {
            // WE SEND THE KEY TO YOUR OTHER APP HERE
            // This assumes your other app expects JSON like: { "apiKey": "the-key-user-sent" }
            const response = await axios.post(CALCULATOR_URL, { 
                apiKey: msgText 
            });

            // WE EXPECT YOUR OTHER APP TO RETURN: { "quote": "R50,000" }
            const quoteAmount = response.data.quote; 
            
            await sendMessage(from, `Based on your sales history, your funding quote is:\n\n*${quoteAmount}*\n\nWould you like to accept this offer? (Yes/No)`);
            userState[from].step = 5;

        } catch (error) {
            console.error("Calculator Error:", error.message);
            await sendMessage(from, "We are having trouble reaching the calculator right now (it might be waking up). Please try pasting the key again in 10 seconds.");
            // We do NOT advance the step, so they can try again immediately
        }
      }

      // Step 5: Handoff to Agent
      else if (step === 5) {
        if (msgText.toLowerCase().includes("yes")) {
            // Pick a random agent
            const randomAgent = AGENTS[Math.floor(Math.random() * AGENTS.length)];
            
            await sendMessage(from, `Fantastic choice! 🎉\n\nI am assigning you to ${randomAgent.name} to finalize the details.`);
            await sendMessage(from, `Click here to chat with them immediately: ${randomAgent.link}`);
            
            // Reset for next time
            userState[from].step = 0; 
        } else {
            await sendMessage(from, "No problem. Type 'Hi' anytime to start over.");
            userState[from].step = 0;
        }
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));
