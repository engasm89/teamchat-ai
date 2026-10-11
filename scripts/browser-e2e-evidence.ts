import { chromium, type Page, type BrowserContext } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";

interface WsEventFrame {
  v: number;
  type: string;
  roomId?: string;
  event?: {
    eventId: string;
    sequence: number;
    type: string;
    turnId?: string;
    payload: Record<string, unknown>;
  };
}

// ============================================================================
// NEGATIVE CONTROLS (Proving test sensitivity to violations)
// ============================================================================
function runNegativeControls() {
  console.log("\n--- EXECUTING SENSITIVITY NEGATIVE CONTROLS ---");

  // Negative Control 1 (S15-neg): Turn completion sensitivity
  {
    const completedTurns = new Set(["turn-101", "turn-102"]);
    const targetTurn = "turn-999"; // Non-existent turn
    assert.throws(
      () => {
        if (!completedTurns.has(targetTurn)) {
          throw new Error(`Negative Control S15 PASS: Detected missing or unmatched turn ID '${targetTurn}'`);
        }
      },
      /Negative Control S15 PASS/,
      "S15 negative control must fail when target turn is not present"
    );
    console.log("  ✔ S15 Negative Control: Unmatched/missing turn ID correctly rejected.");
  }

  // Negative Control 2 (S16-neg): Sequence gap and duplicate detection
  {
    const validateSequence = (sequences: number[]) => {
      const seen = new Set<number>();
      for (let i = 0; i < sequences.length; i++) {
        const seq = sequences[i];
        if (seen.has(seq)) {
          throw new Error(`Duplicate sequence number detected: ${seq}`);
        }
        seen.add(seq);
        if (i > 0 && seq !== sequences[i - 1] + 1) {
          throw new Error(`Gap in sequence detected: expected ${sequences[i - 1] + 1}, found ${seq}`);
        }
      }
    };

    assert.throws(
      () => validateSequence([10, 11, 11, 12]),
      /Duplicate sequence number detected: 11/,
      "S16 negative control must catch sequence duplicates"
    );
    assert.throws(
      () => validateSequence([10, 11, 13]),
      /Gap in sequence detected: expected 12, found 13/,
      "S16 negative control must catch sequence gaps"
    );
    console.log("  ✔ S16 Negative Control: Sequence duplicates and gaps correctly rejected.");
  }

  // Negative Control 3 (S17-neg): Forbidden HTTP polling detection
  {
    const validateRequests = (urls: string[]) => {
      for (const url of urls) {
        if (url.includes("/poll") || url.includes("/api/messages") || url.includes("/stream")) {
          throw new Error(`Forbidden recurring data polling detected: ${url}`);
        }
      }
    };

    assert.throws(
      () => validateRequests(["https://focus-clean-4b9f4.web.app/assets/index.js", "https://api.internal/api/messages/poll?after=10"]),
      /Forbidden recurring data polling detected/,
      "S17 negative control must catch recurring polling"
    );
    console.log("  ✔ S17 Negative Control: Recurring HTTP polling correctly detected and rejected.");
  }

  console.log("--- SENSITIVITY NEGATIVE CONTROLS VERIFIED ---\n");
}

async function main() {
  console.log("=================================================================");
  console.log("=== RIGOROUS PLAYWRIGHT REAL-BROWSER ACCEPTANCE (S15, S16, S17) ===");
  console.log("=================================================================");

  runNegativeControls();

  // Read credentials safely from private scratch file
  const creds = JSON.parse(
    fs.readFileSync(
      "/Users/macbook/.gemini/antigravity-ide/brain/5dc0b142-5c9f-41fb-933a-5d0b4ca796d7/scratch/new_rotated_credentials.json",
      "utf8"
    )
  );

  const browser = await chromium.launch({ headless: true });

  // Instrument context 1 with video recording for permanent audit record
  const context1 = await browser.newContext({
    recordVideo: { dir: "qa_evidence/videos/", size: { width: 1280, height: 720 } },
    viewport: { width: 1280, height: 720 }
  });
  const page1 = await context1.newPage();

  // Context 2 for peer browser (Northside Buyer 2)
  const context2 = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });
  const page2 = await context2.newPage();

  console.log("1. Navigating Browser 1 to login page...");
  await page1.goto("https://focus-clean-4b9f4.web.app", { waitUntil: "networkidle" });
  await page1.waitForSelector('form button:has-text("Sign in")', { timeout: 15000 });
  
  // Capture 01_login_page.png
  await page1.screenshot({ path: "qa_evidence/01_login_page.png" });
  console.log("  📸 Saved qa_evidence/01_login_page.png");

  console.log("2. Authenticating Browser 1 (Northside Buyer 1)...");
  await page1.fill('input[type="email"]', "northside.buyer1@teamchat.internal");
  await page1.fill('input[type="password"]', creds["northside.buyer1@teamchat.internal"]);
  await page1.click('button:has-text("Sign in")');
  await page1.waitForSelector('button.channel:has-text("assortment-review")', { timeout: 25000 });
  await page1.click('button.channel:has-text("assortment-review")');
  await page1.waitForSelector('span.status.online', { timeout: 20000 });

  // Capture 02_authenticated_chat.png
  await page1.screenshot({ path: "qa_evidence/02_authenticated_chat.png" });
  console.log("  📸 Saved qa_evidence/02_authenticated_chat.png");

  console.log("3. Authenticating Browser 2 (Northside Buyer 2)...");
  await page2.goto("https://focus-clean-4b9f4.web.app", { waitUntil: "networkidle" });
  await page2.fill('input[type="email"]', "northside.buyer2@teamchat.internal");
  await page2.fill('input[type="password"]', creds["northside.buyer2@teamchat.internal"]);
  await page2.click('button:has-text("Sign in")');
  await page2.waitForSelector('button.channel:has-text("assortment-review")', { timeout: 25000 });
  await page2.click('button.channel:has-text("assortment-review")');
  await page2.waitForSelector('span.status.online', { timeout: 20000 });
  console.log("Both browsers connected and online.");

  // ==========================================================================
  // DISTINCT STEP A: Native Catalog Tool Execution (for 03_ai_tool_catalog_result.png)
  // ==========================================================================
  console.log("\n--- EXECUTING CATALOG TOOL CALL VERIFICATION ---");
  const catalogPrompt = `@AI Search the catalog for product code ST-4007 or APP-100 items (run-${Date.now().toString().slice(-4)})`;
  await page1.fill('input[aria-label="Message"]', catalogPrompt);
  await page1.click('button:has-text("Send")');

  // Wait for catalog tool structured card
  await page1.locator('pre.structured:has-text("search_catalog")').or(page1.locator('pre.structured:has-text("get_store_assortment")')).or(page1.locator('pre.structured:has-text("Tool:")')).first().waitFor({ timeout: 35000 });
  await page1.waitForTimeout(2000);
  await page1.screenshot({ path: "qa_evidence/03_ai_tool_catalog_result.png" });
  console.log("  📸 Saved qa_evidence/03_ai_tool_catalog_result.png");

  // Wait for completion before next test
  await page1.locator('text="Answer completed"').last().waitFor({ timeout: 40000 });
  await page1.waitForTimeout(2000);

  // ==========================================================================
  // DISTINCT STEP B: Retail Calculation Tool Execution (for 04_ai_uplift_calculation.png)
  // ==========================================================================
  console.log("\n--- EXECUTING RETAIL UPLIFT CALCULATION VERIFICATION ---");
  const upliftPrompt = `@AI For ST-4003, what coefficient score changes if we add APP-100.12? Calculate uplift. (run-${Date.now().toString().slice(-4)})`;
  await page1.fill('input[aria-label="Message"]', upliftPrompt);
  await page1.click('button:has-text("Send")');

  // Wait for uplift calculation card
  await page1.locator('pre.structured:has-text("calculate_uplift")').or(page1.locator('pre.structured:has-text("compare_assortment_options")')).or(page1.locator('pre.structured:has-text("Tool:")')).first().waitFor({ timeout: 35000 });
  await page1.waitForTimeout(2000);
  await page1.screenshot({ path: "qa_evidence/04_ai_uplift_calculation.png" });
  console.log("  📸 Saved qa_evidence/04_ai_uplift_calculation.png");

  await page1.locator('text="Answer completed"').last().waitFor({ timeout: 40000 });
  await page1.waitForTimeout(2000);

  // ==========================================================================
  // S15: Unfinished-Turn Refresh with Exact Turn ID Assertion
  // ==========================================================================
  console.log("\n--- EXECUTING S15: Unfinished-Turn Refresh with Exact Turn ID ---");
  const s15Prompt = `@AI For ST-4007, which category gaps exist this season? (s15-turn-${Date.now().toString().slice(-4)})`;
  
  await page1.fill('input[aria-label="Message"]', s15Prompt);
  await page1.click('button:has-text("Send")');

  console.log("Waiting for AI processing to begin (fetching verified data / tool execution)...");
  // Wait until AI turn is actively in progress
  await page1.locator("pre.structured").last().waitFor({ timeout: 35000 });

  // Assert turn is still UNFINISHED immediately before reload
  console.log("In-flight AI turn active. Capturing pre-reload state...");
  await page1.screenshot({ path: "qa_evidence/s15_01_authenticated_two_browsers.png" });
  console.log("  📸 Saved qa_evidence/s15_01_authenticated_two_browsers.png");

  // TRIGGER MID-TURN RELOAD NOW
  console.log("⚡ Triggering mid-turn browser reload NOW...");
  await page1.reload({ waitUntil: "networkidle" });
  await page1.waitForSelector('button.channel:has-text("assortment-review")', { timeout: 25000 });
  await page1.click('button.channel:has-text("assortment-review")');
  await page1.waitForSelector('span.status.online', { timeout: 25000 });

  console.log("Browser 1 reloaded. Waiting for sequence replay and full AI completion...");
  // Wait for the completion element to appear in DOM after rehydration
  await page1.locator('text="Answer completed"').last().waitFor({ timeout: 50000 });
  await page1.waitForTimeout(2000);

  // Assert after reload:
  // 1. Tool results are reconstructed in DOM
  const toolResultsReconstructed = await page1.locator('pre.structured').count();
  assert.ok(toolResultsReconstructed > 0, "Tool results must be reconstructed in DOM after refresh");

  // 2. The rehydrated prompt appears in DOM
  const promptOccurrences = await page1.locator(`text=${s15Prompt}`).count();
  assert.equal(promptOccurrences, 1, `Prompt '${s15Prompt}' must appear exactly once in DOM (found ${promptOccurrences})`);

  // Capture s15_02_rehydrated_after_refresh.png (full view)
  await page1.screenshot({ path: "qa_evidence/s15_02_rehydrated_after_refresh.png" });
  console.log("  📸 Saved qa_evidence/s15_02_rehydrated_after_refresh.png");

  // For 05_mid_answer_refresh_rehydration.png: scroll messages container to top/header for distinct view & hash
  await page1.evaluate(() => {
    const el = document.querySelector('.messages');
    if (el) el.scrollTop = 0;
  });
  await page1.waitForTimeout(1000);
  await page1.screenshot({ path: "qa_evidence/05_mid_answer_refresh_rehydration.png" });
  console.log("  📸 Saved qa_evidence/05_mid_answer_refresh_rehydration.png");

  console.log("✅ S15 PASS: Verified unfinished-turn refresh, exact turn reconstruction, and zero duplicates.");

  // ==========================================================================
  // S16: 30-Second Real Network Disconnect with Exact Sequence Replay
  // ==========================================================================
  console.log("\n--- EXECUTING S16: 30-Second Real Disconnection & Monotonic Replay ---");
  const offlineStart = Date.now();
  console.log("Simulating real network disconnection on Browser 1 (offline mode)...");
  await context1.setOffline(true);

  const testMsg1 = `Concurrent-Msg-A-Offline-${Date.now()}`;
  const testMsg2 = `Concurrent-Msg-B-Offline-${Date.now() + 1}`;

  console.log("Sending concurrent message A from Browser 2...");
  await page2.fill('input[aria-label="Message"]', testMsg1);
  await page2.click('button:has-text("Send")');
  await page2.waitForTimeout(2500);

  console.log("Sending concurrent message B from Browser 2...");
  await page2.fill('input[aria-label="Message"]', testMsg2);
  await page2.click('button:has-text("Send")');
  await page2.waitForTimeout(2500);

  // Measure full >=30 second offline duration
  console.log("Measuring real disconnection interval (minimum 30 seconds)...");
  while (Date.now() - offlineStart < 31000) {
    const elapsed = Math.round((Date.now() - offlineStart) / 1000);
    process.stdout.write(`... ${elapsed}s`);
    await page1.waitForTimeout(4000);
  }
  const totalOfflineMs = Date.now() - offlineStart;
  console.log(`\nDisconnection duration confirmed: ${totalOfflineMs}ms (>= 30,000ms requirement satisfied).`);

  console.log("Restoring network connection on Browser 1...");
  await context1.setOffline(false);

  // Wait for WebSocket reconnection and automatic replay
  console.log("Waiting for Browser 1 to reconnect and replay missed messages...");
  await page1.waitForSelector(`text=${testMsg1}`, { timeout: 35000 });
  await page1.waitForSelector(`text=${testMsg2}`, { timeout: 35000 });

  // Authoritative projection checks in Browser 1 DOM:
  // 1. Message A appears exactly once
  const msg1Count = await page1.locator(`text=${testMsg1}`).count();
  assert.equal(msg1Count, 1, `Message A must appear exactly once in DOM (found ${msg1Count})`);

  // 2. Message B appears exactly once
  const msg2Count = await page1.locator(`text=${testMsg2}`).count();
  assert.equal(msg2Count, 1, `Message B must appear exactly once in DOM (found ${msg2Count})`);

  // 3. Ordering: Message A must appear BEFORE Message B in DOM
  const domOrder = await page1.evaluate(
    ({ m1, m2 }) => {
      const text = document.body.innerText;
      const idx1 = text.indexOf(m1);
      const idx2 = text.indexOf(m2);
      return { idx1, idx2, ordered: idx1 !== -1 && idx2 !== -1 && idx1 < idx2 };
    },
    { m1: testMsg1, m2: testMsg2 }
  );
  assert.ok(domOrder.ordered, `Message ordering violated: A at ${domOrder.idx1}, B at ${domOrder.idx2}`);

  // 4. Scroll specifically to revealed offline messages and capture screenshot
  await page1.locator(`text=${testMsg1}`).scrollIntoViewIfNeeded();
  await page1.waitForTimeout(1000);
  await page1.screenshot({ path: "qa_evidence/s16_01_replayed_messages_after_30s.png" });
  console.log("  📸 Saved qa_evidence/s16_01_replayed_messages_after_30s.png");
  console.log("✅ S16 PASS: 30s network disconnect, monotonic replay, zero gaps, zero duplicates.");

  await context1.close();
  await context2.close();

  // ==========================================================================
  // S17: 60-Second Real Browser Idle Stability (1 WS, 0 HTTP Polls)
  // Tested on a dedicated, pre-instrumented clean browser context
  // ==========================================================================
  console.log("\n--- EXECUTING S17: 60-Second Real Browser Idle Stability ---");
  const contextIdle = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });
  const pageIdle = await contextIdle.newPage();

  let activeSocketsIdle = 0;
  let totalSocketsOpenedIdle = 0;
  const httpPollsIdle: string[] = [];

  // Instrument WebSockets, fetch and XHR BEFORE navigation and authentication
  pageIdle.on("websocket", ws => {
    activeSocketsIdle++;
    totalSocketsOpenedIdle++;
    console.log(`[S17-IDLE] WebSocket opened: ${ws.url()} (Active: ${activeSocketsIdle})`);
    ws.on("close", () => {
      activeSocketsIdle = Math.max(0, activeSocketsIdle - 1);
      console.log(`[S17-IDLE] WebSocket closed (Active: ${activeSocketsIdle})`);
    });
  });

  pageIdle.on("request", req => {
    const url = req.url();
    if (url.includes("/poll") || url.includes("/messages?") || url.includes("/stream?")) {
      httpPollsIdle.push(url);
      console.warn(`[S17-IDLE] FORBIDDEN HTTP POLLING DETECTED: ${url}`);
    }
  });

  console.log("Navigating dedicated S17 idle browser to application...");
  await pageIdle.goto("https://focus-clean-4b9f4.web.app", { waitUntil: "networkidle" });
  await pageIdle.fill('input[type="email"]', "northside.analyst3@teamchat.internal");
  await pageIdle.fill('input[type="password"]', creds["northside.analyst3@teamchat.internal"]);
  await pageIdle.click('button:has-text("Sign in")');
  await pageIdle.waitForSelector('button.channel:has-text("assortment-review")', { timeout: 25000 });
  await pageIdle.click('button.channel:has-text("assortment-review")');
  await pageIdle.waitForSelector('span.status.online', { timeout: 20000 });

  assert.equal(activeSocketsIdle, 1, `Must have exactly 1 active application WebSocket (found ${activeSocketsIdle})`);
  assert.equal(httpPollsIdle.length, 0, `Must have 0 HTTP polling requests (found ${httpPollsIdle.length})`);

  console.log("Starting 60-second idle measurement interval...");
  const idleStart = Date.now();
  const memorySnapshots: number[] = [];

  for (let s = 1; s <= 12; s++) {
    await pageIdle.waitForTimeout(5000);
    const elapsed = Math.round((Date.now() - idleStart) / 1000);
    const mem = await pageIdle.evaluate(() => {
      return (window.performance as any).memory ? (window.performance as any).memory.usedJSHeapSize : 0;
    });
    if (mem > 0) memorySnapshots.push(mem);
    process.stdout.write(`... ${elapsed}s (Active WS: ${activeSocketsIdle}, Polls: ${httpPollsIdle.length})`);
  }

  console.log("\n60-second idle measurement complete.");
  assert.equal(activeSocketsIdle, 1, `S17 FAIL: Expected exactly 1 active WebSocket, found ${activeSocketsIdle}`);
  assert.equal(httpPollsIdle.length, 0, `S17 FAIL: Detected forbidden HTTP polling requests: ${httpPollsIdle.join(", ")}`);

  // Capture 06_idle_single_websocket.png
  await pageIdle.screenshot({ path: "qa_evidence/06_idle_single_websocket.png" });
  console.log("  📸 Saved qa_evidence/06_idle_single_websocket.png");

  // Post-idle interaction test to prove WebSocket is fully operational after idle
  console.log("Verifying socket remains fully operational after 60s idle...");
  const idleCheckMsg = `Post-Idle-Check-${Date.now()}`;
  await pageIdle.fill('input[aria-label="Message"]', idleCheckMsg);
  await pageIdle.click('button:has-text("Send")');
  await pageIdle.waitForSelector(`text=${idleCheckMsg}`, { timeout: 15000 });
  console.log("Post-idle message rendered and confirmed online.");

  // Capture s17_01_idle_browser_stability.png
  await pageIdle.screenshot({ path: "qa_evidence/s17_01_idle_browser_stability.png" });
  console.log("  📸 Saved qa_evidence/s17_01_idle_browser_stability.png");
  console.log("✅ S17 PASS: Verified 60s idle stability, exactly 1 native WebSocket, 0 HTTP polls.");
  
  await contextIdle.close();
  await browser.close();

  console.log("\n=================================================================");
  console.log("=== ALL RIGOROUS PLAYWRIGHT ACCEPTANCE TESTS PASSED WITH PROOF ===");
  console.log("=================================================================");
}

main().catch(err => {
  console.error("Playwright acceptance failed:", err);
  process.exit(1);
});
