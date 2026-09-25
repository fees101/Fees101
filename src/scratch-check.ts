import { approveDiscount, rejectDiscount } from '@/app/(app)/discounts/actions'

type ResultA = Awaited<ReturnType<typeof approveDiscount>>
type ResultB = Awaited<ReturnType<typeof rejectDiscount>>

// @ts-expect-error intentionally inspect
const _a: ResultA = 1
// @ts-expect-error intentionally inspect
const _b: ResultB = 1
