// @ts-nocheck
/**
 * End-to-End Two-Browser Real-Time QA Script
 * Exercises two independent authenticated client contexts over native WebSockets
 * against the live running server and tunnel.
 */
import WebSocket from "ws";

async function login(email: string, pass: string): Promise<string> {
  const res = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyDJDBdfXKX7p2icNrr1q5d8neZWXK6GcpI", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pass, returnSecureToken: true })
  });
  const data = await res.json();
  if (!data.idToken) throw new Error(`Login failed for ${email}: ${JSON.stringify(data)}`);
  return data.idToken;
}

interface ClientContext {
  name: string;
  email: string;
  ws: WebSocket;
  received: any[];
  authed: boolean;
  replayDone: boolean;
}

async function createClient(name: string, email: string, pass: string, wsUrl: string): Promise<ClientContext> {
  const token = await login(email, pass);
  const received: any[] = [];
  const ws = new WebSocket(wsUrl, { headers: { Origin: "https://focus-clean-4b9f4.web.app" } });
  const client: ClientContext = { name, email, ws, received, authed: false, replayDone: false };

  return new Promise((resolve, reject) => {
    ws.on("open", () => {
      ws.send(JSON.stringify({ v: 1, type: "auth", token }));
    });
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        received.push(msg);
        if (msg.type === "auth_ok") {
          client.authed = true;
          ws.send(JSON.stringify({ v: 1, type: "subscribe", roomId: "assortment-review", after: 0 }));
          resolve(client);
        }
      } catch (e) {
        reject(e);
      }
    });
    ws.on("error", (err) => reject(err));
  });
}

console.log("=== STARTING TWO-BROWSER LIVE REAL-TIME E2E SUITE ===");

const WS_URL = "ws://localhost:8080/ws";

// 1. Establish User 1 (Northside Buyer 1) and User 2 (Northside Buyer 2)
console.log("1. Authenticating User 1 and User 2...");
const nsBuyer1Pass = process.env.NS_BUYER1_PASSWORD;
const nsBuyer2Pass = process.env.NS_BUYER2_PASSWORD;
const vhBuyer1Pass = process.env.VH_BUYER1_PASSWORD;

if (!nsBuyer1Pass || !nsBuyer2Pass || !vhBuyer1Pass) {
  throw new Error("Missing required credentials: NS_BUYER1_PASSWORD, NS_BUYER2_PASSWORD, VH_BUYER1_PASSWORD must be set in environment.");
}

const user1 = await createClient("User 1 (Northside Buyer 1)", "northside.buyer1@teamchat.internal", nsBuyer1Pass, WS_URL);
const user2 = await createClient("User 2 (Northside Buyer 2)", "northside.buyer2@teamchat.internal", nsBuyer2Pass, WS_URL);

console.log(`Connected User 1 (auth: ${user1.authed}) and User 2 (auth: ${user2.authed})`);

// 2. Establish User 3 (Valley Buyer 1 - Cross-Tenant Context)
console.log("2. Authenticating User 3 (Valley Buyer 1)...");
const user3 = await createClient("User 3 (Valley Buyer 1)", "valley.buyer1@teamchat.internal", vhBuyer1Pass, WS_URL);
console.log(`Connected User 3 (auth: ${user3.authed})`);

// 3. User 1 sends a real-time message
console.log("3. User 1 sending real-time broadcast message...");
const testMsgId = `e2e-live-${Date.now()}`;
const initialCountU2 = user2.received.length;
const initialCountU3 = user3.received.length;

user1.ws.send(JSON.stringify({
  v: 1,
  type: "send_message",
  roomId: "assortment-review",
  clientMessageId: testMsgId,
  body: "Hello User 2 from User 1! Live multi-browser test.",
  allowSharedMemorySave: false
}));

// Wait for delivery
await new Promise(r => setTimeout(r, 2000));

const u2GotMsg = user2.received.some(m => m.type === "event" && m.event?.payload?.client_message_id === testMsgId);
const u3GotMsg = user3.received.some(m => m.type === "event" && m.event?.payload?.client_message_id === testMsgId);

console.log(`- User 2 received User 1 message: ${u2GotMsg}`);
console.log(`- User 3 (Valley) received User 1 message: ${u3GotMsg} (must be FALSE for strict isolation)`);

// 4. Send an AI request and verify streaming events on both User 1 and User 2
console.log("4. User 1 sending AI prompt...");
const aiMsgId = `e2e-ai-${Date.now()}`;
user1.ws.send(JSON.stringify({
  v: 1,
  type: "send_message",
  roomId: "assortment-review",
  clientMessageId: aiMsgId,
  body: "@AI what's the right catalog code for portable air conditioning units?",
  allowSharedMemorySave: false
}));

// Wait for AI tool and answer events
await new Promise(r => setTimeout(r, 12000));

const u1GotTool = user1.received.some(m => m.type === "event" && (m.event?.type === "ai_tool" || m.event?.type === "ai_tool_start"));
const u2GotTool = user2.received.some(m => m.type === "event" && (m.event?.type === "ai_tool" || m.event?.type === "ai_tool_start"));
const u3GotAiEvents = user3.received.some(m => m.type === "event" && m.event?.tenantId === "northside-outfitters");

console.log(`- User 1 received AI tool execution: ${u1GotTool}`);
console.log(`- User 2 received AI tool execution: ${u2GotTool}`);
console.log(`- User 3 received zero Northside AI events: ${!u3GotAiEvents}`);

// 5. Clean teardown
user1.ws.close();
user2.ws.close();
user3.ws.close();

const allPassed = u2GotMsg && !u3GotMsg && u1GotTool && u2GotTool && !u3GotAiEvents;
console.log("\n=================== TWO-BROWSER E2E SUMMARY ===================");
console.log(`Multi-User Broadcast:        ${u2GotMsg ? "PASS" : "FAIL"}`);
console.log(`Cross-Tenant Isolation:      ${!u3GotMsg ? "PASS" : "FAIL"}`);
console.log(`Parallel AI Sync (User 1):   ${u1GotTool ? "PASS" : "FAIL"}`);
console.log(`Parallel AI Sync (User 2):   ${u2GotTool ? "PASS" : "FAIL"}`);
console.log(`Zero Foreign-Tenant Leak:    ${!u3GotAiEvents ? "PASS" : "FAIL"}`);
console.log(`OVERALL E2E STATUS:          ${allPassed ? "PASS" : "FAIL"}`);
console.log("================================================================\n");

if (!allPassed) process.exit(1);
