repo: fees101/Fees101
branch: dev
path: src

## Last sync
date: 2026-09-16T18:27:54Z

### Updated in this project
- Phase 05 started: Fees structure (one class-by-fee matrix replacing nine expandable fee cards) and Cycles (term timeline plus the four-state term sequence: generate, send, collect, close). No NOW panels yet — FeeStructureLayout.tsx and CyclesLayout.tsx still unread, so the compare toggle stays disabled on Fees.
- Read StudentSettingsTab.tsx; added the student profile NOW/NEXT comparison panel and fixed the term-history table overflow.
- Phase 03 started: student profile built as a drill-down from the roster (click any row) — term ledger, five-term payment history as one continuous table, activity, and the record panel replacing the settings tab.
- Read InvoicePDF.tsx; added the invoice PDF as its own artefact (separate from the email that attaches it), NOW/NEXT.
- Phase 02 built: the four parent-facing messages (invoice email, receipt email, four SMS templates), drawn from composeInvoice.ts and reminders.ts, each with a NOW/NEXT comparison. SMS rework fits every template into one GSM-7 segment.
- Read AnalyticsCharts.tsx and TimelineHero.tsx in full; redrew the Money → Collections NOW/NEXT comparison panel from the real recharts components (navy/mint/amber/red series, dashed gridlines, brush strip, 10-colour PALETTE, rounded-xl cards).
- Collections split into three sub-views (Position / Breakdown / Forecast & chasing) so the surface is no longer one long scroll.
- Added five new analytics grounded in existing data: collection velocity vs last term, term-close forecast, reminder effectiveness by channel, repeat debtors, payment-method mix.

## Screen map
| Screen | Built from |
| --- | --- |
| App shell (sidebar + header + signals) | src/app/(app)/layout.tsx, src/components/layout/Sidebar.tsx, src/lib/nav/navConfig.ts, src/lib/jobs/ActiveJobsProvider.tsx |
| Today — Now | src/app/(app)/dashboard/page.tsx, src/lib/queries/dashboard.ts, src/components/dashboard/* |
| Today — Record | src/app/(app)/activity/page.tsx, src/components/activity/ActivityFeed.tsx, src/lib/queries/activity.ts |
| Student profile | src/components/students/StudentPaymentHistoryTab.tsx, StudentActivityTimeline.tsx, HeaderVirtualAccount.tsx, StudentFeesTab.tsx, StudentSettingsTab.tsx |
| Students roster | src/components/students/StudentsTable.tsx, StudentsHeader.tsx |
| Money — Invoices | src/components/invoices/InvoicesListLayout.tsx, src/lib/queries/fees.ts |
| Money — Collections | src/components/payments/TimelineHero.tsx, AnalyticsCharts.tsx, PeriodPicker.tsx, src/lib/queries/analytics.ts, src/lib/analytics/aggregate.ts |
| Permission gating (all screens) | src/lib/auth/permissionCatalog.ts, permissions.ts, PermissionsProvider.tsx |
| Login / auth edges | src/app/login/page.tsx, src/app/set-password/page.tsx, src/middleware.ts |
| Parent messages | src/lib/messaging/composeInvoice.ts, reminders.ts, sendMessage.ts |
| Invoice PDF | src/components/invoices/InvoicePDF.tsx, src/lib/pdf/renderInvoicePdf.ts |
| Fees — structure & cycles | src/components/fees/GenerateInvoicesPanel.tsx, TermSelector.tsx (read); FeeStructureLayout.tsx, CyclesLayout.tsx, CycleDetailLayout.tsx, YearEndRolloverWizard.tsx (unread) |
| Settings (planned) | src/components/settings/*, SettingsNav.tsx |

## Notes
- Read in full: layout, Sidebar, navConfig, dashboard page, permissionCatalog, StudentsTable, InvoicesListLayout, SettingsNav, login, middleware, globals.css, analytics queries + aggregate, PeriodPicker, AnalyticsCharts, TimelineHero.
- Inventoried but NOT yet read: FeeStructureLayout.tsx, CyclesLayout.tsx, CycleDetailLayout.tsx, YearEndRolloverWizard.tsx, CreateTermPanel.tsx, EditFeeGroupPanel.tsx, FeeFormPanel.tsx, ManageOptInsPanel.tsx, settings components, CSVImportFlow.tsx, BulkDVAPanel.tsx, AddStudentModal.tsx, StudentFeesTab.tsx, composeInvite.ts. Each needs a read pass before its phase — a NOW panel must never be drawn from an unread component.
- Current analytics palette (for reference when drawing NOW panels): mint #34d399, navy #1e293b, amber #f59e0b, grey #cbd5e1, red #f87171, plus a 10-colour categorical PALETTE.
- Retired in the rework: Manrope, navy #0D1B36, mint #5AD8A6, rounded-xl cards, five-hue status pills, the 64px hover-expand rail.
- This project produces design only — nothing is committed to the repo. Implementation happens via a handoff package in Phase 09.
