import path from 'path'
import { Document, Page, Text, View, StyleSheet, Image, Font } from '@react-pdf/renderer'
import { InvoiceDetail } from '@/lib/queries/fees'

// Helvetica (react-pdf's default) has no glyph for the Naira sign (U+20A6).
// DejaVu Sans has full currency-symbol coverage, so we embed it instead.
Font.register({
  family: 'DejaVuSans',
  fonts: [
    { src: path.join(process.cwd(), 'public/fonts/DejaVuSans.ttf'), fontWeight: 'normal' },
    { src: path.join(process.cwd(), 'public/fonts/DejaVuSans-Bold.ttf'), fontWeight: 'bold' },
  ],
})

const MINT = '#5AD8A6'
const MINT_TEXT = '#2FAE7A'
const MINT_LIGHT = '#E8F8F1'
const NAVY = '#0D1B36'
const AMBER = '#B45309'
const RED = '#DC2626'
const GRAY = '#6b7280'

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: 'DejaVuSans',
    fontSize: 8.5,
    color: NAVY,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 28,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'flex-start', flex: 1, marginRight: 16 },
  logoBox: {
    width: 38,
    height: 38,
    backgroundColor: MINT_LIGHT,
    borderWidth: 1,
    borderColor: MINT,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    flexShrink: 0,
  },
  logoImage: { width: 38, height: 38, borderRadius: 7, marginRight: 12, flexShrink: 0 },
  logoInitials: { fontSize: 11, fontWeight: 'bold', color: NAVY },
  schoolTextBlock: { flexShrink: 1 },
  schoolName: { fontSize: 11, fontWeight: 'bold', color: NAVY, marginBottom: 4 },
  schoolInfo: { fontSize: 7.5, color: GRAY, lineHeight: 1.7 },
  headerRight: { alignItems: 'flex-end', width: 170, flexShrink: 0 },
  invoiceTitle: { fontSize: 14, fontWeight: 'bold', color: NAVY, marginBottom: 5 },
  invoiceNumber: { fontSize: 8.5, fontWeight: 'bold', color: NAVY, marginBottom: 12 },
  metaLine: { fontSize: 7.5, color: NAVY, marginTop: 3, textAlign: 'right' },
  metaLabel: { color: GRAY },

  // Info boxes
  infoRow: { flexDirection: 'row', marginBottom: 24 },
  box: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    padding: 18,
  },
  boxSecond: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    padding: 18,
    marginLeft: 16,
  },
  boxLabel: { fontSize: 8, fontWeight: 'bold', color: GRAY, marginBottom: 12 },
  studentName: { fontSize: 11, fontWeight: 'bold', color: NAVY, marginBottom: 12 },
  infoFieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 9,
  },
  infoFieldLabel: { fontSize: 7.5, color: GRAY },
  infoFieldValue: { fontSize: 8, color: NAVY },
  paymentDesc: { fontSize: 7.5, color: NAVY, lineHeight: 1.7, marginBottom: 12 },

  // Table
  table: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 20,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f9fafb',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  tableHeaderCell: { fontSize: 7.5, fontWeight: 'bold', color: GRAY },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  tableRowTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 11,
    paddingHorizontal: 14,
    backgroundColor: MINT_LIGHT,
  },
  itemNameCell: { flex: 3, flexDirection: 'row', alignItems: 'center' },
  itemAmountCell: { flex: 1, textAlign: 'right', fontSize: 8, color: NAVY },
  tableCell: { fontSize: 8, color: NAVY },
  previousBalanceText: { color: AMBER },
  creditAppliedText: { color: MINT_TEXT },
  creditAppliedNote: { fontSize: 6.5, color: MINT_TEXT, marginTop: 1 },
  optionalPill: {
    marginLeft: 6,
    paddingVertical: 1,
    paddingHorizontal: 6,
    backgroundColor: MINT_LIGHT,
    borderRadius: 8,
  },
  optionalPillText: { fontSize: 6.5, color: MINT_TEXT, fontWeight: 'bold' },
  totalLabel: { fontSize: 9, fontWeight: 'bold', color: NAVY },
  totalValue: { fontSize: 9.5, fontWeight: 'bold', color: MINT_TEXT },

  // Summary tiles
  summaryRow: {
    flexDirection: 'row',
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 16,
  },
  summaryTile: {
    flex: 1,
    borderLeftWidth: 1,
    borderLeftColor: '#e5e7eb',
    paddingLeft: 16,
  },
  summaryTileFirst: { flex: 1, paddingLeft: 0 },
  summaryLabel: { fontSize: 7.5, color: GRAY, marginBottom: 5 },
  summaryValue: { fontSize: 11.5, fontWeight: 'bold' },

  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    fontSize: 7,
    color: '#9ca3af',
    textAlign: 'center',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 8,
  },
})

function formatNaira(amount: number): string {
  return (amount < 0 ? '-₦' : '₦') + Math.abs(amount).toLocaleString('en-NG')
}

function formatDateShort(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
}

function getSchoolInitials(name: string): string {
  const words = name.split(/\s+/).filter(w => w.length > 0)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

interface Props {
  invoice: InvoiceDetail
  logoUrl?: string | null
}

export function InvoicePage({ invoice, logoUrl }: Props) {
  const initials = getSchoolInitials(invoice.schoolName)

  return (
    <Page size="A4" style={styles.page}>

      {/* Header */}
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
            {invoice.schoolAddress && <Text style={styles.schoolInfo}>{invoice.schoolAddress}</Text>}
            {invoice.schoolPhone && <Text style={styles.schoolInfo}>{invoice.schoolPhone}</Text>}
          </View>
        </View>

        <View style={styles.headerRight}>
          <Text style={styles.invoiceTitle}>Invoice</Text>
          <Text style={styles.invoiceNumber}>{invoice.invoiceNumber ? `#${invoice.invoiceNumber}` : ''}</Text>
          <Text style={styles.metaLine}>
            <Text style={styles.metaLabel}>Term: </Text>{invoice.cycleName}
          </Text>
          <Text style={styles.metaLine}>
            <Text style={styles.metaLabel}>Due date: </Text>{formatDateShort(invoice.cycleDueDate)}
          </Text>
        </View>
      </View>

      {/* Student + payment info */}
      <View style={styles.infoRow}>
        <View style={styles.box}>
          <Text style={styles.boxLabel}>student</Text>
          <Text style={styles.studentName}>
            {invoice.studentFirstName} {invoice.studentLastName}
          </Text>
          <View style={styles.infoFieldRow}>
            <Text style={styles.infoFieldLabel}>Admission #</Text>
            <Text style={styles.infoFieldValue}>{invoice.studentAdmissionNumber}</Text>
          </View>
          <View style={styles.infoFieldRow}>
            <Text style={styles.infoFieldLabel}>Class</Text>
            <Text style={styles.infoFieldValue}>{invoice.className}</Text>
          </View>
          {invoice.primaryParentName && (
            <View style={styles.infoFieldRow}>
              <Text style={styles.infoFieldLabel}>Parent / Guardian</Text>
              <Text style={styles.infoFieldValue}>{invoice.primaryParentName}</Text>
            </View>
          )}
          {invoice.primaryParentPhone && (
            <View style={styles.infoFieldRow}>
              <Text style={styles.infoFieldLabel}>Phone</Text>
              <Text style={styles.infoFieldValue}>{invoice.primaryParentPhone}</Text>
            </View>
          )}
        </View>

        <View style={styles.boxSecond}>
          <Text style={styles.boxLabel}>payment instructions</Text>
          {invoice.dvaAccountNumber ? (
            <>
              <Text style={styles.paymentDesc}>
                Please pay via bank transfer to the student&apos;s virtual account below.
              </Text>
              <View style={styles.infoFieldRow}>
                <Text style={styles.infoFieldLabel}>Account number</Text>
                <Text style={styles.infoFieldValue}>{invoice.dvaAccountNumber}</Text>
              </View>
              <View style={styles.infoFieldRow}>
                <Text style={styles.infoFieldLabel}>Bank name</Text>
                <Text style={styles.infoFieldValue}>{invoice.dvaBankName}</Text>
              </View>
            </>
          ) : (
            <Text style={styles.paymentDesc}>
              Please reach out to the school to generate a payment account for this student.
            </Text>
          )}
        </View>
      </View>

      {/* Line items */}
      <View style={styles.table}>
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderCell, styles.itemNameCell]}>Item</Text>
          <Text style={[styles.tableHeaderCell, styles.itemAmountCell]}>Amount (₦)</Text>
        </View>
        {invoice.lineItems.map((item, idx) => (
          <View key={idx} style={styles.tableRow}>
            <View style={styles.itemNameCell}>
              <View>
                <Text style={[
                  styles.tableCell,
                  item.kind === 'previous_balance' ? styles.previousBalanceText : {},
                  item.kind === 'credit_applied' ? styles.creditAppliedText : {},
                ]}>
                  {item.name}
                </Text>
                {item.kind === 'credit_applied' && (
                  <Text style={styles.creditAppliedNote}>From a prior overpayment, not a new payment this term</Text>
                )}
              </View>
              {item.kind === 'opt_in' && (
                <View style={styles.optionalPill}>
                  <Text style={styles.optionalPillText}>optional</Text>
                </View>
              )}
            </View>
            <Text style={[
              styles.itemAmountCell,
              item.kind === 'previous_balance' ? styles.previousBalanceText : {},
              item.kind === 'credit_applied' ? styles.creditAppliedText : {},
            ]}>
              {formatNaira(item.amount)}
            </Text>
          </View>
        ))}
        {invoice.discountAmount > 0 && (
          <View style={styles.tableRow}>
            <Text style={[styles.tableCell, styles.itemNameCell]}>Discount</Text>
            <Text style={styles.itemAmountCell}>-{formatNaira(invoice.discountAmount)}</Text>
          </View>
        )}
        <View style={styles.tableRowTotal}>
          <Text style={styles.totalLabel}>total</Text>
          <Text style={styles.totalValue}>{formatNaira(invoice.totalAmount)}</Text>
        </View>
      </View>

      {/* Summary tiles */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryTileFirst}>
          <Text style={styles.summaryLabel}>total amount</Text>
          <Text style={[styles.summaryValue, { color: NAVY }]}>{formatNaira(invoice.totalAmount)}</Text>
        </View>
        <View style={styles.summaryTile}>
          <Text style={styles.summaryLabel}>amount paid</Text>
          <Text style={[styles.summaryValue, { color: MINT_TEXT }]}>{formatNaira(invoice.paidAmount)}</Text>
        </View>
        <View style={styles.summaryTile}>
          <Text style={styles.summaryLabel}>outstanding balance</Text>
          <Text style={[styles.summaryValue, { color: invoice.outstandingAmount > 0 ? RED : MINT_TEXT }]}>
            {formatNaira(invoice.outstandingAmount)}
          </Text>
        </View>
      </View>

      {/* Footer */}
      <Text style={styles.footer} fixed>
        {invoice.schoolName} · Generated on {formatDateShort(invoice.generatedAt)}
      </Text>
    </Page>
  )
}

export default function InvoicePDF({ invoice, logoUrl }: Props) {
  return (
    <Document>
      <InvoicePage invoice={invoice} logoUrl={logoUrl} />
    </Document>
  )
}
