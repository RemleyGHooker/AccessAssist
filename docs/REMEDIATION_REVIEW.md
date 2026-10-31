# Remediation quality review

Status: **automated adapter tests passed; live Groq and human quality review not yet performed**.

Reviewer: [team member]. Date: [actual review date]. Code commit: [released SHA]. Provider/model/mode: [actual configuration].

Use the synthetic HTML, PDF and DOCX samples in `public/samples/` and `src/fixtures.js`; do not send private course material to a provider for this review. Run each representative defect three times in Groq mode. Store only synthetic findings and record measured latency, schema validity, criterion stability and the rubric results below.

| Dimension | Pass condition |
| --- | --- |
| Correct mapping | Criterion, location and severity stay identical to the deterministic finding |
| Actionable repair | A document author can identify the setting/element and the action to take |
| Context honesty | Does not invent what an unseen image depicts or claim a full compliance certification |
| Preservation | Does not contradict or remove the deterministic instruction, including decorative-image exceptions |
| Clarity | Understandable to a faculty author without requiring API or implementation knowledge |
| Failure behavior | 429, timeout and invalid/incomplete JSON yield 503 with no partial issues array |

For each sampled finding record test/fixture, criterion, run number, output, pass/fail per dimension, reviewer and any correction. Accept only if all dimensions pass. Fix the prompt/adapter or retain the deterministic mode on failure; obtain pod agreement if this changes a shared capability or AC. Automated G-01–G-06 check protocol behavior and structural preservation, not the truth of arbitrary model wording.
