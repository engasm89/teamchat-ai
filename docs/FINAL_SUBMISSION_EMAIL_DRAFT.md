# DRAFT — not sent

Ashraf reviews, edits and sends this himself. No tool or agent sends it. Recipients match the thread in `docs/FINAL_HANDOFF_2026-10-09/EMAIL_CHRONOLOGY.md`: the technical brief went to Gonzalo with Elisa in copy on 8 October, and Gonzalo set the deadline to Friday 16 October.

Before sending:
- Send the reviewer passwords separately, as `docs/REVIEWER_ACCESS.md` describes, and fill in the channel below.
- Open the three links from a private browser window.

---

**To:** gonzalo@controlease.net
**Cc:** elisa@controlease.net
**Subject:** TeamChat AI assessment: submission

Hi Gonzalo, Elisa,

Here is my TeamChat AI submission.

- Live app: https://focus-clean-4b9f4.web.app
- Repository: https://github.com/engasm89/teamchat-ai (public, so @paluchi can read it without an invitation)
- Walkthrough video, narrated, 2 min 37 s: https://github.com/engasm89/teamchat-ai/releases/tag/walkthrough-2026-10-12
- Technical brief: the one I sent on 8 October; a copy is in the repository under `reference/`.

The README covers how to run and deploy it, the architecture, how real-time delivery works, how the model acts through tools and how its output is checked, how the brief changed during the build, and what does not work.

Test accounts: three per chain, Northside Outfitters and Valley Home Goods. I am sending the six sign-in details separately through [CHANNEL]. The README's "Test credentials" section explains how to check the isolation between the two chains yourself.

Every requirement's status is derived from recorded test runs against the deployed build rather than written by hand: `docs/REQUIREMENTS_FINAL_SUMMARY.md` lists them, and each links to its evidence in `qa_evidence/runs`.

A few things I'd rather you hear from me than find. Messages show the sender's raw Firebase user ID instead of a name. The chat does not auto-scroll. The model's answers are terse. Cloud SQL backups are off for this demo deployment. The full list is under "What does not work" in the README.

I'm happy to walk you through a single AI turn end to end whenever suits you.

Best regards,
Ashraf Al-Madhoun
