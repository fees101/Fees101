import path from 'path'
import { Document, Page, Text, View, StyleSheet, Image, Font } from '@react-pdf/renderer'
import { InvoiceDetail } from '@/lib/queries/fees'
import { formatPaymentMethod } from '@/lib/paymentMethod'

// The receipt artefact pairs with the invoice PDF (InvoicePDF.tsx): same A4
// geometry, margins, logo treatment and footer, with three deliberate changes —
// the header label reads RECEIPT under a green rule, the dominant figure is
// AMOUNT RECEIVED in green, and the line-item table becomes a payment table
// (a receipt records transfers, not charges). Generated per payment, not per
// term: a family paying in instalments gets one receipt per payment, each
// showing that payment highlighted with the earlier ones listed above it.

// Helvetica (react-pdf's default) has no glyph for the Naira sign (U+20A6).
// DejaVu Sans has full currency-symbol coverage, so we embed it instead.
Font.register({
  family: 'DejaVuSans',
  fonts: [
    { src: path.join(process.cwd(), 'public/fonts/DejaVuSans.ttf'), fontWeight: 'normal' },
    { src: path.join(process.cwd(), 'public/fonts/DejaVuSans-Bold.ttf'), fontWeight: 'bold' },
  ],
})

// Modernist palette (react-pdf takes literal hex, no CSS variables).
const INK = '#201e1d'
const PAPER = '#f3f2f2'
const SECONDARY = '#605d5d'
const BODY = '#444141'
const DIVIDER = '#d7d3d3'
const GREEN = '#0a6b3d'

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: 'DejaVuSans',
    fontSize: 10,
    color: INK,
    backgroundColor: PAPER,
  },

  // Masthead — identical to the invoice, except the rule under it is green.
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 20,
    paddingBottom: 14,
    borderBottomWidth: 2,
    borderBottomColor: GREEN,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'flex-start', flex: 1, marginRight: 16 },
  logoBox: {
    width: 44,
    height: 44,
    borderWidth: 2,
    borderColor: INK,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    flexShrink: 0,
  },
  logoImage: { width: 44, height: 44, borderWidth: 2, borderColor: INK, marginRight: 12, flexShrink: 0 },
  logoInitials: { fontSize: 12, fontWeight: 'bold', color: INK },
  schoolTextBlock: { flexShrink: 1 },
  schoolName: { fontSize: 15, fontWeight: 'bold', color: INK, marginBottom: 4 },
  schoolInfo: { fontSize: 9, color: SECONDARY, lineHeight: 1.5 },
  headerRight: { alignItems: 'flex-end', flexShrink: 0 },

  receiptTitle: { fontSize: 10, fontWeight: 'bold', letterSpacing: 1.6, color: GREEN, textTransform: 'uppercase', marginBottom: 3 },
  receiptNumber: { fontSize: 12, fontWeight: 'bold', color: INK },
  receiptDate: { fontSize: 9, color: SECONDARY, marginTop: 3 },

  // Received from / term
  detailsRow: {
    flexDirection: 'row',
    gap: 24,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: DIVIDER,
  },
  colWide: { flex: 1.3 },
  colNarrow: { flex: 1 },
  detailsLabel: { fontSize: 9, fontWeight: 'bold', letterSpacing: 1.2, color: SECONDARY, textTransform: 'uppercase', marginBottom: 5 },
  detailsName: { fontSize: 13, fontWeight: 'bold', color: INK, marginBottom: 3 },
  detailsBody: { fontSize: 10, color: BODY, lineHeight: 1.5 },

  // Amount received — the invoice's amount-due tile, in green.
  amountRow: {
    flexDirection: 'row',
    gap: 24,
    paddingTop: 20,
    paddingBottom: 18,
    borderBottomWidth: 2,
    borderBottomColor: INK,
  },
  amountFigure: { fontSize: 32, fontWeight: 'bold', color: GREEN, marginBottom: 4, letterSpacing: -1, lineHeight: 0.95 },
  amountSublineGreen: { fontSize: 11, fontWeight: 'bold', color: GREEN },
  amountSublineSecondary: { fontSize: 11, fontWeight: 'bold', color: SECONDARY },

  // Payment table
  itemsWrap: { marginTop: 16 },
  payHeaderRow: {
    flexDirection: 'row',
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: INK,
  },
  payRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: DIVIDER,
  },
  payHeaderLabel: { fontSize: 9, fontWeight: 'bold', letterSpacing: 1, color: SECONDARY, textTransform: 'uppercase' },
  colDate: { flex: 1.1 },
  colMethod: { flex: 1 },
  colRef: { flex: 1.4 },
  colAmount: { flex: 1, textAlign: 'right' },
  payCell: { fontSize: 10.5, color: BODY },
  payCellInk: { fontSize: 10.5, color: INK },
  payCellHi: { fontSize: 10.5, fontWeight: 'bold', color: INK },
  payThisTag: { fontSize: 8, fontWeight: 'bold', letterSpacing: 0.8, color: GREEN, textTransform: 'uppercase', marginTop: 2 },

  // Three-row summary
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: DIVIDER,
  },
  summaryLabel: { fontSize: 10.5, color: BODY },
  summaryValue: { fontSize: 10.5, fontWeight: 'bold', color: INK },
  receivedValue: { fontSize: 10.5, fontWeight: 'bold', color: GREEN },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingTop: 10,
  },
  balanceLabel: { fontSize: 12.5, fontWeight: 'bold', color: INK },
  balanceValue: { fontSize: 17, fontWeight: 'bold', color: INK },
  balanceValueClear: { fontSize: 17, fontWeight: 'bold', color: GREEN },

  footer: {
    marginTop: 26,
    fontSize: 9,
    color: SECONDARY,
    borderTopWidth: 1,
    borderTopColor: DIVIDER,
    paddingTop: 9,
  },
  footerLine: { lineHeight: 1.6 },
})

function formatNaira(amount: number): string {
  return (amount < 0 ? '-₦' : '₦') + Math.abs(amount).toLocaleString('en-NG')
}

function formatDateShort(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function getSchoolInitials(name: string): string {
  const words = name.split(/\s+/).filter(w => w.length > 0)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

// RCP-{invoice}-{sequence}: pairs the receipt to its invoice and numbers it by
// the payment's position in the sequence of payments against that invoice.
function receiptNumber(invoiceNumber: string | null, sequence: number): string {
  return `RCP-${invoiceNumber || '—'}-${String(sequence).padStart(2, '0')}`
}

interface Props {
  invoice: InvoiceDetail
  logoUrl?: string | null
  // The payment this receipt confirms. Defaults to the most recent payment on
  // the invoice when omitted (the on-demand "send receipt" case).
  highlightPaymentId?: string
}

export function ReceiptPage({ invoice, logoUrl, highlightPaymentId }: Props) {
  const initials = getSchoolInitials(invoice.schoolName)

  // Chronological order: sequence numbering and the "earlier payments above"
  // context both read oldest-first.
  const allPayments = [...(invoice.payments || [])].sort(
    (a, b) => new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime()
  )

  const highlightIndex = highlightPaymentId
    ? Math.max(0, allPayments.findIndex(p => p.id === highlightPaymentId))
    : allPayments.length - 1

  // A receipt is a snapshot at its payment's moment: show that payment and the
  // ones before it, never later payments the parent hadn't made yet.
  const rows = allPayments.slice(0, highlightIndex + 1)
  const highlighted = rows[rows.length - 1]

  const sequence = highlightIndex + 1
  const rcpNumber = receiptNumber(invoice.invoiceNumber, sequence)

  const amountReceived = highlighted ? highlighted.amount : 0
  const totalReceived = rows.reduce((sum, p) => sum + p.amount, 0)
  const balanceRemaining = Math.max(0, invoice.totalAmount - totalReceived)
  const cleared = balanceRemaining <= 0

  return (
    <Page size="A4" style={styles.page}>

      {/* Masthead */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {logoUrl ? (
            <Image src={logoUrl} style={styles.logoImage} />
          ) : (
            <View style={styles.logoBox}>
              <Text style={styles.logoInitials}>{initials}</Text>
            </View>
          )}
          <View style={styles.schoolTextBlock}>
            <Text style={styles.schoolName}>{invoice.schoolName}</Text>
            {(invoice.schoolAddress || invoice.schoolPhone) && (
              <Text style={styles.schoolInfo}>
                {[invoice.schoolAddress, invoice.schoolPhone].filter(Boolean).join(' · ')}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.headerRight}>
          <Text style={styles.receiptTitle}>Receipt</Text>
          <Text style={styles.receiptNumber}>{rcpNumber}</Text>
          {highlighted && <Text style={styles.receiptDate}>{formatDateShort(highlighted.paidAt)}</Text>}
        </View>
      </View>

      {/* Received from / term */}
      <View style={styles.detailsRow}>
        <View style={styles.colWide}>
          <Text style={styles.detailsLabel}>Received from</Text>
          <Text style={styles.detailsName}>{invoice.studentFirstName} {invoice.studentLastName}</Text>
          <Text style={styles.detailsBody}>{invoice.className} · {invoice.studentAdmissionNumber}</Text>
          {invoice.primaryParentName ? (
            <Text style={styles.detailsBody}>
              {invoice.primaryParentName}{invoice.primaryParentPhone ? ` · ${invoice.primaryParentPhone}` : ''}
            </Text>
          ) : null}
        </View>
        <View style={styles.colNarrow}>
          <Text style={styles.detailsLabel}>Term</Text>
          <Text style={styles.detailsName}>{invoice.cycleName}</Text>
          <Text style={styles.detailsBody}>Invoice {invoice.invoiceNumber || '—'}</Text>
        </View>
      </View>

      {/* Amount received */}
      <View style={styles.amountRow}>
        <View style={styles.colWide}>
          <Text style={styles.detailsLabel}>Amount received</Text>
          <Text style={styles.amountFigure}>{formatNaira(amountReceived)}</Text>
          {highlighted && (
            <Text style={styles.amountSublineGreen}>
              {formatPaymentMethod(highlighted.method)} · {formatDateShort(highlighted.paidAt)}
            </Text>
          )}
        </View>
        <View style={styles.colNarrow}>
          <Text style={styles.detailsLabel}>Status</Text>
          {cleared ? (
            <Text style={styles.amountSublineGreen}>Paid in full — nothing further is owed this term.</Text>
          ) : (
            <Text style={styles.amountSublineSecondary}>{formatNaira(balanceRemaining)} still to pay this term.</Text>
          )}
        </View>
      </View>

      {/* Payment table */}
      <View style={styles.itemsWrap}>
        <View style={styles.payHeaderRow}>
          <Text style={[styles.payHeaderLabel, styles.colDate]}>Date</Text>
          <Text style={[styles.payHeaderLabel, styles.colMethod]}>Method</Text>
          <Text style={[styles.payHeaderLabel, styles.colRef]}>Reference</Text>
          <Text style={[styles.payHeaderLabel, styles.colAmount]}>Amount</Text>
        </View>
        {rows.map((p) => {
          const isThis = highlighted && p.id === highlighted.id
          const cell = isThis ? styles.payCellHi : styles.payCell
          return (
            <View key={p.id} style={styles.payRow}>
              <View style={styles.colDate}>
                <Text style={isThis ? styles.payCellHi : styles.payCellInk}>{formatDateShort(p.paidAt)}</Text>
                {isThis && <Text style={styles.payThisTag}>This receipt</Text>}
              </View>
              <Text style={[cell, styles.colMethod]}>{formatPaymentMethod(p.method)}</Text>
              <Text style={[cell, styles.colRef]}>{p.reference || '—'}</Text>
              <Text style={[cell, styles.colAmount]}>{formatNaira(p.amount)}</Text>
            </View>
          )
        })}

        {/* Three-row summary */}
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Total billed for the term</Text>
          <Text style={styles.summaryValue}>{formatNaira(invoice.totalAmount)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Total received</Text>
          <Text style={styles.receivedValue}>{formatNaira(totalReceived)}</Text>
        </View>
        <View style={styles.balanceRow}>
          <Text style={styles.balanceLabel}>Balance remaining</Text>
          <Text style={cleared ? styles.balanceValueClear : styles.balanceValue}>
            {formatNaira(balanceRemaining)}
          </Text>
        </View>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerLine}>
          {invoice.schoolName} · Receipt {rcpNumber} · page 1 of 1
        </Text>
        {invoice.schoolPhone && (
          <Text style={styles.footerLine}>
            Questions about this receipt: call the school office on {invoice.schoolPhone}.
          </Text>
        )}
      </View>
    </Page>
  )
}

export default function ReceiptPDF({ invoice, logoUrl, highlightPaymentId }: Props) {
  return (
    <Document>
      <ReceiptPage invoice={invoice} logoUrl={logoUrl} highlightPaymentId={highlightPaymentId} />
    </Document>
  )
}
