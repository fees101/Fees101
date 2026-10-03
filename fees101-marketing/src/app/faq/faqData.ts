export const FAQS = [
  {
    category: "getting-started",
    q: "What is Fees101?",
    a: "Fees101 is a revenue operations platform for Nigerian schools. It helps schools set up fee structures per term/class, generate per-student invoices, collect payments, and automatically reconcile them against the right student.",
  },
  {
    category: "getting-started",
    q: "Is Fees101 live yet?",
    a: "Fees101 is in active development and currently being rolled out with a small number of schools. We're not yet open for general sign-up, but we'd love to hear from schools interested in early access.",
  },
  {
    category: "getting-started",
    q: "How can my school get early access?",
    a: "Reach out to support@fees101.com and we'll get you set up as part of our early onboarding.",
  },
  {
    category: "payments",
    q: "How does payment collection work?",
    a: "Each student is issued a dedicated virtual bank account through our licensed payment infrastructure partner. Parents pay directly into that account, and Fees101 automatically matches the payment to the right student and invoice — no manual reconciliation needed.",
  },
  {
    category: "payments",
    q: "Do parents need to download an app or change how they pay?",
    a: "No. Parents keep paying exactly how they already do — a regular bank transfer, from whatever banking app they normally use. The only difference is they're transferring into their own child's dedicated account instead of a shared one, and it's the school's side that's now organised — everything is matched and recorded automatically.",
  },
  {
    category: "payments",
    q: "Does Fees101 hold our money?",
    a: "No. Fees101 does not hold school funds. Payments are settled through our payment infrastructure partner directly to the school's own designated settlement account.",
  },
  {
    category: "payments",
    q: "What happens to a student's outstanding balance at the end of term?",
    a: "Any unpaid balance is automatically carried forward to the student's next invoice, so nothing gets lost between terms.",
  },
  {
    category: "payments",
    q: "How can a Nigerian school stop fake bank-transfer payment alerts?",
    a: "Give each student their own dedicated virtual bank account and verify every payment server-side instead of trusting a screenshot or a text alert. With Fees101, each student has a dedicated virtual account through our licensed payment partner, and every payment is confirmed by a verified webhook from that partner before it is recorded. A forged alert or edited screenshot never creates a real payment record, because the record only exists once the money has actually settled.",
  },
  {
    category: "payments",
    q: "How do schools reconcile fee payments automatically?",
    a: "Reconciliation happens automatically when each student pays into their own dedicated virtual account, so the payment is matched to the right student and invoice with no manual lookup. Fees101 issues one virtual account per student, confirms the incoming transfer by verified webhook, and applies it to that student's invoice, carrying any remaining balance forward. Admin staff stop matching transfers to names by hand.",
  },
  {
    category: "payments",
    q: "Can a parent with more than one child in the school pay once?",
    a: "Yes. Siblings can be grouped into a family account with one shared dedicated virtual account, so a parent transfers once and Fees101 applies the payment across each child's outstanding invoices automatically, oldest term first. The parent gets a single confirmation covering every child the payment was applied to. Each student also keeps their own account, so a school can use whichever fits a given family.",
  },
  {
    category: "students",
    q: "What is the best way to track school fees without Excel spreadsheets?",
    a: "Use a system that generates a per-student invoice from the fee structure and updates the balance automatically as money arrives, instead of a spreadsheet someone has to edit by hand. Fees101 sets fees per class and term, issues an invoice for each student, reconciles payments through a dedicated virtual account per student, and shows what is collected and outstanding on a live dashboard. There is no formula to maintain and no file to pass around.",
  },
  {
    category: "getting-started",
    q: "Does Fees101 work for schools currently using Excel or paper records?",
    a: "Yes. Schools moving off Excel or paper can bulk-import their existing student list by CSV and Fees101 takes over invoicing and reconciliation from there. You set your fee structure per class and term once, each student is issued a dedicated virtual account, and payments are matched and recorded automatically. You keep your records, without the manual matching and the version-control headaches.",
  },
  {
    category: "students",
    q: "How do parents get notified about fees?",
    a: "Parents receive SMS (and in future, WhatsApp) notifications for new invoices and payment confirmations, sent through our licensed messaging provider, using the phone number the school has on file.",
  },
  {
    category: "students",
    q: "Does Fees101 send anything other than fee-related messages?",
    a: "No. Every SMS/WhatsApp notification we send is tied to a specific invoice, payment, or reminder for that student's fees — never marketing or unrelated messages.",
  },
  {
    category: "security",
    q: "How is our data protected?",
    a: "We apply industry-standard security practices, including encrypted connections and encrypted storage of sensitive credentials. See our Privacy Policy for full detail on what we collect and how it's used.",
  },
  {
    category: "account",
    q: "Is Fees101 a registered company?",
    a: "Yes. Fees101 is operated by FEES101 LTD, RC 9694725, registered in Nigeria with its registered office at Plot L182, Ellicot Citi Street, Kubwa Extension III, Bwari, FCT, Nigeria.",
  },
  {
    category: "account",
    q: "Who can I contact for support or questions?",
    a: "General enquiries and support: support@fees101.com. The inbox is checked directly by our team — there's no ticketing bot in between.",
  },
];
