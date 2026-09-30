import { LegalLayout, LegalSection } from "@/components/LegalLayout";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Terms of Service",
  description:
    "The terms governing use of the Fees101 platform by Nigerian schools — payments, messaging, data handling and liability.",
  path: "/terms",
});

const SECTIONS = [
  { id: "the-service", label: "1. The service" },
  { id: "accounts-and-eligibility", label: "2. Accounts and eligibility" },
  { id: "school-customer-responsibilities", label: "3. School Customer responsibilities" },
  { id: "payments", label: "4. Payments" },
  { id: "messaging", label: "5. Messaging" },
  { id: "availability-and-changes", label: "6. Availability and changes" },
  { id: "limitation-of-liability", label: "7. Limitation of liability" },
  { id: "termination", label: "8. Termination" },
  { id: "governing-law", label: "9. Governing law" },
  { id: "contact-us", label: "10. Contact us" },
];

export default function TermsPage() {
  return (
    <LegalLayout title="Terms of Service" updated="24 July 2026" sections={SECTIONS}>
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern access to and use of
        the Fees101 platform, provided by FEES101 LTD, RC 9694725, a company
        registered in Nigeria (&ldquo;Fees101&rdquo;, &ldquo;we&rdquo;,
        &ldquo;us&rdquo;). By using Fees101, a School Customer agrees to these
        Terms.
      </p>

      <LegalSection id="the-service" heading="1. The service">
        <p>
          Fees101 is software that helps schools set fee structures, generate
          student invoices, collect and reconcile payments, and notify
          parents/guardians of invoices and payments due. Fees101 is currently in
          active development and being onboarded with schools on a limited basis.
        </p>
      </LegalSection>

      <LegalSection id="accounts-and-eligibility" heading="2. Accounts and eligibility">
        <p>
          Fees101 is intended for use by schools and authorised school staff. You
          must provide accurate information when creating an account and are
          responsible for keeping your login credentials confidential and for all
          activity under your account.
        </p>
      </LegalSection>

      <LegalSection id="school-customer-responsibilities" heading="3. School Customer responsibilities">
        <ul className="list-disc pl-5">
          <li>
            You are responsible for the accuracy of the fee, student, and
            parent/guardian information you enter into Fees101.
          </li>
          <li>
            You confirm you have the appropriate basis and, where applicable,
            consent to share parent/guardian contact details with us for the
            purpose of sending invoice and payment notifications.
          </li>
          <li>
            You will not use Fees101 for any unlawful purpose or to send
            communications unrelated to fee collection and reconciliation.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="payments" heading="4. Payments">
        <p>
          Fees101 integrates with licensed third-party payment infrastructure to
          generate dedicated virtual bank accounts and process fee payments.
          Fees101 does not itself hold customer funds; funds are settled through
          our payment infrastructure partner directly to the relevant School
          Customer&rsquo;s designated settlement account, subject to that
          partner&rsquo;s own terms.
        </p>
      </LegalSection>

      <LegalSection id="messaging" heading="5. Messaging">
        <p>
          Fees101 sends transactional SMS/WhatsApp notifications (such as invoice
          alerts, payment confirmations, and reminders) to parent/guardian phone
          numbers provided by School Customers, using licensed messaging
          providers. These messages are limited to fee-related communication.
        </p>
      </LegalSection>

      <LegalSection id="availability-and-changes" heading="6. Availability and changes">
        <p>
          Fees101 is provided on an &ldquo;as available&rdquo; basis while we
          continue to build and improve it. We may update, modify, or temporarily
          suspend parts of the service, and will make reasonable efforts to
          communicate material changes to affected School Customers in advance.
        </p>
      </LegalSection>

      <LegalSection id="limitation-of-liability" heading="7. Limitation of liability">
        <p>
          To the fullest extent permitted by law, Fees101 will not be liable for
          indirect, incidental, or consequential losses arising from use of the
          platform. Nothing in these Terms limits liability that cannot be
          excluded under Nigerian law.
        </p>
      </LegalSection>

      <LegalSection id="termination" heading="8. Termination">
        <p>
          Either party may stop using or providing the service at any time. On
          termination, we will make reasonable efforts to allow a School Customer
          to export their data, and will retain data only as described in our{" "}
          <a href="/privacy" className="text-signal-text underline">
            Privacy Policy
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection id="governing-law" heading="9. Governing law">
        <p>
          These Terms are governed by the laws of the Federal Republic of
          Nigeria, and any disputes are subject to the exclusive jurisdiction of
          the Nigerian courts.
        </p>
      </LegalSection>

      <LegalSection id="contact-us" heading="10. Contact us">
        <p>
          Questions about these Terms can be sent to{" "}
          <a href="mailto:support@fees101.com" className="text-signal-text underline">
            support@fees101.com
          </a>{" "}
          or{" "}
          <a href="mailto:support@fees101.com" className="text-signal-text underline">
            support@fees101.com
          </a>
          .
        </p>
        <address className="not-italic">
          FEES101 LTD
          <br />
          Plot L182, Ellicot Citi Street, Kubwa Extension III, Bwari, FCT, Nigeria
          <br />
          RC 9694725
        </address>
      </LegalSection>
    </LegalLayout>
  );
}
