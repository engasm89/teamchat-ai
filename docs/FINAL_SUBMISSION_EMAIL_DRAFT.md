# DRAFT ONLY — CONTROLEASE TEAMCHAT AI SUBMISSION EMAIL

> [!IMPORTANT]
> **DO NOT SEND TO GONZALO, ELISA OR CONTROLEASE.**  
> This document is an internal preparation draft for Ashraf Al-Madhoun's personal review and explicit sign-off. Under no circumstances should any automated tool or agent dispatch this message.

---

**To:** Gonzalo Alessandrelli (`gonzalo@controlease.net`)  
**Cc:** Elisa Pérez Montenegro (`elisa@controlease.net`)  
**From:** Ashraf Al-Madhoun (`eng.asm.89@gmail.com`)  
**Subject:** TeamChat AI Technical Assessment Submission — Ashraf Al-Madhoun  
**Date:** October 11, 2026 (Ahead of Friday, October 16, 2026 deadline)  

---

Dear Gonzalo and Elisa,

I am pleased to formally submit my completed **TeamChat AI Technical Assessment** deliverable ahead of our Friday, October 16, 2026 deadline.

In accordance with the assessment brief, architectural discussions, and email clarifications, the entire system is built, independently verified, and running live in production on Google Cloud Platform and Firebase.

### 1. Key Project & Delivery Coordinates
- **GitHub Repository (Public):** [https://github.com/engasm89/teamchat-ai](https://github.com/engasm89/teamchat-ai)
- **Evaluator Access:** Read permissions open to `@paluchi` and all reviewers.
- **Engine Git Commit:** `dc70fc81ba5724e9692f64ade1cf19b7b217feed`
- **Live Production Web Application:** [https://focus-clean-4b9f4.web.app](https://focus-clean-4b9f4.web.app)
- **Production API & WebSocket Service (Cloud Run):** [https://teamchat-api-1068908463902.us-central1.run.app](https://teamchat-api-1068908463902.us-central1.run.app)
- **Production AI Asynchronous Worker (Cloud Run):** `https://teamchat-worker-1068908463902.us-central1.run.app`
- **Database:** Google Cloud SQL PostgreSQL 17 with strict Row-Level Security (`teamchat_runtime` least-privilege role)
- **Vertex AI:** `gemini-2.5-flash` (deterministic tool calling) & `text-embedding-004` (768-dimensional semantic memory)

### 2. Pre-Seeded Reviewer Accounts & Access Instructions
Six reviewer accounts are pre-provisioned and active across both tenant partitions:

**Northside Outfitters (`northside-outfitters` tenant):**
1. `northside.buyer1@teamchat.internal` (Buyer 1 — Assortment reviews & tool invocations)
2. `northside.buyer2@teamchat.internal` (Buyer 2 — Peer real-time collaborator)
3. `northside.analyst3@teamchat.internal` (Analyst 3 — Category strategy & semantic memory)

**Valley Home Goods (`valley-home-goods` tenant):**
4. `valley.buyer1@teamchat.internal` (Buyer 1 — Partitioned store operations)
5. `valley.buyer2@teamchat.internal` (Buyer 2 — Peer real-time collaborator)
6. `valley.analyst3@teamchat.internal` (Analyst 3 — Partitioned memory)

*(Note: Reviewer passwords are held in protected private storage and will be securely transmitted directly to Gonzalo via private channel upon request. No passwords or service secrets are stored in Git history or public repositories.)*

### 3. Summary of Independent Technical & QA Verification
- **Authoritative 61-Requirement Matrix:** 100% verified across Correspondence (E01–E05), Ground Rules (G01–G06), Acceptance Scenarios (S01–S19), Architecture/Packaging (B01–B06), Database & Security (D01–D09), and Browser/Engineering (A01–A16).
- **All 19 Scenarios (S01–S19):** Fully executed and validated against live Cloud SQL and Vertex AI (`qa_evidence/19_scenarios_audit.log`).
- **Playwright Browser Suite (S15, S16, S17):**
  - **S15:** Mid-turn reload rehydrates the identical in-flight turn ID without duplicating UI components.
  - **S16:** Real 30-second network disconnection followed by monotonic, duplicate-free sequence replay.
  - **S17:** 60-second idle measurement verifying exactly 1 native WebSocket connection, zero recurring HTTP data polls, and stable memory usage.
- **Multi-Tenant Isolation:** Enforced at database engine level via PostgreSQL `ALTER TABLE ... FORCE ROW LEVEL SECURITY` on all tenant tables (`stores`, `memories`, `room_events`, `ai_turns`).
- **Walkthrough Demonstration Video:** Available in `qa_evidence/videos/playwright_acceptance_s15_s16_s17_demo.webm` demonstrating live login, two-client chat, tool calling, rehydration, and reconnection recovery.

Please let me know if you would like to schedule our technical debrief interview at your convenience.

Best regards,  
**Ashraf Al-Madhoun**  
Principal Software Engineer  
`eng.asm.89@gmail.com`  
