// mailcomposer has no published type definitions. Used only in
// src/lib/messaging/ses.ts to build a raw MIME message for SES's
// SendRawEmailCommand — the surface we touch is tiny, so a loose ambient
// declaration is enough rather than pulling in a full type package.
declare module 'mailcomposer' {
  interface MailOptions {
    from?: string
    to?: string
    subject?: string
    text?: string
    html?: string
    attachments?: Array<{
      filename: string
      content: Buffer
      contentType?: string
    }>
  }

  class MailComposer {
    constructor(options: MailOptions)
    build(callback: (err: Error | null, message: Buffer) => void): void
  }

  export = MailComposer
}
