# TeamChat AI: agent project pack

Owner: Ashraf Al-Madhoun. Client: Controlease. Prepared: 8 October 2026.
Deadline: **16 October 2026** (Gonzalo's clarification recorded in this conversation). Submission time/timezone is unconfirmed. Do not reuse the stale February date in the original assessment.

## Read in this order

1. `ORIGINAL_ASSESSMENT.md`: unmodified employer instructions.
2. `BRIEF_REFERENCE.md`: text extracted from the latest six-page brief; the PDF remains the authoritative formatted brief.
3. `AGENTS.md`: working rules and continuation prompt.
4. `01_REQUIREMENTS.md`: required behavior and scoring.
5. `02_ARCHITECTURE.md`: implementation contracts and design decisions.
6. `03_ACCEPTANCE.md`: evidence-based pass criteria.
7. `04_MILESTONES.md`: sequence and milestone-one checklist.
8. `05_SKILLS.md`: technical competencies and available skills to apply.
9. `06_STATUS_AND_HANDOFF.md`: update after each work session.

## Source precedence

Employer clarification > original employer requirements > submitted technical brief > these planning files. Record changes from the brief in the implementation README. Design assumptions in this pack are not employer-prescribed business rules. Do not fabricate a later clarification.

## Inputs

- Submitted PDF: `../TeamChat_AI_Technical_Brief_SUBMITTED_2026-10-08.pdf` (exact bytes of Gmail attachment dated 8 October 2026).
- Original ZIP: `../teamchat-ai-assessment_ORIGINAL_UNMODIFIED.zip` (unchanged employer attachment).
- ZIP data folder: `teamchat-ai-assessment/teamchat-ai-seed-data/`.
- Local paths in this conversation are temporary. A future agent must locate the actual attached inputs; do not assume old scratch paths still exist.

This pack includes assessment material and the submitted brief for Ashraf’s private working handoff. Do not indiscriminately commit the full pack to a public repository; review employer material for suitability first. The pack does not duplicate credentials or publish private material. Keep seed bytes unchanged in the repository's fixture folder; record their hashes. Store demo credentials outside the public repository.

## Phase 1 completed boundary

Phase 1 verified 9 October 2026. The six-page brief was **SENT on 8 October 2026**, to Gonzalo with Elisa in CC, with the attached PDF. Its submission evidence is documented in `07_PHASE1_VERIFICATION.md`. The ZIP inputs include no runnable application; existence of code/repositories elsewhere is not checked. GCP access/billing and GitHub repository are not verified. Before application coding, inspect any existing repository, and confirm its first application commit is later than the submitted brief. Employer approval is not required after submission.

## Using this in a ChatGPT Project or repository

Upload these Markdown files plus the assessment ZIP and final PDF to the project's Files area. Put `AGENTS.md` at the repository root for coding agents, and the other files in `docs/` if desired; update relative links accordingly. Reading uploaded files is not guaranteed automatically: start the agent with the prompt in `AGENTS.md`.

These files are project guidance, not installed executable skills. They do not prove any implementation criterion has passed.
