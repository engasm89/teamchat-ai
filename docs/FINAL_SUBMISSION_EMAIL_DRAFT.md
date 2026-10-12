# DRAFT — not sent

The submission email, kept here so the requirements check can confirm its recipients and links. It is sent by hand, never by a script. The test-account passwords are not in it; they go through a separate expiring share.

---

**To:** gonzalo@controlease.net
**Cc:** elisa@controlease.net
**Subject:** TeamChat AI technical assessment: submission (Ashraf Al-Madhoun)

Hi Gonzalo and Elisa,

I'm pleased to share my completed TeamChat AI technical assessment. I focused on what I think matters most in a production system: tenant isolation, reliable real-time delivery, AI answers grounded in each chain's own data, and recovery when things fail.

Links
- Live application: https://focus-clean-4b9f4.web.app
- Repository: https://github.com/engasm89/teamchat-ai (public, so @paluchi can review it without an invitation)
- Walkthrough video, narrated (2 min 37 s): https://github.com/engasm89/teamchat-ai/releases/tag/walkthrough-2026-10-12
- Technical brief: the one I sent on 8 October, unchanged, in the repository under `reference/`

What's in it
- Tenant isolation: the server takes the tenant from the verified Firebase token, and PostgreSQL row-level security, which the application's database role cannot bypass, keeps Northside Outfitters and Valley Home Goods apart.
- Real-time: native WebSockets with durable, ordered room events; clients reconnect and replay what they missed.
- AI: Vertex AI Gemini chooses among seven server-side tools through native function calling; business facts reach the screen only after the server checks them against data fetched in that turn.
- Shared memory: tenant-isolated, stored in PostgreSQL with pgvector embeddings.
- Infrastructure: Firebase Hosting, Cloud Run (API and a private worker), Cloud SQL, Cloud Tasks and Secret Manager.
- Testing: all 19 assessment scenarios passed against the deployed build in the recorded runs, alongside unit tests, live row-level-security tests and real-browser refresh and network-cut recovery tests.

The README covers setup, deployment, architecture, how the brief changed during the build, and what does not work. The requirements matrix (`docs/REQUIREMENTS_FINAL_SUMMARY.md`) is generated from those test runs, and each requirement links to its evidence.

A few limitations I'd rather you hear from me: messages show the sender's raw Firebase user ID instead of a name, the chat doesn't auto-scroll, answers are terse because only verified data is shown, and Cloud SQL backups are off for this demo deployment. The full list is under "What does not work" in the README. I also used AI coding assistants throughout; most commits show a placeholder author identity one of them configured, which the README's "Commit identity" section explains.

Reviewer access: there are six test accounts, three per chain. I'm sending their sign-in details separately through [CHANNEL].

I'd be glad to walk you through the design decisions or trace a single AI turn end to end whenever suits you.

Thank you for your time and consideration.

Best regards,
Ashraf Al-Madhoun
Mechatronics Engineer | AI & Full-Stack Engineering
https://github.com/engasm89
