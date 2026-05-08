# Award Recommendation Workflow — Implementation Summary

## Status
- ✅ Build: `npm run check` + `npm run build` pass
- ✅ API QA: 14 permission scenarios verified (see table below)
- ✅ Deployed: asset_id `a6f68786-37b1-4f7c-bea9-009f9f5762c6`
- ✅ Commit: `6e7c133914c935203c467f9b79179e43097c3293`

## Files Changed (vs `9f570b24`)
| File | Change |
|---|---|
| `shared/schema.ts` | Added `awardRecommendations` table + insert/decision Zod schemas + types |
| `shared/roles.ts` | Added `canSubmitAwardRecommendation`, `canDecideAwardRecommendation`, `canViewAwardRecommendations` |
| `server/storage.ts` | Added recommendation CRUD; approve calls existing `awardInvite` |
| `server/routes.ts` | GET/POST `/api/rfqs/:id/recommendations`, POST `/api/recommendations/:id/decision` with role enforcement |
| `client/src/components/award-recommendations.tsx` | NEW: forms, admin review panel, status badges, history |
| `client/src/pages/home.tsx` | Wired components in; pending banner; preserves buyer direct-award |

## QA Results
| # | Scenario | Expected | Actual |
|---|---|---|---|
| 1 | commercial_staff WITH grant submits | 201 | ✅ 201 |
| 2 | commercial_staff WITHOUT grant submits | 403 | ✅ 403 ("need TEG admin permission") |
| 3 | commercial_staff direct award | 403 | ✅ 403 |
| 4 | commercial_staff direct accept | 403 | ✅ 403 |
| 5 | RFQ status with pending recommendation | still active (not awarded) | ✅ "sent" |
| 6 | admin GET recommendations | 200, list | ✅ |
| 7 | admin returns with note | 200, status=returned | ✅ |
| 8 | commercial resubmits after return | 201 | ✅ 201 |
| 9 | portal endpoint exposes recommendations? | NO | ✅ keys: rfq, invites only |
| 10 | factory_user views recommendations | 403 | ✅ 403 |
| 11 | subcontractor_user views recommendations | 403 | ✅ 403 |
| 12 | admin approve | 200, RFQ awarded, invite 9 accepted, invite 8 closed | ✅ |
| 13 | RFQ post-approve state | status=awarded | ✅ |
| 14 | submit on awarded RFQ | 409 | ✅ 409 |
| 15 | buyer direct award still works | 200, awards | ✅ 200 |

## Assumptions
1. "returned" = needs revision; commercial_staff can submit a fresh one.
2. Only one pending recommendation per RFQ at a time (storage enforces).
3. `recommendedBy` is optional free-text name; `recommendedByRole` tracked separately.
4. Admin self-decide guard checks `recommendedByRole === decider role` (defensive — group_admin never submits).
5. Recommendations visible to admin / buyer / commercial only; blocked from factory_user, subcontractor_user, portal.
6. `decisionNote` required by UI for return/reject; approve does not require note.
7. Approval delegates to existing `awardInvite` (closure reason override or proposed reason fallback or DEFAULT_CLOSURE_REASON).
8. Active-queue filtering already keys on `rfq.status`; pending recommendation does NOT change RFQ status, so it stays active automatically.
9. Buyer direct-award flow preserved; commercial sees recommendation form additionally to the (already-restricted) BuyerControls.
