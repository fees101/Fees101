"use client";

import { useState } from "react";
import { Reveal } from "@/components/Reveal";

const REASSURANCE = [
  "Live and onboarding schools now",
  "A direct line to our team",
  "No obligation",
];

type FieldErrors = Partial<
  Record<"schoolName" | "contactName" | "email", string>
>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function RequestAccessContent() {
  const [schoolName, setSchoolName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  // String-backed so the field can be fully cleared and never gets a stuck
  // leading zero from coercing an empty value back to 0.
  const [studentCount, setStudentCount] = useState("");
  const [message, setMessage] = useState("");

  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!schoolName.trim()) next.schoolName = "School name is required.";
    if (!contactName.trim()) next.contactName = "Your name is required.";
    if (!email.trim()) next.email = "Email is required.";
    else if (!EMAIL_RE.test(email.trim())) next.email = "Enter a valid email address.";
    return next;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");

    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setStatus("sending");
    try {
      const res = await fetch("/api/request-access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schoolName,
          contactName,
          email,
          phone,
          studentCount,
          message,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data?.fieldErrors) setErrors(data.fieldErrors as FieldErrors);
        setFormError(
          data?.error || "Something went wrong. Please email support@fees101.com.",
        );
        setStatus("idle");
        return;
      }

      setStatus("done");
    } catch {
      setFormError(
        "Something went wrong. Please email support@fees101.com.",
      );
      setStatus("idle");
    }
  }

  return (
    <>
      <section className="mx-auto max-w-6xl px-6 pb-10 pt-20">
        <Reveal>
          <span className="m-mono mb-4 block text-xs uppercase tracking-wider text-signal-text">
            Early access
          </span>
          <h1 className="mb-6 max-w-2xl text-4xl font-extrabold leading-[0.92] tracking-tight text-ink sm:text-5xl md:text-6xl">
            Request access to{" "}
            <span className="text-signal">Fees101.</span>
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-neutral-700">
            Tell us a little about your school and we will be in touch to get you
            set up. Fees101 is live and onboarding schools now.
          </p>
        </Reveal>
      </section>

      <section className="border-t-2 border-ink">
        <div className="mx-auto grid max-w-6xl lg:grid-cols-[1fr_1.4fr]">
          {/* Left rail: what to expect */}
          <div className="flex flex-col gap-6 border-b border-neutral-300 p-8 lg:border-b-0 lg:border-r lg:border-neutral-300 lg:p-12">
            <Reveal>
              <span className="m-mono mb-4 block text-xs uppercase tracking-wider text-ink">
                What happens next
              </span>
              <ol className="flex flex-col gap-5">
                {[
                  "We read every request and reply from our own team, not a bot.",
                  "We will ask a few questions about your classes, terms and current fee process.",
                  "If it is a fit, we set your school up and walk you through onboarding.",
                ].map((item, i) => (
                  <li key={item} className="flex gap-3.5 border-t border-neutral-300 pt-4">
                    <span className="m-mono shrink-0 text-[13px] text-signal-text tabular-nums">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="text-[15px] leading-relaxed text-neutral-800">
                      {item}
                    </span>
                  </li>
                ))}
              </ol>
            </Reveal>

            <div className="m-mono mt-2 flex flex-col gap-2 border-t-2 border-ink pt-5 text-[13px] text-neutral-700">
              {REASSURANCE.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </div>

          {/* Right: the form */}
          <div className="bg-surface p-8 sm:p-12">
            {status === "done" ? (
              <Reveal>
                <div className="border-2 border-ink bg-paper p-6 sm:p-8">
                  <span className="m-mono mb-4 block text-xs uppercase tracking-wider text-ink">
                    Request received
                  </span>
                  <h2 className="mb-4 text-2xl font-extrabold leading-tight tracking-tight text-ink sm:text-3xl">
                    Thanks, we have your request and will be in touch.
                  </h2>
                  <p className="max-w-md text-[15px] leading-relaxed text-neutral-700">
                    You are on the early-access list. Our team reviews every
                    request personally and will reach out about the next steps.
                    This is not instant onboarding, so give us a little time to
                    get back to you.
                  </p>
                  <p className="mt-6 text-[15px] leading-relaxed text-neutral-700">
                    Need us sooner? Email{" "}
                    <a
                      href="mailto:support@fees101.com"
                      className="font-semibold text-ink underline decoration-2 underline-offset-4 transition-colors hover:text-signal-text"
                    >
                      support@fees101.com
                    </a>
                    .
                  </p>
                </div>
              </Reveal>
            ) : (
              <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
                <Field
                  id="school-name"
                  label="School name"
                  required
                  error={errors.schoolName}
                >
                  <input
                    id="school-name"
                    name="schoolName"
                    type="text"
                    autoComplete="organization"
                    className="input"
                    value={schoolName}
                    onChange={(e) => setSchoolName(e.target.value)}
                    aria-invalid={errors.schoolName ? true : undefined}
                    aria-describedby={errors.schoolName ? "school-name-error" : undefined}
                  />
                </Field>

                <Field
                  id="contact-name"
                  label="Your name"
                  required
                  error={errors.contactName}
                >
                  <input
                    id="contact-name"
                    name="contactName"
                    type="text"
                    autoComplete="name"
                    className="input"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    aria-invalid={errors.contactName ? true : undefined}
                    aria-describedby={errors.contactName ? "contact-name-error" : undefined}
                  />
                </Field>

                <Field id="email" label="Email" required error={errors.email}>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    className="input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    aria-invalid={errors.email ? true : undefined}
                    aria-describedby={errors.email ? "email-error" : undefined}
                  />
                </Field>

                <Field id="phone" label="Phone" optional>
                  <input
                    id="phone"
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    className="input"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </Field>

                <Field
                  id="student-count"
                  label="Approximate number of students"
                  optional
                >
                  <input
                    id="student-count"
                    name="studentCount"
                    type="text"
                    inputMode="numeric"
                    className="input tabular-nums"
                    value={studentCount}
                    onChange={(e) =>
                      setStudentCount(
                        e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, ""),
                      )
                    }
                  />
                </Field>

                <Field id="message" label="Anything you want us to know" optional>
                  <textarea
                    id="message"
                    name="message"
                    rows={4}
                    className="input resize-y"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                </Field>

                {formError && (
                  <p
                    role="alert"
                    className="border-l-2 border-signal pl-3 text-[14px] leading-relaxed text-signal-text"
                  >
                    {formError}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-4">
                  <button
                    type="submit"
                    className="m-btn m-btn-primary"
                    disabled={status === "sending"}
                  >
                    {status === "sending" ? "Sending your request" : "Request access"}
                  </button>
                  <span className="text-[13px] text-neutral-700">
                    We will only use this to get in touch.
                  </span>
                </div>
              </form>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

function Field({
  id,
  label,
  required,
  optional,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  optional?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-2 flex items-baseline justify-between gap-3 text-[15px] font-semibold text-ink"
      >
        <span>
          {label}
          {required && <span className="ml-1 text-signal-text">*</span>}
        </span>
        {optional && (
          <span className="m-mono text-[11px] font-normal uppercase tracking-wider text-neutral-600">
            Optional
          </span>
        )}
      </label>
      {children}
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          className="mt-2 text-[13px] leading-relaxed text-signal-text"
        >
          {error}
        </p>
      )}
    </div>
  );
}
