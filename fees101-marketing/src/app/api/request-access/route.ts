// Early-access lead capture. The /request-access form (client component) POSTs
// here; this handler validates, inserts the lead into Supabase with the SERVICE
// ROLE key (server-only), then sends a notification email via Brevo.
//
// Why a route handler and not a browser insert: the service-role key must never
// reach the client, and access_requests has RLS on with no policies, so there
// is no anon path into it by design. All secrets are read from process.env.
//
// Failure model (deliberate): a missing env var or a failed insert returns an
// error and the user is told to email support. But if the insert SUCCEEDS and
// only the Brevo email fails, we still return success — the lead is safely
// captured and we do not want to lose it over an email hiccup. The email
// failure is logged for follow-up.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
// This handler only ever responds to POST and must run per-request (it reads
// the body and secrets), so there is nothing to prerender or cache.
export const dynamic = "force-dynamic";

const SUPPORT_EMAIL = "support@fees101.com";
const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type LeadInput = {
  schoolName?: unknown;
  contactName?: unknown;
  email?: unknown;
  phone?: unknown;
  studentCount?: unknown;
  message?: unknown;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function POST(request: Request) {
  // Secrets (server-only). Reuse the public Supabase URL if the marketing
  // project exposes it, otherwise fall back to a server-only SUPABASE_URL.
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!supabaseUrl || !serviceRoleKey) {
    // Config error, not a user error. Do not crash the build — just fail the
    // request clearly and tell the user to email support.
    console.error(
      "[request-access] Missing Supabase config: " +
        `${supabaseUrl ? "" : "SUPABASE_URL "}${serviceRoleKey ? "" : "SUPABASE_SERVICE_ROLE_KEY"}`.trim()
    );
    return NextResponse.json(
      { error: `Something went wrong on our end. Please email ${SUPPORT_EMAIL}.` },
      { status: 500 }
    );
  }

  let body: LeadInput;
  try {
    body = (await request.json()) as LeadInput;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const schoolName = clean(body.schoolName);
  const contactName = clean(body.contactName);
  const email = clean(body.email);
  const phone = clean(body.phone);
  const message = clean(body.message);

  // student_count is an optional integer. The form sends a string; keep null
  // when blank rather than coercing an empty value to 0.
  const rawCount = clean(body.studentCount).replace(/\D/g, "");
  const studentCount = rawCount === "" ? null : parseInt(rawCount, 10);

  // Server-side validation of required fields.
  const fieldErrors: Record<string, string> = {};
  if (!schoolName) fieldErrors.schoolName = "School name is required.";
  if (!contactName) fieldErrors.contactName = "Your name is required.";
  if (!email) fieldErrors.email = "Email is required.";
  else if (!EMAIL_RE.test(email)) fieldErrors.email = "Enter a valid email address.";

  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json(
      { error: "Please check the highlighted fields.", fieldErrors },
      { status: 400 }
    );
  }

  // Insert the lead via PostgREST using the service role key. Prefer=minimal so
  // we do not need the inserted row back.
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/access_requests`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        school_name: schoolName,
        contact_name: contactName,
        email,
        phone: phone || null,
        student_count: studentCount,
        message: message || null,
        source: "marketing_site",
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[request-access] Supabase insert failed (${res.status}): ${detail}`);
      return NextResponse.json(
        { error: `Something went wrong. Please email ${SUPPORT_EMAIL}.` },
        { status: 500 }
      );
    }
  } catch (e) {
    console.error("[request-access] Supabase insert threw:", e);
    return NextResponse.json(
      { error: `Something went wrong. Please email ${SUPPORT_EMAIL}.` },
      { status: 500 }
    );
  }

  // Lead is safely captured. Notify the admin inbox via Brevo as a best-effort
  // step — if this fails, we log it but still report success to the user.
  await sendNotification({
    schoolName,
    contactName,
    email,
    phone,
    studentCount,
    message,
  }).catch((e) => {
    console.error("[request-access] Brevo notification failed:", e);
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}

async function sendNotification(lead: {
  schoolName: string;
  contactName: string;
  email: string;
  phone: string;
  studentCount: number | null;
  message: string;
}): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY || "";
  const senderEmail = process.env.BREVO_FROM_EMAIL || "";
  const senderName = process.env.BREVO_FROM_NAME || "Fees101";
  // Env-driven on purpose: the owner switches this to support@fees101.com at
  // go-live without a code change. Never hardcode the destination.
  const notifyEmail = process.env.LEADS_NOTIFY_EMAIL || "";

  if (!apiKey || !senderEmail || !notifyEmail) {
    console.error(
      "[request-access] Brevo not configured, skipping notification " +
        `(${apiKey ? "" : "BREVO_API_KEY "}${senderEmail ? "" : "BREVO_SENDER_EMAIL "}${notifyEmail ? "" : "LEADS_NOTIFY_EMAIL"}).`.trim()
    );
    return;
  }

  const rows: Array<[string, string]> = [
    ["School", lead.schoolName],
    ["Contact", lead.contactName],
    ["Email", lead.email],
    ["Phone", lead.phone || "Not provided"],
    ["Approx. students", lead.studentCount == null ? "Not provided" : String(lead.studentCount)],
    ["Message", lead.message || "None"],
  ];

  const textContent = rows.map(([k, v]) => `${k}: ${v}`).join("\n");
  const htmlContent =
    `<h2 style="font-family:Arial,sans-serif">New early-access request</h2>` +
    `<table style="font-family:Arial,sans-serif;border-collapse:collapse" cellpadding="6">` +
    rows
      .map(
        ([k, v]) =>
          `<tr><td style="border:1px solid #ccc;font-weight:bold">${escapeHtml(k)}</td>` +
          `<td style="border:1px solid #ccc">${escapeHtml(v)}</td></tr>`
      )
      .join("") +
    `</table>`;

  const res = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: notifyEmail }],
      // Reply-to the submitter so the owner can respond to them directly.
      replyTo: { email: lead.email, name: lead.contactName },
      subject: `Early-access request: ${lead.schoolName}`,
      htmlContent,
      textContent,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Brevo API error (${res.status}): ${detail}`);
  }
}
